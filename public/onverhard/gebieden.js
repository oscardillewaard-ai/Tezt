// "Rondjes in dit gebied": een benoemd beschermd natuurgebied onder een punt op de kaart opzoeken,
// en het stuk ervan dat bij een rondje past (afgesneden met een cirkel rond de start).
//
// Bron 1: PDOK Natura 2000 (OGC API Features, CORS open). Lukt dat niet (netwerk, storing), dan
// bron 2: de laag 'park' van de OpenFreeMap-tegels (zoom 12, het vlak met een naam onder het punt).
// Alleen benoemde beschermde gebieden; bos of heide zonder naam geeft niets.
import { naarRd, naarWgs, vereenvoudigRing } from './kern.js'
import { tegelXY } from './osmtegels.js'

export const NATURA2000 = 'https://api.pdok.nl/rvo/natura2000/ogc/v1/collections/natura2000/items'
// beschermde klassen in de OpenFreeMap-laag 'park' (rommelig: soms de naam van de regeling)
const BESCHERMD = /nature_reserve|national_park|protected_area|natura ?2000|nationaal park/i

/** Ligt p = [lon, lat] binnen de ring [[lon, lat], ...]? (even-oneven-regel) */
export function puntInRing([x, y], ring) {
  let binnen = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) binnen = !binnen
  }
  return binnen
}

/** Binnen een veelhoek met gaten ([buitenring, gat, ...])? */
export function puntInVeelhoek(p, veelhoek) {
  return puntInRing(p, veelhoek[0]) && !veelhoek.slice(1).some((gat) => puntInRing(p, gat))
}

/**
 * Het Natura 2000-gebied onder [lat, lon], of null. Geeft {naam, ring: [[lat, lon], ...], bron}
 * met de buitenring van het deel waar het punt in ligt. Gooit een fout als de bron niet antwoordt.
 */
export async function zoekNatura2000(lat, lon, signal, haal = fetch) {
  const d = 0.001
  const url = `${NATURA2000}?f=json&limit=10&bbox=${(lon - d).toFixed(5)},${(lat - d).toFixed(5)},${(lon + d).toFixed(5)},${(lat + d).toFixed(5)}`
  const r = await haal(url, { signal })
  if (!r.ok) throw new Error(`Natura 2000: HTTP ${r.status}`)
  const json = await r.json()
  for (const f of json.features || []) {
    const g = f.geometry
    if (!g) continue
    const delen = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []
    for (const deel of delen) {
      if (puntInVeelhoek([lon, lat], deel)) {
        return { naam: f.properties.naam_n2k || 'Natura 2000-gebied', ring: deel[0].map(([x, y]) => [y, x]), bron: 'Natura 2000 (PDOK)' }
      }
    }
  }
  return null
}

/**
 * Terugval: het benoemde beschermde vlak onder het punt in de OpenFreeMap-tegel (zoom 12). Een vlak
 * kan over meer tegels lopen; we nemen het stuk uit de tegel onder het punt (met de tegelrand erbij),
 * dat is na het afsnijden met de cirkel meestal genoeg. haalTegels: zie bronnen.js.
 */
export async function zoekParkInTegels(lat, lon, signal, haalTegels) {
  const [x, y] = tegelXY(lat, lon, 12)
  const elementen = await haalTegels([[x, y]], signal, () => {}, { zoom: 12, lagen: ['park'] })
  const kandidaten = []
  for (const e of elementen) {
    if (e.type !== 'park' || !e.naam || !BESCHERMD.test(e.klasse)) continue
    for (const ring of e.ringen) {
      const r = ring.map((q) => [q.lon, q.lat])
      if (puntInRing([lon, lat], r)) kandidaten.push({ naam: e.naam, ring: r.map(([a, b]) => [b, a]), opp: Math.abs(oppervlak(r)) })
    }
  }
  if (!kandidaten.length) return null
  kandidaten.sort((a, b) => a.opp - b.opp) // het kleinste (meest precieze) benoemde gebied
  return { naam: kandidaten[0].naam, ring: kandidaten[0].ring, bron: 'OpenFreeMap (park)' }
}

function oppervlak(ring) {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    s += x1 * y2 - x2 * y1
  }
  return s / 2
}

/** Een cirkel als veelhoek (RD, tegen de klok in). */
export function cirkel([mx, my], straal, n = 64) {
  return Array.from({ length: n }, (_, i) => [mx + straal * Math.cos((2 * Math.PI * i) / n), my + straal * Math.sin((2 * Math.PI * i) / n)])
}

/**
 * Sutherland-Hodgman: de veelhoek 'onderwerp' (mag hol zijn) afgesneden met de bolle veelhoek
 * 'mes' (tegen de klok in). Beide [[x, y], ...] zonder herhaald eindpunt.
 */
export function snijBol(onderwerp, mes) {
  let uit = onderwerp
  for (let i = 0; i < mes.length && uit.length; i++) {
    const [ax, ay] = mes[i]
    const [bx, by] = mes[(i + 1) % mes.length]
    const binnen = ([x, y]) => (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0
    const snij = ([px, py], [qx, qy]) => {
      const a1 = by - ay
      const b1 = ax - bx
      const c1 = a1 * ax + b1 * ay
      const a2 = qy - py
      const b2 = px - qx
      const c2 = a2 * px + b2 * py
      const det = a1 * b2 - a2 * b1
      return [(b2 * c1 - b1 * c2) / det, (a1 * c2 - a2 * c1) / det]
    }
    const invoer = uit
    uit = []
    for (let k = 0; k < invoer.length; k++) {
      const p = invoer[k]
      const q = invoer[(k + 1) % invoer.length]
      if (binnen(q)) {
        if (!binnen(p)) uit.push(snij(p, q))
        uit.push(q)
      } else if (binnen(p)) uit.push(snij(p, q))
    }
  }
  return uit
}

/**
 * Het deel van het gebied (ring [[lat, lon], ...]) binnen een cirkel met straal 'straal' meter rond
 * de start, vereenvoudigd op 10 m. Geeft een ring [[lat, lon], ...] of null als er (bijna) niets over is.
 */
export function gebiedRondStart(ring, [lat, lon], straal) {
  const rd = ring.map(([la, lo]) => naarRd(lo, la))
  if (rd.length > 3 && rd[0][0] === rd[rd.length - 1][0] && rd[0][1] === rd[rd.length - 1][1]) rd.pop()
  const midden = naarRd(lon, lat)
  const knip = snijBol(rd, cirkel(midden, straal))
  if (knip.length < 3 || Math.abs(oppervlak(knip)) < 20000) return null // kleiner dan 2 ha
  const simpel = vereenvoudigRing(knip.flat(), 10)
  return simpel.map(([x, y]) => {
    const [lo, la] = naarWgs(x, y)
    return [la, lo]
  })
}
