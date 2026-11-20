// De vooraf bewerkte routegraaf (graaf-proef, achter ?graaf=vooraf): blokken lezen (NPG1-formaat, zie
// tools/graaf/schrijf.mjs), samenvoegen tot dezelfde graaf als graaf.js bouwGraaf maakt (zelfde
// kostenfunctie), en het vooraf berekende ondergrondoordeel en de hoogtes terugvinden langs een route.
// Puur rekenwerk, geen netwerk: het ophalen staat in bronnen.js.
import * as K from './kern.js'
import { STRAND_FACTOR, ALLES_FACTOR } from './graaf.js'
import { profielVanReeks } from './hoogte.js'

export const ONBEKEND_H = 32767
export const VLAG = { AFGESLOTEN: 1, STRAND: 2, PAADJE: 4, NATUUR: 8, TWIJFEL: 16 }
const BLOK_ZOOM = 12

/** Het blok (zoom 12) waar een kaarttegel (zoom 14) in valt. */
export const blokVanTegel = ([x, y], zoom = 14) => [x >> (zoom - BLOK_ZOOM), y >> (zoom - BLOK_ZOOM)]

/** De blokken die bij deze kaarttegels horen: [[x, y], ...] zonder dubbele. */
export function blokkenVoorTegels(tegels, zoom = 14) {
  const m = new Map()
  for (const t of tegels) {
    const b = blokVanTegel(t, zoom)
    m.set(b.join('/'), b)
  }
  return [...m.values()]
}

/** Lees één blok (de uitgepakte bytes). */
export function leesBlok(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const dv = new DataView(buf)
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'NPG1') throw new Error('geen NPG1-blok')
  const kopLengte = dv.getUint32(4, true)
  const kop = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + kopLengte)))
  let pos = 8 + kopLengte
  pos += (4 - (pos % 4)) % 4
  const rij = (Soort, aantal) => {
    const lengte = aantal * Soort.BYTES_PER_ELEMENT
    const uit = new Soort(buf.slice(pos, pos + lengte))
    pos += lengte + ((4 - (lengte % 4)) % 4)
    return uit
  }
  const { n, m, r, e, nr } = kop
  const lat = rij(Int32Array, n)
  const lon = rij(Int32Array, n)
  const hoogte = rij(Int16Array, n)
  for (let i = 1; i < n; i++) {
    lat[i] += lat[i - 1]
    lon[i] += lon[i - 1]
    hoogte[i] += hoogte[i - 1] // Int16Array: zelfde omslag als de schrijver
  }
  const vanD = rij(Int32Array, m)
  const naarD = rij(Int32Array, m)
  const van = new Uint32Array(m)
  const naar = new Uint32Array(m)
  let vorigeNaar = 0
  for (let s = 0; s < m; s++) {
    van[s] = vanD[s] + vorigeNaar
    naar[s] = naarD[s] + van[s]
    vorigeNaar = naar[s]
  }
  const tag = rij(Uint16Array, m)
  const klasse = rij(Uint8Array, m)
  const vlag = rij(Uint8Array, m)
  const op = rij(Uint8Array, m)
  const af = rij(Uint8Array, m)
  const osm = rij(Int32Array, m)
  for (let s = 1; s < m; s++) osm[s] += osm[s - 1]
  const rleAantal = rij(Uint8Array, m)
  const extraAantal = rij(Uint16Array, m)
  const rleN = rij(Uint16Array, r)
  const rleOordeel = rij(Uint16Array, r)
  const extra = rij(Int16Array, e)
  const rand = rij(Uint32Array, nr)
  const buren = rij(Uint8Array, nr)
  const rleBegin = new Uint32Array(m + 1)
  const extraBegin = new Uint32Array(m + 1)
  for (let s = 0; s < m; s++) {
    rleBegin[s + 1] = rleBegin[s] + rleAantal[s]
    extraBegin[s + 1] = extraBegin[s] + extraAantal[s]
    // tussenhoogtes: een keten vanaf de hoogte van 'van'
    let vorige = hoogte[van[s]]
    for (let j = extraBegin[s]; j < extraBegin[s + 1]; j++) {
      extra[j] += vorige
      vorige = extra[j]
    }
  }
  return {
    blok: kop.blok, n, m, lat, lon, hoogte, van, naar, tag, klasse, vlag, op, af, osm,
    rleBegin, rleN, rleOordeel, extraBegin, extra, rand, buren, tags: kop.tags, oordelen: kop.oordelen, pois: kop.pois || [],
  }
}

/**
 * Voeg gelezen blokken samen tot een graaf zoals graaf.js bouwGraaf hem geeft (zelfde velden, zelfde
 * kostenfunctie), plus g.vooraf met het oordeel en de hoogtes. opbouw: {trail, alles, kaartje, strandMijden}.
 * Wat de app nu in een tweede zoekronde doet (strand en afgesloten stukken buiten de natuur mijden), zit
 * hier meteen in de kosten: dat oordeel is vooraf bekend.
 */
export function bouwVoorafGraaf(blokken, { trail = true, alles = false, kaartje = false, strandMijden = true } = {}) {
  let maxN = 0
  let maxM = 0
  for (const b of blokken) {
    maxN += b.n
    maxM += b.m
  }
  const lat = new Float64Array(maxN)
  const lon = new Float64Array(maxN)
  const x = new Float64Array(maxN)
  const y = new Float64Array(maxN)
  const hoogte = new Int16Array(maxN)
  const randKnoop = new Map() // "lat,lon" (×1e7) -> knoop: de koppeling tussen buurblokken
  const tagLijst = []
  const tagIndex = new Map()
  const tagInfo = []
  const oordelen = []
  const oordeelIndex = new Map()
  const van = new Uint32Array(maxM)
  const naar = new Uint32Array(maxM)
  const lengte = new Float64Array(maxM)
  const factor = new Float64Array(maxM)
  const segTags = new Uint32Array(maxM)
  const segBlok = new Uint16Array(maxM)
  const segLokaal = new Uint32Array(maxM)
  const klasse = new Uint8Array(maxM)
  const vlag = new Uint8Array(maxM)
  const oordeelMap = []
  const pois = []
  let n = 0
  let m = 0
  let aantalStrand = 0
  blokken.forEach((b, bi) => {
    const isRand = new Uint8Array(b.n)
    for (const k of b.rand) isRand[k] = 1
    const kaart = new Uint32Array(b.n)
    for (let i = 0; i < b.n; i++) {
      if (isRand[i]) {
        const sleutel = b.lat[i] + ',' + b.lon[i]
        const al = randKnoop.get(sleutel)
        if (al !== undefined) {
          kaart[i] = al
          continue
        }
        randKnoop.set(sleutel, n)
      }
      lat[n] = b.lat[i] / 1e7
      lon[n] = b.lon[i] / 1e7
      const [px, py] = K.naarRd(lon[n], lat[n])
      x[n] = px
      y[n] = py
      hoogte[n] = b.hoogte[i]
      kaart[i] = n++
    }
    const tagKaart = b.tags.map((tekst) => {
      let ti = tagIndex.get(tekst)
      if (ti === undefined) {
        ti = tagLijst.push(tekst) - 1
        tagIndex.set(tekst, ti)
        tagInfo.push({ klasse: K.osmKlasse(tekst).klasse, highway: K.tagsObject(tekst).highway || '' })
      }
      return ti
    })
    oordeelMap.push(Uint16Array.from(b.oordelen, (o) => {
      const sleutel = JSON.stringify(o)
      let oi = oordeelIndex.get(sleutel)
      if (oi === undefined) {
        oi = oordelen.push({ klasse: K.KLASSEN[o[0]], uitleg: o[1], bron: o[2], strand: !!o[3] }) - 1
        oordeelIndex.set(sleutel, oi)
      }
      return oi
    }))
    for (const p of b.pois) pois.push({ type: 'poi', soort: p[0], naam: p[1], lat: p[2], lon: p[3] })
    for (let s = 0; s < b.m; s++) {
      const v = b.vlag[s]
      const afgesloten = (v & VLAG.AFGESLOTEN) !== 0
      if (afgesloten && !kaartje) continue // zoals bouwGraaf: afgesloten paden alleen met een toegangskaart
      const ti = tagKaart[b.tag[s]]
      const a = kaart[b.van[s]]
      const c = kaart[b.naar[s]]
      if (a === c) continue
      const info = tagInfo[ti]
      let f = (alles ? ALLES_FACTOR[info.highway] || 1 : K.kostenfactor(info.klasse, tagLijst[ti], trail)) * (afgesloten ? 1.3 : 1)
      if (strandMijden && (v & VLAG.STRAND)) f *= STRAND_FACTOR
      if (kaartje && afgesloten && !(v & VLAG.NATUUR)) f *= STRAND_FACTOR // erf of bedrijfsterrein, geen waterleidingduin
      if (f >= STRAND_FACTOR) aantalStrand++
      van[m] = a
      naar[m] = c
      lengte[m] = Math.hypot(x[a] - x[c], y[a] - y[c])
      factor[m] = f
      segTags[m] = ti
      segBlok[m] = bi
      segLokaal[m] = s
      klasse[m] = b.klasse[s]
      vlag[m] = v
      m++
    }
  })
  // buren per knoop (CSR), zoals bouwGraaf
  const graad = new Uint32Array(n + 1)
  for (let s = 0; s < m; s++) {
    graad[van[s] + 1]++
    graad[naar[s] + 1]++
  }
  for (let i = 0; i < n; i++) graad[i + 1] += graad[i]
  const buur = new Uint32Array(graad[n])
  const buurSeg = new Uint32Array(graad[n])
  const vul = graad.slice(0, n)
  for (let s = 0; s < m; s++) {
    buur[vul[van[s]]] = naar[s]
    buurSeg[vul[van[s]]++] = s
    buur[vul[naar[s]]] = van[s]
    buurSeg[vul[naar[s]]++] = s
  }
  return {
    n, lat: lat.slice(0, n), lon: lon.slice(0, n), x: x.slice(0, n), y: y.slice(0, n),
    begin: graad, buur, buurSeg,
    lengte: lengte.slice(0, m), factor: factor.slice(0, m), segTags: segTags.slice(0, m), tagLijst, binnenSeg: new Uint8Array(m).fill(1),
    van: van.slice(0, m), naar: naar.slice(0, m), aantalStrand,
    vooraf: {
      blokken: blokken.map((b) => ({ blok: b.blok, rleBegin: b.rleBegin, rleN: b.rleN, rleOordeel: b.rleOordeel, extraBegin: b.extraBegin, extra: b.extra, op: b.op, af: b.af, osm: b.osm })),
      segBlok: segBlok.slice(0, m), segLokaal: segLokaal.slice(0, m), klasse: klasse.slice(0, m), vlag: vlag.slice(0, m),
      oordeelMap, oordelen, hoogte: hoogte.slice(0, n), pois,
    },
  }
}

// ---------- langs een route ----------
/** Per stap van de route (knoop i -> i+1): segment, richting en de afstand vanaf de start. */
function stappen(r) {
  if (r._stappen) return r._stappen
  const { g, knopen, segs } = r
  const tot = new Float64Array(knopen.length)
  const vooruit = new Uint8Array(segs.length)
  for (let i = 0; i < segs.length; i++) {
    tot[i + 1] = tot[i] + g.lengte[segs[i]]
    vooruit[i] = g.van[segs[i]] === knopen[i] ? 1 : 0
  }
  r._stappen = { tot, vooruit }
  return r._stappen
}

/** De stap waarin afstand d (m vanaf de start) valt, en hoe ver in het segment (0..1, vanaf 'van'). */
function plekOp(r, d) {
  const { tot, vooruit } = stappen(r)
  let lo = 0
  let hi = r.segs.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (tot[mid] <= d) lo = mid
    else hi = mid - 1
  }
  const l = tot[lo + 1] - tot[lo]
  const t = l > 0 ? Math.max(0, Math.min(1, (d - tot[lo]) / l)) : 0.5
  return { stap: lo, seg: r.segs[lo], frac: vooruit[lo] ? t : 1 - t }
}

/** Het vooraf berekende BGT-oordeel op een plek in een segment: {klasse, uitleg, bron, strand}. */
function oordeelIn(v, seg, frac) {
  const bi = v.segBlok[seg]
  const b = v.blokken[bi]
  const s = v.segLokaal[seg]
  const r0 = b.rleBegin[s]
  const r1 = b.rleBegin[s + 1]
  let k = 0
  for (let r = r0; r < r1; r++) k += b.rleN[r]
  let i = Math.min(k - 1, Math.floor(frac * k))
  for (let r = r0; r < r1; r++) {
    if (i < b.rleN[r]) return v.oordelen[v.oordeelMap[bi][b.rleOordeel[r]]]
    i -= b.rleN[r]
  }
  return v.oordelen[v.oordeelMap[bi][b.rleOordeel[r1 - 1]]]
}

/** De route (traject) ligt op de vooraf bewerkte graaf? (maakTraject zet dan traject.vooraf.) */
export const heeftVooraf = (traject) => !!(traject && traject.vooraf && traject.vooraf.g && traject.vooraf.g.vooraf)

/**
 * Een vervanger voor BgtVlakken in kern.js analyseer(): het oordeel per meetpunt komt uit de graaf
 * (gezocht op de afstand langs de route), niet uit de BGT-tegels.
 */
export function voorafVlakken(traject) {
  const r = traject.vooraf
  return {
    lijst: [true], // "de officiële kaart is gebruikt"
    zoekMeetpunt: (mp) => {
      const p = plekOp(r, mp.af)
      return oordeelIn(r.g.vooraf, p.seg, p.frac)
    },
  }
}

/** Ligt het stuk tussen afstand van en tot (m) volgens de voorbewerking in de natuur (toegangskaart-gebied)? */
export function inNatuur(traject, van, tot) {
  const r = traject.vooraf
  const p = plekOp(r, (van + tot) / 2)
  return (r.g.vooraf.vlag[p.seg] & VLAG.NATUUR) !== 0
}

/**
 * Hoogteprofiel uit de vooraf berekende hoogtes (knopen + om de 10 m), op dezelfde manier als
 * hoogte.js hoogteprofiel (om de 10 m, gaten opvullen, gladstrijken, drempel 2 m). Geeft
 * {profiel, perKnoop} (hoogte per routepunt, voor de GPX) of null.
 */
export function voorafProfiel(traject, { stap = 10, drempel = 2 } = {}) {
  const r = traject.vooraf
  const { g, knopen, segs } = r
  const v = g.vooraf
  const { tot, vooruit } = stappen(r)
  const hm = (dm) => (dm === ONBEKEND_H ? NaN : dm / 10)
  // dichte reeks (afstand, hoogte) langs de route
  const da = [0]
  const dh = [hm(v.hoogte[knopen[0]])]
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]
    const b = v.blokken[v.segBlok[s]]
    const ls = v.segLokaal[s]
    const e0 = b.extraBegin[ls]
    const e1 = b.extraBegin[ls + 1]
    const l = g.lengte[s]
    if (vooruit[i]) for (let j = e0; j < e1; j++) {
      da.push(tot[i] + Math.min(l, 10 * (j - e0 + 1)))
      dh.push(hm(b.extra[j]))
    }
    else for (let j = e1 - 1; j >= e0; j--) {
      da.push(tot[i] + Math.max(0, l - 10 * (j - e0 + 1)))
      dh.push(hm(b.extra[j]))
    }
    da.push(tot[i + 1])
    dh.push(hm(v.hoogte[knopen[i + 1]]))
  }
  // om de 'stap' meter, lineair tussen de buren (een onbekende buur telt niet mee)
  const afstand = []
  const hoogte = []
  const totaal = tot[segs.length]
  let k = 0
  for (let d = 0; d <= totaal + 1e-6; d += stap) {
    while (k < da.length - 2 && da[k + 1] < d) k++
    const a = dh[k]
    const c = dh[k + 1] ?? a
    const l = (da[k + 1] ?? da[k]) - da[k]
    const t = l > 0 ? Math.max(0, Math.min(1, (d - da[k]) / l)) : 0
    afstand.push(d)
    hoogte.push(Number.isNaN(a) ? c : Number.isNaN(c) ? a : a + t * (c - a))
  }
  const profiel = profielVanReeks(afstand, hoogte, drempel)
  if (!profiel) return null
  const perKnoop = knopen.map((kn) => {
    const h = hm(v.hoogte[kn])
    return Number.isNaN(h) ? null : Math.round(h * 10) / 10
  })
  return { profiel, perKnoop }
}

/** De waterpunten (POI's) uit de geladen blokken. */
export const voorafPois = (traject) => traject.vooraf.g.vooraf.pois
