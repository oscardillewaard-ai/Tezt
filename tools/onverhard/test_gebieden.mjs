// "Rondjes in dit gebied" op vaste plekken: rechtsklik (= lang drukken) op de kaart, menu-item,
// plannen met de hoofdknop. Meet de tijd van het opzoeken en van het plannen.
//   (cd public && python3 -m http.server 8765) &
//   CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/test_gebieden.mjs [uit.json]
import { chromium } from 'playwright'
import fs from 'node:fs'

const GEBIEDEN = [
  ['Meijendel & Berkheide', 52.130, 4.350],
  ['Veluwe (Veluwezoom)', 52.030, 6.020],
  ['Schoorlse Duinen', 52.700, 4.660],
  ['Kennemerland-Zuid', 52.410, 4.570],
  ['Loonse en Drunense Duinen', 51.660, 5.100],
  ['Delftse Hout (geen beschermd gebied)', 52.017, 4.383],
]
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const basis = process.env.ONVERHARD_URL || 'http://localhost:8765/onverhard/'
const uit = []
for (const [naam, lat, lon] of GEBIEDEN) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const p = await ctx.newPage()
  const fouten = []
  p.on('pageerror', (e) => fouten.push(e.message))
  await p.goto(basis)
  await p.locator('[data-soort="rondje"]').click()
  await p.locator('#snelkeuzes [data-waarde="10"]').click()
  await p.evaluate(([la, lo]) => window.onverhard.kaart.setView([la, lo], 14, { animate: false }), [lat, lon])
  await p.waitForTimeout(500)
  const vak = await p.locator('#kaart').boundingBox()
  const pt = await p.evaluate(([la, lo]) => window.onverhard.kaart.latLngToContainerPoint([la, lo]), [lat, lon])
  const t0 = Date.now()
  await p.mouse.click(vak.x + pt.x, vak.y + pt.y, { button: 'right' })
  const item = p.locator('#kaartmenu .gebiedzoek')
  let gevonden = null
  try {
    await p.waitForFunction(() => { const b = document.querySelector('#kaartmenu .gebiedzoek'); return !b || !b.disabled }, null, { timeout: 30000 })
    if (await item.count()) gevonden = (await item.textContent()).replace('Rondjes in ', '')
  } catch {
    gevonden = 'TIJDSLIMIET'
  }
  const zoekMs = Date.now() - t0
  const r = { gebied: naam, gevonden, zoekMs }
  if (gevonden && gevonden !== 'TIJDSLIMIET') {
    await item.click()
    r.chip = await p.locator('#binnenNaam').textContent()
    const t1 = Date.now()
    await p.locator('#planKnop').click()
    await p.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
    r.planMs = Date.now() - t1
    r.fout = await p.locator('#fout').textContent()
    if (!r.fout) {
      const info = await p.evaluate(() => {
        const pl = window.onverhard.krijgPlan()
        return { km: pl.analyse.lengte / 1000, score: pl.score, binnen: window.onverhard.uitslag().opties.length }
      })
      Object.assign(r, info)
    }
  }
  r.paginafouten = fouten
  uit.push(r)
  console.log(JSON.stringify(r))
  await ctx.close()
}
await browser.close()
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(uit, null, 1))
