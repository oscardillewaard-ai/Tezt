// De kaart in Korrel: vectortegels van OpenFreeMap (OpenMapTiles-schema) in een eigen stijl voor MapLibre.
// Elke ondergrond krijgt een korrel (bos, heide, zand, water, wetland), asfalt is grijs en effen, en wat
// onverhard is (paden, karrensporen, wegen met surface=unpaved) is gestippeld. Zo laat de kaart zelf zien
// waar je wilt lopen. Puur rekenwerk en tekenwerk: het laden van de tegels doet MapLibre.

const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const TILEJSON = 'https://tiles.openfreemap.org/planet'

/** De kleuren per thema. 'ink' is de kleur van de korrel zelf. */
export const THEMA = {
  licht: {
    bg: '#EBDDAE', wood: '#A8BC72', grass: '#D9DA9B', scrub: '#C9C788', heath: '#D3A7C2', farm: '#E9DDA8', sand: '#EAD59C',
    wetland: '#B9CCA3', water: '#8FB4BF', res: '#E3CF99', comm: '#DDC58D', ind: '#D6BD88', campus: '#E7D7A1', pitch: '#C9D28F',
    rail: '#E0D0A0', building: '#DAC28C', buildingLijn: '#C4AA72', ink: '#2B211B', ink2: '#4B3E31', halo: '#F2E4B8',
    snel: '#4F535A', hoofd: '#5E636A', klein: '#80848B', fiets: '#8C9096', onverhard: '#6B4A2E', pad: '#2B211B',
    waterLabel: '#2F6070', park: '#5F7A2F', grens: '#9B4A7A', korrelInkt: [43, 33, 27],
  },
  donker: {
    bg: '#241B16', wood: '#3E4824', grass: '#444728', scrub: '#3A3E26', heath: '#5B3B4D', farm: '#2B2318', sand: '#5A4A2C',
    wetland: '#364434', water: '#2E4853', res: '#2D231B', comm: '#33271E', ind: '#38291F', campus: '#2F261C', pitch: '#3A4424',
    rail: '#2E251C', building: '#3B2E22', buildingLijn: '#52402F', ink: '#F2E4B8', ink2: '#D8C79A', halo: '#241B16',
    snel: '#B8BCC2', hoofd: '#9FA3A9', klein: '#82868C', fiets: '#6F7378', onverhard: '#D9B77A', pad: '#F2E4B8',
    waterLabel: '#9FC4CF', park: '#9DB36A', grens: '#C77BA7', korrelInkt: [242, 228, 184],
  },
}

/**
 * De korrels als plaatje: kleur van de ondergrond met inkt erover. Elk plaatje is een tegel die naadloos
 * aansluit; 'schaal' 2 maakt het scherp op een retinascherm.
 * Geeft {width, height, data (ImageData), pixelRatio}.
 */
const KORRELS = {
  // [grootte in px (logisch), tekenfunctie(ctx, inkt)]
  bos: [10, (c) => {
    c.lineWidth = 1.1
    c.lineCap = 'round'
    for (const [x, y0, y1] of [[2, 8, 4], [5.5, 9, 5.5], [8.5, 6, 2.5]]) {
      c.beginPath()
      c.moveTo(x, y0)
      c.lineTo(x, y1)
      c.stroke()
    }
  }, 0.55, 'wood'],
  gras: [14, (c) => {
    c.lineWidth = 1
    c.lineCap = 'round'
    for (const [x, y0, y1] of [[3, 10, 7], [10, 5, 2]]) {
      c.beginPath()
      c.moveTo(x, y0)
      c.lineTo(x, y1)
      c.stroke()
    }
  }, 0.35, 'grass'],
  struweel: [12, (c) => {
    c.lineWidth = 1
    c.lineCap = 'round'
    for (const [x, y0, y1] of [[2, 7, 4], [8, 10, 7], [10, 4, 2]]) {
      c.beginPath()
      c.moveTo(x, y0)
      c.lineTo(x, y1)
      c.stroke()
    }
    c.beginPath()
    c.arc(5, 3, 0.8, 0, 7)
    c.fill()
  }, 0.5, 'scrub'],
  heide: [7, (c) => {
    c.lineWidth = 1.1
    for (const k of [-1, 0, 1]) {
      c.beginPath()
      c.moveTo(k * 7, 7)
      c.lineTo(7 + k * 7, 0)
      c.stroke()
    }
  }, 0.55, 'heath'],
  zand: [11, (c) => {
    for (const [x, y, r] of [[2, 2, 0.9], [7.5, 1.5, 0.7], [5, 6.5, 1], [10, 8.5, 0.7], [1.5, 9, 0.8]]) {
      c.beginPath()
      c.arc(x, y, r, 0, 7)
      c.fill()
    }
  }, 0.65, 'sand'],
  wetland: [12, (c) => {
    c.lineWidth = 1
    c.beginPath()
    c.moveTo(0, 5)
    c.quadraticCurveTo(3, 2, 6, 5)
    c.quadraticCurveTo(9, 8, 12, 5)
    c.stroke()
    c.beginPath()
    c.moveTo(3, 10)
    c.lineTo(3, 8)
    c.moveTo(9, 11)
    c.lineTo(9, 9)
    c.stroke()
  }, 0.55, 'wetland'],
  water: [12, (c) => {
    c.lineWidth = 1.1
    c.beginPath()
    c.moveTo(0, 4)
    c.quadraticCurveTo(3, 1.5, 6, 4)
    c.quadraticCurveTo(9, 6.5, 12, 4)
    c.stroke()
  }, 0.5, 'water'],
}

/** Teken een korrel in dit thema; doet niets (null) als de naam niet bestaat. */
export function korrelBeeld(naam, donker, schaal = 2) {
  const def = KORRELS[naam]
  if (!def) return null
  const [maat, teken, doorzicht, kleur] = def
  const t = THEMA[donker ? 'donker' : 'licht']
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = maat * schaal
  const c = canvas.getContext('2d')
  c.scale(schaal, schaal)
  c.fillStyle = t[kleur]
  c.fillRect(0, 0, maat, maat)
  const [r, g, b] = t.korrelInkt
  const inkt = `rgba(${r},${g},${b},${donker ? doorzicht * 0.55 : doorzicht})`
  c.strokeStyle = inkt
  c.fillStyle = inkt
  teken(c, inkt)
  return { data: c.getImageData(0, 0, maat * schaal, maat * schaal), pixelRatio: schaal }
}
export const KORRELNAMEN = Object.keys(KORRELS)

/** Een MapLibre-stijl voor het licht of het donker. */
export function korrelStijl(donker) {
  const t = THEMA[donker ? 'donker' : 'licht']
  const naam = ['coalesce', ['get', 'name:nl'], ['get', 'name']]
  const dikte = (...stops) => ['interpolate', ['exponential', 1.4], ['zoom'], ...stops]
  const klasse = (...lijst) => ['in', ['get', 'class'], ['literal', lijst]]
  const geenTunnel = ['!=', ['get', 'brunnel'], 'tunnel']
  const onverhard = ['==', ['get', 'surface'], 'unpaved']
  const verhard = ['==', ['get', 'surface'], 'paved']
  const pat = (n) => `korrel-${n}-${donker ? 'd' : 'l'}`
  const tekst = { 'text-font': ['Noto Sans Regular'], 'text-field': naam }
  const halo = { 'text-color': t.ink, 'text-halo-color': t.halo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 }

  const lagen = [
    { id: 'achtergrond', type: 'background', paint: { 'background-color': t.bg } },
    // landcover: elke soort een eigen korrel
    { id: 'akker', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'farmland'], paint: { 'fill-color': t.farm } },
    { id: 'gras', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['all', ['==', ['get', 'class'], 'grass'], ['!', ['in', ['get', 'subclass'], ['literal', ['heath', 'scrub']]]]], paint: { 'fill-pattern': pat('gras') } },
    { id: 'struweel', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'subclass'], 'scrub'], paint: { 'fill-pattern': pat('struweel') } },
    { id: 'heide', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'subclass'], 'heath'], paint: { 'fill-pattern': pat('heide') } },
    { id: 'zand', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'sand'], paint: { 'fill-pattern': pat('zand') } },
    { id: 'wetland', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wetland'], paint: { 'fill-pattern': pat('wetland') } },
    { id: 'bos', type: 'fill', source: 'ofm', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-pattern': pat('bos') } },
    // landgebruik: effen, een tint donkerder dan de grond
    { id: 'wonen', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'neighbourhood', 'suburb', 'quarter']]], paint: { 'fill-color': t.res } },
    { id: 'handel', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['commercial', 'retail']]], paint: { 'fill-color': t.comm } },
    { id: 'industrie', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['industrial', 'railway']]], paint: { 'fill-color': t.ind } },
    { id: 'campus', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['school', 'education', 'college', 'university', 'hospital']]], paint: { 'fill-color': t.campus } },
    { id: 'sportveld', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['pitch', 'playground']]], paint: { 'fill-color': t.pitch } },
    { id: 'begraafplaats', type: 'fill', source: 'ofm', 'source-layer': 'landuse', filter: ['==', ['get', 'class'], 'cemetery'], paint: { 'fill-pattern': pat('gras') } },
    // beschermde natuur: een streeplijn
    { id: 'natuur-vlak', type: 'fill', source: 'ofm', 'source-layer': 'park', paint: { 'fill-color': t.park, 'fill-opacity': donker ? 0.1 : 0.08 } },
    { id: 'natuur-lijn', type: 'line', source: 'ofm', 'source-layer': 'park', minzoom: 8, paint: { 'line-color': t.park, 'line-width': 1.2, 'line-opacity': 0.8, 'line-dasharray': [4, 3] } },
    // water
    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-pattern': pat('water') } },
    { id: 'waterloop', type: 'line', source: 'ofm', 'source-layer': 'waterway', paint: { 'line-color': t.water, 'line-width': dikte(8, 0.6, 14, 2, 18, 8) } },
    { id: 'gebouwen', type: 'fill', source: 'ofm', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': t.building, 'fill-outline-color': t.buildingLijn } },
    // wegen: eerst een rand in de kleur van de grond, dan de weg zelf
    { id: 'weg-rand', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 9, filter: ['all', geenTunnel, klasse('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'busway')],
      layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': t.halo, 'line-opacity': donker ? 0.18 : 0.9, 'line-width': dikte(9, 1.2, 14, 6, 18, 24) } },
    { id: 'weg-snel', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 5, filter: ['all', geenTunnel, klasse('motorway', 'trunk')],
      layout: { 'line-join': 'round' }, paint: { 'line-color': t.snel, 'line-width': dikte(5, 0.7, 14, 5, 18, 20) } },
    { id: 'weg-hoofd', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 7, filter: ['all', geenTunnel, klasse('primary', 'secondary')],
      layout: { 'line-join': 'round' }, paint: { 'line-color': t.hoofd, 'line-width': dikte(7, 0.6, 14, 3.6, 18, 15) } },
    { id: 'weg-tertiair', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 10, filter: ['all', geenTunnel, klasse('tertiary', 'busway')],
      layout: { 'line-join': 'round' }, paint: { 'line-color': t.hoofd, 'line-width': dikte(10, 0.5, 14, 2.6, 18, 12) } },
    { id: 'weg-klein', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['all', geenTunnel, klasse('minor', 'service'), ['!', onverhard]],
      layout: { 'line-join': 'round' }, paint: { 'line-color': t.klein, 'line-width': dikte(12, 0.4, 14, 1.8, 18, 9) } },
    // wat onverhard is: gestippeld
    { id: 'weg-onverhard', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['all', klasse('minor', 'service'), onverhard],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': t.onverhard, 'line-width': dikte(12, 1.2, 14, 2.4, 18, 7), 'line-dasharray': [0.1, 1.8] } },
    { id: 'karrenspoor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['all', ['==', ['get', 'class'], 'track'], ['!', verhard]],
      layout: { 'line-cap': 'butt' }, paint: { 'line-color': t.onverhard, 'line-width': dikte(11, 1, 14, 1.8, 18, 5), 'line-dasharray': [3, 1.6] } },
    { id: 'karrenspoor-verhard', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['all', ['==', ['get', 'class'], 'track'], verhard],
      paint: { 'line-color': t.fiets, 'line-width': dikte(12, 0.5, 14, 1.2, 18, 4) } },
    { id: 'pad-verhard', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['all', geenTunnel, ['==', ['get', 'class'], 'path'], ['!', ['in', ['get', 'subclass'], ['literal', ['platform']]]], ['any', verhard, ['all', ['!', onverhard], ['in', ['get', 'subclass'], ['literal', ['cycleway', 'footway', 'pedestrian', 'steps']]]]]],
      layout: { 'line-join': 'round' }, paint: { 'line-color': t.fiets, 'line-width': dikte(12, 0.5, 14, 1.2, 18, 4) } },
    { id: 'pad', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 12, filter: ['all', geenTunnel, ['==', ['get', 'class'], 'path'], ['!', verhard], ['!', ['in', ['get', 'subclass'], ['literal', ['platform', 'steps']]]],
      ['any', onverhard, ['in', ['get', 'subclass'], ['literal', ['path', 'bridleway']]]]],
      layout: { 'line-cap': 'round' }, paint: { 'line-color': t.pad, 'line-width': dikte(12, 1.1, 14, 2, 18, 5), 'line-dasharray': [0.1, 2.1] } },
    { id: 'spoor-lijn', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 8, filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': t.ink2, 'line-width': dikte(8, 0.6, 14, 1.6, 18, 4) } },
    { id: 'spoor-streep', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['all', ['==', ['get', 'class'], 'rail'], ['!=', ['get', 'brunnel'], 'tunnel']],
      paint: { 'line-color': t.bg, 'line-width': dikte(11, 0.6, 14, 1, 18, 2.4), 'line-dasharray': [3, 3] } },
    { id: 'veer', type: 'line', source: 'ofm', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'ferry'], paint: { 'line-color': t.waterLabel, 'line-width': 1.4, 'line-dasharray': [3, 3] } },
    { id: 'landsgrens', type: 'line', source: 'ofm', 'source-layer': 'boundary', filter: ['<=', ['get', 'admin_level'], 2], paint: { 'line-color': t.grens, 'line-width': 1.4, 'line-dasharray': [5, 3] } },
    // namen
    { id: 'naam-water', type: 'symbol', source: 'ofm', 'source-layer': 'water_name', minzoom: 8, layout: { ...tekst, 'text-font': ['Noto Sans Italic'], 'text-size': 12, 'text-max-width': 6 }, paint: { ...halo, 'text-color': t.waterLabel } },
    { id: 'naam-weg', type: 'symbol', source: 'ofm', 'source-layer': 'transportation_name', minzoom: 14, filter: klasse('minor', 'service', 'tertiary', 'secondary', 'primary', 'track', 'path'),
      layout: { ...tekst, 'symbol-placement': 'line', 'text-size': 10.5, 'text-letter-spacing': 0.02 }, paint: { ...halo, 'text-color': t.ink2 } },
    { id: 'naam-wijk', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 11, filter: klasse('suburb', 'hamlet', 'neighbourhood'),
      layout: { ...tekst, 'text-size': 11.5, 'text-transform': 'uppercase', 'text-letter-spacing': 0.08, 'text-max-width': 7 }, paint: { ...halo, 'text-color': t.ink2 } },
    { id: 'naam-dorp', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 8, filter: klasse('village'),
      layout: { ...tekst, 'text-font': ['Noto Sans Bold'], 'text-size': dikte(8, 11, 14, 14), 'text-max-width': 7 }, paint: halo },
    { id: 'naam-stad', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 5, filter: klasse('town', 'city'),
      layout: { ...tekst, 'text-font': ['Noto Sans Bold'], 'text-size': dikte(5, 12, 10, 16, 14, 22), 'text-max-width': 8 }, paint: halo },
  ]
  return {
    version: 8,
    name: donker ? 'Korrel donker' : 'Korrel',
    glyphs: GLYPHS,
    sources: { ofm: { type: 'vector', url: TILEJSON, attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data van <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' } },
    layers: lagen,
  }
}

/** Koppel de korrels aan een MapLibre-kaart: elk plaatje wordt gemaakt op het moment dat de stijl erom vraagt. */
export function koppelKorrels(glMap) {
  glMap.on('styleimagemissing', (e) => {
    const m = /^korrel-([a-z]+)-([ld])$/.exec(e.id)
    if (!m || glMap.hasImage(e.id)) return
    const beeld = korrelBeeld(m[1], m[2] === 'd')
    if (beeld) glMap.addImage(e.id, beeld.data, { pixelRatio: beeld.pixelRatio })
  })
}

/** Kan deze browser WebGL? Zo niet, dan blijft de gewone kaart. */
export function kanWebgl() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

/** De bronvermelding die bij deze kaart hoort (OpenFreeMap vraagt erom). */
export const KAART_BRON = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap-bijdragers</a>'
