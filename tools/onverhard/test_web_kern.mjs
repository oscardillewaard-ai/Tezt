// Offline tests voor de rekenkern van de webapp (public/onverhard/kern.js).
// Draaien:  node --test tools/onverhard/test_web_kern.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as K from '../../public/onverhard/kern.js'

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
