// Stap 1: welke kaarttegels (zoom 14) heeft de testset nodig, en welke blokken (zoom 12) zijn dat?
// Gebruikt dezelfde tegelfuncties als de app (osmtegels.js), zodat de regio past bij wat de router vraagt.
//   node tools/graaf/regio.mjs            -> overzicht + public/onverhard/graaf/regio.json-voorstel op stdout
import * as T from '../../public/onverhard/osmtegels.js'

export const DELFT = [52.0116, 4.3571]
export const AB = [
  [52.017, 4.383], [51.989, 4.333], [52.001, 4.404], [52.045, 4.395], [51.976, 4.315],
  [51.9244, 4.4689], [52.11, 4.275], [52.057, 4.493], [51.92, 4.25], [52.166, 4.482],
]
// Meijendel & Berkheide (Natura 2000, PDOK: bbox ~ 52.10–52.19 N, 4.28–4.42 O): rondjes van 15 km vanaf
// twee plekken in het gebied (zelfde start als benchmark_eigen.mjs, plus het noorden van Berkheide)
export const MEIJENDEL = [[52.13081, 4.35323, 15], [52.175, 4.395, 15]]

export function nodigeTegels() {
  const m = new Map()
  const zet = (lijst) => { for (const t of lijst) m.set(t.join('/'), t) }
  zet(T.tegelsRond(DELFT[0], DELFT[1], 0.38 * 10000)) // rondje 10 km (planRondjeEigen)
  // station 15 km: kandidaten op 0,5–0,85 × L in alle richtingen; per richting de ellips naar het station
  for (let hoek = 0; hoek < 360; hoek += 15) for (const f of [0.5, 0.85]) {
    const r = f * 15000
    const p = [DELFT[0] + (r * Math.cos((hoek * Math.PI) / 180)) / 111320, DELFT[1] + (r * Math.sin((hoek * Math.PI) / 180)) / (111320 * Math.cos((DELFT[0] * Math.PI) / 180))]
    zet(T.tegelsLangs(DELFT, p))
  }
  for (const b of AB) zet(T.tegelsLangs(DELFT, b, { factor: 1.4, extra: 600 })) // eigen router, eerste ellips
  for (const [la, lo, km] of MEIJENDEL) zet(T.tegelsRond(la, lo, 0.38 * km * 1000))
  return [...m.values()]
}

export function blokVanTegel([x, y]) { return [x >> 2, y >> 2] }

if (import.meta.url === `file://${process.argv[1]}`) {
  const tegels = nodigeTegels()
  const xs = tegels.map((t) => t[0]); const ys = tegels.map((t) => t[1])
  const blokken = new Map()
  for (const t of tegels) { const b = blokVanTegel(t); blokken.set(b.join('/'), b) }
  const bx = [...blokken.values()].map((b) => b[0]); const by = [...blokken.values()].map((b) => b[1])
  console.log('z14-tegels nodig:', tegels.length, 'x', Math.min(...xs), Math.max(...xs), 'y', Math.min(...ys), Math.max(...ys))
  console.log('z12-blokken geraakt:', blokken.size, 'x', Math.min(...bx), Math.max(...bx), 'y', Math.min(...by), Math.max(...by))
  const n = 2 ** 12
  const lon = (x) => (x / n) * 360 - 180
  const lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI
  console.log('rechthoek blokken bbox (lon/lat):', lon(Math.min(...bx)).toFixed(4), lat(Math.max(...by) + 1).toFixed(4), lon(Math.max(...bx) + 1).toFixed(4), lat(Math.min(...by)).toFixed(4))
  console.log('rechthoek telt', (Math.max(...bx) - Math.min(...bx) + 1) * (Math.max(...by) - Math.min(...by) + 1), 'blokken')
}
