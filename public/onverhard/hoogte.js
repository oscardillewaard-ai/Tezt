// Hoogtemeters uit het AHN (Actueel Hoogtebestand Nederland, maaiveld zonder
// gebouwen en bomen) via de WCS-dienst van PDOK. We halen alleen blokken van
// 500 x 500 m op (10 m per pixel, zo'n 9 kB per blok) waar de route doorheen
// gaat, en lezen het GeoTIFF zelf: 32-bits kommagetallen, zlib-ingepakt, met
// de 'floating point predictor' (TIFF-tag 317 = 3).

export const BLOK_M = 500
export const CEL_M = 10
const AHN_WCS = 'https://service.pdok.nl/rws/ahn/wcs/v1_0'

/** Het adres van één AHN-blok (RD, linksonder x0, y0). */
export function ahnUrl(x0, y0) {
  const n = BLOK_M / CEL_M
  return `${AHN_WCS}?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=dtm_05m&FORMAT=image/tiff` +
    `&SUBSET=x(${x0},${x0 + BLOK_M})&SUBSET=y(${y0},${y0 + BLOK_M})&SCALESIZE=x(${n}),y(${n})`
}

/** De blokken (linksonder, RD) waar deze punten in vallen. */
export function blokkenVoor(xy) {
  const uit = new Map()
  for (const [x, y] of xy) {
    const bx = Math.floor(x / BLOK_M) * BLOK_M
    const by = Math.floor(y / BLOK_M) * BLOK_M
    uit.set(bx + ',' + by, [bx, by])
  }
  return [...uit.values()]
}

async function pakUit(bytes) {
  const stroom = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stroom).arrayBuffer())
}

/**
 * Lees een AHN-GeoTIFF: {breedte, hoogte, x0, y1, cel, waarden: Float32Array}
 * (x0, y1 = linksboven in RD; waarden rij voor rij van boven naar beneden; NaN
 * waar geen hoogte is, zoals onder water en gebouwen).
 */
export async function leesAhnTiff(buffer) {
  const b = new Uint8Array(buffer)
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const klein = d.getUint16(0) === 0x4949
  if (!klein && d.getUint16(0) !== 0x4d4d) throw new Error('geen TIFF')
  const u16 = (o) => d.getUint16(o, klein)
  const u32 = (o) => d.getUint32(o, klein)
  const ifd = u32(4)
  const tags = new Map()
  const grootte = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 }
  for (let i = 0; i < u16(ifd); i++) {
    const e = ifd + 2 + 12 * i
    const tag = u16(e)
    const type = u16(e + 2)
    const aantal = u32(e + 4)
    const lengte = (grootte[type] || 1) * aantal
    const plek = lengte <= 4 ? e + 8 : u32(e + 8)
    const lees = (k) => (type === 3 ? u16(plek + 2 * k) : type === 4 ? u32(plek + 4 * k) : type === 12 ? d.getFloat64(plek + 8 * k, klein) : b[plek + k])
    if (type === 2) tags.set(tag, new TextDecoder().decode(b.subarray(plek, plek + aantal)).replace(/\0+$/, ''))
    else tags.set(tag, Array.from({ length: aantal }, (_, k) => lees(k)))
  }
  const breedte = tags.get(256)[0]
  const hoogte = tags.get(257)[0]
  if ((tags.get(258) || [32])[0] !== 32 || (tags.get(339) || [3])[0] !== 3) throw new Error('verwacht 32-bits kommagetallen')
  const compressie = (tags.get(259) || [1])[0]
  const predictor = (tags.get(317) || [1])[0]
  const rijenPerStrip = (tags.get(278) || [hoogte])[0]
  const offsets = tags.get(273)
  const lengtes = tags.get(279)
  const nodata = tags.has(42113) ? Number(tags.get(42113)) : NaN
  const schaal = tags.get(33550) || [1, 1]
  const punt = tags.get(33922) || [0, 0, 0, 0, 0, 0]
  const waarden = new Float32Array(breedte * hoogte)
  const rijBytes = breedte * 4
  const rij = new Uint8Array(rijBytes)
  const vier = new DataView(new ArrayBuffer(4))
  for (let s = 0; s < offsets.length; s++) {
    let data = b.subarray(offsets[s], offsets[s] + lengtes[s])
    if (compressie === 8 || compressie === 32946) data = await pakUit(data)
    else if (compressie !== 1) throw new Error(`TIFF-compressie ${compressie} wordt niet ondersteund`)
    const rijen = Math.min(rijenPerStrip, hoogte - s * rijenPerStrip)
    for (let r = 0; r < rijen; r++) {
      const y = s * rijenPerStrip + r
      const bron = data.subarray(r * rijBytes, (r + 1) * rijBytes)
      if (predictor === 3) {
        // bytes zijn per rij verschillen; daarna staan eerst alle hoogste bytes, dan de volgende, ...
        rij.set(bron)
        for (let i = 1; i < rijBytes; i++) rij[i] = (rij[i] + rij[i - 1]) & 0xff
        for (let x = 0; x < breedte; x++) {
          for (let k = 0; k < 4; k++) vier.setUint8(k, rij[x + k * breedte])
          waarden[y * breedte + x] = vier.getFloat32(0, false)
        }
      } else {
        const dv = new DataView(bron.buffer, bron.byteOffset, bron.byteLength)
        for (let x = 0; x < breedte; x++) waarden[y * breedte + x] = dv.getFloat32(4 * x, klein)
      }
    }
  }
  for (let i = 0; i < waarden.length; i++) if (!(Math.abs(waarden[i]) < 1e6) || waarden[i] === nodata) waarden[i] = NaN
  return { breedte, hoogte, x0: punt[3], y1: punt[4], cel: schaal[0], waarden }
}

/** Hoogte op een RD-punt (bilineair tussen de middens van de pixels); NaN als die er niet is. */
export function hoogteOp(raster, x, y) {
  const fx = (x - raster.x0) / raster.cel - 0.5
  const fy = (raster.y1 - y) / raster.cel - 0.5
  const i = Math.max(0, Math.min(raster.breedte - 2, Math.floor(fx)))
  const j = Math.max(0, Math.min(raster.hoogte - 2, Math.floor(fy)))
  const tx = Math.max(0, Math.min(1, fx - i))
  const ty = Math.max(0, Math.min(1, fy - j))
  const w = raster.waarden
  const v = (a, c) => w[(j + c) * raster.breedte + i + a]
  const p = [[v(0, 0), (1 - tx) * (1 - ty)], [v(1, 0), tx * (1 - ty)], [v(0, 1), (1 - tx) * ty], [v(1, 1), tx * ty]]
  let som = 0
  let gewicht = 0
  for (const [h, g] of p) if (!Number.isNaN(h)) {
    som += h * g
    gewicht += g
  }
  return gewicht > 0.01 ? som / gewicht : NaN
}

/**
 * Hoogteprofiel langs een route (RD-punten): om de 'stap' meter een hoogte,
 * gaten (water, gebouwen) opgevuld vanuit de buren, licht gladgestreken.
 * Stijgen en dalen tellen pas mee als het meer dan 'drempel' meter is (zo
 * telt ruis van de kaart niet op). Geeft {afstand: [], hoogte: [], stijgen, dalen, min, max}.
 */
export function hoogteprofiel(xy, rasters, { stap = 10, drempel = 2 } = {}) {
  const op = (x, y) => {
    const r = rasters.get(Math.floor(x / BLOK_M) * BLOK_M + ',' + Math.floor(y / BLOK_M) * BLOK_M)
    return r ? hoogteOp(r, x, y) : NaN
  }
  const afstand = []
  const hoogte = []
  let totaal = 0
  let rest = 0
  for (let i = 0; i < xy.length; i++) {
    if (i > 0) {
      const [ax, ay] = xy[i - 1]
      const [bx, by] = xy[i]
      const l = Math.hypot(bx - ax, by - ay)
      let t = stap - rest
      while (t <= l) {
        afstand.push(totaal + t)
        hoogte.push(op(ax + ((bx - ax) * t) / l, ay + ((by - ay) * t) / l))
        t += stap
      }
      rest = l - (t - stap)
      totaal += l
    } else {
      afstand.push(0)
      hoogte.push(op(xy[0][0], xy[0][1]))
    }
  }
  // gaten opvullen: lineair tussen de dichtstbijzijnde bekende hoogtes
  const bekend = hoogte.map((h, i) => (Number.isNaN(h) ? -1 : i)).filter((i) => i >= 0)
  if (!bekend.length) return null
  for (let i = 0; i < hoogte.length; i++) {
    if (!Number.isNaN(hoogte[i])) continue
    let k = 0
    while (k < bekend.length && bekend[k] < i) k++
    const na = bekend[Math.min(k, bekend.length - 1)]
    const voor = bekend[Math.max(0, k - 1)]
    if (voor === na || voor > i) hoogte[i] = hoogte[na]
    else if (na < i) hoogte[i] = hoogte[voor]
    else hoogte[i] = hoogte[voor] + ((hoogte[na] - hoogte[voor]) * (i - voor)) / (na - voor)
  }
  // licht gladstrijken (gemiddelde over 3 punten = 30 m)
  const glad = hoogte.map((h, i) => (hoogte[Math.max(0, i - 1)] + h + hoogte[Math.min(hoogte.length - 1, i + 1)]) / 3)
  let stijgen = 0
  let dalen = 0
  let ankers = glad[0]
  for (const h of glad) {
    if (h - ankers >= drempel) {
      stijgen += h - ankers
      ankers = h
    } else if (ankers - h >= drempel) {
      dalen += ankers - h
      ankers = h
    }
  }
  // het laatste stukje (onder de drempel) telt ook: stijgen - dalen = eind - begin
  const laatste = glad[glad.length - 1] - ankers
  if (laatste > 0) stijgen += laatste
  else dalen -= laatste
  return { afstand, hoogte: glad, stijgen, dalen, min: Math.min(...glad), max: Math.max(...glad) }
}
