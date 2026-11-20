// Voorbewerking (graaf-proef): bouw de routegraaf van een regio één keer vooraf, met per wegstuk het
// ondergrondoordeel (BGT + OSM, dezelfde code als de app), toegang, strand, toegangskaart-gebied en
// hoogtes (AHN, dezelfde bron en methode als de app), en schrijf hem in blokken (zoom 12) naar
// public/onverhard/graaf/<versie>/ met een manifest.
//
//   node --max-old-space-size=8000 tools/graaf/bouw.mjs [--bron ofm|<elementen.ndjson uit bron_pbf.py>] [--versie v1] [--uit public/onverhard/graaf]
//
// Bronnen: "ofm" = de OpenFreeMap-kaarttegels (zoom 14) die de app nu ook leest (werkt overal);
// een .ndjson-bestand = ways uit een OpenStreetMap-extract van Geofabrik (tools/graaf/bron_pbf.py, in de
// GitHub Action). Alle downloads gaan via een schijfcache (haal.mjs), een paar tegelijk.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { haal, tegelijk, teller } from './haal.mjs'
import { ofmElementen, ofmVersie } from './bron_ofm.mjs'
import { segMeetpunten, segTussen, bgtTegelsVoorSeg, ahnBlokVan } from './nodig.mjs'
import { schrijfBlok } from './schrijf.mjs'
import * as G from '../../public/onverhard/graaf.js'
import * as K from '../../public/onverhard/kern.js'
import * as H from '../../public/onverhard/hoogte.js'
import * as T from '../../public/onverhard/osmtegels.js'
import { tagsVanOsm } from './osmtags.mjs'

const HIER = path.dirname(fileURLToPath(import.meta.url))
const BGT_URL = 'https://api.pdok.nl/kadaster/bgt/ogc/v1/tiles/NetherlandsRDNewQuad/12/'

export function laadRegio(pad = path.join(HIER, 'regio.json')) {
  const r = JSON.parse(fs.readFileSync(pad, 'utf8'))
  r.blokken = []
  for (let x = r.blokken_x[0]; x <= r.blokken_x[1]; x++) for (let y = r.blokken_y[0]; y <= r.blokken_y[1]; y++) r.blokken.push([x, y])
  return r
}

/** Elementen ({type:'way', tags, geometry, osm}) uit de gekozen bron, plus snap (zoals de app). */
export async function laadElementen(regio, bron) {
  if (bron === 'ofm') {
    const { elementen, bron: info } = await ofmElementen(regio.blokken)
    return { elementen, snap: 1.5, info } // kaarttegels: losse eindjes aan het netwerk knopen (zoals de app)
  }
  // ndjson uit bron_pbf.py: per regel {osm, tags, geometry: [[lat, lon], ...]} of {poi|station}
  const elementen = []
  let id = 0
  for (const regel of fs.readFileSync(bron, 'utf8').split('\n')) {
    if (!regel.trim()) continue
    const e = JSON.parse(regel)
    if (e.soort === 'way') {
      const tags = tagsVanOsm(e.tags)
      if (tags) elementen.push({ type: 'way', id: ++id, osm: e.osm, tags, geometry: e.geometry.map(([lat, lon]) => ({ lat, lon })) })
    } else if (e.soort === 'poi') elementen.push({ type: 'poi', id: ++id, soort: e.poi, naam: e.naam, lat: e.lat, lon: e.lon })
    else if (e.soort === 'station') elementen.push({ ...e, type: 'station', id: ++id, soort: 'station' })
  }
  const kop = JSON.parse(fs.readFileSync(bron.replace(/\.ndjson$/, '.json'), 'utf8'))
  return { elementen, snap: 0, info: { naam: 'OpenStreetMap-extract (Geofabrik)', ...kop } } // echte knopen: geen snap nodig (zoals Overpass)
}

/** Stations zoals de app ze vindt: OpenFreeMap-tegels op zoom 12, laag poi. */
async function ofmStations(regio) {
  const { sjabloon, versie } = await ofmVersie()
  const lijsten = await tegelijk(regio.blokken, 4, async ([x, y]) => {
    const b = await haal(sjabloon.replace('{z}', 12).replace('{x}', x).replace('{y}', y), `ofm/${versie}/12/${x}/${y}.pbf`)
    return b ? T.leesOsmTegel(b, x, y, 0, { zoom: 12, lagen: ['poi'] }).filter((e) => e.type === 'station') : []
  })
  return lijsten.flat()
}

// ---------- BGT: vlakken per groep, met een kleine cache van gelezen tegels ----------
const gelezen = new Map()
async function bgtTegel(col, row) {
  const k = col + '/' + row
  if (gelezen.has(k)) {
    const v = gelezen.get(k)
    gelezen.delete(k)
    gelezen.set(k, v)
    return v
  }
  const bytes = await haal(`${BGT_URL}${row}/${col}?f=mvt`, `bgt/${col}_${row}.mvt`, { maxDagen: 30 })
  const v = bytes ? K.leesTegel(bytes, col, row) : []
  gelezen.set(k, v)
  if (gelezen.size > 500) gelezen.delete(gelezen.keys().next().value)
  return v
}

async function vlakkenVoor(tegels) {
  const vlakken = new K.BgtVlakken(K.SNAP_M)
  // vaste volgorde (de app voegt ze toe in volgorde van binnenkomst; voor het oordeel maakt dat niet uit)
  for (const k of [...tegels].sort()) {
    const [col, row] = k.split('/').map(Number)
    const gebied = K.tegelGebied(col, row)
    for (const v of await bgtTegel(col, row)) {
      if (v.collectie === 'waterdeel') {
        if (v.props.type === 'zee') vlakken.voegToeZee(v.props.lokaal_id, v.polygonen)
      } else vlakken.voegToeVlak(v.collectie, v.props, v.polygonen, gebied)
    }
  }
  return vlakken
}

function meestVoorkomend(lijst, sleutel) {
  const telling = new Map()
  for (const item of lijst) {
    const k = sleutel(item)
    const t = telling.get(k)
    if (t) t.n += 1
    else telling.set(k, { n: 1, item })
  }
  let beste = null
  for (const t of telling.values()) if (!beste || t.n > beste.n) beste = t
  return beste
}

const ONBEKEND_H = 32767
const z12Van = (lat, lon) => T.tegelXY(lat, lon, 12)

async function hoofd() {
  const arg = (naam, std) => {
    const i = process.argv.indexOf(naam)
    return i > 0 ? process.argv[i + 1] : std
  }
  const bronArg = arg('--bron', 'ofm')
  const datum = new Date().toISOString().slice(0, 10)
  const versie = arg('--versie', 'v' + datum.replaceAll('-', ''))
  const uitBasis = arg('--uit', path.join(HIER, '../../public/onverhard/graaf'))
  const regio = laadRegio(arg('--regio', undefined))
  const t0 = Date.now()
  const tijd = {}
  const stap = (naam) => { tijd[naam] = Math.round((Date.now() - t0) / 1000); console.log(`[${tijd[naam]} s] ${naam}`) }

  const { elementen, snap, info } = await laadElementen(regio, bronArg)
  stap('elementen')
  const g = G.bouwGraaf(elementen, { kaartje: true, strandMijden: true, snap, metBron: true, trail: true })
  const m = g.van.length
  console.log('graaf', g.n, 'knopen', m, 'segmenten')
  stap('graaf')

  // per segment: blok (midden), groep (z14-tegel van het midden)
  const blokVan = new Int32Array(m).fill(-1)
  const blokIndex = new Map(regio.blokken.map((b, i) => [b.join('/'), i]))
  const groepen = new Map()
  for (let s = 0; s < m; s++) {
    const a = g.van[s]
    const b = g.naar[s]
    const la = (g.lat[a] + g.lat[b]) / 2
    const lo = (g.lon[a] + g.lon[b]) / 2
    const bi = blokIndex.get(z12Van(la, lo).join('/'))
    if (bi === undefined) continue
    blokVan[s] = bi
    const k = T.tegelXY(la, lo, 14).join('/')
    if (!groepen.has(k)) groepen.set(k, [])
    groepen.get(k).push(s)
  }

  // ---------- ondergrond (BGT + OSM), per groep ----------
  const oordelen = []
  const oordeelIndex = new Map()
  const oordeelVan = (o) => {
    const rij = [K.KLASSEN.indexOf(o.klasse), o.uitleg, o.bron, o.strand ? 1 : 0]
    const k = rij.join('|')
    let i = oordeelIndex.get(k)
    if (i === undefined) {
      i = oordelen.push(rij) - 1
      oordeelIndex.set(k, i)
    }
    return i
  }
  const klasse = new Uint8Array(m)
  const vlag = new Uint8Array(m)
  const rle = new Array(m)
  const stats = { twijfel: 0, strand: 0, afgesloten: 0, natuur: 0 }
  const groepLijst = [...groepen.entries()].sort((p, q) => p[0].localeCompare(q[0]))
  let gi = 0
  for (const [, segs] of groepLijst) {
    if (++gi % 50 === 0) console.log(`  ondergrond: groep ${gi}/${groepLijst.length} (${teller.net} opgehaald, ${teller.cache} uit cache)`)
    const tegels = new Set()
    for (const s of segs) bgtTegelsVoorSeg(g, s, K.alleenMetKaartje(g.tagLijst[g.segTags[s]]), tegels)
    const vlakken = await vlakkenVoor(tegels)
    for (const s of segs) {
      const tekst = g.tagLijst[g.segTags[s]]
      const osm = K.osmKlasse(tekst)
      const niveau = K.osmNiveau(tekst)
      const osmGroep = osm.zeker ? K.groep(osm.klasse) : null
      const lijst = segMeetpunten(g, s).map(([x, y]) => vlakken.zoek(x, y, niveau, osmGroep))
      // oordeel per meetpunt (runs)
      const runs = []
      for (const o of lijst) {
        const oi = oordeelVan(o)
        const laatste = runs[runs.length - 1]
        if (laatste && laatste[1] === oi && laatste[0] < 65535) laatste[0]++
        else runs.push([1, oi])
      }
      while (runs.length > 255) { // past niet in een Uint8: de kortste runs bij de buur
        let k = 0
        for (let i = 1; i < runs.length; i++) if (runs[i][0] < runs[k][0]) k = i
        const buur = k > 0 ? k - 1 : 1
        runs[buur][0] += runs[k][0]
        runs.splice(k, 1)
      }
      rle[s] = runs
      // het eindoordeel van het hele wegstuk, zoals analyseer() het per stuk doet
      const top = meestVoorkomend(lijst, (o) => o.klasse)
      const detail = meestVoorkomend(lijst.filter((o) => o.klasse === top.item.klasse), (o) => o.uitleg + '|' + o.bron).item
      const st = { osm: osm.klasse, osmZeker: osm.zeker, osmUitleg: osm.uitleg, bgt: top.item.klasse, bgtUitleg: detail.uitleg, bgtBron: detail.bron }
      K.bepaalEindEnTwijfel(st)
      klasse[s] = K.KLASSEN.indexOf(st.eind)
      let v = 0
      const afgesloten = K.alleenMetKaartje(tekst)
      if (afgesloten) {
        v |= 1
        stats.afgesloten++
        const mx = (g.x[g.van[s]] + g.x[g.naar[s]]) / 2
        const my = (g.y[g.van[s]] + g.y[g.naar[s]]) / 2
        if (vlakken.natuur(mx, my) >= 0.6) { v |= 8; stats.natuur++ }
      }
      if (g.factor[s] >= G.STRAND_FACTOR || detail.strand) { v |= 2; stats.strand++ }
      const hw = K.tagsObject(tekst).highway
      if (hw === 'path' || hw === 'footway') v |= 4
      if (st.twijfel) { v |= 16; stats.twijfel++ }
      vlag[s] = v
    }
  }
  console.log('oordelen', oordelen.length, stats)
  stap('ondergrond')

  // ---------- hoogte (AHN, zelfde blokken en methode als de app) ----------
  const ahnNodig = new Map()
  for (let i = 0; i < g.n; i++) { const b = ahnBlokVan(g.x[i], g.y[i]); ahnNodig.set(b.join(','), b) }
  for (let s = 0; s < m; s++) if (blokVan[s] >= 0) for (const [x, y] of segTussen(g, s)) { const b = ahnBlokVan(x, y); ahnNodig.set(b.join(','), b) }
  const rasters = new Map()
  await tegelijk([...ahnNodig.entries()], 4, async ([k, [x0, y0]]) => {
    try {
      const b = await haal(H.ahnUrl(x0, y0), `ahn/${x0}_${y0}.tif`, { maxDagen: 365 })
      if (b) rasters.set(k, await H.leesAhnTiff(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)))
    } catch (fout) {
      console.log('  ahn', k, fout.message)
    }
  }, { naam: 'ahn', elk: 2000 })
  const hoogteDm = (x, y) => {
    const r = rasters.get(Math.floor(x / H.BLOK_M) * H.BLOK_M + ',' + Math.floor(y / H.BLOK_M) * H.BLOK_M)
    const h = r ? H.hoogteOp(r, x, y) : NaN
    return Number.isNaN(h) ? ONBEKEND_H : Math.round(h * 10)
  }
  const knoopH = new Int16Array(g.n)
  for (let i = 0; i < g.n; i++) knoopH[i] = hoogteDm(g.x[i], g.y[i])
  const extra = new Array(m)
  const op = new Uint8Array(m)
  const af = new Uint8Array(m)
  for (let s = 0; s < m; s++) {
    if (blokVan[s] < 0) continue
    extra[s] = segTussen(g, s).map(([x, y]) => hoogteDm(x, y))
    let o = 0
    let a = 0
    let vorige = null
    for (const h of [knoopH[g.van[s]], ...extra[s], knoopH[g.naar[s]]]) {
      if (h === ONBEKEND_H) continue
      if (vorige !== null) { if (h > vorige) o += h - vorige; else a += vorige - h }
      vorige = h
    }
    op[s] = Math.min(255, o)
    af[s] = Math.min(255, a)
  }
  console.log('AHN-blokken', rasters.size, 'van', ahnNodig.size)
  stap('hoogte')

  // ---------- blokken ----------
  const knoopBlokken = new Map() // knoop -> Set(blok)
  for (let s = 0; s < m; s++) {
    if (blokVan[s] < 0) continue
    for (const k of [g.van[s], g.naar[s]]) {
      let st = knoopBlokken.get(k)
      if (!st) knoopBlokken.set(k, (st = new Set()))
      st.add(blokVan[s])
    }
  }
  const poisPerBlok = regio.blokken.map(() => [])
  const gezienPoi = new Set()
  for (const e of elementen) {
    if (e.type !== 'poi') continue
    const k = `${e.soort}|${e.lat}|${e.lon}`
    if (gezienPoi.has(k)) continue
    gezienPoi.add(k)
    const bi = blokIndex.get(z12Van(e.lat, e.lon).join('/'))
    if (bi !== undefined) poisPerBlok[bi].push([e.soort, e.naam, e.lat, e.lon])
  }
  const RICHTING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]]
  const map = path.join(uitBasis, versie)
  fs.mkdirSync(map, { recursive: true })
  const segsPerBlok = regio.blokken.map(() => [])
  for (let s = 0; s < m; s++) if (blokVan[s] >= 0) segsPerBlok[blokVan[s]].push(s)
  const lijst = []
  for (const [bi, [bx, by]] of regio.blokken.entries()) {
    const segs = segsPerBlok[bi]
    const lokaal = new Map()
    const knopen = []
    const lok = (k) => {
      let i = lokaal.get(k)
      if (i === undefined) { i = knopen.push(k) - 1; lokaal.set(k, i) }
      return i
    }
    const tagLokaal = new Map()
    const tags = []
    const oordeelLokaal = new Map()
    const oordeelLijst = []
    const b = {
      blok: [bx, by], van: [], naar: [], tag: [], klasse: [], vlag: [], op: [], af: [], osm: [], rleN: [], rleOordeel: [], extra: [],
      pois: poisPerBlok[bi],
    }
    for (const s of segs) {
      b.van.push(lok(g.van[s]))
      b.naar.push(lok(g.naar[s]))
      const tekst = g.tagLijst[g.segTags[s]]
      if (!tagLokaal.has(tekst)) tagLokaal.set(tekst, tags.push(tekst) - 1)
      b.tag.push(tagLokaal.get(tekst))
      b.klasse.push(klasse[s])
      b.vlag.push(vlag[s])
      b.op.push(op[s])
      b.af.push(af[s])
      b.osm.push(elementen[g.segBron[s]]?.osm || 0)
      b.rleN.push(rle[s].map((r) => r[0]))
      b.rleOordeel.push(rle[s].map((r) => {
        if (!oordeelLokaal.has(r[1])) oordeelLokaal.set(r[1], oordeelLijst.push(oordelen[r[1]]) - 1)
        return oordeelLokaal.get(r[1])
      }))
      b.extra.push(extra[s])
    }
    b.lat = Int32Array.from(knopen, (k) => Math.round(g.lat[k] * 1e7))
    b.lon = Int32Array.from(knopen, (k) => Math.round(g.lon[k] * 1e7))
    b.hoogte = Int16Array.from(knopen, (k) => knoopH[k])
    b.tags = tags
    b.oordelen = oordeelLijst
    b.rand = []
    b.buren = []
    knopen.forEach((k, i) => {
      const st = knoopBlokken.get(k)
      if (!st || st.size < 2) return
      let mask = 0
      for (const andere of st) {
        if (andere === bi) continue
        const [ox, oy] = regio.blokken[andere]
        const r = RICHTING.findIndex(([dx, dy]) => dx === ox - bx && dy === oy - by)
        if (r >= 0) mask |= 1 << r
      }
      b.rand.push(i)
      b.buren.push(mask)
    })
    const { ruw, gz } = schrijfBlok(b)
    const bestand = `z12_${bx}_${by}.npg.gz`
    fs.writeFileSync(path.join(map, bestand), gz)
    lijst.push({ x: bx, y: by, bestand, ruw: ruw.length, gz: gz.length, sha256: crypto.createHash('sha256').update(gz).digest('hex').slice(0, 16), knopen: knopen.length, wegstukken: segs.length, rand: b.rand.length, pois: b.pois.length })
  }
  stap('blokken')

  const stations = bronArg === 'ofm' ? await ofmStations(regio) : elementen.filter((e) => e.type === 'station')
  const gezienSt = new Set()
  const stationLijst = []
  for (const s of stations) {
    const k = `${s.naam}|${s.lat.toFixed(5)}|${s.lon.toFixed(5)}`
    if (gezienSt.has(k)) continue
    gezienSt.add(k)
    stationLijst.push({ soort: s.soort, naam: s.naam, trein: s.trein, rank: s.rank, lat: s.lat, lon: s.lon })
  }
  const som = (k) => lijst.reduce((t, b) => t + b[k], 0)
  const manifest = {
    formaat: 'NPG1', versie, datum, gebouwd: new Date().toISOString(),
    regio: { naam: regio.naam, zoom: regio.zoom, bbox: regio.bbox_lonlat, blokken_x: regio.blokken_x, blokken_y: regio.blokken_y },
    bronnen: [
      { soort: 'osm', ...info },
      { soort: 'bgt', naam: 'BGT-vectortegels (PDOK), NetherlandsRDNewQuad 12', opgehaald: datum, maxLeeftijdDagen: 30 },
      { soort: 'ahn', naam: 'AHN dtm_05m via WCS (PDOK), 10 m per pixel', opgehaald: datum },
    ],
    totaal: { blokken: lijst.length, ruw: som('ruw'), gz: som('gz'), knopen: som('knopen'), wegstukken: som('wegstukken'), oordelen: oordelen.length, ...stats },
    bouwtijdSeconden: tijd,
    blokken: lijst,
    stations: stationLijst,
  }
  fs.writeFileSync(path.join(map, 'manifest.json'), JSON.stringify(manifest, null, 1))
  // actueel.json: wat de app leest (zelfde inhoud, bestandsnamen met de versiemap ervoor)
  const actueel = { ...manifest, blokken: lijst.map((b) => ({ ...b, bestand: `${versie}/${b.bestand}` })) }
  fs.writeFileSync(path.join(uitBasis, 'actueel.json'), JSON.stringify(actueel))
  stap('klaar')
  console.log(JSON.stringify(manifest.totaal), 'downloads', teller)
}

if (import.meta.url === `file://${process.argv[1]}`) await hoofd()
