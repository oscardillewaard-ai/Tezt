// Onverhard: de rekenkern. Geen netwerk en geen DOM, zodat dit ook in Node
// te testen is. Het is een vertaling van tools/onverhard/onverhard.py; houd de
// twee gelijk, want de test vergelijkt de uitkomsten.

export const ONVERHARD = 'onverhard'
export const HALF = 'half verhard'
export const OPEN = 'open verharding'
export const GESLOTEN = 'gesloten verharding'
export const ONBEKEND = 'onbekend'
export const KLASSEN = [ONVERHARD, HALF, OPEN, GESLOTEN, ONBEKEND]
export const BGT_COLLECTIES = [
  'wegdeel',
  'ondersteunendwegdeel',
  'onbegroeidterreindeel',
  'begroeidterreindeel',
]

export const STUK_M = 50 // maximale lengte van een routestuk in het rapport
export const STAP_M = 5 // afstand tussen meetpunten binnen een stuk
export const SNAP_M = 3 // ligt de lijn zo dicht bij een wegdeel, dan telt dat wegdeel

export function groep(klasse) {
  if (klasse === ONVERHARD || klasse === HALF) return 'zacht'
  if (klasse === OPEN || klasse === GESLOTEN) return 'hard'
  return null
}

// ---------- RD-coördinaten (EPSG:28992) ----------
// Benaderingsformules van Schreutelkamp en Strang van Hees: binnen Nederland
// tot op enkele decimeters nauwkeurig. Ruim genoeg naast de 3 m tolerantie.
const PHI0 = 52.1551744
const LAM0 = 5.38720621
const X0 = 155000
const Y0 = 463000
const RPQ = [
  [0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705],
  [3, 1, -2.34], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148],
]
const SPQ = [
  [1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788],
  [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054],
]
const KPQ = [
  [0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.2475], [2, 1, -0.84978], [0, 3, -0.0655],
  [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.0053], [2, 3, -0.00039], [4, 1, 0.00033],
  [1, 1, -0.00012],
]
const LPQ = [
  [1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594],
  [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022],
  [2, 0, -0.00022], [5, 0, 0.00026],
]

export function naarRd(lon, lat) {
  const dp = 0.36 * (lat - PHI0)
  const dl = 0.36 * (lon - LAM0)
  let x = X0
  let y = Y0
  for (const [p, q, r] of RPQ) x += r * dp ** p * dl ** q
  for (const [p, q, s] of SPQ) y += s * dp ** p * dl ** q
  return [x, y]
}

export function naarWgs(x, y) {
  const dx = (x - X0) * 1e-5
  const dy = (y - Y0) * 1e-5
  let lat = 0
  let lon = 0
  for (const [p, q, k] of KPQ) lat += k * dx ** p * dy ** q
  for (const [p, q, l] of LPQ) lon += l * dx ** p * dy ** q
  return [LAM0 + lon / 3600, PHI0 + lat / 3600]
}

// ---------- Lijnen ----------
const afstand = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])

export function lijnLengte(xy) {
  let som = 0
  for (let i = 1; i < xy.length; i++) som += afstand(xy[i - 1], xy[i])
  return som
}

/** Punt op afstand d (meters) vanaf het begin van de lijn. */
export function puntOpLijn(xy, d) {
  let rest = d
  for (let i = 1; i < xy.length; i++) {
    const l = afstand(xy[i - 1], xy[i])
    if (rest <= l && l > 0) {
      const f = rest / l
      return [xy[i - 1][0] + f * (xy[i][0] - xy[i - 1][0]), xy[i - 1][1] + f * (xy[i][1] - xy[i - 1][1])]
    }
    rest -= l
  }
  return xy[xy.length - 1]
}

/** Het deel van de lijn tussen afstand a en b (meters vanaf het begin). */
export function snijLijn(xy, a, b) {
  const uit = [puntOpLijn(xy, a)]
  let gelopen = 0
  for (let i = 1; i < xy.length; i++) {
    gelopen += afstand(xy[i - 1], xy[i])
    if (gelopen > a + 1e-9 && gelopen < b - 1e-9) uit.push(xy[i])
  }
  uit.push(puntOpLijn(xy, b))
  return uit
}

// ---------- BRouter ----------
const PROFIEL = `# onverhard-planner: voorkeur voor onverharde paden (hardlopen)
---context:global
assign processUnusedTags = true
assign validForFoot = true
assign turnInstructionMode = 1
---context:way
assign isunpaved = surface=unpaved|ground|dirt|grass|sand|earth|clay|rock
assign ishalf = surface=gravel|fine_gravel|compacted
assign ispaved = surface=asphalt|paved|concrete|paving_stones|sett|cobblestone|grass_paver
assign footok = foot=yes|designated|permissive
assign forbidden = or highway=motorway|motorway_link|trunk|trunk_link|construction|proposed
                   or ( and access=private|no not footok ) foot=no|private
assign base =
  if forbidden then 10000
  else if isunpaved then 1
  else if ishalf then 1.1
  else if ispaved then
     ( if highway=path|track|footway|pedestrian|bridleway then 3 else if highway=primary|primary_link then 8 else if highway=secondary|secondary_link then 6 else 4 )
  else if highway=track then
     ( if tracktype=grade1 then 3 else if tracktype=grade2 then 1.2 else 1.3 )
  else if highway=path|bridleway then 1.3
  else if highway=footway|pedestrian|steps then 2.5
  else if highway=residential|living_street|service|unclassified|cycleway|tertiary|tertiary_link then 4
  else if highway=secondary|secondary_link then 6
  else if highway=primary|primary_link then 8
  else 10000
assign islaw = or route_hiking_nwn=yes route_hiking_iwn=yes
assign costfactor = if islaw then base else multiply base NIETLAW
assign turncost = 0
assign initialcost = 0
---context:node
assign initialcost = 0
`

/**
 * Profieltekst voor BRouter. law 0.3 = een LAW-pad kost 0,3x zoveel als
 * hetzelfde pad zonder LAW. We maken daarvoor alle andere wegen 1/law keer
 * duurder, zodat de kostenfactor nergens onder 1 komt.
 */
export function maakProfiel(law, { trail = false } = {}) {
  if (!(law >= 0.05 && law <= 1)) throw new Error('De LAW-factor moet tussen 0,05 en 1 liggen')
  const tekst = trail ? PROFIEL.replace(/assign base =[\s\S]*?\nassign islaw/, TRAIL_BASIS + '\nassign islaw') : PROFIEL
  return tekst.replace('NIETLAW', (1 / law).toFixed(4))
}

// Trailrunnen: smalle paadjes zijn het fijnst, ongeacht of er een surface-tag
// op staat (in de duinen en bossen vaak niet). Brede zandwegen zijn iets
// minder, ruiterpaden even duur als brede zandwegen, verharding het minst.
const TRAIL_BASIS = `assign base =
  if forbidden then 10000
  else if ispaved then
     ( if highway=path|track|footway|pedestrian|bridleway then 3 else if highway=primary|primary_link then 8 else if highway=secondary|secondary_link then 6 else 4 )
  else if highway=path then ( if ishalf then 1.1 else 1 )
  else if highway=footway|steps then ( if isunpaved then 1 else if ishalf then 1.2 else 2.5 )
  else if highway=bridleway then 1.3
  else if highway=track then
     ( if tracktype=grade1 then 3 else if ishalf then 1.4 else 1.3 )
  else if isunpaved then 1.3
  else if ishalf then 1.4
  else if highway=pedestrian then 2.5
  else if highway=residential|living_street|service|unclassified|cycleway|tertiary|tertiary_link then 4
  else if highway=secondary|secondary_link then 6
  else if highway=primary|primary_link then 8
  else 10000`

/**
 * Zet een BRouter-GeoJSON-feature om in een traject. properties.messages is
 * een tabel met in de eerste rij de kolomnamen; elke volgende rij beschrijft
 * het stuk dat EINDIGT op (Longitude, Latitude).
 */
export function leesBrouterRoute(feature) {
  const coords = feature.geometry.coordinates.map((c) => [c[0], c[1], c.length > 2 ? c[2] : null])
  if (coords.length < 2) throw new Error('route zonder geometrie ontvangen')
  const berichten = (feature.properties && feature.properties.messages) || []
  if (berichten.length < 2) return { coords, segs: [[0, coords.length - 1, '']], punten: [] }
  const kop = berichten[0]
  const kLon = kop.indexOf('Longitude')
  const kLat = kop.indexOf('Latitude')
  const kTags = kop.indexOf('WayTags')
  const sleutels = coords.map((c) => [Math.round(c[0] * 1e6), Math.round(c[1] * 1e6)])
  const segs = []
  let vorige = 0
  for (const rij of berichten.slice(1)) {
    const lon = Number(rij[kLon])
    const lat = Number(rij[kLat])
    let i = -1
    for (let j = vorige; j < coords.length; j++) {
      if (sleutels[j][0] === lon && sleutels[j][1] === lat) {
        i = j
        break
      }
    }
    if (i < 0) {
      // afrondingsverschil: neem het dichtstbijzijnde punt verderop
      let beste = Infinity
      for (let j = vorige; j < coords.length; j++) {
        const d = Math.abs(sleutels[j][0] - lon) + Math.abs(sleutels[j][1] - lat)
        if (d < beste) {
          beste = d
          i = j
        }
      }
    }
    if (i > vorige) {
      const tags = rij[kTags]
        .split(/\s+/)
        .filter((t) => t && !t.startsWith('reversedirection='))
        .join(' ')
      segs.push([vorige, i, tags])
      vorige = i
    }
  }
  if (vorige < coords.length - 1) {
    segs.push([vorige, coords.length - 1, segs.length ? segs[segs.length - 1][2] : ''])
  }
  return { coords, segs, punten: [] }
}

/** Plak deeltrajecten (van punt naar punt) achter elkaar. */
export function plak(trajecten) {
  const coords = []
  const segs = []
  for (const t of trajecten) {
    let verschuiving = coords.length
    const laatste = coords[coords.length - 1]
    if (laatste && laatste[0] === t.coords[0][0] && laatste[1] === t.coords[0][1]) {
      verschuiving -= 1
      for (let i = 1; i < t.coords.length; i++) coords.push(t.coords[i])
    } else {
      for (const c of t.coords) coords.push(c)
    }
    for (const [i0, i1, tags] of t.segs) segs.push([i0 + verschuiving, i1 + verschuiving, tags])
  }
  return { coords, segs, punten: [] }
}

export function zelfdeTraject(a, b) {
  return (
    a.coords.length === b.coords.length &&
    a.coords.every((p, i) => p[0] === b.coords[i][0] && p[1] === b.coords[i][1])
  )
}

export const trajectXy = (traject) => traject.coords.map((c) => naarRd(c[0], c[1]))

// ---------- OSM-tags -> ondergrondklasse ----------
const OSM_SURFACE = {}
for (const [klasse, waarden] of [
  [ONVERHARD, 'unpaved ground dirt earth grass sand mud clay rock woodchips soil'],
  [HALF, 'gravel fine_gravel compacted pebblestone shells'],
  [OPEN, 'paving_stones sett cobblestone unhewn_cobblestone bricks grass_paver'],
  [GESLOTEN, 'asphalt concrete paved concrete:plates concrete:lanes chipseal metal wood'],
]) {
  for (const w of waarden.split(' ')) OSM_SURFACE[w] = klasse
}

export function tagsObject(tags) {
  const uit = {}
  for (const t of tags.split(/\s+/)) {
    const i = t.indexOf('=')
    if (i > 0) uit[t.slice(0, i)] = t.slice(i + 1)
  }
  return uit
}

/**
 * Geef {klasse, zeker, uitleg} op basis van OSM-tags. zeker is alleen waar
 * als er een surface-tag is; anders is het een aanname op basis van het
 * wegtype (dezelfde aanname die het routeprofiel doet).
 */
export function osmKlasse(tags) {
  const t = tagsObject(tags)
  const surface = t.surface
  const highway = t.highway || ''
  if (surface && OSM_SURFACE[surface]) {
    return { klasse: OSM_SURFACE[surface], zeker: true, uitleg: `surface=${surface}` }
  }
  const voor = surface ? `surface=${surface} (onbekende waarde), ` : ''
  const gok = (klasse, uitleg) => ({ klasse, zeker: false, uitleg: voor + uitleg })
  if (highway === 'track') {
    if (t.tracktype === 'grade1') return gok(GESLOTEN, 'aanname: track grade1')
    if (t.tracktype === 'grade2') return gok(HALF, 'aanname: track grade2')
    return gok(ONVERHARD, `aanname: track${t.tracktype ? ' ' + t.tracktype : ''} zonder surface`)
  }
  if (highway === 'path' || highway === 'bridleway') return gok(ONVERHARD, `aanname: ${highway} zonder surface`)
  if (['footway', 'pedestrian', 'steps'].includes(highway)) return gok(ONBEKEND, `${highway} zonder surface`)
  if (
    ['cycleway', 'residential', 'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link',
      'secondary', 'secondary_link', 'primary', 'primary_link'].includes(highway)
  ) {
    return gok(GESLOTEN, `aanname: ${highway} zonder surface`)
  }
  return gok(ONBEKEND, highway ? `${highway} zonder surface` : 'geen tags')
}

/** +1 op een brug, -1 in een tunnel, anders 0 (voor de BGT-hoogteligging). */
export function osmNiveau(tags) {
  const t = tagsObject(tags)
  if ((t.bridge || 'no') !== 'no') return 1
  if ((t.tunnel || 'no') !== 'no') return -1
  return 0
}

export function isLaw(tags) {
  const t = tagsObject(tags)
  return t.route_hiking_nwn === 'yes' || t.route_hiking_iwn === 'yes'
}

/** De kostenfactor uit het routeprofiel, maar met een gegeven ondergrondklasse. */
export function kostenfactor(klasse, tags, trail = false) {
  if (trail && (klasse === ONVERHARD || klasse === HALF)) {
    const highway = tagsObject(tags).highway || ''
    const half = klasse === HALF
    if (highway === 'path') return half ? 1.1 : 1
    if (highway === 'footway' || highway === 'steps') return half ? 1.2 : 1
    if (highway === 'bridleway') return 1.3
    return half ? 1.4 : 1.3
  }
  if (klasse === ONVERHARD) return 1
  if (klasse === HALF) return 1.1
  const highway = tagsObject(tags).highway || ''
  if (klasse === OPEN || klasse === GESLOTEN) {
    if (['path', 'track', 'footway', 'pedestrian', 'bridleway', 'steps'].includes(highway)) return 3
    if (highway === 'primary' || highway === 'primary_link') return 8
    if (highway === 'secondary' || highway === 'secondary_link') return 6
    return 4
  }
  return 2.5
}

// ---------- BGT ----------
const BGT_LABEL = {
  wegdeel: 'wegdeel',
  ondersteunendwegdeel: 'ondersteunend wegdeel (berm)',
  onbegroeidterreindeel: 'onbegroeid terreindeel',
  begroeidterreindeel: 'begroeid terreindeel',
}

/** Vertaal BGT fysiek_voorkomen naar een rapportklasse. */
export function bgtKlasse(collectie, fysiek) {
  const f = (fysiek || '').trim().toLowerCase()
  if ([GESLOTEN, OPEN, HALF, ONVERHARD].includes(f)) return f
  if (f === 'groenvoorziening' || f === 'zand') return ONVERHARD
  if (['', 'transitie', 'erf', 'waardeonbekend', 'niet-bgt'].includes(f)) return ONBEKEND
  if (collectie === 'begroeidterreindeel') return ONVERHARD
  return ONBEKEND
}

const nl = (getal, decimalen = 2) => getal.toFixed(decimalen).replace('.', ',')

function vlakUitleg(v) {
  let tekst = BGT_LABEL[v.collectie]
  if (v.functie) tekst += ', ' + v.functie
  tekst += ': ' + (v.fysiek || '?')
  if (v.plus) tekst += ` (${v.plus})`
  return tekst
}

// ---------- BGT-vectortegels ----------
// PDOK levert de BGT ook als vectortegels (NetherlandsRDNewQuad). Er is alleen
// zoomniveau 12: vakjes van 256 pixels van 0,84 m = 215,04 m, geteld vanaf de
// linkerbovenhoek. Een tegel bevat elk vlak dat hem raakt in zijn geheel (niet
// afgeknipt op de rand), op 5 cm nauwkeurig. Dat is veel compacter dan de
// GeoJSON van de OGC API, die per bbox alle vlakken met alle velden en
// coördinaten in tekst terugstuurt.
export const TEGEL_M = 215.04
const TEGEL_X0 = -285401.92
const TEGEL_Y0 = 903401.92

/** Kolom en rij van de tegel waar een RD-punt in valt. */
export function tegelVan(x, y) {
  return [Math.floor((x - TEGEL_X0) / TEGEL_M), Math.floor((TEGEL_Y0 - y) / TEGEL_M)]
}

/** RD-bbox van een tegel: [minX, minY, maxX, maxY]. */
export function tegelGebied(col, row) {
  const x0 = TEGEL_X0 + col * TEGEL_M
  const y1 = TEGEL_Y0 - row * TEGEL_M
  return [x0, y1 - TEGEL_M, x0 + TEGEL_M, y1]
}

/**
 * De tegels die nodig zijn voor deze meetpunten: die van elk punt, plus een
 * buurtegel als het punt dichter dan 'marge' meter bij de rand ligt (een
 * wegdeel net over de rand moet ook meetellen). Geeft [[col, row], ...].
 */
export function tegelsVoor(punten, marge = SNAP_M) {
  const uit = new Map()
  for (const { x, y } of punten) {
    for (const dx of [-marge, 0, marge]) {
      for (const dy of [-marge, 0, marge]) {
        const [col, row] = tegelVan(x + dx, y + dy)
        uit.set(col + '/' + row, [col, row])
      }
    }
  }
  return [...uit.values()]
}

// Een kleine protobuf-lezer voor Mapbox Vector Tiles: alleen wat we nodig hebben.
const utf8 = new TextDecoder()

class Lezer {
  constructor(bytes) {
    this.b = bytes
    this.pos = 0
  }

  // tot 2^53 exact: genoeg voor lengtes, veldnummers en geometrie
  varint() {
    let waarde = 0
    let schaal = 1
    let byte
    do {
      byte = this.b[this.pos++]
      waarde += (byte & 0x7f) * schaal
      schaal *= 128
    } while (byte >= 0x80)
    return waarde
  }

  // int64-waarden kunnen negatief zijn (dan 10 bytes lang): die lezen we als BigInt
  varintGroot() {
    let waarde = 0n
    let schuif = 0n
    let byte
    do {
      byte = this.b[this.pos++]
      waarde |= BigInt(byte & 0x7f) << schuif
      schuif += 7n
    } while (byte >= 0x80)
    return waarde
  }

  stuk() {
    const lengte = this.varint()
    const begin = this.pos
    this.pos += lengte
    return this.b.subarray(begin, this.pos)
  }

  sla(type) {
    if (type === 0) this.varint()
    else if (type === 1) this.pos += 8
    else if (type === 2) this.pos += this.varint()
    else if (type === 5) this.pos += 4
    else throw new Error(`onbekend protobuf-veldtype ${type}`)
  }

  klaar() {
    return this.pos >= this.b.length
  }

  /** [veldnummer, type] van het volgende veld */
  veld() {
    const sleutel = this.varint()
    return [Math.floor(sleutel / 8), sleutel % 8]
  }
}

function packed(bytes) {
  const l = new Lezer(bytes)
  const uit = []
  while (!l.klaar()) uit.push(l.varint())
  return uit
}

function leesWaarde(bytes) {
  const l = new Lezer(bytes)
  let waarde = null
  while (!l.klaar()) {
    const [nr, type] = l.veld()
    const kijk = () => new DataView(bytes.buffer, bytes.byteOffset + l.pos)
    if (nr === 1 && type === 2) waarde = utf8.decode(l.stuk())
    else if (nr === 2 && type === 5) {
      waarde = kijk().getFloat32(0, true)
      l.pos += 4
    } else if (nr === 3 && type === 1) {
      waarde = kijk().getFloat64(0, true)
      l.pos += 8
    } else if (nr === 4 && type === 0) waarde = Number(BigInt.asIntN(64, l.varintGroot()))
    else if (nr === 5 && type === 0) waarde = Number(l.varintGroot())
    else if (nr === 6 && type === 0) {
      const v = l.varintGroot()
      waarde = Number((v >> 1n) ^ -(v & 1n))
    } else if (nr === 7 && type === 0) waarde = l.varint() !== 0
    else l.sla(type)
  }
  return waarde
}

/**
 * Zet de geometrie van een vlak-feature om in polygonen in RD. Buitenringen
 * hebben in tegelcoördinaten (y naar beneden) een positieve oppervlakte, gaten
 * een negatieve. Elke ring wordt een Float64Array [x0, y0, x1, y1, ...].
 */
function leesVlakken(geom, x0, y1, schaal) {
  const ringen = []
  let x = 0
  let y = 0
  let ring = null
  let i = 0
  while (i < geom.length) {
    const opdracht = geom[i++]
    const id = opdracht & 7
    const aantal = opdracht >>> 3
    if (id === 1 || id === 2) {
      for (let k = 0; k < aantal; k++) {
        const dx = geom[i++]
        const dy = geom[i++]
        x += (dx >>> 1) ^ -(dx & 1)
        y += (dy >>> 1) ^ -(dy & 1)
        if (id === 1) {
          ring = [x, y]
          ringen.push(ring)
        } else ring.push(x, y)
      }
    } else if (id === 7) {
      if (ring) ring.push(ring[0], ring[1])
    } else break
  }
  const polygonen = []
  for (const r of ringen) {
    if (r.length < 8) continue
    let opp = 0
    for (let j = 0; j + 3 < r.length; j += 2) opp += r[j] * r[j + 3] - r[j + 2] * r[j + 1]
    if (opp === 0) continue
    const rd = new Float64Array(r.length)
    for (let j = 0; j < r.length; j += 2) {
      rd[j] = x0 + r[j] * schaal
      rd[j + 1] = y1 - r[j + 1] * schaal
    }
    if (opp > 0) polygonen.push([rd])
    else if (polygonen.length) polygonen[polygonen.length - 1].push(rd)
  }
  return polygonen
}

const NODIGE_VELDEN = new Set([
  'lokaal_id', 'functie', 'fysiek_voorkomen', 'plus_fysiek_voorkomen', 'relatieve_hoogteligging', 'status', 'type',
])

function leesLaag(bytes, col, row, lagen, uit) {
  const l = new Lezer(bytes)
  let naam = ''
  let extent = 4096
  const features = []
  const sleutels = []
  const waarden = []
  while (!l.klaar()) {
    const [nr, type] = l.veld()
    if (nr === 1 && type === 2) {
      naam = utf8.decode(l.stuk())
      if (!lagen.includes(naam)) return // deze laag hebben we niet nodig
    } else if (nr === 2 && type === 2) features.push(l.stuk())
    else if (nr === 3 && type === 2) sleutels.push(utf8.decode(l.stuk()))
    else if (nr === 4 && type === 2) waarden.push(l.stuk())
    else if (nr === 5 && type === 0) extent = l.varint()
    else l.sla(type)
  }
  if (!lagen.includes(naam)) return
  const gelezen = new Map()
  const waarde = (i) => {
    if (!gelezen.has(i)) gelezen.set(i, leesWaarde(waarden[i]))
    return gelezen.get(i)
  }
  const [x0, , , y1] = tegelGebied(col, row)
  for (const fb of features) {
    const f = new Lezer(fb)
    let tags = []
    let type = 0
    let geom = null
    while (!f.klaar()) {
      const [nr, t] = f.veld()
      if (nr === 2 && t === 2) tags = packed(f.stuk())
      else if (nr === 3 && t === 0) type = f.varint()
      else if (nr === 4 && t === 2) geom = packed(f.stuk())
      else f.sla(t)
    }
    if (type !== 3 || !geom) continue // alleen vlakken
    const props = {}
    for (let i = 0; i + 1 < tags.length; i += 2) {
      const sleutel = sleutels[tags[i]]
      if (NODIGE_VELDEN.has(sleutel)) props[sleutel] = waarde(tags[i + 1])
    }
    const polygonen = leesVlakken(geom, x0, y1, TEGEL_M / extent)
    if (polygonen.length) uit.push({ collectie: naam, props, polygonen })
  }
}

/**
 * Lees een BGT-vectortegel (de uitgepakte bytes). Geeft de vlakken van de
 * gevraagde lagen: [{collectie, props, polygonen}], polygonen in RD.
 */
export function leesTegel(bytes, col, row, lagen = [...BGT_COLLECTIES, 'waterdeel']) {
  const uit = []
  const l = new Lezer(bytes)
  while (!l.klaar()) {
    const [nr, type] = l.veld()
    if (nr === 3 && type === 2) leesLaag(l.stuk(), col, row, lagen, uit)
    else l.sla(type)
  }
  return uit
}

// ---------- Vlakken opzoeken ----------
function inRing(x, y, r) {
  let binnen = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i]
    const yi = r[i + 1]
    const xj = r[j]
    const yj = r[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen
  }
  return binnen
}

function afstandTotRing(x, y, r) {
  let beste = Infinity
  for (let i = 2; i < r.length; i += 2) {
    const ax = r[i - 2]
    const ay = r[i - 1]
    const dx = r[i] - ax
    const dy = r[i + 1] - ay
    const l2 = dx * dx + dy * dy
    let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0
    t = t < 0 ? 0 : t > 1 ? 1 : t
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy))
    if (d < beste) beste = d
  }
  return beste
}

/** Afstand van een punt tot een vlak (polygonen met Float64Array-ringen); 0 als het erin ligt. */
export function afstandTotVlak(x, y, polygonen) {
  let beste = Infinity
  for (const poly of polygonen) {
    if (inRing(x, y, poly[0]) && !poly.slice(1).some((gat) => inRing(x, y, gat))) return 0
    for (const ring of poly) {
      const d = afstandTotRing(x, y, ring)
      if (d < beste) beste = d
    }
  }
  return beste
}

/** GeoJSON-(Multi)Polygon naar polygonen met Float64Array-ringen. */
export function geojsonVlakken(geometrie) {
  if (!geometrie) return []
  let lijst = []
  if (geometrie.type === 'Polygon') lijst = [geometrie.coordinates]
  else if (geometrie.type === 'MultiPolygon') lijst = geometrie.coordinates
  return lijst.map((poly) => poly.map((ring) => Float64Array.from(ring.flat())))
}

const CEL = 40 // meters; zoekrooster voor de vlakken
const BOERENLAND = new Set(['grasland agrarisch', 'bouwland', 'fruitteelt', 'boomteelt', 'houtwal'])

/** De BGT-vlakken rond een route, met een zoekrooster om snel op te zoeken. */
export class BgtVlakken {
  constructor(snap = SNAP_M) {
    this.snap = snap
    this.lijst = []
    this.index = new Map() // 'collectie|lokaal_id' -> plaats in lijst
    this.rooster = new Map()
    this.zee = [] // watervlakken van het type 'zee': om het strand te herkennen
    this.zeeIds = new Set()
  }

  /** Bewaar een zeevlak (BGT waterdeel, type zee). */
  voegToeZee(id, polygonen) {
    if (this.zeeIds.has(id)) return
    this.zeeIds.add(id)
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const poly of polygonen) {
      const r = poly[0]
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < minX) minX = r[i]
        if (r[i] > maxX) maxX = r[i]
        if (r[i + 1] < minY) minY = r[i + 1]
        if (r[i + 1] > maxY) maxY = r[i + 1]
      }
    }
    this.zee.push({ polygonen, bbox: [minX, minY, maxX, maxY] })
  }

  /**
   * Hoe 'natuurlijk' is de omgeving van een punt (0..1)? We prikken een raster
   * van 5×5 punten in een vierkant van 200 m: duin, bos, heide, natuurgras en
   * onverharde paden tellen als natuur (1), boerenland half, verharding,
   * bebouwing (geen vlak in onze lagen) en zee niet.
   */
  natuur(x, y) {
    let som = 0
    let n = 0
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const px = x + i * 50
        const py = y + j * 50
        n += 1
        const hier = this.kandidaten(px, py).filter(([d]) => d <= 0.01).map(([, v]) => v)
        if (!hier.length) continue
        hier.sort((a, b) => BGT_COLLECTIES.indexOf(a.collectie) - BGT_COLLECTIES.indexOf(b.collectie))
        const v = hier[0]
        if (v.collectie === 'begroeidterreindeel') som += BOERENLAND.has(v.fysiek) ? 0.5 : 1
        else if (groep(v.klasse) === 'zacht' && !(v.fysiek === 'zand' && this.bijZee(px, py))) som += 1
      }
    }
    return som / n
  }

  /** Ligt dit punt binnen 'afstand' meter van de zee? */
  bijZee(x, y, afstand = 250) {
    for (const z of this.zee) {
      const b = z.bbox
      if (x < b[0] - afstand || x > b[2] + afstand || y < b[1] - afstand || y > b[3] + afstand) continue
      if (afstandTotVlak(x, y, z.polygonen) <= afstand) return true
    }
    return false
  }

  /** Voeg een GeoJSON-feature (in RD) toe. Geeft false als het niet meetelt. */
  voegToe(collectie, feature) {
    const p = feature.properties || {}
    if (p.eind_registratie !== null && p.eind_registratie !== undefined) return false // historische versie
    return this.voegToeVlak(collectie, { ...p, lokaal_id: p.lokaal_id || feature.id }, geojsonVlakken(feature.geometry))
  }

  /**
   * Voeg een vlak toe. 'gebied' ([minX, minY, maxX, maxY]) beperkt het
   * zoekrooster tot de tegel waar het vlak vandaan komt: een groot weiland
   * hoeft niet kilometers ver geïndexeerd te worden. Komt hetzelfde vlak ook
   * uit een buurtegel, dan bewaren we het één keer en breiden we alleen het
   * rooster uit.
   */
  voegToeVlak(collectie, p, polygonen, gebied = null) {
    if ((p.status || 'bestaand') !== 'bestaand') return false
    if (!polygonen.length) return false
    const sleutel = p.lokaal_id ? collectie + '|' + p.lokaal_id : null
    let plek = sleutel ? this.index.get(sleutel) : undefined
    if (plek === undefined) {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const poly of polygonen) {
        const r = poly[0]
        for (let i = 0; i < r.length; i += 2) {
          if (r[i] < minX) minX = r[i]
          if (r[i] > maxX) maxX = r[i]
          if (r[i + 1] < minY) minY = r[i + 1]
          if (r[i + 1] > maxY) maxY = r[i + 1]
        }
      }
      plek = this.lijst.push({
        collectie,
        fysiek: p.fysiek_voorkomen || '',
        plus: p.plus_fysiek_voorkomen || '',
        functie: p.functie || '',
        niveau: Number(p.relatieve_hoogteligging) || 0,
        klasse: bgtKlasse(collectie, p.fysiek_voorkomen),
        polygonen,
        bbox: [minX, minY, maxX, maxY],
      }) - 1
      if (sleutel) this.index.set(sleutel, plek)
    }
    const b = this.lijst[plek].bbox
    const m = this.snap
    const x0 = (gebied ? Math.max(b[0], gebied[0]) : b[0]) - m
    const y0 = (gebied ? Math.max(b[1], gebied[1]) : b[1]) - m
    const x1 = (gebied ? Math.min(b[2], gebied[2]) : b[2]) + m
    const y1 = (gebied ? Math.min(b[3], gebied[3]) : b[3]) + m
    for (let cx = Math.floor(x0 / CEL); cx <= Math.floor(x1 / CEL); cx++) {
      for (let cy = Math.floor(y0 / CEL); cy <= Math.floor(y1 / CEL); cy++) {
        const k = cx + ',' + cy
        const cel = this.rooster.get(k)
        if (!cel) this.rooster.set(k, [plek])
        else if (!cel.includes(plek)) cel.push(plek)
      }
    }
    return true
  }

  /** Alle vlakken binnen snap-afstand van het punt: [[afstand, vlak], ...]. */
  kandidaten(x, y) {
    const cel = this.rooster.get(Math.floor(x / CEL) + ',' + Math.floor(y / CEL))
    if (!cel) return []
    const uit = []
    for (const i of cel) {
      const v = this.lijst[i]
      const b = v.bbox
      if (x < b[0] - this.snap || x > b[2] + this.snap || y < b[1] - this.snap || y > b[3] + this.snap) continue
      const d = afstandTotVlak(x, y, v.polygonen)
      if (d <= this.snap) uit.push([d, v])
    }
    return uit
  }

  /** Ligt dit punt op een wegdeel? (Bepaalt of we ook terreindelen moeten ophalen.) */
  opWegdeel(x, y) {
    return this.kandidaten(x, y).some(([d, v]) => d <= 0.01 && v.collectie === 'wegdeel')
  }

  /**
   * Het BGT-oordeel voor een punt: {klasse, uitleg, bron}. bron is 'wegdeel'
   * (lijn ligt op een wegdeel), 'wegdeel-nabij' (binnen snap-afstand),
   * 'terrein' (geen pad geregistreerd; de lijn ligt in een terrein- of
   * bermvlak) of 'geen'.
   */
  zoek(x, y, niveau, osmGroep) {
    const leeg = { klasse: ONBEKEND, uitleg: 'de officiële kaart heeft hier niets', bron: 'geen' }
    const kandidaten = this.kandidaten(x, y)
    if (!kandidaten.length) return leeg
    const opNiveau = (lijst) => {
      const goed = lijst.filter(([, v]) => Math.sign(v.niveau) === niveau)
      return goed.length ? goed : lijst
    }
    const rang = (v) => BGT_COLLECTIES.indexOf(v.collectie)
    const binnen = opNiveau(kandidaten.filter(([d]) => d <= 0.01))
    binnen.sort((a, b) => rang(a[1]) - rang(b[1]) || b[1].niveau - a[1].niveau)
    const direct = binnen.length ? binnen[0][1] : null
    if (direct && direct.collectie === 'wegdeel') {
      return { klasse: direct.klasse, uitleg: vlakUitleg(direct), bron: 'wegdeel' }
    }
    const nabij = opNiveau(kandidaten.filter(([d, v]) => d > 0.01 && v.collectie === 'wegdeel'))
    nabij.sort((a, b) => a[0] - b[0])
    if (nabij.length) {
      let keuze = nabij[0]
      if (osmGroep) {
        // OSM heeft een surface-tag: gebruik die om kaartverschuiving op te lossen
        const eens = nabij.filter(([, v]) => groep(v.klasse) === osmGroep)
        if (eens.length) keuze = eens[0]
        else if (direct && groep(direct.klasse) === osmGroep) keuze = null
      }
      if (keuze) {
        return {
          klasse: keuze[1].klasse,
          uitleg: `${vlakUitleg(keuze[1])} op ${nl(keuze[0], 1)} m van de lijn`,
          bron: 'wegdeel-nabij',
        }
      }
    }
    if (direct) {
      // het strand: een zandvlakte zonder pad erin, vlak bij de zee (anders is het een zandverstuiving)
      const strand = direct.collectie === 'onbegroeidterreindeel' && direct.fysiek === 'zand' && this.bijZee(x, y)
      return { klasse: direct.klasse, uitleg: `geen pad geregistreerd; lijn ligt in ${vlakUitleg(direct)}`, bron: 'terrein', strand }
    }
    return leeg
  }
}

// ---------- Analyse ----------
function meestVoorkomend(lijst, sleutel) {
  // zoals Counter.most_common(1): bij gelijke stand wint wat het eerst voorkwam
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

/** BGT wint als die iets weet; markeer conflicten en gissingen als twijfel. */
export function bepaalEindEnTwijfel(s) {
  s.eind = s.bgt !== ONBEKEND ? s.bgt : s.osm
  s.twijfel = ''
  s.twijfelTekst = ''
  const go = groep(s.osm)
  const gb = groep(s.bgt)
  if (gb && go && gb !== go) {
    if (s.osmZeker) {
      s.twijfel = 'conflict'
      s.twijfelTekst = `OpenStreetMap zegt ${s.osm} (${s.osmUitleg}), de officiële kaart zegt ${s.bgt}`
    } else if (s.bgtBron === 'terrein') {
      s.twijfel = 'bgt-zwak'
      s.twijfelTekst = `OpenStreetMap vermoedt ${s.osm} (${s.osmUitleg}); de officiële kaart kent hier geen pad en de lijn ligt in ${s.bgt} terrein`
    }
  } else if (gb === null) {
    if (s.osm === ONBEKEND) {
      s.twijfel = 'onbekend'
      s.twijfelTekst = `geen van beide bronnen kent de ondergrond (${s.osmUitleg}; ${s.bgtUitleg})`
    } else if (!s.osmZeker) {
      s.twijfel = 'osm-aanname'
      s.twijfelTekst = `alleen een aanname van OpenStreetMap (${s.osmUitleg}); officiële kaart: ${s.bgtUitleg}`
    }
  }
}

/** Knip de route in stukken van hooguit STUK_M met het OSM-oordeel erbij. */
export function maakStukken(traject, xy) {
  const stukken = []
  let gelopen = 0
  for (const [i0, i1, tags] of traject.segs) {
    const punten = [xy[i0]]
    for (let i = i0 + 1; i <= i1; i++) {
      const vorige = punten[punten.length - 1]
      if (xy[i][0] !== vorige[0] || xy[i][1] !== vorige[1]) punten.push(xy[i])
    }
    if (punten.length < 2) continue
    const lengte = lijnLengte(punten)
    if (lengte < 0.01) continue
    const osm = osmKlasse(tags)
    const n = Math.max(1, Math.ceil(lengte / STUK_M))
    for (let j = 0; j < n; j++) {
      stukken.push({
        van: gelopen + (lengte * j) / n,
        tot: gelopen + (lengte * (j + 1)) / n,
        xy: n === 1 ? punten : snijLijn(punten, (lengte * j) / n, (lengte * (j + 1)) / n),
        tags: [tags],
        osm: osm.klasse,
        osmZeker: osm.zeker,
        osmUitleg: osm.uitleg,
        bgt: ONBEKEND,
        bgtUitleg: 'officiële kaart niet geraadpleegd',
        bgtBron: 'geen',
        eind: ONBEKEND,
        twijfel: '',
        twijfelTekst: '',
      })
    }
    gelopen += lengte
  }
  return { stukken, lengte: gelopen }
}

/** De meetpunten (om de STAP_M) van elk stuk: [{x, y, stuk, niveau, osmGroep}]. */
export function meetpunten(stukken) {
  const uit = []
  stukken.forEach((s, si) => {
    const lengte = lijnLengte(s.xy)
    const k = Math.max(3, Math.ceil(lengte / STAP_M))
    const niveau = osmNiveau(s.tags[0])
    const osmGroep = s.osmZeker ? groep(s.osm) : null
    for (let j = 0; j < k; j++) {
      const [x, y] = puntOpLijn(s.xy, (lengte * (j + 0.5)) / k)
      uit.push({ x, y, stuk: si, niveau, osmGroep })
    }
  })
  return uit
}

/** Aandeel van de route dat (bijna) over hetzelfde stuk heen en terug gaat. */
export function dubbelAandeel(xy) {
  if (xy.length < 2) return 0
  const lengte = lijnLengte(xy)
  const n = Math.max(2, Math.floor(lengte / 10))
  const cellen = new Map()
  const rond = (v) => {
    // zoals Python: afronden naar het dichtstbijzijnde even getal bij .5
    const r = Math.round(v)
    return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
  }
  for (let i = 0; i <= n; i++) {
    const p = puntOpLijn(xy, (lengte * i) / n)
    const k = rond(p[0] / 15) + ',' + rond(p[1] / 15)
    const d = (i * lengte) / n
    const c = cellen.get(k)
    if (c) {
      c.n += 1
      c.min = Math.min(c.min, d)
      c.max = Math.max(c.max, d)
    } else cellen.set(k, { n: 1, min: d, max: d })
  }
  let dubbel = 0
  for (const c of cellen.values()) if (c.max - c.min > 150) dubbel += c.n
  return dubbel / (n + 1)
}

/**
 * Bepaal per stuk OSM-, BGT- en eindoordeel. vlakken is een BgtVlakken met de
 * vlakken rond de route al erin, of null als de BGT niet gebruikt wordt.
 */
export function analyseer(traject, vlakken, klaar = null) {
  const xy = klaar ? klaar.xy : trajectXy(traject)
  const { stukken, lengte } = klaar || maakStukken(traject, xy)
  let bgtGebruikt = false
  if (vlakken && stukken.length) {
    const perStuk = stukken.map(() => [])
    for (const m of (klaar && klaar.punten) || meetpunten(stukken)) {
      perStuk[m.stuk].push(vlakken.zoek(m.x, m.y, m.niveau, m.osmGroep))
    }
    stukken.forEach((s, si) => {
      const lijst = perStuk[si]
      // per stuk wint de klasse met de grootste overlap (meeste meetpunten)
      const top = meestVoorkomend(lijst, (o) => o.klasse)
      const klasse = top.item.klasse
      const detail = meestVoorkomend(lijst.filter((o) => o.klasse === klasse), (o) => o.uitleg + '|' + o.bron).item
      s.bgt = klasse
      s.bgtUitleg = detail.uitleg
      s.bgtBron = detail.bron
      s.bgtAandeel = top.n / lijst.length
      s.strand = !!detail.strand
    })
    bgtGebruikt = vlakken.lijst.length > 0
  }
  for (const s of stukken) bepaalEindEnTwijfel(s)

  const samen = []
  for (const s of stukken) {
    const v = samen[samen.length - 1]
    if (v && v.osm === s.osm && v.osmZeker === s.osmZeker && v.bgt === s.bgt && v.eind === s.eind && v.twijfel === s.twijfel) {
      v.tot = s.tot
      v.xy = v.xy.concat(s.xy.slice(1))
      for (const t of s.tags) if (!v.tags.includes(t)) v.tags.push(t)
    } else {
      samen.push({ ...s, xy: s.xy.slice(), tags: s.tags.slice() })
    }
  }
  return { traject, xy, stukken, samengevoegd: samen, lengte, bgtGebruikt, dubbel: dubbelAandeel(xy) }
}

export function kmPerKlasse(analyse, bron) {
  const tot = Object.fromEntries(KLASSEN.map((k) => [k, 0]))
  for (const s of analyse.stukken) tot[s[bron]] += s.tot - s.van
  return tot
}

/** Aandeel onverhard + half verhard (0..1) volgens 'osm', 'bgt' of 'eind'. */
export function zachtAandeel(analyse, bron = 'eind') {
  if (!analyse.lengte) return 0
  const v = kmPerKlasse(analyse, bron)
  return (v[ONVERHARD] + v[HALF]) / analyse.lengte
}

/** Meters over het strand (volgens de officiële kaart). */
export function strandMeter(analyse) {
  let som = 0
  for (const s of analyse.stukken) if (s.strand) som += s.tot - s.van
  return som
}

/** Aandeel over smalle onverharde paadjes (path, footway): waar trailrunners voor komen. */
export function paadjesAandeel(analyse) {
  if (!analyse.lengte) return 0
  let som = 0
  for (const s of analyse.stukken) {
    const highway = tagsObject(s.tags[0]).highway
    if ((highway === 'path' || highway === 'footway') && groep(s.eind) === 'zacht') som += s.tot - s.van
  }
  return som / analyse.lengte
}

export function lawAandeel(analyse) {
  if (!analyse.lengte) return 0
  let som = 0
  for (const s of analyse.stukken) if (isLaw(s.tags[0])) som += s.tot - s.van
  return som / analyse.lengte
}

/** Routekosten in 'gewogen km' met de ondergrond van het eindoordeel. */
export function routeKosten(analyse, lawFactor = 1, trail = false, strandStraf = 0) {
  let totaal = 0
  for (const s of analyse.stukken) {
    const f = kostenfactor(s.eind, s.tags[0], trail) + (s.strand ? strandStraf : 0)
    totaal += (s.tot - s.van) * (isLaw(s.tags[0]) ? f : f / lawFactor)
  }
  return totaal / 1000
}

export function twijfelStukken(analyse, minimaal) {
  return analyse.samengevoegd.filter((s) => s.twijfel && s.tot - s.van >= minimaal)
}

/** De langste aaneengesloten zachte stukken. */
export function zachteStukken(analyse, aantal = 5) {
  const reeksen = []
  let huidig = null
  for (const s of analyse.stukken) {
    if (groep(s.eind) === 'zacht') {
      if (!huidig) {
        huidig = { van: s.van, tot: s.tot, klassen: new Set() }
        reeksen.push(huidig)
      }
      huidig.tot = s.tot
      huidig.klassen.add(s.eind)
    } else huidig = null
  }
  reeksen.sort((a, b) => b.tot - b.van - (a.tot - a.van))
  return reeksen.slice(0, aantal).map((r) => ({
    van: r.van,
    tot: r.tot,
    klassen: KLASSEN.filter((k) => r.klassen.has(k)),
  }))
}

/** Tabel met km en % per klasse voor OSM, BGT en eindoordeel. */
export function tabel(analyse) {
  return KLASSEN.map((klasse) => {
    const rij = { klasse }
    for (const bron of ['osm', 'bgt', 'eind']) {
      const m = kmPerKlasse(analyse, bron)[klasse]
      rij[bron] = { km: m / 1000, pct: analyse.lengte ? (100 * m) / analyse.lengte : 0 }
    }
    return rij
  })
}

// ---------- Routes vergelijken ----------
/** Punten om de 'stap' meter langs een lijn (één keer doorlopen). */
export function bemonster(xy, stap) {
  const uit = []
  if (xy.length < 2) return xy.slice()
  let rest = 0
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1]
    const l = afstand(a, xy[i])
    let d = rest
    while (d <= l) {
      const f = l ? d / l : 0
      uit.push([a[0] + f * (xy[i][0] - a[0]), a[1] + f * (xy[i][1] - a[1])])
      d += stap
    }
    rest = d - l
  }
  uit.push(xy[xy.length - 1])
  return uit
}

/** Aandeel van route B dat binnen 'marge' meter van route A loopt (0..1). */
export function overlap(xyA, xyB, marge = 20) {
  const rooster = new Set()
  for (const [x, y] of bemonster(xyA, marge / 2)) rooster.add(Math.floor(x / marge) + ',' + Math.floor(y / marge))
  const punten = bemonster(xyB, 10)
  let raak = 0
  for (const [x, y] of punten) {
    const cx = Math.floor(x / marge)
    const cy = Math.floor(y / marge)
    let gevonden = false
    for (let dx = -1; dx <= 1 && !gevonden; dx++) {
      for (let dy = -1; dy <= 1 && !gevonden; dy++) gevonden = rooster.has(cx + dx + ',' + (cy + dy))
    }
    if (gevonden) raak += 1
  }
  return punten.length ? raak / punten.length : 0
}

/**
 * Loopt de route bij dit punt een doodlopend stuk in en over hetzelfde pad
 * weer terug? We zoeken de plek op de route die het dichtst bij het punt
 * ligt en kijken hoe ver de route ervoor en erna samenvalt. Geeft
 * {lengte, basis}: de lengte van het doodlopende stuk (enkele reis) en de
 * plek waar het begint.
 */
export function doodlopend(xy, punt, stap = 5, marge = 8) {
  const cum = [0]
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + afstand(xy[i - 1], xy[i]))
  let beste = 0
  for (let i = 1; i < xy.length; i++) if (afstand(xy[i], punt) < afstand(xy[beste], punt)) beste = i
  const s = cum[beste]
  const totaal = cum[cum.length - 1]
  let d = 0
  while (s - d - stap >= 0 && s + d + stap <= totaal) {
    if (afstand(puntOpLijn(xy, s - d - stap), puntOpLijn(xy, s + d + stap)) > marge) break
    d += stap
  }
  return { lengte: d, basis: puntOpLijn(xy, s - d) }
}

// ---------- Rondje ----------
/** Punt op 'meters' afstand in kompasrichting 'peiling' (graden), in RD. */
export function verplaats(punt, peiling, meters) {
  const h = (peiling * Math.PI) / 180
  return [punt[0] + meters * Math.sin(h), punt[1] + meters * Math.cos(h)]
}

/**
 * De drie tussenpunten (lat, lon) van een rondje door start, in een richting.
 * 'straal' is de halve lengte van het rondje in die richting; 'rek' maakt het
 * langgerekt (2,5 = een ellips die 2,5 keer zo lang als breed is). Dat past
 * beter in een smalle strook natuur, zoals de duinen langs de kust.
 */
export function rondjePunten(start, peiling, straal, rek = 1) {
  const s = naarRd(start[1], start[0])
  const midden = verplaats(s, peiling, straal)
  const breed = straal / rek
  const via = [
    verplaats(midden, peiling - 90, breed),
    verplaats(midden, peiling, straal),
    verplaats(midden, peiling + 90, breed),
  ].map(([x, y]) => {
    const [lon, lat] = naarWgs(x, y)
    return [lat, lon]
  })
  return [start, ...via, start]
}

/** Omtrek (hemelsbreed, langs de tussenpunten) van zo'n rondje. */
export const rondjeOmtrek = (straal, rek = 1) => 4 * Math.hypot(straal, straal / rek)

// ---------- GPX ----------
const xmlVeilig = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

export function maakGpx(traject, naam, tijd = new Date()) {
  const regels = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="onverhard-planner" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xmlVeilig(naam)}</name><time>${tijd.toISOString().slice(0, 19)}Z</time></metadata>`,
  ]
  traject.punten.forEach(([lat, lon], i) => {
    const label = i === 0 ? 'Start' : i === traject.punten.length - 1 ? 'Finish' : `Via ${i}`
    regels.push(`  <wpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"><name>${label}</name></wpt>`)
  })
  regels.push(`  <trk><name>${xmlVeilig(naam)}</name><trkseg>`)
  for (const [lon, lat, hoogte] of traject.coords) {
    const ele = hoogte === null || hoogte === undefined ? '' : `<ele>${hoogte.toFixed(1)}</ele>`
    regels.push(`    <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}">${ele}</trkpt>`)
  }
  regels.push('  </trkseg></trk>', '</gpx>')
  return regels.join('\n') + '\n'
}

// ---------- Luchtfoto: kleurindicatie ----------
/**
 * Grove kleurmaat van de strook onder de routelijn (gemiddelde r, g, b).
 * Een indicatie, geen meting; drempels gelijk aan het Python-script, maar
 * zonder de textuurmaat.
 */
export function kleurIndicatie(r, g, b) {
  const helder = (r + g + b) / 3
  const max = Math.max(r, g, b)
  const verzadiging = (max - Math.min(r, g, b)) / Math.max(1, max)
  const groen = (g - (r + b) / 2) / Math.max(1, helder)
  if (helder < 75) return { tekst: 'donker (schaduw of bomen): niet te beoordelen', steun: null }
  if (groen >= 0.07 && g > b && g >= r - 2) {
    return { tekst: 'groenig: wijst op begroeiing (gras), dus onverhard', steun: 'zacht' }
  }
  if (groen <= 0.02 && verzadiging <= 0.1) return { tekst: 'grijs: wijst op verharding', steun: 'hard' }
  if (r - b >= 18) return { tekst: 'warm getint: zand, aarde of klinkers (geen richting)', steun: null }
  return { tekst: 'geen duidelijk kleursignaal', steun: null }
}
