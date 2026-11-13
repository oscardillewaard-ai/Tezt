// End-to-end-test van de webapp in een headless browser, tegen de echte bronnen.
//
//   (cd public && python3 -m http.server 8765) &
//   node tools/onverhard/test_web_e2e.mjs <map voor screenshots> [python.json] '<hash>' [naam] [mobiel]
//
// Met ONVERHARD_URL=<adres> test je een andere plek dan de lokale server, bv. de live site.
//
// De hash is wat er achter # in de link staat, bv. 'p=51.9921,4.3481;51.9255,4.4679'.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const map = args.shift()
const python = args[0].endsWith('.json') ? JSON.parse(fs.readFileSync(args.shift(), 'utf8')) : null
const [hash, naam = 'web', mobiel] = args
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
// CHROMIUM_PAD: alleen nodig als de Playwright-versie van dit project geen eigen browser heeft
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined })
const ctx = await browser.newContext(
  mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
// geheugen tijdens het plannen: elke 250 ms meten en de piek onthouden
const cdp = await ctx.newCDPSession(page)
let piek = 0
const meter = setInterval(async () => {
  try {
    piek = Math.max(piek, (await cdp.send('Runtime.getHeapUsage')).usedSize)
  } catch {
    // de pagina laadt net opnieuw
  }
}, 250)
const fouten = []
let bytes = 0
let verzoeken = 0
page.on('console', (m) => m.type() === 'error' && fouten.push(m.text()))
page.on('pageerror', (e) => fouten.push('PAGEERROR ' + e.message))
page.on('requestfinished', async (r) => {
  if (/brouter|api\.pdok/.test(r.url())) {
    verzoeken += 1
    bytes += (await r.sizes()).responseBodySize // zoals over de lijn (gecomprimeerd)
  }
})
const t0 = Date.now()
// ONVERHARD_URL=https://oscardillewaard-ai.github.io/Tezt/onverhard/ test de live site
const basis = process.env.ONVERHARD_URL || 'http://localhost:8765/onverhard/'
await page.goto(`${basis}#${hash}&plan=1`)
await page.screenshot({ path: path.join(map, naam + '_bezig.png') })
await page.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden,
  null, { timeout: 600000 })
const sec = Math.round((Date.now() - t0) / 1000)
const fout = await page.locator('#fout').textContent()
if (fout) console.log('FOUTMELDING IN DE APP:', fout)
await page.waitForFunction(() => [...document.querySelectorAll('#twijfels canvas')].every((c) => c.dataset.klaar), null, { timeout: 60000 }).catch(() => {})
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1500)
clearInterval(meter)
await cdp.send('HeapProfiler.collectGarbage')
const geheugen = (await cdp.send('Runtime.getHeapUsage')).usedSize
const info = await page.evaluate(() => {
  const p = window.onverhard.krijgPlan()
  return p && {
    km: p.analyse.lengte / 1000, tabel: p.tabel, twijfels: p.twijfels.length, law: p.law, vlakken: p.vlakken,
    indicaties: p.twijfels.map((s) => s.indicatie || null),
    kern: [...document.querySelectorAll('#kern b')].map((b) => b.textContent),
    lijnen: document.querySelectorAll('#kaart path.leaflet-interactive').length,
    fotosKlaar: [...document.querySelectorAll('#twijfels canvas')].filter((c) => c.dataset.klaar).length,
    breedte: document.documentElement.scrollWidth,
  }
})
await page.screenshot({ path: path.join(map, naam + '.png') })
await page.screenshot({ path: path.join(map, naam + '_heel.png'), fullPage: true })
console.log(`${naam}: ${sec} s, ${verzoeken} verzoeken, ${(bytes / 1e6).toFixed(1)} MB over de lijn, ` +
  `geheugen piek ${Math.round(piek / 1e6)} MB, daarna ${Math.round(geheugen / 1e6)} MB, fouten: ${JSON.stringify(fouten)}`)
if (info) {
  console.log(JSON.stringify({ ...info, tabel: undefined }))
  if (python) {
    let grootste = 0
    info.tabel.forEach((rij, i) => {
      for (const bron of ['osm', 'bgt', 'eind']) grootste = Math.max(grootste, Math.abs(rij[bron].km - python.tabel[i][bron].km) * 1000)
    })
    console.log(`Python: ${python.lengte_km} km, ${python.twijfels.length} twijfels; grootste verschil per klasse: ${Math.round(grootste)} m`)
  }
}
await browser.close()
