// Eigen routeplanner in de browser: de paden komen uit OpenStreetMap (via de
// Overpass API), de route rekenen we zelf uit. Voordeel ten opzichte van een
// routeserver: geen limiet op het aantal verzoeken, dus we kunnen honderden
// rondjes proberen, en we bepalen zelf wat verboden is (zoals het strand).
//
// Puur rekenwerk, geen netwerk: het ophalen staat in bronnen.js.

import * as K from './kern.js'

const NOOIT = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'platform', 'elevator', 'abandoned', 'razed'])
export const STRAND_FACTOR = 40 // strand mag alleen als er echt niets anders is

/** De Overpass-vraag: alle wegen en paden plus de stranden in een bbox [zuid, west, noord, oost]. */
export function overpassVraag([z, w, n, o]) {
  const bb = `${z.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${o.toFixed(5)}`
  return `[out:json][timeout:90];(way["highway"](${bb});way["natural"="beach"](${bb});relation["natural"="beach"](${bb}););out geom qt;`
}

function tagTekst(tags) {
  return Object.entries(tags || {})
    .filter(([k]) => !k.includes(' ') && !/^(name|note|description|source|fixme|wikidata|wikipedia)/.test(k))
    .map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_')}`)
    .join(' ')
}

/** Strandvlakken uit de Overpass-elementen, als ringen in RD (plat [x, y, ...]). */
function strandRingen(elementen) {
  const ringen = []
  const voegToe = (geom) => {
    if (!geom || geom.length < 4) return
    const r = new Float64Array(geom.length * 2)
    geom.forEach((p, i) => {
      const [x, y] = K.naarRd(p.lon, p.lat)
      r[2 * i] = x
      r[2 * i + 1] = y
    })
    ringen.push(r)
  }
  for (const e of elementen) {
    if (!e.tags || e.tags.natural !== 'beach') continue
    if (e.type === 'way') voegToe(e.geometry)
    else if (e.type === 'relation') for (const m of e.members || []) if (m.role === 'outer') voegToe(m.geometry)
  }
  return ringen.map((r) => ({ polygonen: [[r]], bbox: bboxRing(r) }))
}

function bboxRing(r) {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < b[0]) b[0] = r[i]
    if (r[i] > b[2]) b[2] = r[i]
    if (r[i + 1] < b[1]) b[1] = r[i + 1]
    if (r[i + 1] > b[3]) b[3] = r[i + 1]
  }
  return b
}

function opStrand(x, y, stranden) {
  for (const s of stranden) {
    const b = s.bbox
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue
    if (K.afstandTotVlak(x, y, s.polygonen) === 0) return true
  }
  return false
}

/**
 * Bouw de graaf. opties: {trail, kaartje, strandMijden, extraStranden}
 * (extraStranden: vlakken {polygonen, bbox} uit de officiële kaart).
 * Knopen zijn de punten van de OSM-wegen (gedeelde punten = kruisingen).
 */
export function bouwGraaf(elementen, { trail = true, kaartje = false, strandMijden = true, extraStranden = [] } = {}) {
  const stranden = strandMijden ? strandRingen(elementen).concat(extraStranden) : []
  const knoop = new Map()
  const lat = []
  const lon = []
  const xs = []
  const ys = []
  const knoopVan = (p) => {
    const k = p.lat + ',' + p.lon
    let i = knoop.get(k)
    if (i === undefined) {
      i = lat.length
      knoop.set(k, i)
      lat.push(p.lat)
      lon.push(p.lon)
      const [x, y] = K.naarRd(p.lon, p.lat)
      xs.push(x)
      ys.push(y)
    }
    return i
  }
  // segmenten: van, naar, lengte, kosten per meter, tags
  const van = []
  const naar = []
  const lengte = []
  const factor = []
  const segTags = []
  const tagLijst = []
  const tagIndex = new Map()
  for (const e of elementen) {
    if (e.type !== 'way' || !e.tags || !e.tags.highway || !e.geometry) continue
    const t = e.tags
    if (NOOIT.has(t.highway) || t.area === 'yes') continue
    const tekst = tagTekst(t)
    const footok = ['yes', 'designated', 'permissive'].includes(t.foot)
    const afgesloten = (['no', 'private'].includes(t.access) && !footok) || ['no', 'private'].includes(t.foot)
    if (afgesloten && !kaartje) continue
    let ti = tagIndex.get(tekst)
    if (ti === undefined) {
      ti = tagLijst.push(tekst) - 1
      tagIndex.set(tekst, ti)
    }
    const f0 = K.kostenfactor(K.osmKlasse(tekst).klasse, tekst, trail) * (afgesloten ? 1.3 : 1)
    const geom = e.geometry
    for (let i = 1; i < geom.length; i++) {
      if (!geom[i - 1] || !geom[i]) continue
      const a = knoopVan(geom[i - 1])
      const b = knoopVan(geom[i])
      if (a === b) continue
      const l = Math.hypot(xs[a] - xs[b], ys[a] - ys[b])
      const strand = stranden.length && opStrand((xs[a] + xs[b]) / 2, (ys[a] + ys[b]) / 2, stranden)
      van.push(a)
      naar.push(b)
      lengte.push(l)
      factor.push(f0 * (strand ? STRAND_FACTOR : 1))
      segTags.push(ti)
    }
  }
  // buren per knoop (CSR): beide richtingen, met het segmentnummer
  const n = lat.length
  const graad = new Uint32Array(n + 1)
  for (let s = 0; s < van.length; s++) {
    graad[van[s] + 1]++
    graad[naar[s] + 1]++
  }
  for (let i = 0; i < n; i++) graad[i + 1] += graad[i]
  const buur = new Uint32Array(graad[n])
  const buurSeg = new Uint32Array(graad[n])
  const vul = graad.slice(0, n)
  for (let s = 0; s < van.length; s++) {
    buur[vul[van[s]]] = naar[s]
    buurSeg[vul[van[s]]++] = s
    buur[vul[naar[s]]] = van[s]
    buurSeg[vul[naar[s]]++] = s
  }
  return {
    n, lat, lon, x: Float64Array.from(xs), y: Float64Array.from(ys),
    begin: graad, buur, buurSeg,
    lengte: Float64Array.from(lengte), factor: Float64Array.from(factor), segTags: Uint32Array.from(segTags), tagLijst,
    aantalStrand: factor.filter((f) => f >= STRAND_FACTOR).length,
  }
}

/** De knoop het dichtst bij een RD-punt (alleen knopen met buren). */
export function dichtsteKnoop(g, x, y) {
  let beste = -1
  let besteD = Infinity
  for (let i = 0; i < g.n; i++) {
    if (g.begin[i + 1] === g.begin[i]) continue
    const d = (g.x[i] - x) ** 2 + (g.y[i] - y) ** 2
    if (d < besteD) {
      besteD = d
      beste = i
    }
  }
  return { knoop: beste, afstand: Math.sqrt(besteD) }
}

/**
 * Dijkstra vanaf 'bron'. straf: Float32Array per segment (vermenigvuldigt de
 * kosten; 1 = geen straf) of null. doel: stop zodra die knoop vast ligt.
 * Geeft {kosten, meter, vorigeSeg, vorigeKnoop}.
 */
export function dijkstra(g, bron, { straf = null, doel = -1, maxKosten = Infinity } = {}) {
  const kosten = new Float64Array(g.n).fill(Infinity)
  const meter = new Float64Array(g.n)
  const vorigeSeg = new Int32Array(g.n).fill(-1)
  const vorigeKnoop = new Int32Array(g.n).fill(-1)
  const vast = new Uint8Array(g.n)
  // binaire hoop met (kosten, knoop)
  let hk = new Float64Array(1024)
  let hn = new Int32Array(1024)
  let grootte = 0
  const duw = (k, v) => {
    if (grootte === hk.length) {
      const nk = new Float64Array(grootte * 2)
      nk.set(hk)
      hk = nk
      const nn = new Int32Array(grootte * 2)
      nn.set(hn)
      hn = nn
    }
    let i = grootte++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hk[p] <= k) break
      hk[i] = hk[p]
      hn[i] = hn[p]
      i = p
    }
    hk[i] = k
    hn[i] = v
  }
  const pak = () => {
    const v = hn[0]
    const k = hk[--grootte]
    const kn = hn[grootte]
    let i = 0
    for (;;) {
      let c = 2 * i + 1
      if (c >= grootte) break
      if (c + 1 < grootte && hk[c + 1] < hk[c]) c++
      if (hk[c] >= k) break
      hk[i] = hk[c]
      hn[i] = hn[c]
      i = c
    }
    hk[i] = k
    hn[i] = kn
    return v
  }
  kosten[bron] = 0
  duw(0, bron)
  while (grootte) {
    const u = pak()
    if (vast[u]) continue
    vast[u] = 1
    if (u === doel || kosten[u] > maxKosten) break
    for (let j = g.begin[u]; j < g.begin[u + 1]; j++) {
      const v = g.buur[j]
      if (vast[v]) continue
      const s = g.buurSeg[j]
      const k = kosten[u] + g.lengte[s] * g.factor[s] * (straf ? straf[s] : 1)
      if (k < kosten[v]) {
        kosten[v] = k
        meter[v] = meter[u] + g.lengte[s]
        vorigeSeg[v] = s
        vorigeKnoop[v] = u
        duw(k, v)
      }
    }
  }
  return { kosten, meter, vorigeSeg, vorigeKnoop }
}

/** Het pad naar 'doel' uit een dijkstra-boom: {knopen, segs} vanaf de bron. */
export function pad(boom, doel) {
  const knopen = [doel]
  const segs = []
  let v = doel
  while (boom.vorigeKnoop[v] >= 0) {
    segs.push(boom.vorigeSeg[v])
    v = boom.vorigeKnoop[v]
    knopen.push(v)
  }
  knopen.reverse()
  segs.reverse()
  return { knopen, segs }
}

/** Zet een rij knopen + segmenten om in een traject zoals BRouter het geeft. */
export function maakTraject(g, knopen, segs, punten = []) {
  const coords = knopen.map((i) => [g.lon[i], g.lat[i], null])
  const uit = []
  let begin = 0
  for (let i = 1; i <= segs.length; i++) {
    if (i === segs.length || g.segTags[segs[i]] !== g.segTags[segs[begin]]) {
      uit.push([begin, i, g.tagLijst[g.segTags[segs[begin]]]])
      begin = i
    }
  }
  if (!uit.length) uit.push([0, coords.length - 1, ''])
  return { coords, segs: uit, punten }
}

/** Kosten, meters en strandmeters van een rij segmenten. */
function tel(g, segs) {
  let kosten = 0
  let meter = 0
  let strand = 0
  for (const s of segs) {
    kosten += g.lengte[s] * g.factor[s]
    meter += g.lengte[s]
    if (g.factor[s] >= STRAND_FACTOR) strand += g.lengte[s]
  }
  return { kosten, meter, strand }
}

/** Een route langs punten (knoopnummers), met straf voor wat al gelopen is. */
export function routeLangs(g, knopen, strafFactor = 1) {
  const straf = strafFactor > 1 ? new Float32Array(g.lengte.length).fill(1) : null
  const alle = [knopen[0]]
  const segs = []
  for (let i = 1; i < knopen.length; i++) {
    const b = dijkstra(g, knopen[i - 1], { straf, doel: knopen[i] })
    if (!Number.isFinite(b.kosten[knopen[i]])) return null
    const p = pad(b, knopen[i])
    alle.push(...p.knopen.slice(1))
    segs.push(...p.segs)
    if (straf) for (const s of p.segs) straf[s] = strafFactor
  }
  return { knopen: alle, segs }
}

/**
 * Zoek rondjes van ongeveer 'doel' meter vanaf knoop 'start'. Probeert
 * driehoeken start → A → B → start met A en B uit een ring van kandidaten
 * rond de start (per windrichting de mooiste bereikbare plek), met straf
 * op wat al gelopen is zodat het een echte lus wordt.
 * Geeft de beste rondjes: [{knopen, segs, meter, kosten, dubbel, strand, via}].
 */
export function zoekRondjes(g, start, doel, { aantal = 6, sectoren = 24, maxProbeer = 160 } = {}) {
  const boom = dijkstra(g, start, { maxKosten: doel * 6 })
  const sx = g.x[start]
  const sy = g.y[start]
  // kandidaten: per sector en per ring de plek met de laagste kosten per meter
  const ringen = [0.18, 0.26, 0.34, 0.42]
  const beste = new Map()
  for (let i = 0; i < g.n; i++) {
    const m = boom.meter[i]
    if (!Number.isFinite(boom.kosten[i]) || m < 0.12 * doel || m > 0.48 * doel) continue
    const hoek = (Math.atan2(g.x[i] - sx, g.y[i] - sy) * 180) / Math.PI
    const sector = Math.floor((((hoek % 360) + 360) % 360) / (360 / sectoren))
    let ring = 0
    for (let r = 1; r < ringen.length; r++) if (Math.abs(m - ringen[r] * doel) < Math.abs(m - ringen[ring] * doel)) ring = r
    if (Math.abs(m - ringen[ring] * doel) > 0.05 * doel) continue
    const waarde = boom.kosten[i] / m
    const sleutel = sector * 10 + ring
    const nu = beste.get(sleutel)
    if (!nu || waarde < nu.waarde) beste.set(sleutel, { knoop: i, waarde, meter: m, hoek, sector, ring })
  }
  const kand = [...beste.values()]
  // paren: niet te dicht bij elkaar in richting, geschatte lengte in de buurt van het doel
  const paren = []
  for (const a of kand) {
    for (const b of kand) {
      if (a === b) continue
      let dh = ((b.hoek - a.hoek) % 360 + 360) % 360
      if (dh < 25 || dh > 160) continue // rechtsom van a naar b; linksom komt als (b, a) ook langs
      const ab = Math.hypot(g.x[a.knoop] - g.x[b.knoop], g.y[a.knoop] - g.y[b.knoop])
      const schatting = a.meter + 1.35 * ab + b.meter
      const af = Math.abs(schatting - doel) / doel
      if (af > 0.3) continue
      paren.push({ a, b, prior: a.waarde + b.waarde + 2 * af })
    }
  }
  paren.sort((p, q) => p.prior - q.prior)
  const uit = []
  const straf = new Float32Array(g.lengte.length)
  for (const { a, b } of paren.slice(0, maxProbeer)) {
    straf.fill(1)
    const p1 = pad(boom, a.knoop)
    for (const s of p1.segs) straf[s] = 4
    const b2 = dijkstra(g, a.knoop, { straf, doel: b.knoop })
    if (!Number.isFinite(b2.kosten[b.knoop])) continue
    const p2 = pad(b2, b.knoop)
    for (const s of p2.segs) straf[s] = 4
    const b3 = dijkstra(g, b.knoop, { straf, doel: start })
    if (!Number.isFinite(b3.kosten[start])) continue
    const p3 = pad(b3, start)
    const segs = [...p1.segs, ...p2.segs, ...p3.segs]
    const knopen = [...p1.knopen, ...p2.knopen.slice(1), ...p3.knopen.slice(1)]
    const t = tel(g, segs)
    // dubbel: meters over een segment dat al eerder in dit rondje zat
    const gezien = new Set()
    let dubbelM = 0
    for (const s of segs) {
      if (gezien.has(s)) dubbelM += g.lengte[s]
      gezien.add(s)
    }
    const af = Math.abs(t.meter - doel) / doel
    const score = t.kosten / t.meter + 3 * (dubbelM / t.meter) + 4 * Math.max(0, af - 0.08)
    uit.push({ knopen, segs, meter: t.meter, kosten: t.kosten, strand: t.strand, dubbel: dubbelM / t.meter, score, via: [a.knoop, b.knoop] })
  }
  uit.sort((p, q) => p.score - q.score)
  // verschillende rondjes: minder dan 60% dezelfde segmenten als een beter rondje
  const gekozen = []
  for (const r of uit) {
    if (gekozen.length >= aantal) break
    const set = new Set(r.segs)
    const lijkt = gekozen.some((q) => {
      let zelfde = 0
      for (const s of q.segs) if (set.has(s)) zelfde += g.lengte[s]
      return zelfde / Math.min(q.meter, r.meter) > 0.6
    })
    if (!lijkt) gekozen.push(r)
  }
  return { rondjes: gekozen, kandidaten: kand.length, geprobeerd: Math.min(paren.length, maxProbeer) }
}
