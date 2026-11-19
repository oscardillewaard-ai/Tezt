// Schermafbeeldingen voor docs/ux-voortgang: 390 × 844, licht en donker.
//   node tools/onverhard/screens_ux.mjs <label> [extra query, bv. ui=nieuw]
// Toestanden: leeg (nieuwe gebruiker), rondje gepland (piek en half).
import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'

const [label, query = ''] = process.argv.slice(2)
const map = path.resolve('docs/ux-voortgang')
fs.mkdirSync(map, { recursive: true })
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const basis = (process.env.ONVERHARD_URL || 'http://localhost:8765/onverhard/') + (query ? `?${query}` : '')
for (const thema of ['licht', 'donker']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: thema === 'donker' ? 'dark' : 'light' })
  const page = await ctx.newPage()
  await page.goto(basis)
  await page.evaluate((t) => { localStorage.setItem('onverhard.intro', '1'); localStorage.setItem('onverhard.thema', t) }, thema)
  await page.goto(basis)
  await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: path.join(map, `${label}_leeg_${thema}.png`) })
  await page.goto(`${basis}#p=52.0116,4.3571&rondje=10&plan=1`)
  await page.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  await page.waitForTimeout(3000)
  await page.screenshot({ path: path.join(map, `${label}_resultaat-piek_${thema}.png`) })
  await page.evaluate(() => window.onverhard.sheet.zet('half'))
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(map, `${label}_resultaat-half_${thema}.png`) })
  await page.evaluate(() => window.onverhard.sheet.zet('vol'))
  await page.waitForTimeout(600)
  await page.screenshot({ path: path.join(map, `${label}_resultaat-vol_${thema}.png`) })
  await ctx.close()
  console.log('klaar', thema)
}
await browser.close()
