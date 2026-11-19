// Snelheidsmeting (stap 0 en de hermeting na stap 6): vaste testset, per geval N× koude en N× warme
// cache, mediaan per fase. De app meet zelf (meting.js); dit script leest window.onverhard.meting.
//
//   (cd public && python3 -m http.server 8765) &
//   CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/benchmark_snelheid.mjs uit.json [N=5] [filter] [groep]
//
// groep: 'ab' = alleen de A-naar-B-paren (BRouter of eigen router), 'rest' = de andere gevallen, leeg = alles.
// Koud = een nieuwe browsercontext (lege HTTP-cache en lege Cache Storage). Warm = dezelfde context na
// één opwarmronde, met elke keer de pagina opnieuw geladen (geheugen leeg, caches gevuld).
// ONVERHARD_QUERY=router=eigen voegt ?router=eigen toe (stap 6).
import { chromium } from 'playwright'
import fs from 'node:fs'

const [uitPad, nTekst = '5', filter = '', groep = ''] = process.argv.slice(2)
const N = Number(nTekst)
const DELFT = '52.0116,4.3571'
const AB = [
  ['ab-kort-1 Delftse Hout', '52.0170,4.3830'],
  ['ab-kort-2 Den Hoorn', '51.9890,4.3330'],
  ['ab-kort-3 Delfgauw', '52.0010,4.4040'],
  ['ab-kort-4 Nootdorp', '52.0450,4.3950'],
  ['ab-kort-5 Schipluiden', '51.9760,4.3150'],
  ['ab-lang-1 Rotterdam Centraal', '51.9244,4.4689'],
  ['ab-lang-2 Scheveningen', '52.1100,4.2750'],
  ['ab-lang-3 Zoetermeer', '52.0570,4.4930'],
  ['ab-lang-4 Maassluis', '51.9200,4.2500'],
  ['ab-lang-5 Leiden Centraal', '52.1660,4.4820'],
]
let GEVALLEN = [
  ['rondje-10 Delft Centraal', `p=${DELFT}&rondje=10`],
  ['station-15 Delft Centraal', `p=${DELFT}&station=15`],
  ...AB.map(([naam, b]) => [naam, `p=${DELFT};${b}`]),
  ['gebied Delftse Hout (voorbeeld, 8 km)', 'modus=gebied&t=52.03342,4.33407;52.03751,4.34372;52.03553,4.34544;52.03183,4.34393;52.03104,4.33986;52.02946,4.33814;52.03183,4.33385&p=52.03262,4.33428&rondje=8'],
  ['tekenen (voorbeeld)', 'modus=tekenen&t=52.03289,4.33514;52.03421,4.33814;52.03553,4.34115;52.03632,4.34286;52.03421,4.34372;52.03236,4.34115'],
]
if (groep === 'ab') GEVALLEN = GEVALLEN.filter(([n]) => n.startsWith('ab-'))
if (groep === 'rest') GEVALLEN = GEVALLEN.filter(([n]) => !n.startsWith('ab-'))
if (filter) GEVALLEN = GEVALLEN.filter(([n]) => n.includes(filter))

const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const basis = (process.env.ONVERHARD_URL || 'http://localhost:8765/onverhard/') + (process.env.ONVERHARD_QUERY ? `?${process.env.ONVERHARD_QUERY}` : '')

async function eenRun(ctx, hash) {
  const p = await ctx.newPage()
  const t0 = Date.now()
  try {
    await p.goto(`${basis}#${hash}&plan=1`)
    await p.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
    // voorlopige resultaten (stap 3): wacht tot alles binnen is
    await p.waitForFunction(() => !window.onverhard.bezig || !window.onverhard.bezig(), null, { timeout: 300000 }).catch(() => {})
    const fout = await p.locator('#fout').textContent()
    const r = await p.evaluate(() => {
      const pl = window.onverhard.krijgPlan()
      return { meting: window.onverhard.meting.rapport(), eersteMs: window.onverhard.eersteMs ? window.onverhard.eersteMs() : null, score: pl ? pl.score : null, km: pl ? pl.analyse.lengte / 1000 : null, zacht: pl ? pl.zacht.eind : null, n: pl ? pl.opties.length : 0 }
    })
    return { ok: !fout, fout, wand: Date.now() - t0, ...r }
  } catch (e) {
    return { ok: false, fout: String(e.message).slice(0, 200), wand: Date.now() - t0 }
  } finally {
    await p.close()
  }
}

const mediaan = (a) => {
  const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y)
  if (!s.length) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)
}
function samenvatting(runs) {
  const ok = runs.filter((r) => r.ok)
  const fasen = new Set(ok.flatMap((r) => Object.keys(r.meting.fasen)))
  const bronnen = new Set(ok.flatMap((r) => Object.keys(r.meting.bronnen)))
  return {
    ok: ok.length, van: runs.length,
    totaal: mediaan(ok.map((r) => r.meting.totaal)),
    eerste: mediaan(ok.map((r) => r.eersteMs)),
    fasen: Object.fromEntries([...fasen].map((f) => [f, mediaan(ok.map((r) => r.meting.fasen[f] || 0))])),
    bronnen: Object.fromEntries([...bronnen].map((b) => [b, {
      n: mediaan(ok.map((r) => (r.meting.bronnen[b] || {}).n || 0)),
      kB: Math.round(mediaan(ok.map((r) => (r.meting.bronnen[b] || {}).bytes || 0)) / 1024),
      cache: mediaan(ok.map((r) => (r.meting.bronnen[b] || {}).cache || 0)),
    }])),
    score: mediaan(ok.map((r) => r.score)), km: ok.length ? Math.round(mediaan(ok.map((r) => r.km * 100)) ) / 100 : null,
    zacht: ok.length ? mediaan(ok.map((r) => Math.round(r.zacht * 1000))) / 10 : null,
  }
}

const uit = fs.existsSync(uitPad) ? JSON.parse(fs.readFileSync(uitPad, 'utf8')) : {}
for (const [naam, hash] of GEVALLEN) {
  const koud = []
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    koud.push(await eenRun(ctx, hash))
    await ctx.close()
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await eenRun(ctx, hash) // opwarmen
  const warm = []
  for (let i = 0; i < N; i++) warm.push(await eenRun(ctx, hash))
  await ctx.close()
  uit[naam] = { hash, koud: samenvatting(koud), warm: samenvatting(warm), ruw: { koud, warm } }
  console.log(naam, JSON.stringify({ koud: { ok: uit[naam].koud.ok, totaal: uit[naam].koud.totaal, fasen: uit[naam].koud.fasen }, warm: { ok: uit[naam].warm.ok, totaal: uit[naam].warm.totaal } }))
  fs.writeFileSync(uitPad, JSON.stringify(uit, null, 1))
}
await browser.close()
