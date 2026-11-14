// Eigen routeplanner in de browser: de paden komen uit OpenStreetMap (via de
// Overpass API), de route rekenen we zelf uit. Voordeel ten opzichte van een
// routeserver: geen limiet op het aantal verzoeken, dus we kunnen honderden
// rondjes proberen, en we bepalen zelf wat verboden is (zoals het strand).
//
// Puur rekenwerk, geen netwerk: het ophalen staat in bronnen.js.

import * as K from './kern.js'

const NOOIT = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'construction', 'proposed', 'raceway', 'bus_guideway', 'platform', 'elevator', 'abandoned', 'razed'])
export const STRAND_FACTOR = 40 // strand mag alleen als er echt niets anders is

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
 * Bouw de graaf. opties: {trail, kaartje, strandMijden, extraStranden}
 * (extraStranden: vlakken {polygonen, bbox} uit de officiële kaart).
 * Knopen zijn de punten van de OSM-wegen (gedeelde punten = kruisingen).
 */
export function bouwGraaf(elementen, { trail = true, kaartje = false, strandMijden = true, extraStranden = [], mijdPunten = [] } = {}) {
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
    const f0 = K.kostenfactor(K.osmKlasse(tekst).klasse, tekst, trail) * (afgesloten ? 1.3 : 1)
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
 * mooiste route ernaartoe). Wat al gelopen is krijgt straf, zodat het een
 * echte lus wordt. 'kronkel': vier hoeken dicht bij de start in plaats van
 * een grote driehoek, voor kronkelen in een klein gebied.
 * Geeft {rondjes: [{knopen, segs, meter, kosten, dubbel, strand, via}], ...}.
 */
export function zoekRondjes(g, start, doel, { aantal = 6, sectoren = 24, maxProbeer = 160, kronkel = false } = {}) {
  const boom = dijkstra(g, start, { maxKosten: doel * 6 })
  const sx = g.x[start]
  const sy = g.y[start]
  const ringen = kronkel ? [0.1, 0.15, 0.2, 0.26] : [0.18, 0.26, 0.34, 0.42]
  const beste = new Map()
  for (let i = 0; i < g.n; i++) {
    const m = boom.meter[i]
    if (!Number.isFinite(boom.kosten[i]) || m < (ringen[0] - 0.05) * doel || m > (ringen[3] + 0.05) * doel) continue
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
        if (af <= 0.3) combis.push({ hoeken: [a, b], prior: a.waarde + b.waarde + 2 * af })
        continue
      }
      for (const c of kand) {
        const dbc = draai(b, c)
        if (c === a || c === b || dbc < 25 || dbc > 120 || dab + dbc > 240) continue
        const af = Math.abs(a.meter + 1.35 * (afstand(a, b) + afstand(b, c)) + c.meter - doel) / doel
        if (af <= 0.3) combis.push({ hoeken: [a, b, c], prior: (a.waarde + b.waarde + c.waarde) * (2 / 3) + 2 * af })
      }
    }
  }
  combis.sort((p, q) => p.prior - q.prior)
  const uit = []
  const straf = new Float32Array(g.lengte.length)
  for (const { hoeken } of combis.slice(0, maxProbeer)) {
    straf.fill(1)
    const p1 = pad(boom, hoeken[0].knoop)
    for (const s of p1.segs) straf[s] = 4
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
      for (const s of p.segs) straf[s] = 4
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
