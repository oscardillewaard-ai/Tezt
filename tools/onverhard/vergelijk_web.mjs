// Draait de webversie (public/onverhard) in Node tegen de echte bronnen en
// zet de uitkomst naast die van het Python-script.
//
//   python onverhard.py ... -o uit/test --json
//   NODE_USE_ENV_PROXY=1 node vergelijk_web.mjs uit/test.json "51.9921,4.3481" ... [--law 0.3] [--rondje 12]
//
// (NODE_USE_ENV_PROXY is alleen nodig achter een proxy.)
import fs from 'node:fs'
import { maakPlan, details } from '../../public/onverhard/bronnen.js'

const args = process.argv.slice(2)
const optie = (naam) => {
  const i = args.indexOf(naam)
  return i < 0 ? null : Number(args.splice(i, 2)[1])
}
const law = optie('--law') ?? 1
const rondjeKm = optie('--rondje')
const pythonJson = args[0].endsWith('.json') ? JSON.parse(fs.readFileSync(args.shift(), 'utf8')) : null
const punten = args.map((a) => a.split(',').map(Number))

const t0 = Date.now()
let laatste = ''
// zelfde instellingen als het Python-script: klassiek profiel, strand niet apart, 4 alternatieven
const uitslag = await maakPlan({
  punten, law, rondjeKm, trail: false, strandMijden: false, alternatieven: 4,
  meld: (tekst) => {
    if (tekst !== laatste) console.error('  ' + tekst)
    laatste = tekst
  },
})
const plan = { ...details(uitslag.opties[0]), verzoeken: uitslag.verzoeken, vlakken: uitslag.vlakken, meldingen: uitslag.meldingen }
const nl = (x, d = 2) => x.toFixed(d).replace('.', ',')
console.log(`\nWeb: ${nl(plan.analyse.lengte / 1000)} km, ${plan.twijfels.length} twijfelstukken, LAW ${nl(100 * plan.law, 1)}%, ` +
  `${plan.verzoeken} verzoeken, ${plan.vlakken} vlakken, ${Math.round((Date.now() - t0) / 1000)} s`)
if (pythonJson) console.log(`Python: ${nl(pythonJson.lengte_km)} km, ${pythonJson.twijfels.length} twijfelstukken, LAW ${nl(pythonJson.law_pct, 1)}%`)
console.log('\nklasse                 bron   web km   python km   verschil m')
let grootste = 0
for (const [i, rij] of plan.tabel.entries()) {
  for (const bron of ['osm', 'bgt', 'eind']) {
    const py = pythonJson ? pythonJson.tabel[i][bron].km : NaN
    const verschil = (rij[bron].km - py) * 1000
    if (pythonJson) grootste = Math.max(grootste, Math.abs(verschil))
    console.log(`${rij.klasse.padEnd(22)} ${bron.padEnd(5)} ${nl(rij[bron].km, 3).padStart(8)} ${pythonJson ? nl(py, 3).padStart(10) : ''} ${pythonJson ? nl(verschil, 0).padStart(10) : ''}`)
  }
}
for (const m of plan.meldingen) console.log('LET OP: ' + m)
if (pythonJson) console.log(`\nGrootste verschil met Python: ${nl(grootste, 0)} m`)
for (const o of uitslag.opties) console.log(`route ${o.naam}: ${nl(o.km)} km, ${nl(100 * o.zacht, 1)}% onverhard, ${nl(100 * o.law, 1)}% LAW`)
