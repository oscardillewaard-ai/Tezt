// Paden uit kaarttegels van OpenFreeMap (OpenMapTiles-indeling, zoomniveau 14)
// in plaats van uit de Overpass API. De tegels staan op een groot CDN, zonder
// limiet of sleutel, en zijn dus veel betrouwbaarder dan de drukke
// Overpass-servers. Nadeel: minder detail (ondergrond alleen 'verhard' of
// 'onverhard', geen tracktype). De officiële kaart vult dat daarna aan.
//
// Puur rekenwerk: tegelnummers, de tegel lezen en omzetten naar dezelfde
// elementen als Overpass geeft ({type: 'way', id, tags, geometry}), zodat
// graaf.js er niets van merkt.

import { Lezer, packed, leesWaarde } from './kern.js'

export const TEGEL_ZOOM = 14
const N = 2 ** TEGEL_ZOOM

/** Tegelnummers (x, y) op zoom 14 voor een punt. */
export function tegelXY(lat, lon) {
  const x = Math.floor(((lon + 180) / 360) * N)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N)
  return [x, y]
}

/** Alle tegels die een cirkel van 'straal' meter rond een punt raken. */
export function tegelsRond(lat, lon, straal) {
  const dLat = straal / 111320
  const dLon = straal / (111320 * Math.cos((lat * Math.PI) / 180))
  const [x0, y0] = tegelXY(lat + dLat, lon - dLon)
  const [x1, y1] = tegelXY(lat - dLat, lon + dLon)
  const uit = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) uit.push([x, y])
  return uit
}

// OpenMapTiles-klasse naar een OSM-highway-waarde (die kent de rest van de app)
const KLASSE = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  minor: 'unclassified', service: 'service', track: 'track', path: 'path', raceway: 'raceway', busway: 'bus_guideway',
}

function highwayVan(p) {
  const k = p.class
  if (k === 'path') return ['footway', 'cycleway', 'bridleway', 'steps', 'pedestrian', 'path'].includes(p.subclass) ? p.subclass : 'path'
  if (k === 'minor') return ['residential', 'living_street', 'unclassified', 'road'].includes(p.subclass) ? p.subclass : 'unclassified'
  const h = KLASSE[k]
  if (!h) return null // spoor, veerboot, enzovoort
  return p.ramp && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes(h) ? h + '_link' : h
}

/**
 * Lees een tegel (uitgepakte bytes) en geef elementen zoals Overpass ze geeft:
 * wegen en paden, en stranden. Coördinaten worden afgerond op het raster van
 * de tegel; dat raster loopt over de tegelgrenzen door, zodat hetzelfde punt
 * in twee tegels precies dezelfde coördinaten krijgt (een kruising blijft een
 * kruising).
 */
export function leesOsmTegel(bytes, x, y, idStart = 0) {
  const uit = []
  let id = idStart
  const l = new Lezer(bytes)
  while (!l.klaar()) {
    const [nr, type] = l.veld()
    if (nr !== 3 || type !== 2) {
      l.sla(type)
      continue
    }
    const laag = new Lezer(l.stuk())
    let naam = ''
    let extent = 4096
    const features = []
    const sleutels = []
    const waarden = []
    while (!laag.klaar()) {
      const [n, t] = laag.veld()
      if (n === 1 && t === 2) naam = new TextDecoder().decode(laag.stuk())
      else if (n === 2 && t === 2) features.push(laag.stuk())
      else if (n === 3 && t === 2) sleutels.push(new TextDecoder().decode(laag.stuk()))
      else if (n === 4 && t === 2) waarden.push(laag.stuk())
      else if (n === 5 && t === 0) extent = laag.varint()
      else laag.sla(t)
    }
    if (naam !== 'transportation' && naam !== 'landcover') continue
    const waardeCache = new Map()
    const waarde = (i) => {
      if (!waardeCache.has(i)) waardeCache.set(i, leesWaarde(waarden[i]))
      return waardeCache.get(i)
    }
    // rastercoördinaat -> lat/lon, met het raster over de hele wereld (zodat buren aansluiten)
    const totaal = N * extent
    const naarLatLon = (gx, gy) => {
      const px = x * extent + gx
      const py = y * extent + gy
      const lon = (px / totaal) * 360 - 180
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / totaal))) * 180) / Math.PI
      return { lat: Math.round(lat * 1e7) / 1e7, lon: Math.round(lon * 1e7) / 1e7 }
    }
    for (const f of features) {
      const fl = new Lezer(f)
      let tags = []
      let soort = 0
      let geom = []
      while (!fl.klaar()) {
        const [n, t] = fl.veld()
        if (n === 2 && t === 2) tags = packed(fl.stuk())
        else if (n === 3 && t === 0) soort = fl.varint()
        else if (n === 4 && t === 2) geom = packed(fl.stuk())
        else fl.sla(t)
      }
      const p = {}
      for (let i = 0; i + 1 < tags.length; i += 2) p[sleutels[tags[i]]] = waarde(tags[i + 1])
      // geometrie: lijnen (2) of vlakken (3), in losse stukken (MoveTo begint een nieuw stuk)
      const stukken = []
      let cx = 0
      let cy = 0
      for (let i = 0; i < geom.length; ) {
        const cmd = geom[i] & 7
        const aantal = geom[i] >> 3
        i++
        if (cmd === 7) {
          if (stukken.length && stukken[stukken.length - 1].length) stukken[stukken.length - 1].push(stukken[stukken.length - 1][0])
          continue
        }
        for (let k = 0; k < aantal; k++) {
          const dx = (geom[i] >>> 1) ^ -(geom[i] & 1)
          const dy = (geom[i + 1] >>> 1) ^ -(geom[i + 1] & 1)
          i += 2
          cx += dx
          cy += dy
          if (cmd === 1) stukken.push([])
          stukken[stukken.length - 1].push([cx, cy])
        }
      }
      if (naam === 'transportation' && soort === 2) {
        const highway = highwayVan(p)
        if (!highway) continue
        const t = { highway }
        if (p.surface) t.surface = p.surface
        if (p.access) t.access = p.access
        if (p.foot) t.foot = p.foot
        if (p.service) t.service = p.service
        if (p.brunnel === 'bridge') t.bridge = 'yes'
        if (p.brunnel === 'tunnel') t.tunnel = 'yes'
        if (p.layer) t.layer = String(p.layer)
        for (const st of stukken) if (st.length >= 2) uit.push({ type: 'way', id: ++id, tags: t, geometry: st.map(([gx, gy]) => naarLatLon(gx, gy)), bron: 'tegel' })
      } else if (naam === 'landcover' && soort === 3 && p.subclass === 'beach') {
        for (const st of stukken) if (st.length >= 4) uit.push({ type: 'way', id: ++id, tags: { natural: 'beach' }, geometry: st.map(([gx, gy]) => naarLatLon(gx, gy)), bron: 'tegel' })
      }
    }
  }
  return uit
}
