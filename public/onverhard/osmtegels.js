// Paden uit kaarttegels van OpenFreeMap (OpenMapTiles-indeling, zoomniveau 14)
// in plaats van uit de Overpass API. De tegels staan op een groot CDN, zonder
// limiet of sleutel, en zijn dus veel betrouwbaarder dan de drukke
// Overpass-servers. Nadeel: minder detail (ondergrond alleen 'verhard' of
// 'onverhard', geen tracktype). De officiële kaart vult dat daarna aan.
//
// Puur rekenwerk: tegelnummers, de tegel lezen en omzetten naar dezelfde
// elementen als Overpass geeft ({type: 'way', id, tags, geometry}), zodat
// graaf.js er niets van merkt.

import { Lezer, packed, leesWaarde, naarRd } from './kern.js'

export const TEGEL_ZOOM = 14

/** Tegelnummers (x, y) voor een punt, standaard op zoom 14. */
export function tegelXY(lat, lon, zoom = TEGEL_ZOOM) {
  const n = 2 ** zoom
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [x, y]
}

/** Alle tegels die een cirkel van 'straal' meter rond een punt raken. */
export function tegelsRond(lat, lon, straal, zoom = TEGEL_ZOOM) {
  const dLat = straal / 111320
  const dLon = straal / (111320 * Math.cos((lat * Math.PI) / 180))
  const [x0, y0] = tegelXY(lat + dLat, lon - dLon, zoom)
  const [x1, y1] = tegelXY(lat - dLat, lon + dLon, zoom)
  const uit = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) uit.push([x, y])
  return uit
}

/** Hoek (lat, lon) linksboven van tegel (x, y). */
function tegelHoek(x, y, zoom) {
  const n = 2 ** zoom
  return [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, (x / n) * 360 - 180]
}

/**
 * De tegels (zoom 14) in een ellips met a en b ([lat, lon]) als brandpunten: een tegel doet mee als
 * ergens op de tegel (hoeken of midden) de som van de afstanden tot a en b hooguit
 * factor × (afstand a-b) + extra meter is. Zo haal je alleen op wat langs de weg van a naar b ligt.
 */
export function tegelsLangs(a, b, { factor = 1.35, extra = 1000, zoom = TEGEL_ZOOM } = {}) {
  const [ax, ay] = naarRd(a[1], a[0])
  const [bx, by] = naarRd(b[1], b[0])
  const grens = factor * Math.hypot(bx - ax, by - ay) + extra
  const marge = grens / 2 + 1500 // zoveel kan een punt van de ellips buiten het midden liggen, plus een tegel
  const midden = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const uit = []
  for (const [x, y] of tegelsRond(midden[0], midden[1], marge, zoom)) {
    const [lat0, lon0] = tegelHoek(x, y, zoom)
    const [lat1, lon1] = tegelHoek(x + 1, y + 1, zoom)
    const punten = [[lat0, lon0], [lat0, lon1], [lat1, lon0], [lat1, lon1], [(lat0 + lat1) / 2, (lon0 + lon1) / 2]]
    for (const [lat, lon] of punten) {
      const [px, py] = naarRd(lon, lat)
      if (Math.hypot(px - ax, py - ay) + Math.hypot(px - bx, py - by) <= grens) {
        uit.push([x, y])
        break
      }
    }
  }
  return uit
}

// OpenMapTiles-klasse naar een OSM-highway-waarde (die kent de rest van de app)
const KLASSE = {
  motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary',
  minor: 'unclassified', service: 'service', track: 'track', path: 'path', raceway: 'raceway', busway: 'bus_guideway',
}

// punten waar je water kunt krijgen (OpenMapTiles-laag 'poi': klasse/subklasse)
export const POI_SOORT = {
  'drinking_water/drinking_water': 'water',
  'cafe/cafe': 'horeca', 'restaurant/restaurant': 'horeca', 'fast_food/fast_food': 'horeca', 'beer/pub': 'horeca', 'bar/bar': 'horeca', 'ice_cream/ice_cream': 'horeca',
  'grocery/supermarket': 'winkel', 'shop/convenience': 'winkel', 'bakery/bakery': 'winkel',
  'toilets/toilets': 'toilet',
  'fuel/fuel': 'tank',
}

// treinstations (niet metro of tram) uit dezelfde laag 'poi'. RandstadRail-haltes staan in de tegels
// ook als railway/station, dus die komen er (helaas) bij.
export const STATION_SOORT = new Set(['railway/station', 'railway/halt'])

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
export function leesOsmTegel(bytes, x, y, idStart = 0, { zoom = TEGEL_ZOOM, lagen = ['transportation', 'landcover', 'poi'] } = {}) {
  const N = 2 ** zoom
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
    if (!lagen.includes(naam)) continue
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
      let fid = 0
      while (!fl.klaar()) {
        const [n, t] = fl.veld()
        if (n === 1 && t === 0) fid = fl.varint()
        else if (n === 2 && t === 2) tags = packed(fl.stuk())
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
      } else if (naam === 'poi' && soort === 1 && stukken.length && stukken[0].length) {
        const s2 = POI_SOORT[`${p.class}/${p.subclass}`]
        if (STATION_SOORT.has(`${p.class}/${p.subclass}`)) {
          const { lat, lon } = naarLatLon(stukken[0][0][0], stukken[0][0][1])
          // 'trein': waarschijnlijk een NS-station (de tegels noemen RandstadRail-haltes ook station); de
          // Engelse naam eindigt dan op 'railway station' of de Nederlandse begint met 'station'. Een gok.
          const trein = /railway station/i.test(p['name:en'] || '') || /^(station|halte) /i.test(p['name:nl'] || '')
          const naamNl = String(p['name:nl'] || '').replace(/^(station|halte) /i, '')
          uit.push({ type: 'station', id: ++id, soort: p.subclass, naam: naamNl || p.name || '', trein, rank: p.rank || 0, lat, lon })
        } else if (s2) {
          const { lat, lon } = naarLatLon(stukken[0][0][0], stukken[0][0][1])
          uit.push({ type: 'poi', id: ++id, soort: s2, naam: p['name:nl'] || p.name || '', lat, lon })
        }
      } else if (naam === 'park' && soort === 3) {
        // natuurgebieden: de naam staat ook op het vlak (gecontroleerd, zie VOORTGANG.md, controle e)
        const ringen = stukken.filter((st) => st.length >= 4).map((st) => st.map(([gx, gy]) => naarLatLon(gx, gy)))
        if (ringen.length) uit.push({ type: 'park', id: fid, klasse: p.class || '', naam: p['name:nl'] || p.name || '', ringen })
      } else if (naam === 'landcover' && soort === 3 && p.subclass === 'beach') {
        for (const st of stukken) if (st.length >= 4) uit.push({ type: 'way', id: ++id, tags: { natural: 'beach' }, geometry: st.map(([gx, gy]) => naarLatLon(gx, gy)), bron: 'tegel' })
      }
    }
  }
  return uit
}
