// Offline tests voor de rekenkern van de webapp (public/onverhard/kern.js).
// Draaien:  node --test tools/onverhard/test_web_kern.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../../public/onverhard/kern.js'
import * as G from '../../public/onverhard/graaf.js'
import * as T from '../../public/onverhard/osmtegels.js'
import * as H from '../../public/onverhard/hoogte.js'
import zlib from 'node:zlib'

const vierkant = (x0, y0, x1, y1) => ({ type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] })
const feature = (id, fysiek, geometry, niveau = 0) => ({
  id, geometry,
  properties: { lokaal_id: id, fysiek_voorkomen: fysiek, eind_registratie: null, status: 'bestaand', relatieve_hoogteligging: niveau },
})

test('RD-omrekening klopt binnen een halve meter met pyproj', () => {
  // referentiewaarden uit pyproj (EPSG:4326 -> EPSG:28992)
  for (const [lon, lat, x, y] of [
    [4.3481, 51.9921, 83631.84, 445367.1],
    [4.4679, 51.9255, 91765.93, 437846.89],
    [6.9, 53.3, 255855.0, 591450.42],
  ]) {
    const [rx, ry] = K.naarRd(lon, lat)
    assert.ok(Math.hypot(rx - x, ry - y) < 0.5, `${lon},${lat}: ${rx},${ry}`)
    const [lon2, lat2] = K.naarWgs(rx, ry)
    assert.ok(Math.abs(lon2 - lon) < 1e-6 && Math.abs(lat2 - lat) < 1e-6)
  }
})

test('profiel: LAW-factor ingevuld en geen waarden die BRouter weigert', () => {
  const p = K.maakProfiel(0.3)
  assert.ok(p.includes('multiply base 3.3333') && !p.includes('NIETLAW'))
  for (const verboden of ['woodchips', 'pebblestone', 'mud', 'concrete:plates', 'min(']) assert.ok(!p.includes(verboden))
  assert.throws(() => K.maakProfiel(0))
})

test('OSM-tags naar klasse', () => {
  const k = (tags) => [K.osmKlasse(tags).klasse, K.osmKlasse(tags).zeker]
  assert.deepEqual(k('highway=path surface=grass'), [K.ONVERHARD, true])
  assert.deepEqual(k('highway=footway surface=fine_gravel'), [K.HALF, true])
  assert.deepEqual(k('highway=residential surface=paving_stones'), [K.OPEN, true])
  assert.deepEqual(k('highway=cycleway surface=asphalt'), [K.GESLOTEN, true])
  assert.deepEqual(k('highway=path'), [K.ONVERHARD, false])
  assert.deepEqual(k('highway=track tracktype=grade1'), [K.GESLOTEN, false])
  assert.deepEqual(k('highway=footway'), [K.ONBEKEND, false])
  assert.deepEqual(k(''), [K.ONBEKEND, false])
})

test('BGT fysiek voorkomen naar klasse', () => {
  assert.equal(K.bgtKlasse('wegdeel', 'half verhard'), K.HALF)
  assert.equal(K.bgtKlasse('wegdeel', 'transitie'), K.ONBEKEND)
  assert.equal(K.bgtKlasse('onbegroeidterreindeel', 'erf'), K.ONBEKEND)
  assert.equal(K.bgtKlasse('begroeidterreindeel', 'grasland agrarisch'), K.ONVERHARD)
})

const brouterFeature = () => {
  const coords = [0, 1, 2, 3, 4].map((i) => [4 + i * 0.001, 52, 1])
  return {
    geometry: { coordinates: coords },
    properties: { messages: [
      ['Longitude', 'Latitude', 'Elevation', 'Distance', 'WayTags'],
      [String(Math.round(coords[2][0] * 1e6)), '52000000', '1', '137', 'reversedirection=yes highway=path surface=grass'],
      [String(Math.round(coords[4][0] * 1e6)), '52000000', '1', '137', 'highway=cycleway surface=asphalt'],
    ] },
  }
}

test('BRouter-berichten worden stukken, en plakken haalt het dubbele knooppunt weg', () => {
  const t = K.leesBrouterRoute(brouterFeature())
  assert.deepEqual(t.segs, [[0, 2, 'highway=path surface=grass'], [2, 4, 'highway=cycleway surface=asphalt']])
  assert.ok(Math.abs(K.lijnLengte(K.trajectXy(t)) - 274) < 3)
  const twee = K.plak([t, { coords: [t.coords[4], [4.006, 52, 1]], segs: [[0, 1, 'highway=path']] }])
  assert.equal(twee.coords.length, 6)
  assert.deepEqual(twee.segs[2], [4, 5, 'highway=path'])
})

test('BGT opzoeken: wegdeel, kaartverschuiving, terrein en niveau', () => {
  const v = new K.BgtVlakken()
  v.voegToe('wegdeel', feature('pad', 'gesloten verharding', vierkant(0, 0, 100, 4)))
  v.voegToe('begroeidterreindeel', feature('gras', 'grasland overig', vierkant(0, 4, 100, 60)))
  assert.equal(v.voegToe('wegdeel', { ...feature('oud', 'onverhard', vierkant(0, 0, 100, 4)), properties: { eind_registratie: '2020-01-01' } }), false)
  assert.equal(v.zoek(50, 2, 0, null).bron, 'wegdeel')
  assert.deepEqual([v.zoek(50, 6, 0, null).klasse, v.zoek(50, 6, 0, null).bron], [K.GESLOTEN, 'wegdeel-nabij'])
  assert.deepEqual([v.zoek(50, 30, 0, null).klasse, v.zoek(50, 30, 0, null).bron], [K.ONVERHARD, 'terrein'])
  assert.equal(v.zoek(500, 500, 0, null).bron, 'geen')
  // OSM zegt expliciet gras: dan telt het grasvlak waar de lijn in ligt, niet de weg ernaast
  assert.equal(v.zoek(50, 6, 0, 'zacht').bron, 'terrein')
  assert.equal(v.zoek(50, 6, 0, 'hard').bron, 'wegdeel-nabij')
  assert.ok(v.opWegdeel(50, 2) && !v.opWegdeel(50, 6))

  const brug = new K.BgtVlakken()
  brug.voegToe('wegdeel', feature('onder', 'onverhard', vierkant(0, 0, 100, 10)))
  brug.voegToe('wegdeel', feature('brug', 'gesloten verharding', vierkant(40, -20, 60, 30), 1))
  assert.equal(brug.zoek(50, 5, 0, null).klasse, K.ONVERHARD)
  assert.equal(brug.zoek(50, 5, 1, null).klasse, K.GESLOTEN)
})

test('vlak met een gat: een punt in het gat ligt er niet in', () => {
  const ring = { type: 'Polygon', coordinates: [
    [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
    [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
  ] }
  const vlakken = K.geojsonVlakken(ring)
  assert.ok(vlakken[0][0] instanceof Float64Array)
  assert.equal(K.afstandTotVlak(2, 2, vlakken), 0)
  assert.equal(K.afstandTotVlak(5, 5, vlakken), 1)
})

test('analyse: zonder BGT geen twijfel; met tegensprekende BGT een conflict en de BGT wint', () => {
  const t = K.leesBrouterRoute(brouterFeature())
  const zonder = K.analyseer(t, null)
  assert.ok(Math.abs(K.zachtAandeel(zonder, 'osm') - 0.5) < 0.01)
  assert.equal(K.twijfelStukken(zonder, 10).length, 0)
  const xy = K.trajectXy(t)
  const xs = xy.map((p) => p[0])
  const ys = xy.map((p) => p[1])
  const v = new K.BgtVlakken()
  v.voegToe('wegdeel', feature('alles', 'gesloten verharding', vierkant(Math.min(...xs) - 5, Math.min(...ys) - 5, Math.max(...xs) + 5, Math.max(...ys) + 5)))
  const met = K.analyseer(t, v)
  assert.equal(K.zachtAandeel(met, 'eind'), 0)
  const twijfels = K.twijfelStukken(met, 10)
  assert.equal(twijfels.length, 1)
  assert.equal(twijfels[0].twijfel, 'conflict')
  assert.ok(Math.abs(K.routeKosten(met, 1) - (137 * 3 + 137 * 4) / 1000) < 0.03)
  assert.equal(K.tabel(met)[3].eind.pct, 100)
})

test('tegels: rekenen met kolom, rij en rand', () => {
  // de tegel bij het Slinksloot-graspad, gecontroleerd bij PDOK
  assert.deepEqual(K.tegelVan(83455.56, 443133.05), [1715, 2140])
  const [x0, y0, x1, y1] = K.tegelGebied(1715, 2140)
  assert.ok(Math.abs(x1 - x0 - 215.04) < 1e-6 && Math.abs(y1 - y0 - 215.04) < 1e-6)
  assert.ok(x0 <= 83455.56 && 83455.56 < x1 && y0 < 443133.05 && 443133.05 <= y1)
  const midden = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }
  assert.equal(K.tegelsVoor([midden]).length, 1)
  assert.equal(K.tegelsVoor([{ x: x0 + 1, y: midden.y }]).length, 2) // 1 m van de linkerrand: ook de buurtegel
  assert.equal(K.tegelsVoor([{ x: x0 + 1, y: y1 - 1 }]).length, 4) // in de hoek: vier tegels
})

// Een minimale protobuf-schrijver, alleen voor deze test.
const varint = (n) => {
  let v = BigInt.asUintN(64, BigInt(n))
  const uit = []
  do {
    let b = Number(v & 0x7fn)
    v >>= 7n
    if (v > 0n) b |= 0x80
    uit.push(b)
  } while (v > 0n)
  return uit
}
const veld = (nr, type) => varint(nr * 8 + type)
const bytes = (nr, inhoud) => [...veld(nr, 2), ...varint(inhoud.length), ...inhoud]
const tekst = (nr, s) => bytes(nr, [...new TextEncoder().encode(s)])
const getal = (nr, n) => [...veld(nr, 0), ...varint(n)]
const zz = (n) => (n << 1) ^ (n >> 31)
function ringOpdrachten(punten, cursor) {
  // MoveTo naar het eerste punt, LineTo naar de rest, ClosePath
  const uit = []
  punten.forEach(([x, y], i) => {
    if (i === 0) uit.push(1 | (1 << 3))
    if (i === 1) uit.push(2 | ((punten.length - 1) << 3))
    uit.push(zz(x - cursor[0]), zz(y - cursor[1]))
    cursor[0] = x
    cursor[1] = y
  })
  uit.push(7 | (1 << 3))
  return uit
}

test('tegellezer: lagen, eigenschappen (ook negatief) en een vlak met een gat', () => {
  const cursor = [0, 0]
  const geom = [
    ...ringOpdrachten([[0, 0], [4096, 0], [4096, 4096], [0, 4096]], cursor), // buitenring, met de klok mee (y omlaag)
    ...ringOpdrachten([[1024, 1024], [1024, 3072], [3072, 3072], [3072, 1024]], cursor), // gat, tegen de klok in
  ]
  const feature = [...getal(1, 7), ...bytes(2, [0, 0, 1, 1, 2, 2, 3, 3].flatMap((t) => varint(t))), ...getal(3, 3), ...bytes(4, geom.flatMap((g) => varint(g)))]
  const wegdeel = [
    ...getal(15, 2), // versie (moet overgeslagen worden)
    ...tekst(1, 'wegdeel'),
    ...bytes(2, feature),
    ...tekst(3, 'lokaal_id'), ...tekst(3, 'fysiek_voorkomen'), ...tekst(3, 'relatieve_hoogteligging'), ...tekst(3, 'bronhouder'),
    ...bytes(4, tekst(1, 'G1842.test')), ...bytes(4, tekst(1, 'onverhard')), ...bytes(4, getal(4, -1)), ...bytes(4, tekst(1, 'G1842')),
    ...getal(5, 4096),
  ]
  const pand = [...tekst(1, 'pand'), ...bytes(2, feature), ...tekst(3, 'x'), ...bytes(4, tekst(1, 'y'))]
  const tegel = new Uint8Array([...bytes(3, pand), ...bytes(3, wegdeel)])

  const vlakken = K.leesTegel(tegel, 1715, 2140)
  assert.equal(vlakken.length, 1) // de pand-laag is overgeslagen
  const [v] = vlakken
  assert.equal(v.collectie, 'wegdeel')
  assert.deepEqual(v.props, { lokaal_id: 'G1842.test', fysiek_voorkomen: 'onverhard', relatieve_hoogteligging: -1 })
  assert.equal(v.polygonen.length, 1)
  assert.equal(v.polygonen[0].length, 2) // buitenring en gat
  const [x0, y0, x1, y1] = K.tegelGebied(1715, 2140)
  const buiten = v.polygonen[0][0]
  assert.ok(Math.abs(buiten[0] - x0) < 1e-6 && Math.abs(buiten[1] - y1) < 1e-6) // (0,0) = linkerbovenhoek
  assert.ok(Math.abs(buiten[4] - x1) < 1e-6 && Math.abs(buiten[5] - y0) < 1e-6) // (4096,4096) = rechteronderhoek
  const m = 215.04 / 4
  assert.equal(K.afstandTotVlak(x0 + m / 2, y1 - m / 2, v.polygonen), 0) // in het vlak
  assert.ok(Math.abs(K.afstandTotVlak(x0 + 2 * m, y1 - 2 * m, v.polygonen) - m) < 1e-6) // midden van het gat
})

test('hetzelfde vlak uit twee tegels wordt één keer bewaard en in beide tegels gevonden', () => {
  const v = new K.BgtVlakken()
  const a = K.tegelGebied(1715, 2140)
  const b = K.tegelGebied(1716, 2140)
  const strook = [[Float64Array.from([a[0] + 10, a[1] + 100, b[2] - 10, a[1] + 100, b[2] - 10, a[1] + 104, a[0] + 10, a[1] + 104, a[0] + 10, a[1] + 100])]]
  const p = { lokaal_id: 'G1.strook', fysiek_voorkomen: 'half verhard', status: 'bestaand' }
  v.voegToeVlak('wegdeel', p, strook, a)
  v.voegToeVlak('wegdeel', p, strook, b)
  assert.equal(v.lijst.length, 1)
  assert.equal(v.zoek(a[0] + 50, a[1] + 102, 0, null).klasse, K.HALF)
  assert.equal(v.zoek(b[2] - 50, a[1] + 102, 0, null).klasse, K.HALF)
  assert.equal(v.voegToeVlak('wegdeel', { ...p, lokaal_id: 'G1.plan', status: 'plan' }, strook, a), false)
})

test('dubbel gelopen, rondjepunten, GPX en kleurindicatie', () => {
  assert.ok(K.dubbelAandeel([[0, 0], [1000, 0], [0, 0]]) > 0.6)
  const cirkel = Array.from({ length: 101 }, (_, a) => [500 * Math.cos((a / 50) * Math.PI), 500 * Math.sin((a / 50) * Math.PI)])
  assert.ok(K.dubbelAandeel(cirkel) < 0.1)
  const punten = K.rondjePunten([51.9921, 4.3481], 90, 1000)
  assert.equal(punten.length, 5)
  assert.deepEqual(punten[0], punten[4])
  const [sx, sy] = K.naarRd(4.3481, 51.9921)
  const [vx, vy] = K.naarRd(punten[2][1], punten[2][0])
  assert.ok(Math.abs(vx - sx - 2000) < 1 && Math.abs(vy - sy) < 1) // overkant van de cirkel: 2 km naar het oosten
  const gpx = K.maakGpx({ coords: [[4.3, 52, 1.5], [4.31, 52, null]], punten: [[52, 4.3], [52, 4.31]] }, 'test <a&b>')
  assert.ok(gpx.includes('<trkpt lat="52.000000" lon="4.300000"><ele>1.5</ele></trkpt>') && gpx.includes('test &lt;a&amp;b&gt;'))
  assert.equal((gpx.match(/<wpt/g) || []).length, 2)
  assert.equal(K.kleurIndicatie(95, 118, 80).steun, 'zacht')
  assert.equal(K.kleurIndicatie(150, 148, 146).steun, 'hard')
  assert.equal(K.kleurIndicatie(40, 45, 42).steun, null)
})

test('doodlopend stuk en overlap tussen routes', () => {
  assert.deepEqual(K.doodlopend([[0, 0], [100, 0], [100, 80], [100, 0], [200, 0]], [100, 80]), { lengte: 80, basis: [100, 0] })
  assert.equal(K.doodlopend([[0, 0], [100, 0], [200, 0]], [100, 0]).lengte, 0)
  const heen = [[0, 0], [100, 0], [200, 0]]
  assert.equal(K.overlap(heen, [[200, 0], [0, 0]]), 1)
  assert.ok(K.overlap(heen, [[200, 0], [200, 300], [0, 300], [0, 0]]) < 0.2)
})

test('object uit losse delen: elke tegel brengt alleen zijn eigen delen mee, alles telt (strand Voornes Duin)', () => {
  // Echt gezien: het strand van Voornes Duin is één BGT-object van meerdere stukken; de tegel in
  // het noorden had alleen het noordelijke stuk, die in het zuiden alleen het zuidelijke.
  const v = new K.BgtVlakken()
  const a = K.tegelGebied(1613, 2173)
  const b = K.tegelGebied(1613, 2183)
  const deelA = K.geojsonVlakken(vierkant(a[0] + 20, a[1] + 20, a[0] + 180, a[1] + 180))
  const deelB = K.geojsonVlakken(vierkant(b[0] + 20, b[1] + 20, b[0] + 180, b[1] + 180))
  const p = { lokaal_id: 'L0002.strand', fysiek_voorkomen: 'zand', status: 'bestaand' }
  v.voegToeVlak('onbegroeidterreindeel', p, deelA, a)
  v.voegToeVlak('onbegroeidterreindeel', p, deelB, b)
  v.voegToeVlak('onbegroeidterreindeel', p, deelB, b) // nog een keer: niet dubbel bewaren
  assert.equal(v.lijst.length, 1)
  assert.equal(v.lijst[0].polygonen.length, 2)
  assert.equal(v.zoek(a[0] + 100, a[1] + 100, 0, null).klasse, K.ONVERHARD)
  assert.equal(v.zoek(b[0] + 100, b[1] + 100, 0, null).klasse, K.ONVERHARD)
  // zee net zo: het tweede stuk zee maakt het tweede stuk zand tot strand
  v.voegToeZee('zee1', K.geojsonVlakken(vierkant(a[0] - 300, a[1], a[0] - 10, a[3])))
  v.voegToeZee('zee1', K.geojsonVlakken(vierkant(b[0] - 300, b[1], b[0] - 10, b[3])))
  assert.equal(v.zee.length, 1)
  assert.equal(v.zoek(b[0] + 100, b[1] + 100, 0, null).strand, true)
})

test('strand = zandvlak zonder pad vlak bij de zee; verderop is het een zandverstuiving', () => {
  const v = new K.BgtVlakken()
  v.voegToe('onbegroeidterreindeel', feature('zand', 'zand', vierkant(0, 0, 2000, 100)))
  v.voegToeZee('zee1', K.geojsonVlakken(vierkant(0, -500, 2000, 0)))
  const strand = v.zoek(1000, 50, 0, null)
  assert.equal(strand.klasse, K.ONVERHARD)
  assert.equal(strand.strand, true)
  const ver = new K.BgtVlakken()
  ver.voegToe('onbegroeidterreindeel', feature('zand', 'zand', vierkant(0, 0, 2000, 100)))
  ver.voegToeZee('zee1', K.geojsonVlakken(vierkant(0, -2000, 2000, -1000)))
  assert.equal(ver.zoek(1000, 50, 0, null).strand, false)
})

test('trailprofiel: smalle paadjes goedkoopst, klassiek profiel ongewijzigd', () => {
  const trail = K.maakProfiel(1, { trail: true })
  assert.ok(trail.includes('else if highway=path then ( if ishalf then 1.1 else 1 )'))
  assert.ok(!trail.includes('NIETLAW'))
  assert.equal(K.maakProfiel(1), K.maakProfiel(1, { trail: false }))
  assert.equal(K.kostenfactor(K.ONVERHARD, 'highway=path', true), 1)
  assert.equal(K.kostenfactor(K.ONVERHARD, 'highway=track', true), 1.3)
  assert.equal(K.kostenfactor(K.GESLOTEN, 'highway=path', true), 3)
})

test('aandeel smalle paadjes en strand in een analyse', () => {
  const t = K.leesBrouterRoute(brouterFeature()) // 137 m path/gras, 137 m fietspad/asfalt
  const an = K.analyseer(t, null)
  assert.ok(Math.abs(K.paadjesAandeel(an) - 0.5) < 0.01)
  assert.equal(K.strandMeter(an), 0)
})

test('vormen van rondjes: rond, langgerekt en kronkel', () => {
  assert.ok(Math.abs(K.vormOmtrek(1) - 4 * Math.SQRT2) < 1e-3)
  assert.ok(K.vormOmtrek(2.5) < K.vormOmtrek(1))
  const ster = K.kronkelPunten([52, 5], 0, 1000)
  assert.equal(ster.length, 7) // start, vijf tussenpunten, start
  const s = K.naarRd(5, 52)
  const afst = ster.slice(1, -1).map(([la, lo]) => { const p = K.naarRd(lo, la); return Math.hypot(p[0] - s[0], p[1] - s[1]) })
  assert.ok(Math.max(...afst) > 1500 && Math.min(...afst) > 300) // afwisselend ver en dichtbij, nooit op de start
  assert.deepEqual(K.vormPunten([52, 5], 0, 1000, 0), ster)
})

test('toegangskaart: afgesloten paden herkennen en het profiel', () => {
  assert.equal(K.alleenMetKaartje('highway=track access=no foot=no'), true)
  assert.equal(K.alleenMetKaartje('highway=path access=private'), true)
  assert.equal(K.alleenMetKaartje('highway=path access=no foot=permissive'), false)
  assert.equal(K.alleenMetKaartje('highway=path foot=yes'), false)
  const p = K.maakProfiel(1, { trail: true, kaartje: true })
  assert.ok(p.includes('assign afgesloten') && p.includes('multiply ( if afgesloten then 1.3 else 1 )'))
  assert.ok(!/assign forbidden = [^\n]*access=private/.test(p))
  assert.ok(K.maakProfiel(1, { trail: true }).includes('access=private|no not footok'))
})

// ---------- eigen routeplanner ----------
// een rooster van paden (onverhard) met één asfaltweg erdoor, 100 m tussen kruisingen
function roosterElementen() {
  const el = []
  const p = (i, j) => ({ lat: 52 + j * 0.0009, lon: 5 + i * 0.00146 })
  let id = 1
  for (let j = 0; j <= 10; j++) {
    for (let i = 0; i < 10; i++) {
      const tags = j === 5 ? { highway: 'tertiary', surface: 'asphalt' } : { highway: 'path', surface: 'sand' }
      el.push({ type: 'way', id: id++, tags, geometry: [p(i, j), p(i + 1, j)] })
    }
  }
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j < 10; j++) el.push({ type: 'way', id: id++, tags: { highway: 'path', surface: 'ground' }, geometry: [p(i, j), p(i, j + 1)] })
  }
  return { el, p }
}

test('eigen planner: graaf, kortste mooiste pad, strand verboden, afgesloten alleen met kaartje', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  assert.equal(g.n, 121)
  assert.equal(G.netwerken(g).grootte.length, 1)
  // van links naar rechts over rij 5: de asfaltweg is korter dan om, maar het pad ernaast wint
  const naarRd = (q) => K.naarRd(q.lon, q.lat)
  const a = G.dichtsteKnoop(g, ...naarRd(p(0, 5))).knoop
  const b = G.dichtsteKnoop(g, ...naarRd(p(10, 5))).knoop
  const r = G.routeLangs(g, [a, b])
  const tr = G.maakTraject(g, r.knopen, r.segs)
  assert.ok(tr.segs.some(([, , t]) => t.includes('highway=path')))
  assert.ok(!tr.segs.slice(1, -1).some(([, , t]) => t.includes('tertiary')), 'midden over het pad, niet over de weg')
  // strand: een vlak over het hele rooster maakt elk segment heel duur
  const strand = { type: 'way', id: 9999, tags: { natural: 'beach' }, geometry: [p(-1, -1), p(11, -1), p(11, 11), p(-1, 11), p(-1, -1)] }
  const gs = G.bouwGraaf([...el, strand], { trail: true })
  assert.equal(gs.aantalStrand, gs.lengte.length)
  assert.equal(G.bouwGraaf([...el, strand], { trail: true, strandMijden: false }).aantalStrand, 0)
  // afgesloten pad: zonder kaartje niet in de graaf, met kaartje wel
  const dicht = [{ type: 'way', id: 1, tags: { highway: 'path', access: 'no' }, geometry: [p(0, 0), p(1, 0)] }]
  assert.equal(G.bouwGraaf(dicht).lengte.length, 0)
  assert.equal(G.bouwGraaf(dicht, { kaartje: true }).lengte.length, 1)
  // de Overpass-vraag: cirkel om de start, zonder opritten en stoepen
  const v = G.overpassVraag(52.1, 4.3, 5000)
  assert.ok(v.includes('around:5000,52.10000,4.30000') && v.includes('sidewalk') && v.includes('natural"="beach'))
})

test('eigen planner: rondjes zijn echte lussen van ongeveer de gevraagde lengte, zonder uitstapjes', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  const start = G.dichtsteKnoop(g, ...K.naarRd(p(5, 2).lon, p(5, 2).lat)).knoop
  for (const kronkel of [false, true]) {
    const z = G.zoekRondjes(g, start, 2400, { kronkel })
    assert.ok(z.rondjes.length >= 2, `rondjes gevonden (kronkel ${kronkel})`)
    const r = z.rondjes[0]
    assert.equal(r.knopen[0], start)
    assert.equal(r.knopen[r.knopen.length - 1], start)
    assert.ok(Math.abs(r.meter - 2400) / 2400 < 0.25, `lengte ${r.meter}`)
    assert.ok(r.dubbel < 0.2, `dubbel ${r.dubbel}`)
    assert.equal(r.strand, 0)
    for (let i = 1; i < r.segs.length; i++) assert.notEqual(r.segs[i], r.segs[i - 1], 'geen heen-en-terug over één segment')
  }
  // uitstapje: 0-1-2-1-3 wordt 0-1-3
  assert.deepEqual(G.zonderUitstapjes([0, 1, 2, 1, 3], [10, 11, 11, 12]), { knopen: [0, 1, 3], segs: [10, 12] })
})

test('kaarttegels van OpenFreeMap: paden, ondergrond, strand, en buurtegels sluiten aan', () => {
  // laag 'transportation' met een pad (onverhard) en een spoorlijn (doet niet mee), laag 'landcover' met een strand
  const waarde = (sv) => bytes(4, tekst(1, sv))
  const lijn = (punten) => {
    const c = [0, 0]
    const uit = []
    punten.forEach(([x, y], i) => {
      if (i === 0) uit.push(1 | (1 << 3))
      if (i === 1) uit.push(2 | ((punten.length - 1) << 3))
      uit.push(zz(x - c[0]), zz(y - c[1]))
      c[0] = x
      c[1] = y
    })
    return uit
  }
  const feat = (tags, soort, geom) => bytes(2, [...bytes(2, tags.flatMap((t) => varint(t))), ...getal(3, soort), ...bytes(4, geom.flatMap((g) => varint(g)))])
  const transport = [
    ...tekst(1, 'transportation'),
    ...feat([0, 0, 1, 1, 2, 2], 2, lijn([[0, 2048], [4096, 2048]])), // class=path subclass=footway surface=unpaved
    ...feat([0, 3], 2, lijn([[0, 0], [4096, 4096]])), // class=rail
    ...tekst(3, 'class'), ...tekst(3, 'subclass'), ...tekst(3, 'surface'),
    ...waarde('path'), ...waarde('footway'), ...waarde('unpaved'), ...waarde('rail'),
    ...getal(5, 4096),
  ]
  const c = [0, 0]
  const land = [
    ...tekst(1, 'landcover'),
    ...feat([0, 0, 1, 1], 3, ringOpdrachten([[0, 0], [1000, 0], [1000, 1000], [0, 1000]], c)),
    ...tekst(3, 'class'), ...tekst(3, 'subclass'), ...waarde('sand'), ...waarde('beach'),
    ...getal(5, 4096),
  ]
  const tegel = Uint8Array.from([...bytes(3, transport), ...bytes(3, land)])
  const [x, y] = T.tegelXY(51.88, 4.04)
  const el = T.leesOsmTegel(tegel, x, y)
  const paden = el.filter((e) => e.tags.highway)
  assert.equal(paden.length, 1)
  assert.deepEqual(paden[0].tags, { highway: 'footway', surface: 'unpaved' })
  assert.equal(K.osmKlasse('highway=footway surface=unpaved').klasse, K.ONVERHARD)
  assert.equal(el.filter((e) => e.tags.natural === 'beach').length, 1)
  // het rechterpunt van deze tegel is precies het linkerpunt van de buurtegel
  const buur = T.leesOsmTegel(tegel, x + 1, y)
  assert.deepEqual(paden[0].geometry[1], buur.find((e) => e.tags.highway).geometry[0])
  assert.ok(Math.abs(paden[0].geometry[0].lat - 51.88) < 0.02 && Math.abs(paden[0].geometry[0].lon - 4.04) < 0.03)
  // tegels rond een punt: in Nederland is een tegel op zoom 14 zo'n 1,5 km breed,
  // dus een cirkel van 3 km (vierkant van 6 km) raakt een blok van 4 x 4 tot 5 x 5 tegels
  const rond = T.tegelsRond(51.88, 4.04, 3000)
  assert.ok(rond.length >= 16 && rond.length <= 25, `${rond.length} tegels`)
})

test('losse eindjes uit kaarttegels worden aan het netwerk geknoopt', () => {
  // een pad dat 0,4 m naast een weg ophoudt (het aansluitpunt is weggevallen), en een dubbel segment
  const p = (dx, dy) => ({ lat: 52 + dy / 111320, lon: 5 + dx / 68600 })
  const el = [
    { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [p(0, 0), p(200, 0)] },
    { type: 'way', id: 2, tags: { highway: 'path' }, geometry: [p(100, 0.4), p(100, 80)] },
    { type: 'way', id: 3, tags: { highway: 'residential' }, geometry: [p(0, 0), p(200, 0)] },
  ]
  assert.equal(G.netwerken(G.bouwGraaf(el)).grootte.length, 2)
  const g = G.bouwGraaf(el, { snap: 1.5 })
  assert.equal(G.netwerken(g).grootte.length, 1)
  assert.equal(g.lengte.length, 4) // weg gesplitst in twee, het pad, en het verbindingsstukje; het dubbele segment is weg
})

test('in een gebied: rondjes blijven binnen het gebied, zo nodig meerdere rondjes', () => {
  const { el, p } = roosterElementen()
  // gebied: het blok van kolom 0-4, rij 0-4 (onder de asfaltweg), ruim genomen
  const hoek = (i, j) => K.naarRd(p(i, j).lon, p(i, j).lat)
  const ring = Float64Array.from([hoek(-0.3, -0.3), hoek(4.3, -0.3), hoek(4.3, 4.3), hoek(-0.3, 4.3), hoek(-0.3, -0.3)].flat())
  const g = G.bouwGraaf(el, { trail: true, gebied: ring })
  const binnen = G.knopenBinnen(g, ring)
  assert.equal(binnen.reduce((a, b) => a + b, 0), 25)
  const start = G.dichtsteKnoop(g, ...hoek(0, 0)).knoop
  const z = G.zoekRondjesInGebied(g, start, 4000, binnen)
  assert.ok(z.rondjes.length >= 1)
  const r = z.rondjes[0]
  for (const s of r.segs) assert.equal(g.binnenSeg[s], 1, 'segment buiten het gebied')
  assert.equal(r.knopen[0], start)
  assert.equal(r.knopen[r.knopen.length - 1], start)
  assert.ok(r.ronden >= 2, `${r.ronden} rondjes voor 4 km in een blok van 400 x 400 m`)
  assert.ok(Math.abs(r.meter - 4000) < 0.4 * 4000, `${r.meter} m`)
})

test('door elke straat: elk vereist segment zit erin, begin en eind bij de start', () => {
  const { el, p } = roosterElementen()
  const hoek = (i, j) => K.naarRd(p(i, j).lon, p(i, j).lat)
  const ring = Float64Array.from([hoek(-0.3, 2.7), hoek(6.3, 2.7), hoek(6.3, 7.3), hoek(-0.3, 7.3), hoek(-0.3, 2.7)].flat())
  const g = G.bouwGraaf(el, { gebied: ring, buitenFactor: 1 })
  for (const soort of ['straten', 'paden', 'alles']) {
    const vereist = G.vereisteSegmenten(g, soort)
    const start = G.dichtsteKnoop(g, ...hoek(3, 5)).knoop
    const r = G.doorElkeStraat(g, start, vereist)
    assert.ok(r, soort)
    const gelopen = new Set(r.segs)
    for (let s = 0; s < vereist.length; s++) if (vereist[s]) assert.ok(gelopen.has(s), `${soort}: segment ${s} ontbreekt`)
    assert.equal(r.knopen[0], start)
    assert.equal(r.knopen[r.knopen.length - 1], start)
    for (let i = 0; i < r.segs.length; i++) {
      const s = r.segs[i]
      const [a, b] = [r.knopen[i], r.knopen[i + 1]]
      assert.ok((g.van[s] === a && g.naar[s] === b) || (g.van[s] === b && g.naar[s] === a), 'de route springt niet')
    }
    assert.ok(r.meter >= r.vereistMeter - 1)
  }
  // straten: alleen de asfaltweg (rij 5) tussen kolom 0 en 6 = 600 m
  const r = G.doorElkeStraat(g, G.dichtsteKnoop(g, ...hoek(3, 5)).knoop, G.vereisteSegmenten(g, 'straten'))
  assert.ok(Math.abs(r.vereistMeter - 600) < 30, `${r.vereistMeter}`)
})

test('route langs een tekening volgt de lijn, ook als rondje', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  const rd = (i, j) => K.naarRd(p(i, j).lon, p(i, j).lat)
  // een L-vorm: langs rij 2 naar rechts, dan omhoog langs kolom 8
  const r = G.volgTekening(g, [rd(1, 2), rd(8, 2), rd(8, 8)])
  assert.ok(r && !r.rond)
  assert.ok(Math.abs(r.meter - 1300) < 150, `${r.meter}`)
  assert.ok(r.afwijkend < 0.1)
  // een rondje: terug naar het begin
  const rondje = G.volgTekening(g, [rd(1, 1), rd(4, 1), rd(4, 4), rd(1, 4), rd(1, 1.05)])
  assert.ok(rondje.rond)
  assert.equal(rondje.knopen[0], rondje.knopen[rondje.knopen.length - 1])
  assert.ok(Math.abs(rondje.meter - 1200) < 150, `${rondje.meter}`)
})

// een GeoTIFF zoals PDOK hem maakt: float32, zlib, floating point predictor, strips
function maakAhnTiff(breedte, hoogte, x0, y1, cel, waarde, rijenPerStrip = 4) {
  const strips = []
  for (let s = 0; s * rijenPerStrip < hoogte; s++) {
    const rijen = Math.min(rijenPerStrip, hoogte - s * rijenPerStrip)
    const ruw = new Uint8Array(rijen * breedte * 4)
    for (let r = 0; r < rijen; r++) {
      const y = s * rijenPerStrip + r
      const rij = new Uint8Array(breedte * 4)
      const dv = new DataView(new ArrayBuffer(4))
      for (let x = 0; x < breedte; x++) {
        dv.setFloat32(0, waarde(x, y), false) // groot-endiaans: hoogste byte eerst
        for (let k = 0; k < 4; k++) rij[x + k * breedte] = dv.getUint8(k)
      }
      for (let i = rij.length - 1; i > 0; i--) rij[i] = (rij[i] - rij[i - 1]) & 0xff
      ruw.set(rij, r * breedte * 4)
    }
    strips.push(zlib.deflateSync(ruw))
  }
  const tags = [] // [tag, type, waarden]
  tags.push([256, 3, [breedte]], [257, 3, [hoogte]], [258, 3, [32]], [259, 3, [8]], [262, 3, [1]], [277, 3, [1]], [278, 3, [rijenPerStrip]], [317, 3, [3]], [339, 3, [3]])
  const kop = 8
  const ifdGrootte = 2 + 12 * 14 + 4
  let extra = kop + ifdGrootte
  const extraBytes = []
  const zetExtra = (bytes) => {
    const plek = extra
    extraBytes.push(bytes)
    extra += bytes.length
    return plek
  }
  const f64 = (lijst) => { const b = new Uint8Array(8 * lijst.length); const d = new DataView(b.buffer); lijst.forEach((v, i) => d.setFloat64(8 * i, v, true)); return b }
  const u32 = (lijst) => { const b = new Uint8Array(4 * lijst.length); const d = new DataView(b.buffer); lijst.forEach((v, i) => d.setUint32(4 * i, v, true)); return b }
  const schaal = zetExtra(f64([cel, cel, 0]))
  const punt = zetExtra(f64([0, 0, 0, x0, y1, 0]))
  const nodata = zetExtra(new TextEncoder().encode('3.4028234663852886e+38\0'))
  const lengtesPlek = zetExtra(u32(strips.map((s) => s.length)))
  const offsetsPlek = extra // de offsets zelf, daarna de strips
  extra += 4 * strips.length
  const offsets = []
  let o = extra
  for (const st of strips) { offsets.push(o); o += st.length }
  tags.push([273, 4, offsetsPlek], [279, 4, lengtesPlek], [33550, 12, schaal], [33922, 12, punt], [42113, 2, nodata])
  tags.sort((a, b) => a[0] - b[0])
  const uit = new Uint8Array(o)
  const d = new DataView(uit.buffer)
  d.setUint16(0, 0x4949, true); d.setUint16(2, 42, true); d.setUint32(4, kop, true)
  d.setUint16(kop, tags.length, true)
  tags.forEach(([tag, type, w], i) => {
    const e = kop + 2 + 12 * i
    d.setUint16(e, tag, true); d.setUint16(e + 2, type, true)
    if (tag === 273 || tag === 279) { d.setUint32(e + 4, strips.length, true); d.setUint32(e + 8, w, true) }
    else if (type === 12) { d.setUint32(e + 4, tag === 33550 ? 3 : 6, true); d.setUint32(e + 8, w, true) }
    else if (type === 2) { d.setUint32(e + 4, 23, true); d.setUint32(e + 8, w, true) }
    else { d.setUint32(e + 4, 1, true); d.setUint16(e + 8, w[0], true) }
  })
  let plek = kop + ifdGrootte
  for (const b of extraBytes) { uit.set(b, plek); plek += b.length }
  uit.set(u32(offsets), offsetsPlek)
  strips.forEach((st, i) => uit.set(st, offsets[i]))
  return uit.buffer
}

test('AHN-GeoTIFF lezen (float32, zlib, floating point predictor) en hoogtemeters tellen', async () => {
  // een duin: 50 x 50 pixels van 10 m, oplopend van 0 naar 20 m in het midden en weer terug, met water (geen hoogte)
  const duin = (x) => 20 - Math.abs(x - 25) * 0.8
  const buffer = maakAhnTiff(50, 50, 82000, 452000, 10, (x, y) => (y === 40 && x < 5 ? 3.4028234663852886e38 : duin(x)))
  const r = await H.leesAhnTiff(buffer)
  assert.equal(r.breedte, 50)
  assert.equal(r.cel, 10)
  assert.equal(r.x0, 82000)
  assert.ok(Math.abs(r.waarden[10 * 50 + 25] - 20) < 1e-4)
  assert.ok(Math.abs(r.waarden[10 * 50 + 5] - duin(5)) < 1e-4)
  assert.ok(Number.isNaN(r.waarden[40 * 50 + 2]))
  // hoogte op een punt: midden van pixel (25, 10)
  assert.ok(Math.abs(H.hoogteOp(r, 82255, 451895) - 20) < 0.5)
  // een route van west naar oost over het duin: 20 m omhoog, 20 m omlaag (minus wat gladstrijken)
  const rasters = new Map([['82000,451500', r]])
  const xy = [[82005, 451800], [82495, 451800]]
  const p = H.hoogteprofiel(xy, rasters)
  assert.ok(p.stijgen > 17 && p.stijgen < 21, `stijgen ${p.stijgen}`)
  assert.ok(p.dalen > 17 && p.dalen < 21, `dalen ${p.dalen}`)
  assert.ok(Math.abs(p.afstand[p.afstand.length - 1] - 490) < 11)
  // de blokken van 500 m die een route raakt
  assert.deepEqual(H.blokkenVoor([[82005, 451800], [82600, 451800]]), [[82000, 451500], [82500, 451500]])
  assert.ok(H.ahnUrl(82000, 451500).includes('SUBSET=x(82000,82500)') && H.ahnUrl(82000, 451500).includes('SCALESIZE=x(50),y(50)'))
})

test('doodlopende takken: een doodlopende straat (ook met een zijtak) valt af, de rest niet', () => {
  const p = (dx, dy) => ({ lat: 52 + dy / 111320, lon: 5 + dx / 68600 })
  const w = (id, a, b) => ({ type: 'way', id, tags: { highway: 'residential' }, geometry: [p(...a), p(...b)] })
  // een vierkant blok (rondweg) met een doodlopende straat naar binnen, en daaraan nog een zijtakje
  const el = [
    w(1, [0, 0], [200, 0]), w(2, [200, 0], [200, 200]), w(3, [200, 200], [0, 200]), w(4, [0, 200], [0, 0]),
    w(5, [0, 100], [80, 100]), w(6, [80, 100], [80, 140]),
  ]
  const g = G.bouwGraaf(el)
  const dood = G.doodlopendeTakken(g)
  let doodM = 0
  for (let s = 0; s < dood.length; s++) if (dood[s]) doodM += g.lengte[s]
  assert.ok(Math.abs(doodM - 120) < 2, `${doodM} m doodlopend`)
  const met = G.vereisteSegmenten(g, 'straten')
  const zonder = G.vereisteSegmenten(g, 'straten', { zonderDoodlopend: true })
  const som = (v) => [...v].reduce((m, x, s) => m + (x ? g.lengte[s] : 0), 0)
  assert.ok(Math.abs(som(met) - som(zonder) - 120) < 2)
  const r = G.doorElkeStraat(g, G.dichtsteKnoop(g, ...K.naarRd(5, 52)).knoop, zonder)
  assert.ok(Math.abs(r.meter - 800) < 5, `rondje om het blok: ${r.meter} m`)
})

test('route verslepen: het stuk rond de greep gaat via het nieuwe punt, loslaten herstelt het', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  const rd = (i, j) => K.naarRd(p(i, j).lon, p(i, j).lat)
  const start = G.dichtsteKnoop(g, ...rd(5, 2)).knoop
  const r = G.zoekRondjes(g, start, 2400).rondjes[0]
  const vast = [0, r.knopen.length - 1]
  const i0 = Math.floor(r.knopen.length / 2)
  // sleep naar een knoop een eind van de route af
  const doel = G.dichtsteKnoop(g, ...rd(9, 9)).knoop
  const v = G.versleep(g, r.knopen, r.segs, vast, i0, doel, { venster: 5000 })
  assert.ok(v)
  assert.ok(v.knopen.includes(doel), 'de route gaat via het versleepte punt')
  assert.equal(v.knopen[0], start)
  assert.equal(v.knopen[v.knopen.length - 1], start)
  assert.equal(v.vast.length, 3)
  assert.equal(v.knopen[v.vast[1]], doel)
  for (let i = 0; i < v.segs.length; i++) {
    const s = v.segs[i]
    const [a, b] = [v.knopen[i], v.knopen[i + 1]]
    assert.ok((g.van[s] === a && g.naar[s] === b) || (g.van[s] === b && g.naar[s] === a), 'aaneengesloten')
  }
  // loslaten: het punt verdwijnt, de route is weer een rondje van redelijke lengte (niet leeg)
  const l = G.laatLos(g, v.knopen, v.segs, v.vast, v.vast[1], { venster: 5000 })
  assert.ok(l)
  assert.deepEqual(l.vast.length, 2)
  const meter = l.segs.reduce((m, s) => m + g.lengte[s], 0)
  assert.ok(meter > 1000, `${meter} m na loslaten`)
  assert.equal(l.knopen[0], start)
  assert.equal(l.knopen[l.knopen.length - 1], start)
})

test('water onderweg: punten bij de route met hun km, dubbele weg, langste stuk zonder', () => {
  const p = (dx, dy) => ({ lat: 52 + dy / 111320, lon: 5 + dx / 68600 })
  const xy = [[0, 0], [5000, 0]].map(([dx, dy]) => { const q = p(dx, dy); return K.naarRd(q.lon, q.lat) })
  // lijn van 5 km; taps op 1 km (dubbel uit twee tegels) en 4 km, een café 1 km van de route af
  const poi = (soort, dx, dy) => ({ type: 'poi', soort, naam: '', ...p(dx, dy) })
  const w = G.waterLangs(xy, [poi('water', 1000, 20), poi('water', 1003, 21), poi('water', 4000, -50), poi('horeca', 2500, 1000)], 300)
  assert.equal(w.punten.length, 2)
  assert.ok(Math.abs(w.punten[0].km - 1) < 0.25 && Math.abs(w.punten[1].km - 4) < 0.25)
  assert.ok(Math.abs(w.langsteZonder - 3000) < 300, `${w.langsteZonder}`)
})

test('rondjes kiezen geen hoekpunt aan het eind van een doodlopend pad', () => {
  const { el, p } = roosterElementen()
  // lange doodlopende paden naar buiten, aan alle kanten
  const extra = []
  let id = 9000
  for (const [i, j, di, dj] of [[0, 5, -1, 0], [10, 5, 1, 0], [5, 0, 0, -1], [5, 10, 0, 1]]) {
    const geom = []
    for (let k = 0; k <= 6; k++) geom.push(p(i + di * k, j + dj * k))
    extra.push({ type: 'way', id: id++, tags: { highway: 'path', surface: 'sand' }, geometry: geom })
  }
  const g = G.bouwGraaf([...el, ...extra], { trail: true })
  const dood = G.doodlopendeKnopen(g)
  assert.ok(dood.reduce((a, b) => a + b, 0) >= 20)
  const start = G.dichtsteKnoop(g, ...K.naarRd(p(5, 5).lon, p(5, 5).lat)).knoop
  for (const kronkel of [false, true]) {
    const z = G.zoekRondjes(g, start, 3000, { kronkel })
    for (const r of z.rondjes) for (const v of r.via) assert.equal(dood[v], 0, 'hoekpunt op een doodlopend pad')
  }
})

test('openingstijden: gangbare OSM-notaties, open en dicht, en te ingewikkeld', () => {
  const op = (dag, uur, min = 0) => new Date(2026, 10, 15 + ((dag - 0 + 7) % 7), uur, min) // 15 nov 2026 is een zondag
  const t = 'Mo-Sa 08:00-21:00; Su 10:00-18:00'
  assert.deepEqual(K.isOpen(t, op(1, 12)), { open: true, tot: '21:00', vanaf: null })
  assert.deepEqual(K.isOpen(t, op(1, 7)), { open: false, tot: null, vanaf: '08:00' })
  assert.deepEqual(K.isOpen(t, op(0, 9)), { open: false, tot: null, vanaf: '10:00' })
  assert.equal(K.isOpen(t, op(0, 17, 59)).open, true)
  assert.equal(K.isOpen('24/7').open, true)
  assert.equal(K.isOpen('Mo-Fr 07:00-12:00,13:00-17:00; Sa,Su off', op(3, 12, 30)).open, false)
  assert.equal(K.isOpen('Mo-Fr 07:00-12:00,13:00-17:00; Sa,Su off', op(3, 13, 30)).open, true)
  assert.equal(K.isOpen('Mo-Fr 07:00-12:00,13:00-17:00; Sa,Su off', op(6, 13)).open, false)
  assert.equal(K.isOpen('Fr-Sa 18:00-02:00', op(5, 23)).open, true) // over middernacht
  assert.equal(K.isOpen('Apr-Sep: Mo-Su 10:00-18:00'), null)
})

test('stukje route weghalen: een lusje verdwijnt, de rest blijft aaneengesloten', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  const k = (i, j) => G.dichtsteKnoop(g, ...K.naarRd(p(i, j).lon, p(i, j).lat)).knoop
  // een route van (0,0) naar (6,0) met onderweg een lusje bij (3,0): omhoog naar (3,2), rechts, terug
  const langs = [k(0, 0), k(3, 0), k(3, 2), k(4, 2), k(4, 1), k(3, 1), k(3, 0), k(6, 0)]
  const r = G.routeLangs(g, langs)
  const opLus = r.knopen.indexOf(k(4, 2))
  const w = G.haalStukWeg(g, r.knopen, r.segs, [0, r.knopen.length - 1], opLus)
  assert.ok(w && w.weg > 300, `${w && w.weg} m weg`)
  assert.ok(!w.knopen.includes(k(4, 2)), 'het lusje is weg')
  assert.equal(w.knopen[0], k(0, 0))
  assert.equal(w.knopen[w.knopen.length - 1], k(6, 0))
  for (let i = 0; i < w.segs.length; i++) {
    const s = w.segs[i]
    const [a, b] = [w.knopen[i], w.knopen[i + 1]]
    assert.ok((g.van[s] === a && g.naar[s] === b) || (g.van[s] === b && g.naar[s] === a), 'aaneengesloten')
  }
})

test('lusjes weghalen: een rondje om een blok onderweg verdwijnt', () => {
  const { el, p } = roosterElementen()
  const g = G.bouwGraaf(el, { trail: true })
  const k = (i, j) => G.dichtsteKnoop(g, ...K.naarRd(p(i, j).lon, p(i, j).lat)).knoop
  const r = G.routeLangs(g, [k(0, 2), k(3, 2), k(3, 3), k(4, 3), k(4, 2), k(3, 2), k(6, 2)])
  const meter = (segs) => segs.reduce((m, s) => m + g.lengte[s], 0)
  const z = G.zonderLusjes(g, r.knopen, r.segs, [], { maxLus: 600 })
  assert.ok(!z.knopen.includes(k(4, 3)), 'het lusje om het blok is weg')
  assert.ok(Math.abs(meter(z.segs) - 600) < 30, `${meter(z.segs)} m`)
  assert.ok(z.weg > 350)
  // een vast (versleept) punt in het lusje blijft staan
  const vast = [0, r.knopen.indexOf(k(4, 3)), r.knopen.length - 1]
  assert.ok(G.zonderLusjes(g, r.knopen, r.segs, vast, { maxLus: 600 }).knopen.includes(k(4, 3)))
})
