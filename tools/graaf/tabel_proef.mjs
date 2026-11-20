// Graaf-proef stap 4: tabellen en beslisregels uit de metingen (markdown op stdout).
//   node tools/graaf/tabel_proef.mjs docs/graaf-proef
// Verwacht in die map: huidig-rest.json, vooraf-rest.json (rondje + station), brouter-ab.json,
// eigen-ab.json (?router=eigen), vooraf-ab.json (?graaf=vooraf&router=eigen), oordeel.json.
import fs from 'node:fs'
import path from 'node:path'

const map = process.argv[2]
const lees = (f) => (fs.existsSync(path.join(map, f)) ? JSON.parse(fs.readFileSync(path.join(map, f), 'utf8')) : {})
const huidigRest = lees('huidig-rest.json')
const voorafRest = lees('vooraf-rest.json')
const brouter = lees('brouter-ab.json')
const eigen = lees('eigen-ab.json')
const voorafAb = lees('vooraf-ab.json')
const oordeel = lees('oordeel.json')

const s = (ms) => (ms === null || ms === undefined ? '–' : (ms / 1000).toFixed(1).replace('.', ','))
const kb = (b) => (b ? Math.round(b.kB / 1024 * 10) / 10 : 0)
const pct = (x) => (x === null || x === undefined ? '–' : `${String(x).replace('.', ',')}%`)
const bronTekst = (r) => {
  const b = r.bronnen || {}
  const n = Object.values(b).reduce((t, v) => t + (v.n || 0), 0)
  const mb = Object.values(b).reduce((t, v) => t + (v.kB || 0), 0) / 1024
  return { n, mb: mb.toFixed(1).replace('.', ',') }
}
const fasen = (r) => ['tegels', 'blokken', 'graaf', 'route', 'bgt', 'ahn', 'water', 'brouter'].map((f) => s(r.fasen?.[f] ?? null)).join(' | ')

console.log('#### Tijd, verzoeken en bytes (mediaan van 5, seconden)\n')
console.log('| Geval | Modus | Cache | Route A | Totaal | tegels | blokken | graaf | route | bgt | ahn | water | brouter | verzoeken | MB | graaf uit |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
const rijen = []
for (const [naam, mode, data] of [
  ...Object.keys(huidigRest).flatMap((n) => [[n, 'huidig', huidigRest[n]], [n, 'vooraf', voorafRest[n]]]),
  ...Object.keys(brouter).flatMap((n) => [[n, 'BRouter (huidig)', brouter[n]], [n, 'eigen, tegels', eigen[n]], [n, 'eigen, vooraf', voorafAb[n]]]),
]) {
  if (!data) continue
  for (const c of ['koud', 'warm']) {
    const r = data[c]
    const b = bronTekst(r)
    console.log(`| ${naam} | ${mode} | ${c} | ${s(r.eerste)} | ${s(r.totaal)} | ${fasen(r)} | ${b.n} | ${b.mb} | ${r.graaf || '–'} |`)
  }
  rijen.push({ naam, mode, data })
}

console.log('\n#### Uitkomst per testgeval (mediaan van de koude runs)\n')
console.log('| Geval | Modus | Score | Lengte (km) | Onverhard + half | Verboden (m) |')
console.log('|---|---|---|---|---|---|')
for (const { naam, mode, data } of rijen) {
  const r = data.koud
  console.log(`| ${naam} | ${mode} | ${r.score ?? '–'} | ${String(r.km ?? '–').replace('.', ',')} | ${pct(r.zacht)} | ${r.verboden ?? '–'} |`)
}

// ---------- Beslisregel 1: ?graaf=vooraf standaard binnen de regio ----------
// testgevallen: rondje en station (huidig tegen vooraf) en de 10 paren met de eigen router (tegels tegen vooraf)
const paren = []
for (const n of Object.keys(huidigRest)) if (voorafRest[n]) paren.push([n, huidigRest[n], voorafRest[n]])
for (const n of Object.keys(eigen)) if (voorafAb[n]) paren.push([n, eigen[n], voorafAb[n]])
console.log('\n#### Beslisregel 1: `?graaf=vooraf` standaard binnen de regio\n')
console.log('| Geval | Route A koud huidig → vooraf (s) | Winst | Score huidig → vooraf | Score ≥ |')
console.log('|---|---|---|---|---|')
let scoreOk = 0
let snelOk = 0
for (const [n, a, b] of paren) {
  const winst = a.koud.eerste ? 1 - b.koud.eerste / a.koud.eerste : null
  const ok = (b.koud.score ?? -1) >= (a.koud.score ?? 0)
  if (ok) scoreOk++
  if (winst !== null && winst >= 0.4) snelOk++
  console.log(`| ${n} | ${s(a.koud.eerste)} → ${s(b.koud.eerste)} | ${winst === null ? '–' : Math.round(100 * winst) + '%'} | ${a.koud.score} → ${b.koud.score} | ${ok ? 'ja' : 'nee'} |`)
}
const kern = paren.filter(([n]) => !n.startsWith('ab-'))
const kernSnel = kern.every(([, a, b]) => b.koud.eerste <= 0.6 * a.koud.eerste)
console.log(`\nRoute A koud ≥ 40% sneller: ${snelOk} van ${paren.length} gevallen; bij rondje en station (waar vooraf de standaard zou worden): ${kernSnel ? 'ja' : 'nee'}.`)
console.log(`Score gelijk of hoger: ${scoreOk} van ${paren.length} (eis: ≥ 90%, dus ≥ ${Math.ceil(0.9 * paren.length)}).`)
console.log(`Ondergrondoordeel gelijk: ${oordeel.gelijkPct ?? '–'}% van ${oordeel.km ?? '–'} km (eis ≥ 98%).`)
const regel1 = kernSnel && scoreOk >= Math.ceil(0.9 * paren.length) && (oordeel.gelijkPct ?? 0) >= 98
console.log(`REGEL1: ${regel1 ? 'GEHAALD' : 'NIET GEHAALD'}`)

// ---------- Beslisregel 2: eigen router (vooraf) tegen BRouter ----------
console.log('\n#### Beslisregel 2: A naar B, eigen router met de vooraf bewerkte graaf tegen BRouter\n')
console.log('| Paar | Wachttijd koud BRouter → eigen (s) | warm (s) | Lengte (km) | Onverhard+half | Score | Verboden (m) | Sneller | Score ≥ |')
console.log('|---|---|---|---|---|---|---|---|---|')
let sneller = 0
let beter = 0
let verboden = 0
for (const n of Object.keys(brouter)) {
  const a = brouter[n]
  const b = voorafAb[n]
  if (!b) continue
  const sn = b.koud.totaal < a.koud.totaal
  const sc = (b.koud.score ?? -1) >= (a.koud.score ?? 0)
  if (sn) sneller++
  if (sc) beter++
  if (b.koud.verboden > 0) verboden++
  console.log(`| ${n} | ${s(a.koud.totaal)} → ${s(b.koud.totaal)} | ${s(a.warm.totaal)} → ${s(b.warm.totaal)} | ${String(a.koud.km).replace('.', ',')} → ${String(b.koud.km).replace('.', ',')} | ${pct(a.koud.zacht)} → ${pct(b.koud.zacht)} | ${a.koud.score} → ${b.koud.score} | ${b.koud.verboden} | ${sn ? 'ja' : 'nee'} | ${sc ? 'ja' : 'nee'} |`)
}
console.log(`\nSneller op ${sneller} van 10; score gelijk of hoger op ${beter} van 10; paren met een verboden stuk: ${verboden}.`)
console.log(`REGEL2: ${sneller >= 9 && beter >= 9 && verboden === 0 ? 'GEHAALD' : 'NIET GEHAALD'}`)

if (oordeel.resultaten) {
  console.log('\n#### Ondergrondoordeel: vooraf tegen de app (per route)\n')
  console.log('| Geval | Route | km | Gelijk | Score vooraf / app | Onverhard+half vooraf / app |')
  console.log('|---|---|---|---|---|---|')
  for (const r of oordeel.resultaten) console.log(`| ${r.geval} | ${r.route} | ${String(r.km).replace('.', ',')} | ${pct(r.gelijkPct)} | ${r.scoreVooraf} / ${r.scoreApp} | ${pct(r.zachtVooraf)} / ${pct(r.zachtApp)} |`)
  console.log('\n**Grootste verschillen**\n')
  console.log('| Geval | m | Vooraf | App | Tags | Plek | Uitleg vooraf → app |')
  console.log('|---|---|---|---|---|---|---|')
  for (const v of oordeel.grootsteVerschillen.slice(0, 15)) console.log(`| ${v.geval} ${v.route} | ${v.m} | ${v.vooraf} | ${v.app} | \`${v.tags}\` | ${v.plek.join(', ')} | ${v.voorafUitleg} → ${v.appUitleg} |`)
}
void kb
