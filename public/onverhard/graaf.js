// Eigen routeplanner in de browser: de paden komen uit OpenStreetMap (via de
// Overpass API), de route rekenen we zelf uit. Voordeel ten opzichte van een
// routeserver: geen limiet op het aantal verzoeken, dus we kunnen honderden
// rondjes proberen, en we bepalen zelf wat verboden is (zoals het strand).
//
// Puur rekenwerk, geen netwerk: het ophalen staat in bronnen.js.

import * as K from './kern.js'

const NOOIT = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'platform', 'elevator', 'abandoned', 'razed'])
export const STRAND_FACTOR = 40 // strand mag alleen als er echt niets anders is
const ALLES_FACTOR = { primary: 2, primary_link: 2, secondary: 1.6, secondary_link: 1.6, tertiary: 1.25, tertiary_link: 1.25, steps: 1.3 }

/**
 * De Overpass-vraag: alle wegen en paden plus de stranden binnen 'straal'
 * meter van een punt. Opritten, parkeerplaatsen en stoepen laten we weg: die
 * maken de download in een stad twee keer zo groot en een rondje heeft ze
 * niet nodig (de straat ernaast is er wel).
 */
export function overpassVraag(lat, lon, straal) {
  const rond = `around:${Math.round(straal)},${lat.toFixed(5)},${lon.toFixed(5)}`
  return `[out:json][timeout:90];(` +
    `way["highway"]["service"!~"^(driveway|parking_aisle|drive-through)$"]["footway"!="sidewalk"]["area"!="yes"](${rond});` +
    `way["natural"="beach"](${rond});relation["natural"="beach"](${rond});` +
    `);out geom qt;`
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
 * Kaarttegels zijn gemaakt om te tekenen, niet om te routeren: bij het
 * vereenvoudigen van lijnen verdwijnt soms het punt waar een pad op een weg
 * aansluit, en aan de tegelrand worden lijnen afgeknipt. Daardoor valt het
 * netwerk in stukken. Herstel: een los eindje (knoop met één buur) dat binnen
 * 'snap' meter van een ander segment ligt, verbinden we daarmee; ligt het
 * aansluitpunt midden op dat segment, dan splitsen we het segment daar.
 * Werkt op de losse arrays (segmenten met factor -1 zijn weggehaald).
 */
function verbindLosseEinden(d, snap) {
  const { van, naar, lengte, factor, segTags, xs, ys, lat, lon } = d
  const graad = new Map()
  for (let i = 0; i < van.length; i++) {
    if (factor[i] < 0) continue
    graad.set(van[i], (graad.get(van[i]) || 0) + 1)
    graad.set(naar[i], (graad.get(naar[i]) || 0) + 1)
  }
  const CEL = 10
  const rooster = new Map()
  const aantal = van.length
  for (let i = 0; i < aantal; i++) {
    if (factor[i] < 0) continue
    const a = van[i]
    const b = naar[i]
    const x0 = Math.floor((Math.min(xs[a], xs[b]) - snap) / CEL)
    const x1 = Math.floor((Math.max(xs[a], xs[b]) + snap) / CEL)
    const y0 = Math.floor((Math.min(ys[a], ys[b]) - snap) / CEL)
    const y1 = Math.floor((Math.max(ys[a], ys[b]) + snap) / CEL)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue // heel lang recht stuk: overslaan
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = cx + ',' + cy
        const lijst = rooster.get(k)
        if (lijst) lijst.push(i)
        else rooster.set(k, [i])
      }
    }
  }
  // per los eindje het dichtstbijzijnde segment (niet het eigen segment)
  const splitsingen = new Map() // segment -> [{t, x, y, knoop}]
  const verbindingen = [] // [eindje, segment, t]
  for (const [knoop, g] of graad) {
    if (g !== 1) continue
    const x = xs[knoop]
    const y = ys[knoop]
    let beste = -1
    let besteD = snap
    let besteT = 0
    for (const i of rooster.get(Math.floor(x / CEL) + ',' + Math.floor(y / CEL)) || []) {
      const a = van[i]
      const b = naar[i]
      if (a === knoop || b === knoop) continue
      const dx = xs[b] - xs[a]
      const dy = ys[b] - ys[a]
      const l2 = dx * dx + dy * dy
      let t = l2 ? ((x - xs[a]) * dx + (y - ys[a]) * dy) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const afst = Math.hypot(x - (xs[a] + t * dx), y - (ys[a] + t * dy))
      if (afst < besteD) {
        besteD = afst
        beste = i
        besteT = t
      }
    }
    if (beste >= 0) verbindingen.push([knoop, beste, besteT])
  }
  const nieuweKnoop = (x, y) => {
    xs.push(x)
    ys.push(y)
    // lat/lon terug uit de twee eindpunten (lineair: op een paar meter nauwkeurig genoeg)
    return xs.length - 1
  }
  const segment = (a, b, tags, f) => {
    van.push(a)
    naar.push(b)
    lengte.push(Math.max(0.01, Math.hypot(xs[a] - xs[b], ys[a] - ys[b])))
    factor.push(f)
    segTags.push(tags)
  }
  for (const [knoop, i, t] of verbindingen) {
    const a = van[i]
    const b = naar[i]
    const l = lengte[i]
    if (t * l < 0.3) segment(knoop, a, segTags[i], factor[i])
    else if ((1 - t) * l < 0.3) segment(knoop, b, segTags[i], factor[i])
    else {
      if (!splitsingen.has(i)) splitsingen.set(i, [])
      splitsingen.get(i).push({ t, knoop })
    }
  }
  for (const [i, lijst] of splitsingen) {
    const a = van[i]
    const b = naar[i]
    lijst.sort((p, q) => p.t - q.t)
    let vorige = a
    for (const { t, knoop } of lijst) {
      const x = xs[a] + t * (xs[b] - xs[a])
      const y = ys[a] + t * (ys[b] - ys[a])
      const n = nieuweKnoop(x, y)
      lat.push(lat[a] + t * (lat[b] - lat[a]))
      lon.push(lon[a] + t * (lon[b] - lon[a]))
      segment(vorige, n, segTags[i], factor[i])
      segment(knoop, n, segTags[i], factor[i])
      vorige = n
    }
    segment(vorige, b, segTags[i], factor[i])
    factor[i] = -1
  }
}

/**
 * Bouw de graaf. opties: {trail, kaartje, strandMijden, extraStranden}
 * (extraStranden: vlakken {polygonen, bbox} uit de officiële kaart).
 * Knopen zijn de punten van de OSM-wegen (gedeelde punten = kruisingen).
 */
export function bouwGraaf(elementen, { trail = true, alles = false, kaartje = false, strandMijden = true, extraStranden = [], mijdPunten = [], snap = 0, gebied = null, buitenFactor = 30 } = {}) {
  const stranden = strandMijden ? strandRingen(elementen).concat(extraStranden) : []
  // te mijden plekken (RD-punten, 20 m eromheen), via een rooster van 50 m
  const mijd = new Set()
  for (const [x, y] of mijdPunten) mijd.add(Math.floor(x / 50) + ',' + Math.floor(y / 50))
  const teMijden = (x, y) => {
    if (!mijd.size) return false
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!mijd.has(Math.floor((x + 20 * dx) / 50) + ',' + Math.floor((y + 20 * dy) / 50))) continue
      if (mijdPunten.some(([px, py]) => Math.hypot(px - x, py - y) < 20)) return true
    }
    return false
  }
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
    // 'alles': geen voorkeur voor onverhard; alleen drukke wegen zijn wat duurder
    const f0 = (alles ? ALLES_FACTOR[t.highway] || 1 : K.kostenfactor(K.osmKlasse(tekst).klasse, tekst, trail)) * (afgesloten ? 1.3 : 1)
    const geom = e.geometry
    for (let i = 1; i < geom.length; i++) {
      if (!geom[i - 1] || !geom[i]) continue
      const a = knoopVan(geom[i - 1])
      const b = knoopVan(geom[i])
      if (a === b) continue
      const l = Math.hypot(xs[a] - xs[b], ys[a] - ys[b])
      const mx = (xs[a] + xs[b]) / 2
      const my = (ys[a] + ys[b]) / 2
      const strand = (stranden.length && opStrand(mx, my, stranden)) || teMijden(mx, my)
      van.push(a)
      naar.push(b)
      lengte.push(l)
      factor.push(f0 * (strand ? STRAND_FACTOR : 1))
      segTags.push(ti)
    }
  }
  // dubbele segmenten (zelfde twee knopen, bijvoorbeeld uit de overlap van twee kaarttegels) eruit
  const gezien = new Set()
  for (let i = 0; i < van.length; i++) {
    const k = van[i] < naar[i] ? van[i] + ',' + naar[i] : naar[i] + ',' + van[i]
    if (gezien.has(k)) factor[i] = -1
    else gezien.add(k)
  }
  if (snap > 0) {
    verbindLosseEinden({ van, naar, lengte, factor, segTags, xs, ys, lat, lon }, snap)
  }
  // weggehaalde segmenten (factor -1) echt weghalen
  {
    let j = 0
    for (let i = 0; i < van.length; i++) {
      if (factor[i] < 0) continue
      van[j] = van[i]
      naar[j] = naar[i]
      lengte[j] = lengte[i]
      factor[j] = factor[i]
      segTags[j] = segTags[i]
      j++
    }
    van.length = naar.length = lengte.length = factor.length = segTags.length = j
  }
  // een getekend gebied: segmenten erbuiten zijn duur (wel bruikbaar om er te komen)
  const binnenSeg = new Uint8Array(van.length)
  if (gebied) {
    const vlak = [[gebied]]
    for (let i = 0; i < van.length; i++) {
      const mx = (xs[van[i]] + xs[naar[i]]) / 2
      const my = (ys[van[i]] + ys[naar[i]]) / 2
      if (K.afstandTotVlak(mx, my, vlak) === 0) binnenSeg[i] = 1
      else factor[i] *= buitenFactor
    }
  } else binnenSeg.fill(1)
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
    lengte: Float64Array.from(lengte), factor: Float64Array.from(factor), segTags: Uint32Array.from(segTags), tagLijst, binnenSeg,
    van: Uint32Array.from(van), naar: Uint32Array.from(naar),
    aantalStrand: factor.filter((f) => f >= STRAND_FACTOR).length,
  }
}

/** Nummer van het samenhangende netwerk per knoop, en de grootte van elk netwerk. */
export function netwerken(g) {
  if (g.netwerk) return g.netwerk
  const nr = new Int32Array(g.n).fill(-1)
  const grootte = []
  const stapel = []
  for (let i = 0; i < g.n; i++) {
    if (nr[i] >= 0) continue
    const id = grootte.length
    let n = 0
    nr[i] = id
    stapel.push(i)
    while (stapel.length) {
      const u = stapel.pop()
      n++
      for (let j = g.begin[u]; j < g.begin[u + 1]; j++) {
        const v = g.buur[j]
        if (nr[v] < 0) {
          nr[v] = id
          stapel.push(v)
        }
      }
    }
    grootte.push(n)
  }
  g.netwerk = { nr, grootte }
  return g.netwerk
}

/**
 * De knoop het dichtst bij een RD-punt, op een netwerk van flinke omvang
 * (geen los stukje pad rond een gebouw of achter een hek).
 */
export function dichtsteKnoop(g, x, y) {
  const { nr, grootte } = netwerken(g)
  const groot = Math.max(...grootte)
  let beste = -1
  let besteD = Infinity
  for (let i = 0; i < g.n; i++) {
    if (g.begin[i + 1] === g.begin[i] || grootte[nr[i]] < 0.05 * groot) continue
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
export function dijkstra(g, bron, { straf = null, doel = -1, maxKosten = Infinity, alleenLengte = false, stop = null } = {}) {
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
  for (const b of Array.isArray(bron) ? bron : [bron]) {
    kosten[b] = 0
    duw(0, b)
  }
  while (grootte) {
    const u = pak()
    if (vast[u]) continue
    vast[u] = 1
    if (u === doel || kosten[u] > maxKosten || (stop && stop(u))) break
    for (let j = g.begin[u]; j < g.begin[u + 1]; j++) {
      const v = g.buur[j]
      if (vast[v]) continue
      const s = g.buurSeg[j]
      const k = kosten[u] + g.lengte[s] * (alleenLengte ? 1 : g.factor[s]) * (straf ? straf[s] : 1)
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
 * Haal uitstapjes weg: loopt een route een segment op en meteen weer terug
 * (een doodlopend stukje naar een tussenpunt), dan vallen beide weg.
 */
export function zonderUitstapjes(knopen, segs) {
  const kn = [knopen[0]]
  const sg = []
  for (let i = 0; i < segs.length; i++) {
    if (sg.length && sg[sg.length - 1] === segs[i]) {
      sg.pop()
      kn.pop()
    } else {
      sg.push(segs[i])
      kn.push(knopen[i + 1])
    }
  }
  return { knopen: kn, segs: sg }
}

/**
 * Zoek rondjes van ongeveer 'doel' meter vanaf knoop 'start'. Een rondje gaat
 * start → A → B (→ C) → start; de hoekpunten komen uit een ring van
 * kandidaten rond de start (per windrichting en afstand de plek met de
 * mooiste route ernaartoe). Wat al gelopen is kost acht keer zo veel, zodat het een
 * echte lus wordt. 'kronkel': vier hoeken dicht bij de start in plaats van
 * een grote driehoek, voor kronkelen in een klein gebied.
 * Geeft {rondjes: [{knopen, segs, meter, kosten, dubbel, strand, via}], ...}.
 */
export function zoekRondjes(g, start, doel, { aantal = 6, sectoren = 24, maxProbeer = 160, kronkel = false, strafFactor = 8, ringen: eigenRingen = null, binnen = null, maxAf = 0.3 } = {}) {
  const boom = dijkstra(g, start, { maxKosten: doel * 6 })
  const sx = g.x[start]
  const sy = g.y[start]
  const ringen = eigenRingen || (kronkel ? [0.1, 0.15, 0.2, 0.26] : [0.18, 0.26, 0.34, 0.42])
  const dood = doodlopendeKnopen(g)
  const beste = new Map()
  for (let i = 0; i < g.n; i++) {
    const m = boom.meter[i]
    if (!Number.isFinite(boom.kosten[i]) || m < (ringen[0] - 0.05) * doel || m > (ringen[3] + 0.05) * doel) continue
    if (binnen && !binnen[i]) continue
    if (dood[i]) continue // geen hoekpunt aan het eind van een doodlopend pad (dan moet je terug)
    const hoek = (Math.atan2(g.x[i] - sx, g.y[i] - sy) * 180) / Math.PI
    const sector = Math.floor((((hoek % 360) + 360) % 360) / (360 / sectoren))
    let ring = 0
    for (let r = 1; r < ringen.length; r++) if (Math.abs(m - ringen[r] * doel) < Math.abs(m - ringen[ring] * doel)) ring = r
    if (Math.abs(m - ringen[ring] * doel) > 0.04 * doel) continue
    const waarde = boom.kosten[i] / m
    const sleutel = sector * 10 + ring
    const nu = beste.get(sleutel)
    if (!nu || waarde < nu.waarde) beste.set(sleutel, { knoop: i, waarde, meter: m, hoek })
  }
  const kand = [...beste.values()]
  const afstand = (p, q) => Math.hypot(g.x[p.knoop] - g.x[q.knoop], g.y[p.knoop] - g.y[q.knoop])
  const draai = (p, q) => ((q.hoek - p.hoek) % 360 + 360) % 360
  // combinaties van hoekpunten, rechtsom (linksom komt als omgekeerde volgorde ook langs);
  // een eerste schatting van de lengte en hoe mooi de wegen naar de hoeken zijn bepaalt de volgorde
  const combis = []
  for (const a of kand) {
    for (const b of kand) {
      const dab = draai(a, b)
      if (a === b || dab < 25 || dab > (kronkel ? 120 : 160)) continue
      if (!kronkel) {
        const af = Math.abs(a.meter + 1.35 * afstand(a, b) + b.meter - doel) / doel
        if (af <= maxAf) combis.push({ hoeken: [a, b], prior: a.waarde + b.waarde + 2 * af })
        continue
      }
      for (const c of kand) {
        const dbc = draai(b, c)
        if (c === a || c === b || dbc < 25 || dbc > 120 || dab + dbc > 240) continue
        const af = Math.abs(a.meter + 1.35 * (afstand(a, b) + afstand(b, c)) + c.meter - doel) / doel
        if (af <= maxAf) combis.push({ hoeken: [a, b, c], prior: (a.waarde + b.waarde + c.waarde) * (2 / 3) + 2 * af })
      }
    }
  }
  combis.sort((p, q) => p.prior - q.prior)
  const uit = []
  const straf = new Float32Array(g.lengte.length)
  // de 'steel' van het rondje: de eerste paar honderd meter vanaf de start mag je heen én terug
  // lopen (anders zoekt de terugweg een omweg om een parkeerplaats of steekt hij twee keer over)
  const steel = Math.min(400, 0.04 * doel)
  const inSteel = (s) => Math.hypot(g.x[g.van[s]] - sx, g.y[g.van[s]] - sy) < steel && Math.hypot(g.x[g.naar[s]] - sx, g.y[g.naar[s]] - sy) < steel
  for (const { hoeken } of combis.slice(0, maxProbeer)) {
    straf.fill(1)
    const p1 = pad(boom, hoeken[0].knoop)
    for (const s of p1.segs) if (!inSteel(s)) straf[s] = strafFactor
    let knopen = p1.knopen.slice()
    let segs = p1.segs.slice()
    let vorige = hoeken[0].knoop
    let gelukt = true
    for (const doelKnoop of [...hoeken.slice(1).map((h) => h.knoop), start]) {
      const b = dijkstra(g, vorige, { straf, doel: doelKnoop })
      if (!Number.isFinite(b.kosten[doelKnoop])) {
        gelukt = false
        break
      }
      const p = pad(b, doelKnoop)
      for (const s of p.segs) if (!inSteel(s)) straf[s] = strafFactor
      knopen = knopen.concat(p.knopen.slice(1))
      segs = segs.concat(p.segs)
      vorige = doelKnoop
    }
    if (!gelukt) continue
    ;({ knopen, segs } = zonderUitstapjes(knopen, segs))
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
    uit.push({ knopen, segs, meter: t.meter, kosten: t.kosten, strand: t.strand, dubbel: dubbelM / t.meter, score, via: hoeken.map((h) => h.knoop) })
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
  return { rondjes: gekozen, kandidaten: kand.length, geprobeerd: Math.min(combis.length, maxProbeer) }
}

// ---------- Rondjes binnen een getekend gebied ----------
/** Per knoop: ligt hij binnen het gebied (ring in RD)? */
export function knopenBinnen(g, ring) {
  const uit = new Uint8Array(g.n)
  const vlak = [[ring]]
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < ring.length; i += 2) {
    b[0] = Math.min(b[0], ring[i])
    b[2] = Math.max(b[2], ring[i])
    b[1] = Math.min(b[1], ring[i + 1])
    b[3] = Math.max(b[3], ring[i + 1])
  }
  for (let i = 0; i < g.n; i++) {
    if (g.x[i] < b[0] || g.x[i] > b[2] || g.y[i] < b[1] || g.y[i] > b[3]) continue
    if (K.afstandTotVlak(g.x[i], g.y[i], vlak) === 0) uit[i] = 1
  }
  return uit
}

/**
 * Rondjes die binnen een gebied blijven. De ringen voor de hoekpunten
 * schalen mee met hoe ver je binnen het gebied kunt komen; is één rondje
 * korter dan gevraagd, dan worden het meerdere rondjes achter elkaar
 * (afwisselend verschillende, als die er zijn).
 * Geeft {rondjes: [{knopen, segs, meter, ronden, ...}], lus: meter van één rondje}.
 */
export function zoekRondjesInGebied(g, startpunt, doel, binnen, { aantal = 4 } = {}) {
  // ligt de start buiten het gebied (een parkeerplaats, een hotel), dan beginnen de rondjes bij
  // het eerste punt erbinnen; de weg ernaartoe loop je één keer heen en aan het eind terug
  let start = startpunt
  let toegang = null
  if (!binnen[startpunt]) {
    const b0 = dijkstra(g, startpunt)
    let ingang = -1
    for (let i = 0; i < g.n; i++) if (binnen[i] && Number.isFinite(b0.kosten[i]) && (ingang < 0 || b0.kosten[i] < b0.kosten[ingang])) ingang = i
    if (ingang >= 0) {
      toegang = pad(b0, ingang)
      start = ingang
      let m = 0
      for (const s of toegang.segs) m += g.lengte[s]
      doel = Math.max(doel * 0.3, doel - 2 * m)
    }
  }
  const boom = dijkstra(g, start)
  let verst = 0
  for (let i = 0; i < g.n; i++) if (binnen[i] && Number.isFinite(boom.kosten[i])) verst = Math.max(verst, boom.meter[i])
  if (verst < 50) return { rondjes: [], lus: 0 }
  // Een rondje binnen een gebied is hooguit zo'n 3 tot 4 keer de verste afstand. We zoeken
  // rondjes van een paar groottes en houden ze allemaal; de gevraagde lengte is hier geen
  // harde eis (dan worden het meerdere rondjes).
  const buiten = (r) => {
    let m = 0
    for (const s of r.segs) if (!g.binnenSeg[s]) m += g.lengte[s]
    return m / r.meter
  }
  const alle = []
  for (const f of [3.5, 2.6, 1.9, 1.3]) {
    const lusDoel = Math.min(doel, f * verst)
    if (alle.some((r) => r.lusDoel === lusDoel)) continue
    const ringen = [0.35, 0.55, 0.75, 0.95].map((q) => (q * verst) / lusDoel)
    for (const kronkel of [true, false]) {
      const z = zoekRondjes(g, start, lusDoel, { aantal: 4, ringen, binnen, kronkel, maxProbeer: 120, maxAf: 0.6 })
      for (const r of z.rondjes) alle.push({ ...r, lusDoel, buiten: buiten(r) })
    }
  }
  if (!alle.length) return { rondjes: [], lus: 0 }
  // mooi (lage kosten per meter), weinig heen en terug, binnen het gebied, en liever lang
  const rang = (r) => r.kosten / r.meter + 3 * r.dubbel + 3 * r.buiten - 0.6 * Math.min(1, r.meter / doel)
  alle.sort((p, q) => rang(p) - rang(q))
  const lijst = []
  for (const r of alle) {
    const set = new Set(r.segs)
    const lijkt = lijst.some((q) => {
      let zelfde = 0
      for (const s of q.segs) if (set.has(s)) zelfde += g.lengte[s]
      return zelfde / Math.min(q.meter, r.meter) > 0.6
    })
    if (!lijkt) lijst.push(r)
    if (lijst.length >= aantal + 1) break
  }
  const uit = []
  for (const [i, r] of lijst.slice(0, aantal).entries()) {
    // rondjes erbij (afwisselend een ander rondje, als dat er is) tot de lengte ongeveer klopt
    let knopen = r.knopen.slice()
    let segs = r.segs.slice()
    let meter = r.meter
    let ronden = 1
    const ander = lijst[(i + 1) % lijst.length]
    for (;;) {
      const volgende = ronden % 2 === 1 && ander !== r ? ander : r
      if (meter + volgende.meter / 2 > doel || ronden >= 20) break
      knopen = knopen.concat(volgende.knopen.slice(1))
      segs = segs.concat(volgende.segs)
      meter += volgende.meter
      ronden++
    }
    if (toegang) {
      // de toegang ervoor en (omgekeerd) erachter
      knopen = [...toegang.knopen, ...knopen.slice(1), ...toegang.knopen.slice(0, -1).reverse()]
      segs = [...toegang.segs, ...segs, ...toegang.segs.slice().reverse()]
      for (const s of toegang.segs) meter += 2 * g.lengte[s]
    }
    uit.push({ ...r, knopen, segs, meter, ronden })
  }
  return { rondjes: uit, lus: lijst[0].meter }
}

// ---------- Door elke straat (Chinese postbode) ----------
const STRATEN = new Set(['residential', 'living_street', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link',
  'primary', 'primary_link', 'pedestrian', 'road'])
const PADEN = new Set(['path', 'footway', 'track', 'bridleway', 'cycleway', 'steps'])

/**
 * Doodlopende takken: pel het hele netwerk af vanaf de losse eindjes (knopen
 * met één lijn), zodat ook een doodlopend stuk aan een doodlopend stuk
 * meegaat. Een straat die alleen aan de rand van het gebied ophoudt maar
 * daarbuiten doorloopt, is niet doodlopend (het netwerk is ruimer geladen).
 * Geeft per segment 1 als het in een doodlopende tak ligt.
 */
export function doodlopendeTakken(g) {
  const graad = new Int32Array(g.n)
  for (let i = 0; i < g.n; i++) graad[i] = g.begin[i + 1] - g.begin[i]
  const weg = new Uint8Array(g.lengte.length)
  const rij = []
  for (let i = 0; i < g.n; i++) if (graad[i] === 1) rij.push(i)
  while (rij.length) {
    const u = rij.pop()
    if (graad[u] !== 1) continue
    for (let j = g.begin[u]; j < g.begin[u + 1]; j++) {
      const s = g.buurSeg[j]
      if (weg[s]) continue
      weg[s] = 1
      graad[u] = 0
      const v = g.buur[j]
      graad[v] -= 1
      if (graad[v] === 1) rij.push(v)
      break
    }
  }
  return weg
}

/** Knopen die alleen aan doodlopende takken liggen (eenmaal berekend per graaf). */
export function doodlopendeKnopen(g) {
  if (g.doodKnopen) return g.doodKnopen
  const takken = doodlopendeTakken(g)
  const uit = new Uint8Array(g.n)
  for (let i = 0; i < g.n; i++) {
    if (g.begin[i + 1] === g.begin[i]) continue
    let allemaal = true
    for (let j = g.begin[i]; j < g.begin[i + 1]; j++) if (!takken[g.buurSeg[j]]) allemaal = false
    uit[i] = allemaal ? 1 : 0
  }
  g.doodKnopen = uit
  return uit
}

/**
 * Welke segmenten moeten erin: binnen het gebied, en van de gekozen soort
 * ('straten', 'paden' of 'alles' wat begaanbaar is). Met zonderDoodlopend
 * vallen doodlopende takken af.
 */
export function vereisteSegmenten(g, soort = 'straten', { zonderDoodlopend = false } = {}) {
  const dood = zonderDoodlopend ? doodlopendeTakken(g) : null
  const highwayVan = g.tagLijst.map((t) => (/(?:^| )highway=(\S+)/.exec(t) || [])[1] || '')
  const dienstVan = g.tagLijst.map((t) => (/(?:^| )service=(\S+)/.exec(t) || [])[1] || '')
  const uit = new Uint8Array(g.lengte.length)
  for (let s = 0; s < uit.length; s++) {
    if (!g.binnenSeg[s] || g.factor[s] >= STRAND_FACTOR || (dood && dood[s])) continue
    const h = highwayVan[g.segTags[s]]
    const straat = STRATEN.has(h) || (h === 'service' && !dienstVan[g.segTags[s]])
    const pad = PADEN.has(h)
    if (soort === 'straten' ? straat : soort === 'paden' ? pad : straat || pad || h === 'service') uit[s] = 1
  }
  return uit
}

/**
 * Een rondje vanaf 'start' dat elk vereist segment minstens één keer loopt,
 * zo kort mogelijk (benadering van het 'Chinese postbode'-probleem):
 * 1. losse stukken verbinden via de kortste weg (ook over niet-vereiste wegen);
 * 2. knopen met een oneven aantal lijnen twee aan twee koppelen, dichtstbijzijnde eerst,
 *    en die verbinding dubbel lopen;
 * 3. dan heeft elke knoop een even aantal lijnen en is er één rondje dat alles precies
 *    één keer loopt (Euler, met het algoritme van Hierholzer).
 * Geeft {knopen, segs, meter, vereistMeter, extraMeter} of null.
 */
export function doorElkeStraat(g, start, vereist) {
  const randen = [] // [a, b, seg]
  let vereistMeter = 0
  for (let s = 0; s < vereist.length; s++) {
    if (!vereist[s]) continue
    randen.push([g.van[s], g.naar[s], s])
    vereistMeter += g.lengte[s]
  }
  if (!randen.length) return null
  // 1. samenhang: union-find over de knopen
  const ouder = new Map()
  const vind = (x) => {
    let r = x
    while (ouder.get(r) !== r) r = ouder.get(r)
    let y = x
    while (ouder.get(y) !== r) {
      const volgende = ouder.get(y)
      ouder.set(y, r)
      y = volgende
    }
    return r
  }
  const zetIn = (x) => {
    if (!ouder.has(x)) ouder.set(x, x)
  }
  const voeg = (a, b) => {
    zetIn(a)
    zetIn(b)
    ouder.set(vind(a), vind(b))
  }
  for (const [a, b] of randen) voeg(a, b)
  zetIn(start)
  let verbindMeter = 0
  const padToevoegen = (p) => {
    for (const s of p.segs) verbindMeter += g.lengte[s]
    for (let i = 0; i < p.segs.length; i++) {
      randen.push([p.knopen[i], p.knopen[i + 1], p.segs[i]])
      voeg(p.knopen[i], p.knopen[i + 1])
    }
  }
  for (let ronde = 0; ronde < 500; ronde++) {
    const wortel = vind(start)
    const groep = [...ouder.keys()].filter((k) => vind(k) === wortel)
    if (groep.length === ouder.size) break
    const inGroep = new Set(groep)
    const boom = dijkstra(g, groep, { alleenLengte: true, stop: (u) => ouder.has(u) && !inGroep.has(u) })
    let doel = -1
    let beste = Infinity
    for (const k of ouder.keys()) if (!inGroep.has(k) && boom.kosten[k] < beste) {
      beste = boom.kosten[k]
      doel = k
    }
    if (doel < 0) {
      // onbereikbare stukken: weglaten
      for (const k of [...ouder.keys()]) if (!inGroep.has(k)) ouder.delete(k)
      for (let i = randen.length - 1; i >= 0; i--) if (!inGroep.has(randen[i][0])) randen.splice(i, 1)
      break
    }
    padToevoegen(pad(boom, doel))
  }
  // 2. oneven knopen koppelen
  const graad = new Map()
  for (const [a, b] of randen) {
    graad.set(a, (graad.get(a) || 0) + 1)
    graad.set(b, (graad.get(b) || 0) + 1)
  }
  const oneven = [...graad.keys()].filter((k) => graad.get(k) % 2 === 1)
  const onevenSet = new Set(oneven)
  // afstanden tussen oneven knopen (tot de 10 dichtstbijzijnde per knoop); alleen de getallen bewaren
  const afst = new Map()
  const zetAfst = (u, v, d) => {
    if (!afst.has(u)) afst.set(u, new Map())
    if (!afst.has(v)) afst.set(v, new Map())
    afst.get(u).set(v, d)
    afst.get(v).set(u, d)
  }
  const paren = []
  for (const u of oneven) {
    let gevonden = 0
    const boom = dijkstra(g, u, { alleenLengte: true, stop: (v) => v !== u && onevenSet.has(v) && ++gevonden >= 20 })
    for (const v of oneven) {
      if (v !== u && Number.isFinite(boom.kosten[v])) {
        zetAfst(u, v, boom.kosten[v])
        paren.push([boom.kosten[v], u, v])
      }
    }
  }
  const d = (u, v) => (afst.get(u) && afst.get(u).has(v) ? afst.get(u).get(v) : Infinity)
  // eerst gretig: dichtstbijzijnde paren eerst
  paren.sort((p, q) => p[0] - q[0])
  const partner = new Map()
  for (const [, u, v] of paren) {
    if (partner.has(u) || partner.has(v)) continue
    partner.set(u, v)
    partner.set(v, u)
  }
  // nog ongekoppelde (zelden): met de dichtstbijzijnde andere ongekoppelde
  const over = oneven.filter((u) => !partner.has(u))
  while (over.length >= 2) {
    const u = over.shift()
    const rest = new Set(over)
    const boom = dijkstra(g, u, { alleenLengte: true, stop: (v) => rest.has(v) })
    const v = over.reduce((b, k) => (boom.kosten[k] < boom.kosten[b] ? k : b), over[0])
    over.splice(over.indexOf(v), 1)
    zetAfst(u, v, boom.kosten[v])
    partner.set(u, v)
    partner.set(v, u)
  }
  // dan verbeteren: twee paren (a,b) en (c,e) ruilen als (a,c)+(b,e) of (a,e)+(b,c) korter is;
  // vanuit a én vanuit b zoeken, en doorgaan tot het niet meer korter wordt
  const koppel = (x, y) => {
    partner.set(x, y)
    partner.set(y, x)
  }
  const verbeter = () => {
  for (let ronde = 0; ronde < 60; ronde++) {
    let beter = false
    for (const a1 of oneven) {
      const b1 = partner.get(a1)
      if (b1 === undefined) continue
      for (const [x, y] of [[a1, b1], [b1, a1]]) {
        for (const c1 of afst.get(x) ? afst.get(x).keys() : []) {
          const e1 = partner.get(c1)
          if (e1 === undefined || c1 === y || c1 === x || e1 === x) continue
          const nu = d(x, y) + d(c1, e1)
          if (d(x, c1) + d(y, e1) < nu - 1) {
            koppel(x, c1)
            koppel(y, e1)
            beter = true
            break
          }
          if (d(x, e1) + d(y, c1) < nu - 1) {
            koppel(x, e1)
            koppel(y, c1)
            beter = true
            break
          }
        }
        if (partner.get(a1) !== b1) break
      }
    }
    if (!beter) break
  }
  }
  verbeter()
  // Lange paren (restjes van de gretige stap): voor die knopen ook de afstanden verder weg
  // uitrekenen, zodat ruilen met paren die verder weg liggen ook kan. Daarna nog eens verbeteren.
  for (let keer = 0; keer < 2; keer++) {
    const lang = oneven.filter((x) => partner.has(x) && d(x, partner.get(x)) > 60)
    if (!lang.length) break
    for (const x of lang) {
      const grens = Math.min(3000, 2 * d(x, partner.get(x)) + 200)
      const boom = dijkstra(g, x, { alleenLengte: true, maxKosten: grens })
      for (const y of oneven) if (y !== x && boom.kosten[y] <= grens) zetAfst(x, y, boom.kosten[y])
    }
    verbeter()
  }
  // de gekozen verbindingen dubbel lopen
  let koppelMeter = 0
  for (const [u, v] of partner) {
    if (u > v) continue
    const boom = dijkstra(g, u, { alleenLengte: true, doel: v })
    if (!Number.isFinite(boom.kosten[v])) continue
    koppelMeter += boom.kosten[v]
    const p = pad(boom, v)
    for (let i = 0; i < p.segs.length; i++) randen.push([p.knopen[i], p.knopen[i + 1], p.segs[i]])
  }
  // 3. Euler-rondje (Hierholzer)
  const buren = new Map()
  randen.forEach(([a, b], i) => {
    if (!buren.has(a)) buren.set(a, [])
    if (!buren.has(b)) buren.set(b, [])
    buren.get(a).push(i)
    buren.get(b).push(i)
  })
  const gebruikt = new Uint8Array(randen.length)
  const wijzer = new Map()
  const begin = buren.has(start) ? start : randen[0][0]
  const stapel = [[begin, -1]]
  const kring = []
  while (stapel.length) {
    const [v] = stapel[stapel.length - 1]
    const lijst = buren.get(v) || []
    let w = wijzer.get(v) || 0
    while (w < lijst.length && gebruikt[lijst[w]]) w++
    wijzer.set(v, w)
    if (w === lijst.length) {
      kring.push(stapel.pop())
    } else {
      const r = lijst[w]
      gebruikt[r] = 1
      const [a, b, s] = randen[r]
      stapel.push([a === v ? b : a, s])
    }
  }
  kring.reverse()
  const knopen = kring.map(([k]) => k)
  const segs = kring.slice(1).map(([, s]) => s)
  let meter = 0
  for (const s of segs) meter += g.lengte[s]
  return { knopen, segs, meter, vereistMeter, extraMeter: Math.max(0, meter - vereistMeter), nietGelopen: randen.length - segs.length, verbindMeter, koppelMeter, oneven: oneven.length }
}

// ---------- Route langs een tekening ----------
/**
 * Een route die een getekende lijn (RD-punten [[x, y], ...]) volgt over echte
 * paden: hoe verder een segment van de lijn, hoe duurder (binnen 20 m bijna
 * gratis, op 60 m tien keer zo duur). De route gaat via punten om de 250 m
 * langs de lijn; ligt het eind vlak bij het begin, dan wordt het een rondje.
 */
export function volgTekening(g, lijn, { gelijk = 20, stap = 250 } = {}) {
  // de lijn bemonsteren om de 20 m, in een rooster van 50 m
  const monsters = []
  for (let i = 1; i < lijn.length; i++) {
    const [ax, ay] = lijn[i - 1]
    const [bx, by] = lijn[i]
    const l = Math.hypot(bx - ax, by - ay)
    const n = Math.max(1, Math.ceil(l / 20))
    for (let k = 0; k < n; k++) monsters.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  monsters.push(lijn[lijn.length - 1])
  const rooster = new Map()
  for (const [x, y] of monsters) {
    const k = Math.floor(x / 50) + ',' + Math.floor(y / 50)
    if (!rooster.has(k)) rooster.set(k, [])
    rooster.get(k).push([x, y])
  }
  const afstand = (x, y) => {
    let beste = 200
    const cx = Math.floor(x / 50)
    const cy = Math.floor(y / 50)
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      for (const [px, py] of rooster.get(cx + dx + ',' + (cy + dy)) || []) beste = Math.min(beste, Math.hypot(px - x, py - y))
    }
    return beste
  }
  const straf = new Float32Array(g.lengte.length)
  for (let s = 0; s < straf.length; s++) {
    const d = afstand((g.x[g.van[s]] + g.x[g.naar[s]]) / 2, (g.y[g.van[s]] + g.y[g.naar[s]]) / 2)
    straf[s] = 1 + (d / gelijk) ** 2
  }
  // tussenpunten om de 'stap' meter langs de lijn
  const punten = [monsters[0]]
  let opgeteld = 0
  for (let i = 1; i < monsters.length; i++) {
    opgeteld += Math.hypot(monsters[i][0] - monsters[i - 1][0], monsters[i][1] - monsters[i - 1][1])
    if (opgeteld >= stap) {
      punten.push(monsters[i])
      opgeteld = 0
    }
  }
  const eind = monsters[monsters.length - 1]
  const rond = Math.hypot(eind[0] - monsters[0][0], eind[1] - monsters[0][1]) < 150 && lijn.length > 2
  if (!rond) punten.push(eind)
  const knopenLangs = punten.map(([x, y]) => dichtsteKnoop(g, x, y).knoop)
  if (rond) knopenLangs.push(knopenLangs[0])
  const schoon = knopenLangs.filter((k, i) => i === 0 || k !== knopenLangs[i - 1])
  if (schoon.length < 2) return null
  let knopen = [schoon[0]]
  let segs = []
  for (let i = 1; i < schoon.length; i++) {
    const b = dijkstra(g, schoon[i - 1], { straf, doel: schoon[i] })
    if (!Number.isFinite(b.kosten[schoon[i]])) return null
    const p = pad(b, schoon[i])
    knopen = knopen.concat(p.knopen.slice(1))
    segs = segs.concat(p.segs)
  }
  ;({ knopen, segs } = zonderUitstapjes(knopen, segs))
  let meter = 0
  let ver = 0
  for (const s of segs) {
    meter += g.lengte[s]
    if (straf[s] > 1 + (40 / gelijk) ** 2) ver += g.lengte[s] // meer dan 40 m van de lijn
  }
  return { knopen, segs, meter, rond, afwijkend: ver / Math.max(1, meter), via: schoon }
}

// ---------- Route verslepen ----------
/**
 * Versleep een route: het stuk rond positie i0 (index in 'knopen') gaat
 * voortaan via knoop 'doel'. Alleen een venster rond i0 wordt opnieuw
 * berekend: tot het dichtstbijzijnde vaste punt (start, finish, eerder
 * versleepte punten) en hooguit 'venster' meter naar elke kant. De rest van
 * de route blijft liggen; wat daarin al gelopen wordt, kost extra, zodat het
 * nieuwe stuk er niet overheen gaat. Geeft {knopen, segs, vast} (vast:
 * gesorteerde indexen in de nieuwe knopen, met het nieuwe punt erbij) of null.
 */
export function versleep(g, knopen, segs, vast, i0, doel, { venster = null } = {}) {
  const opgeteld = [0]
  for (let i = 0; i < segs.length; i++) opgeteld.push(opgeteld[i] + g.lengte[segs[i]])
  const totaal = opgeteld[opgeteld.length - 1]
  const v = venster ?? Math.max(300, Math.min(1500, 0.12 * totaal))
  const vastVoor = vast.filter((k) => k < i0)
  const vastNa = vast.filter((k) => k > i0)
  let ia = vastVoor.length ? vastVoor[vastVoor.length - 1] : 0
  let ib = vastNa.length ? vastNa[0] : knopen.length - 1
  while (ia < i0 - 1 && opgeteld[i0] - opgeteld[ia] > v) ia++
  while (ib > i0 + 1 && opgeteld[ib] - opgeteld[i0] > v) ib--
  if (ia >= ib) return null
  const straf = new Float32Array(g.lengte.length).fill(1)
  for (let i = 0; i < ia; i++) straf[segs[i]] = 4
  for (let i = ib; i < segs.length; i++) straf[segs[i]] = 4
  const been = (van, naar) => {
    if (van === naar) return { knopen: [van], segs: [] }
    const b = dijkstra(g, van, { straf, doel: naar })
    return Number.isFinite(b.kosten[naar]) ? pad(b, naar) : null
  }
  const p1 = been(knopen[ia], doel)
  const p2 = been(doel, knopen[ib])
  if (!p1 || !p2) return null
  const nieuweKnopen = [...knopen.slice(0, ia), ...p1.knopen, ...p2.knopen.slice(1), ...knopen.slice(ib + 1)]
  const nieuweSegs = [...segs.slice(0, ia), ...p1.segs, ...p2.segs, ...segs.slice(ib)]
  const verschuiving = p1.segs.length + p2.segs.length - (ib - ia)
  const nieuwVast = [
    ...vast.filter((k) => k <= ia),
    ia + p1.segs.length,
    ...vast.filter((k) => k >= ib).map((k) => k + verschuiving),
  ]
  return { knopen: nieuweKnopen, segs: nieuweSegs, vast: [...new Set(nieuwVast)].sort((a, b) => a - b) }
}

/**
 * Haal een vast (versleept) punt weg: een venster eromheen (tot de buren en
 * hooguit 'venster' meter) loopt weer de mooiste weg. Bij een rondje vallen
 * start en finish samen; daarom nooit van start naar finish rekenen.
 */
export function laatLos(g, knopen, segs, vast, index, { venster = null } = {}) {
  const rest = vast.filter((k) => k !== index)
  const opgeteld = [0]
  for (let i = 0; i < segs.length; i++) opgeteld.push(opgeteld[i] + g.lengte[segs[i]])
  const v = venster ?? Math.max(300, Math.min(1500, 0.12 * opgeteld[opgeteld.length - 1]))
  let voor = rest.filter((k) => k < index).pop() ?? 0
  let na = rest.find((k) => k > index) ?? knopen.length - 1
  while (voor < index - 1 && opgeteld[index] - opgeteld[voor] > v) voor++
  while (na > index + 1 && opgeteld[na] - opgeteld[index] > v) na--
  if (knopen[voor] === knopen[na]) return { knopen, segs, vast: rest }
  const straf = new Float32Array(g.lengte.length).fill(1)
  for (let i = 0; i < voor; i++) straf[segs[i]] = 4
  for (let i = na; i < segs.length; i++) straf[segs[i]] = 4
  const b = dijkstra(g, knopen[voor], { straf, doel: knopen[na] })
  if (!Number.isFinite(b.kosten[knopen[na]])) return null
  const p = pad(b, knopen[na])
  const nieuweKnopen = [...knopen.slice(0, voor), ...p.knopen, ...knopen.slice(na + 1)]
  const nieuweSegs = [...segs.slice(0, voor), ...p.segs, ...segs.slice(na)]
  const verschuiving = p.segs.length - (na - voor)
  return { knopen: nieuweKnopen, segs: nieuweSegs, vast: rest.map((k) => (k >= na ? k + verschuiving : k)) }
}

// ---------- Water onderweg ----------
/**
 * Punten (water, horeca, winkel, toilet, tankstation) binnen 'max' meter van
 * de route, met hun plek langs de route. Geeft ze gesorteerd op afstand vanaf
 * de start: [{soort, naam, lat, lon, km, afstand, index}], plus het langste
 * stuk zonder waterpunt (in meter, start en finish tellen als waterpunt).
 */
export function waterLangs(xy, pois, max = { winkel: 500, standaard: 300 }) {
  const maxVoor = (soort) => (typeof max === 'number' ? max : max[soort] ?? max.standaard)
  const opgeteld = [0]
  for (let i = 1; i < xy.length; i++) opgeteld.push(opgeteld[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]))
  // segmenten van de route in een rooster van 200 m (een lang recht stuk in alle cellen die het raakt)
  const rooster = new Map()
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1]
    const [bx, by] = xy[i]
    const stappen = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 100))
    const cellen = new Set()
    for (let k = 0; k <= stappen; k++) cellen.add(Math.floor((ax + ((bx - ax) * k) / stappen) / 200) + ',' + Math.floor((ay + ((by - ay) * k) / stappen) / 200))
    for (const c of cellen) {
      if (!rooster.has(c)) rooster.set(c, [])
      rooster.get(c).push(i)
    }
  }
  const uit = []
  const gezien = [] // [soort, x, y] van wat er al in zit
  for (const p of pois) {
    const [x, y] = K.naarRd(p.lon, p.lat)
    if (gezien.some(([s, gx, gy]) => s === p.soort && Math.hypot(gx - x, gy - y) < 15)) continue // zelfde punt uit twee tegels
    let beste = -1
    let besteD = maxVoor(p.soort)
    let besteKm = 0
    const cx = Math.floor(x / 200)
    const cy = Math.floor(y / 200)
    for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) {
      for (const i of rooster.get(cx + dx + ',' + (cy + dy)) || []) {
        const [ax, ay] = xy[i - 1]
        const [bx, by] = xy[i]
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2
        let t = l2 ? ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2 : 0
        t = t < 0 ? 0 : t > 1 ? 1 : t
        const d = Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)))
        if (d < besteD) {
          besteD = d
          beste = t < 0.5 ? i - 1 : i
          besteKm = (opgeteld[i - 1] + t * (opgeteld[i] - opgeteld[i - 1])) / 1000
        }
      }
    }
    if (beste < 0) continue
    gezien.push([p.soort, x, y])
    uit.push({ ...p, afstand: besteD, index: beste, km: besteKm })
  }
  uit.sort((a, b) => a.km - b.km)
  const plekken = [0, ...uit.map((p) => p.km * 1000), opgeteld[opgeteld.length - 1]]
  let langst = 0
  for (let i = 1; i < plekken.length; i++) langst = Math.max(langst, plekken[i] - plekken[i - 1])
  return { punten: uit, langsteZonder: langst }
}

/** Segmenten binnen het gebied die onverhard of half verhard zijn (lage kosten in het trailprofiel). */
export function onverhardeSegmenten(g) {
  const uit = new Uint8Array(g.lengte.length)
  const klasse = g.tagLijst.map((t) => K.osmKlasse(t).klasse)
  for (let s = 0; s < uit.length; s++) {
    if (!g.binnenSeg[s] || g.factor[s] >= STRAND_FACTOR) continue
    const k = klasse[g.segTags[s]]
    if (k === K.ONVERHARD || k === K.HALF) uit[s] = 1
  }
  return uit
}

// ---------- GPX inlezen: de wegen eronder herkennen ----------
/**
 * Bij een ingelezen route (RD-punten) de OSM-tags van het pad eronder: per
 * punt het dichtstbijzijnde segment binnen 'max' meter. Geeft segs zoals
 * BRouter ze geeft: [[i0, i1, tags], ...] (stukken zonder pad: '').
 */
export function tagsLangs(g, xy, max = 15) {
  const rooster = new Map()
  for (let s = 0; s < g.lengte.length; s++) {
    const a = g.van[s]
    const b = g.naar[s]
    const x0 = Math.floor((Math.min(g.x[a], g.x[b]) - max) / 25)
    const x1 = Math.floor((Math.max(g.x[a], g.x[b]) + max) / 25)
    const y0 = Math.floor((Math.min(g.y[a], g.y[b]) - max) / 25)
    const y1 = Math.floor((Math.max(g.y[a], g.y[b]) + max) / 25)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      const k = cx + ',' + cy
      if (!rooster.has(k)) rooster.set(k, [])
      rooster.get(k).push(s)
    }
  }
  const tagVan = xy.map(([x, y]) => {
    let beste = -1
    let besteD = max
    for (const s of rooster.get(Math.floor(x / 25) + ',' + Math.floor(y / 25)) || []) {
      const ax = g.x[g.van[s]]
      const ay = g.y[g.van[s]]
      const dx = g.x[g.naar[s]] - ax
      const dy = g.y[g.naar[s]] - ay
      const l2 = dx * dx + dy * dy
      let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
      if (d < besteD) {
        besteD = d
        beste = s
      }
    }
    return beste >= 0 ? g.tagLijst[g.segTags[beste]] : ''
  })
  const segs = []
  let begin = 0
  for (let i = 1; i < xy.length; i++) {
    if (i === xy.length - 1 || tagVan[i] !== tagVan[begin]) {
      segs.push([begin, i, tagVan[begin]])
      begin = i
    }
  }
  if (!segs.length) segs.push([0, xy.length - 1, ''])
  return segs
}
