// Graaf-proef stap 4: komt het vooraf berekende ondergrondoordeel overeen met wat de app nu zegt?
// Plant de testset met ?graaf=vooraf (in Node, zonder worker), en analyseert elke route twee keer:
// met het vooraf berekende oordeel, en zoals de app nu doet (BGT-tegels rond de route + K.analyseer).
// Uitkomst: overeenkomst van het eindoordeel als % van de lengte, en de grootste verschillen.
//
//   NODE_USE_ENV_PROXY=1 node --max-old-space-size=8000 tools/graaf/vergelijk_oordeel.mjs uit.json
import fs from 'node:fs'
import * as K from '../../public/onverhard/kern.js'
import { maakPlan } from '../../public/onverhard/bronnen.js'
import { vlakkenVoor } from './bouw.mjs'
import { DELFT, AB } from './regio.mjs'

globalThis.__geenWerker = true
const NAMEN = ['ab-kort-1 Delftse Hout', 'ab-kort-2 Den Hoorn', 'ab-kort-3 Delfgauw', 'ab-kort-4 Nootdorp', 'ab-kort-5 Schipluiden',
  'ab-lang-1 Rotterdam Centraal', 'ab-lang-2 Scheveningen', 'ab-lang-3 Zoetermeer', 'ab-lang-4 Maassluis', 'ab-lang-5 Leiden Centraal']
const GEVALLEN = [
  ['rondje-10 Delft Centraal', { punten: [DELFT], rondjeKm: 10 }],
  ['station-15 Delft Centraal', { modus: 'station', punten: [DELFT], rondjeKm: 15 }],
  ['rondje-10 Meijendel', { punten: [[52.13081, 4.35323]], rondjeKm: 10 }],
  ...AB.map((b, i) => [NAMEN[i], { punten: [DELFT, b], router: 'eigen' }]),
]

const uitPad = process.argv[2] || 'vergelijk_oordeel.json'
const resultaten = []
const verschillen = []
let totaal = 0
let gelijk = 0
for (const [naam, opties] of GEVALLEN) {
  const plan = await maakPlan({ ...opties, graaf: 'vooraf', trail: true, strandMijden: true, kaartje: false, alternatieven: 2, hoogtes: false })
  if (plan.graafBron !== 'vooraf') { console.log(naam, 'niet vooraf:', plan.graafBron); continue }
  for (const o of plan.opties) {
    const an = o.analyse
    const punten = K.meetpunten(an.stukken)
    const vlakken = await vlakkenVoor(new Set(K.tegelsVoor(punten, K.SNAP_M).map((t) => t.join('/'))))
    const app = K.analyseer(an.traject, vlakken)
    let m = 0
    let g = 0
    an.stukken.forEach((s, i) => {
      const t = app.stukken[i]
      const l = s.tot - s.van
      m += l
      if (s.eind === t.eind) g += l
      else verschillen.push({ geval: naam, route: o.naam, m: Math.round(l), vooraf: s.eind, app: t.eind, tags: s.tags[0], voorafUitleg: s.bgtUitleg, appUitleg: t.bgtUitleg, plek: K.naarWgs(...K.puntOpLijn(s.xy, K.lijnLengte(s.xy) / 2)).map((v) => +v.toFixed(5)).reverse() })
    })
    totaal += m
    gelijk += g
    const scoreV = K.nopavesScore(an).score
    const scoreA = K.nopavesScore(app).score
    resultaten.push({ geval: naam, route: o.naam, km: +(m / 1000).toFixed(2), gelijkPct: +((100 * g) / m).toFixed(2), scoreVooraf: scoreV, scoreApp: scoreA, zachtVooraf: +(100 * K.zachtAandeel(an)).toFixed(1), zachtApp: +(100 * K.zachtAandeel(app)).toFixed(1) })
    console.log(naam, o.naam, `${(m / 1000).toFixed(2)} km`, `gelijk ${((100 * g) / m).toFixed(2)}%`, `score ${scoreV}/${scoreA}`)
  }
}
verschillen.sort((a, b) => b.m - a.m)
const samen = { gelijkPct: +((100 * gelijk) / totaal).toFixed(2), km: +(totaal / 1000).toFixed(1), resultaten, grootsteVerschillen: verschillen.slice(0, 25) }
fs.writeFileSync(uitPad, JSON.stringify(samen, null, 1))
console.log('TOTAAL', samen.gelijkPct, '% van', samen.km, 'km')
