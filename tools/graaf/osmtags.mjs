// Ruwe OpenStreetMap-tags (uit het Geofabrik-extract) terugbrengen tot de tags die de app uit de
// OpenFreeMap-tegels krijgt (OpenMapTiles-schema, zie osmtegels.js highwayVan). Zo is de invoer van
// de indelingslogica (kern.js osmKlasse, kostenfactor, alleenMetKaartje) gelijk aan die van de app,
// en dus ook het oordeel. Gecontroleerd tegen de tegels (graaf-proef stap 2): access alleen "no",
// surface alleen "paved"/"unpaved", foot ongewijzigd, woonstraten als "unclassified".

// OpenMapTiles surface_value()
const VERHARD = new Set(['paved', 'asphalt', 'cobblestone', 'concrete', 'concrete:lanes', 'concrete:plates', 'metal', 'paving_stones', 'sett', 'unhewn_cobblestone', 'wood', 'grade1'])
const ONVERHARD = new Set(['unpaved', 'compacted', 'dirt', 'earth', 'fine_gravel', 'grass', 'grass_paver', 'gravel', 'gravel_turf', 'ground', 'ice', 'mud', 'pebblestone', 'salt', 'sand', 'snow', 'woodchips'])
const DOOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'service', 'track', 'raceway',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
  'path', 'footway', 'cycleway', 'bridleway', 'steps', 'pedestrian'])
const MINOR = new Set(['residential', 'living_street', 'unclassified', 'road'])
const SERVICE = new Set(['spur', 'yard', 'siding', 'crossover', 'driveway', 'alley', 'parking_aisle'])

/** {highway, surface, access, foot, service, bridge, tunnel, layer} zoals uit de tegels, of null (geen weg voor ons). */
export function tagsVanOsm(o) {
  if (o.natural === 'beach' && !o.highway) return { natural: 'beach' }
  let h = o.highway
  if (!h || o.area === 'yes') return null
  if (MINOR.has(h)) h = 'unclassified'
  else if (h === 'busway') h = 'bus_guideway'
  else if (!DOOR.has(h)) return null // construction, proposed, platform, corridor, elevator, ...
  const t = { highway: h }
  if (o.surface && VERHARD.has(o.surface)) t.surface = 'paved'
  else if (o.surface && ONVERHARD.has(o.surface)) t.surface = 'unpaved'
  if (o.access === 'no' || o.access === 'private') t.access = 'no'
  if (o.foot) t.foot = o.foot
  if (h === 'service' && SERVICE.has(o.service)) t.service = o.service
  if (o.bridge && o.bridge !== 'no') t.bridge = 'yes'
  else if (o.tunnel && o.tunnel !== 'no') t.tunnel = 'yes'
  if (o.layer && o.layer !== '0' && /^-?\d+$/.test(o.layer)) t.layer = String(Number(o.layer))
  return t
}
