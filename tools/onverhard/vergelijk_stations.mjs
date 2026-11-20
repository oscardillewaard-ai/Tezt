// Stap 5: Naar station met en zonder ringen naast elkaar (Node, echte bronnen).
//   NODE_USE_ENV_PROXY=1 node tools/onverhard/vergelijk_stations.mjs [uit.json]
import fs from 'node:fs'
import { maakPlan } from '../../public/onverhard/bronnen.js'
import * as M from '../../public/onverhard/meting.js'

const STARTS = [
  ['Delft Centraal', [52.0116, 4.3571], 15],
  ['Utrecht Centraal', [52.0894, 5.1101], 12],
  ['Amersfoort', [52.1561, 5.3878], 15],
  ['Haarlem', [52.3874, 4.6383], 12],
  ['Den Bosch', [51.6900, 5.2930], 15],
  ['Zwolle', [52.5050, 6.0930], 20],
]
const uit = []
for (const [naam, start, km] of STARTS) {
  const r = { naam, km }
  for (const ringen of [false, true]) {
    M.reset()
    const t0 = Date.now()
    try {
      const p = await maakPlan({ modus: 'station', punten: [start], rondjeKm: km, alternatieven: 2, metBgt: true, hoogtes: false, ringen })
      r[ringen ? 'ringen' : 'gewoon'] = {
        ms: Date.now() - t0, tegels: (M.rapport().bronnen.tegels || {}).n,
        routes: p.opties.map((o) => `${o.station} ${o.km.toFixed(2)} km s${o.score}`),
      }
    } catch (e) {
      r[ringen ? 'ringen' : 'gewoon'] = { fout: e.message }
    }
  }
  r.gelijk = JSON.stringify(r.gewoon.routes) === JSON.stringify(r.ringen.routes)
  console.log(JSON.stringify(r))
  uit.push(r)
}
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(uit, null, 1))
