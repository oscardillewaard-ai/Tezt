// Playwright-test van de Nopav.es-onderdelen (score, laden, kaartlagen, ...), tegen de echte bronnen.
//
//   (cd public && python3 -m http.server 8765) &
//   CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/test_web_nopaves.mjs <map voor screenshots> [mobiel|desktop]
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import path from 'node:path'

const [map, soort = 'desktop'] = process.argv.slice(2)
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost' } : undefined
// WebGL zonder grafische kaart (SwiftShader), anders blijft de kaart de gewone OpenStreetMap
const browser = await chromium.launch({ proxy, executablePath: process.env.CHROMIUM_PAD || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
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

// ---- de kaart zelf: Korrel (vectortegels), met de bronvermelding ----
await page.goto(`${basis}#p=52.0116,4.3571&rondje=10`)
await page.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
assert.equal(await page.locator('.maplibregl-canvas').count(), 1, 'de Korrel-kaart (WebGL) staat aan')
assert.match(await page.locator('.leaflet-control-attribution').textContent(), /OpenFreeMap/, 'bronvermelding van OpenFreeMap')
const basis_lagen = await page.evaluate(() => [...document.querySelectorAll('.leaflet-control-layers-base label')].map((l) => l.textContent.trim()))
assert.deepEqual(basis_lagen, ['Korrel', 'OpenStreetMap', 'Luchtfoto (PDOK)'], 'Korrel staat bovenaan, de oude kaarten blijven kiesbaar')
stap('kaart in Korrel (MapLibre), met OpenStreetMap en luchtfoto als alternatief')

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

// ---- groene omwegen ----
{
  // een rondje bij Rijswijk Buiten: lange verharde stukken met een onverhard alternatief ernaast
  const og = await ctx.newPage()
  await og.goto(`${basis}#p=52.04,4.32&rondje=10&plan=1`)
  await og.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  await og.waitForTimeout(2000)
  const meet = () => og.evaluate(() => {
    const p = window.onverhard.krijgPlan()
    const o = p.opties[0]
    return { score: o.score, zacht: o.zacht, dubbel: o.dubbel, km: o.km, aantal: p.opties.length }
  })
  const klik = (id) => og.evaluate((i) => document.getElementById(i).click(), id)
  const voor = await meet()
  assert.equal(await og.locator('#omwegen').isHidden(), false, 'knop Groene omwegen staat bij het resultaat')
  await klik('omwegen')
  await og.waitForTimeout(500)
  const chips = await og.locator('.omwegchip').allTextContents()
  console.log(`  omwegen op ${voor.km.toFixed(1)} km, score ${voor.score}, ${(100 * voor.zacht).toFixed(0)}% onverhard: ${chips.length ? chips.join(' | ') : 'geen'}`)
  await og.screenshot({ path: path.join(map, `nopaves_omwegen_${soort}.png`) })
  assert.ok(chips.length >= 1, 'bij Rijswijk Buiten is een groene omweg te vinden')
  {
    assert.ok(chips.every((c) => /[+−][\d,]+ km · ≈ [+−]\d+ punten/.test(c)), `chips: ${chips}`)
    assert.equal(await og.locator('#omwegen').getAttribute('aria-pressed'), 'true')
    await og.locator('.omwegchip').first().click({ force: true })
    await og.waitForFunction((s) => window.onverhard.krijgPlan().opties[0].km !== s, voor.km, { timeout: 60000 })
    await og.waitForTimeout(1500)
    const na = await meet()
    assert.ok(na.zacht > voor.zacht, `onverhard-% omhoog: ${(100 * voor.zacht).toFixed(1)} → ${(100 * na.zacht).toFixed(1)}`)
    assert.ok(na.score >= voor.score, `score ${voor.score} → ${na.score}`)
    assert.ok(na.dubbel <= 0.1, `dubbel gelopen blijft laag: ${voor.dubbel.toFixed(3)} → ${na.dubbel.toFixed(3)}`)
    stap(`omweg toegepast: score ${voor.score} → ${na.score}, onverhard ${(100 * voor.zacht).toFixed(0)}% → ${(100 * na.zacht).toFixed(0)}%, ${voor.km.toFixed(1)} → ${na.km.toFixed(1)} km, dubbel ${(100 * na.dubbel).toFixed(1)}%`)
    await og.evaluate(() => document.getElementById('terug').click())
    await og.waitForFunction((s) => window.onverhard.krijgPlan().opties[0].km === s, voor.km, { timeout: 10000 })
    assert.equal((await meet()).score, voor.score, '↶ haalt de omweg weg')
    stap('↶ maakt de omweg ongedaan')
  }
  // Esc zet de modus uit
  await og.keyboard.press('Escape')
  await og.waitForTimeout(300)
  assert.equal(await og.locator('.omwegchip').count(), 0, 'Esc: chips weg')
  assert.equal(await og.locator('#omwegen').getAttribute('aria-pressed'), 'false')
}

// ---- bottom sheet (alleen telefoon) ----
if (mobiel) {
  const info = () => page.evaluate(() => {
    const m = document.getElementById('paneel').getBoundingClientRect()
    const k = document.getElementById('kaart').getBoundingClientRect()
    return { stand: window.onverhard.sheet.stand(), paneel: Math.round(m.height), kaart: Math.round(k.height), kaartBreed: Math.round(k.width), venster: innerHeight, scrollY, breedte: document.documentElement.scrollWidth }
  })
  let i = await info()
  assert.equal(i.stand, 'piek', 'na het plannen staat het paneel op piek')
  assert.equal(i.kaart, i.venster, 'de kaart is schermvullend')
  assert.ok(i.paneel < 200, `piek is laag (${i.paneel}px)`)
  assert.equal(i.breedte, 390, 'geen horizontaal scrollen')
  assert.equal(await page.locator('#piekbalk .pscore').textContent(), String(score), 'piekbalk toont de score')
  assert.ok(await page.locator('#piekbalk [data-proxy="gpx"]').isVisible(), 'knoppen op piek')
  await page.screenshot({ path: path.join(map, 'nopaves_sheet_piek.png') })
  const standen = [i.paneel]
  // invalidateSize wordt aangeroepen als de stand verandert
  await page.evaluate(() => {
    window.__invalidate = 0
    const orig = window.onverhard.kaart.invalidateSize.bind(window.onverhard.kaart)
    window.onverhard.kaart.invalidateSize = (...a) => { window.__invalidate += 1; return orig(...a) }
  })
  for (const verwacht of ['half', 'vol', 'piek']) {
    await page.locator('#sheetgreep').click()
    await page.waitForTimeout(450)
    i = await info()
    assert.equal(i.stand, verwacht, `tik op het handvat → ${verwacht}`)
    assert.equal(i.kaart, i.venster, `kaart blijft schermvullend op ${verwacht}`)
    standen.push(i.paneel)
    await page.screenshot({ path: path.join(map, `nopaves_sheet_${verwacht}.png`) })
  }
  assert.ok(standen[1] > standen[0] && standen[2] > standen[1] && standen[3] === standen[0], `hoogtes ${standen}`)
  assert.ok((await page.evaluate(() => window.__invalidate)) >= 3, 'invalidateSize bij elke standwissel')
  // slepen aan het handvat: omhoog veegt naar half
  const g = await page.locator('#sheetgreep').boundingBox()
  await page.mouse.move(g.x + g.width / 2, g.y + 10)
  await page.mouse.down()
  for (let s = 1; s <= 8; s++) await page.mouse.move(g.x + g.width / 2, g.y + 10 - s * 40, { steps: 2 })
  await page.mouse.up()
  await page.waitForTimeout(450)
  assert.notEqual((await info()).stand, 'piek', 'omhoog slepen opent het paneel')
  // de piekbalk-knoppen werken door naar de echte knoppen
  await page.evaluate(() => window.onverhard.sheet.zet('piek'))
  stap(`bottom sheet: standen ${standen.join(' < ')} px, kaart schermvullend, na het plannen op piek`)
}

assert.deepEqual(fouten.filter((f) => !/Failed to load resource/.test(f)), [], 'geen consolefouten')
// ---- stationsmodus: routes van Delft naar stations, en 'Route hierheen' op een ander station ----
{
  const sp = await ctx.newPage()
  const sf = []
  sp.on('pageerror', (e) => sf.push('PAGEERROR ' + e.message))
  let tegels12 = 0
  let tegels14 = 0
  sp.on('request', (r) => {
    if (/openfreemap|tiles\.openfreemap/.test(r.url())) {
      if (/\/12\/\d+\/\d+/.test(r.url())) tegels12 += 1
      else if (/\/14\/\d+\/\d+/.test(r.url())) tegels14 += 1
    }
  })
  const t0 = Date.now()
  await sp.goto(`${basis}#p=52.0116,4.3571&station=15&plan=1`)
  await sp.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  const sec = Math.round((Date.now() - t0) / 1000)
  assert.equal(await sp.locator('#fout').textContent(), '', 'stationsmodus: geen foutmelding')
  await sp.waitForLoadState('networkidle').catch(() => {})
  await sp.waitForTimeout(1000)
  const titels = await sp.locator('#opties .kies > span:nth-child(2) > b:first-child').allTextContents()
  assert.ok(titels.length >= 2 && titels.length <= 4, `2-4 routes naar stations (${titels.length})`)
  assert.ok(titels.every((t) => t.startsWith('→')), `elke route heeft een station: ${titels.join(' | ')}`)
  const namen = await sp.evaluate(() => window.onverhard.krijgPlan().opties.map((o) => o.station))
  assert.equal(new Set(namen).size, namen.length, 'verschillende stations')
  const km = await sp.evaluate(() => window.onverhard.krijgPlan().opties.map((o) => o.km))
  assert.ok(km.every((k) => k <= 15 * 1.3 + 0.01), `alle routes ≤ 1,3 × 15 km: ${km.map((k) => k.toFixed(1))}`)
  const stationsInfo = await sp.evaluate(() => window.onverhard.uitslag().stations.map((s) => ({ naam: s.naam, km: s.km })))
  assert.ok(stationsInfo.length >= namen.length)
  const laag = sp.locator('.kaartlagen button[aria-label^="Stations"]')
  assert.equal(await laag.count(), 1, '🚉 in de kaartlagen-knop')
  assert.equal(await sp.locator('.stationico').count(), stationsInfo.length, 'een 🚉 per kandidaat-station')
  await laag.click()
  assert.equal(await sp.locator('.stationico').count(), 0, '🚉-laag uit')
  await laag.click()
  // een station zonder route in de lijst: tik, 'Route hierheen'
  const extra = stationsInfo.find((s) => !namen.includes(s.naam))
  if (extra) {
    const marker = sp.locator('.stationico').nth(stationsInfo.findIndex((s) => s.naam === extra.naam))
    await marker.click({ force: true })
    await sp.locator('.leaflet-popup button', { hasText: 'Route hierheen' }).click()
    await sp.waitForFunction((n) => document.querySelectorAll('#opties .optie').length > n, titels.length, { timeout: 120000 })
    const na = await sp.locator('#opties .kies > span:nth-child(2) > b:first-child').allTextContents()
    assert.ok(na.some((t) => t.includes(extra.naam)), `route naar ${extra.naam} erbij`)
    // ↶ haalt hem weer weg
    await sp.locator('#terug').click()
    await sp.waitForFunction((n) => document.querySelectorAll('#opties .optie').length === n, titels.length, { timeout: 10000 })
    stap(`'Route hierheen' naar ${extra.naam} voegt een route toe; ↶ haalt hem weer weg`)
  }
  // GPX-naam
  const [download] = await Promise.all([sp.waitForEvent('download'), sp.locator('#gpx').click()])
  assert.match(download.suggestedFilename(), /^Nopav\.es-.*\.gpx$/)
  const gpx = (await import('node:fs')).readFileSync(await download.path(), 'utf8')
  assert.match(gpx, /<name>Nopav\.es → /)
  assert.deepEqual(sf, [], 'geen paginafouten')
  stap(`stationsmodus: ${titels.length} routes (${namen.join(', ')}) in ${sec} s, ${tegels12} tegels z12, ${tegels14} tegels z14, stations: ${stationsInfo.map((s) => s.naam).join(', ')}`)
  await sp.screenshot({ path: path.join(map, `nopaves_station_${soort}.png`) })
}

// ---- stationsmodus via de knoppen (zoals je hem zelf gebruikt, niet via een link) ----
{
  // een schone browser zonder bewaarde keuzes, zoals bij een nieuwe gebruiker
  const schoon = await browser.newContext(
    mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  const sk = await schoon.newPage()
  await sk.goto(basis)
  await sk.evaluate(() => localStorage.setItem('onverhard.intro', '1'))
  await sk.goto(basis)
  await sk.click('[data-modus="station"]')
  assert.equal(await sk.locator('#naar3').isDisabled(), true, 'zonder startpunt kun je nog niet verder')
  await sk.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0116, 4.3571) }))
  assert.equal(await sk.locator('#naar3').isDisabled(), false, 'met één startpunt kun je verder (geen eindpunt nodig)')
  await sk.evaluate(() => document.getElementById('naar3').click())
  assert.equal(await sk.locator('#kmveld').isVisible(), true, 'de lengte kies je in stap 3')
  assert.equal(await sk.locator('#plan').isDisabled(), false)
  assert.match(await sk.locator('#plan').textContent(), /stations/)
  await schoon.close()
  stap('stationsmodus via de knoppen: één startpunt, Verder, lengte, plannen')
}

// ---- lokale teller "Mijn gebruik": alles via de knoppen, en er gaat niets het netwerk op ----
{
  const schoon = await browser.newContext(
    mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  const tp = await schoon.newPage()
  const verzonden = []
  tp.on('request', (r) => {
    const tekst = r.url() + (r.postData() || '')
    if (/plan_start|nopaves\.log|app_open/.test(tekst)) verzonden.push(r.url())
  })
  await tp.goto(basis)
  await tp.evaluate(() => localStorage.setItem('onverhard.intro', '1'))
  await tp.goto(basis)
  await tp.waitForSelector('.maplibregl-canvas', { timeout: 20000 })
  await tp.click('[data-modus="rondje"]')
  // een echte tik op de kaart (Delft), niet via een link
  await tp.evaluate(() => window.onverhard.kaart.setView([52.0116, 4.3571], 14))
  await tp.waitForTimeout(400)
  const k = await tp.locator('#kaart').boundingBox()
  await tp.mouse.click(k.x + k.width / 2, k.y + (mobiel ? k.height * 0.3 : k.height / 2))
  await tp.waitForTimeout(500)
  await tp.locator('#naar3').click()
  await tp.locator('#km').fill('5')
  await tp.locator('#km').dispatchEvent('change')
  await tp.locator('#plan').click()
  await tp.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  const log = await tp.evaluate(() => JSON.parse(localStorage.getItem('nopaves.log') || '[]'))
  const ev = log.map((r) => r.ev)
  assert.ok(ev.includes('app_open'), `app_open geteld: ${ev}`)
  const open = log.find((r) => r.ev === 'app_open').d
  assert.ok(['browser', 'standalone'].includes(open.weergave) && typeof open.locatie === 'string', `app_open: ${JSON.stringify(open)}`)
  assert.ok(ev.includes('km_change'), 'km_change geteld')
  const start = log.find((r) => r.ev === 'plan_start').d
  assert.equal(start.soort, 'rondje')
  assert.equal(start.km, 5)
  assert.equal(start.start, 'tik')
  assert.match(start.voorkeuren, /^P.\|S.\|T.\|H.\|L[\d.]+\|R\d\|V.$/)
  const klaar = log.find((r) => r.ev === 'plan_done').d
  assert.equal(typeof klaar.ok, 'boolean')
  assert.ok(klaar.ms > 0)
  // GPX en de tab Ondergrond tellen mee
  if (klaar.ok) {
    if (mobiel) await tp.evaluate(() => window.onverhard.sheet.zet('vol'))
    await tp.locator('#tabs [data-tab="ondergrond"]').click()
    await Promise.all([tp.waitForEvent('download'), tp.locator('#gpx').click()])
  }
  // [?] → Mijn gebruik
  if (mobiel) await tp.evaluate(() => window.onverhard.sheet.zet('piek'))
  await tp.locator('#uitleg').click()
  await tp.waitForSelector('#hulp[open]')
  const overzicht = await tp.locator('#gebruik').textContent()
  assert.match(overzicht, /Rondje 1×/, overzicht)
  assert.match(overzicht, /tik 1×/)
  assert.match(overzicht, /5 km 1×/)
  if (klaar.ok) assert.match(overzicht, /Geopend: tab ondergrond 1×/)
  await tp.locator('#gebruik').scrollIntoViewIfNeeded()
  await tp.screenshot({ path: path.join(map, `nopaves_gebruik_${soort}.png`) })
  // Kopieer als JSON: klembord, of (zonder klembord) een vak om zelf te kopiëren
  await schoon.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(basis).origin }).catch(() => {})
  await tp.locator('#gebruikKopieer').click()
  await tp.waitForTimeout(300)
  const json = (await tp.locator('#gebruikJson').isVisible())
    ? await tp.locator('#gebruikJson').inputValue()
    : await tp.evaluate(() => navigator.clipboard.readText())
  assert.equal(JSON.parse(json).length, (await tp.evaluate(() => JSON.parse(localStorage.getItem('nopaves.log')).length)), 'de JSON is het hele logboek')
  // Wis: twee keer tikken
  await tp.locator('#gebruikWis').click()
  assert.match(await tp.locator('#gebruikWis').textContent(), /Zeker/)
  assert.notEqual(await tp.evaluate(() => localStorage.getItem('nopaves.log')), null, 'één tik wist nog niets')
  await tp.locator('#gebruikWis').click()
  assert.equal(await tp.evaluate(() => localStorage.getItem('nopaves.log')), null, 'twee tikken wissen het logboek')
  assert.match(await tp.locator('#gebruik').textContent(), /Nog niets geteld/)
  assert.deepEqual(verzonden, [], 'geen teller-gegevens in netwerkverzoeken')
  await schoon.close()
  stap(`teller: ${ev.length} gebeurtenissen (${[...new Set(ev)].join(', ')}), Mijn gebruik, Kopieer als JSON, Wis; niets verstuurd`)
}

await browser.close()
console.log(`klaar (${soort})`)
