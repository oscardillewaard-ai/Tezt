// Playwright-test van de Nopav.es-onderdelen (score, laden, kaartlagen, ...), tegen de echte bronnen.
//
//   (cd public && python3 -m http.server 8765) &
//   CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/test_web_nopaves.mjs <map voor screenshots> [mobiel|desktop]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import path from 'node:path'

const [map, soort = 'desktop'] = process.argv.slice(2)
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined })
const mobiel = soort === 'mobiel'
const ctx = await browser.newContext(
  mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const fouten = []
page.on('console', (m) => m.type() === 'error' && fouten.push(m.text()))
page.on('pageerror', (e) => fouten.push('PAGEERROR ' + e.message))
const basis = process.env.ONVERHARD_URL || 'http://localhost:8765/onverhard/'
const stap = (tekst) => console.log(`✓ ${soort}: ${tekst}`)

// ---- laden: geen zichtbare tekst, wel een poppetje op de balk ----
await page.goto(`${basis}#p=52.0116,4.3571&rondje=10&plan=1`)
await page.waitForSelector('#bezig:not([hidden])', { timeout: 20000 })
const zichtbaar = await page.evaluate(() => {
  const s = document.getElementById('status')
  const r = s.getBoundingClientRect()
  return { breedte: r.width, hoogte: r.height, tekst: s.textContent, live: s.getAttribute('aria-live') }
})
assert.ok(zichtbaar.breedte <= 1 && zichtbaar.hoogte <= 1, 'statustekst is visueel verborgen')
assert.equal(zichtbaar.live, 'polite')
assert.ok(await page.locator('#bezig .looppop').isVisible(), 'poppetje zichtbaar tijdens het laden')
assert.ok(await page.locator('#stop').isVisible(), 'stopknop zichtbaar')
await page.waitForTimeout(600)
await page.screenshot({ path: path.join(map, `nopaves_laden_${soort}.png`) })
stap('geen zichtbare tekst tijdens het laden; poppetje en Stop staan er')

await page.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
assert.equal(await page.locator('#fout').textContent(), '', 'geen foutmelding')
await page.waitForLoadState('networkidle').catch(() => {})
await page.waitForTimeout(1500)

// ---- score ----
const score = Number(await page.locator('#kern .score b').textContent())
assert.ok(score >= 0 && score <= 100, `score ${score}`)
const badges = await page.locator('#opties .badge').allTextContents()
assert.ok(badges.length >= 1)
assert.equal(Number(badges[0]), score, 'de badge van de gekozen route is de score in de tegel')
const scores = badges.map(Number)
assert.ok(scores.every((s, i) => i === 0 || s <= scores[0] + 8), 'aanbevolen route heeft (ongeveer) de hoogste score')
stap(`score ${score} in de tegel en op de routekaart (${badges.join(', ')})`)

// ---- kaartlagen op de kaart, geen Water-tab meer ----
assert.equal(await page.locator('#tabs button').count(), 2, 'tabs: Hoogte en Ondergrond')
assert.equal(await page.locator('#waterlijst').count(), 0, 'geen waterlijst meer in het paneel')
const lagen = page.locator('.kaartlagen button')
assert.ok((await lagen.count()) >= 1, 'kaartlagen-knop heeft knoppen')
const waterMarkers = () => page.locator('.waterico').count()
const voor = await waterMarkers()
const eerste = lagen.first()
const aan = (await eerste.getAttribute('aria-pressed')) === 'true'
await eerste.click()
assert.equal((await eerste.getAttribute('aria-pressed')) === 'true', !aan, 'een tik wisselt de laag')
assert.notEqual(await waterMarkers(), voor, 'markers op de kaart volgen de knop')
await eerste.click()
assert.equal(await waterMarkers(), voor, 'terug aan/uit')
stap(`kaartlagen-knop: ${await lagen.count()} lagen; markers ${voor} → wisselt mee`)
const waterregel = await page.locator('#waterregel').textContent()
assert.match(waterregel, /Langste stuk zonder water/)
await page.screenshot({ path: path.join(map, `nopaves_resultaat_${soort}.png`) })

assert.deepEqual(fouten.filter((f) => !/Failed to load resource/.test(f)), [], 'geen consolefouten')
await browser.close()
console.log(`klaar (${soort})`)
