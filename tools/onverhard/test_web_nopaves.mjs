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

// ---- stationsmodus via de knoppen van de oude interface (?ui=oud) ----
{
  // een schone browser zonder bewaarde keuzes, zoals bij een nieuwe gebruiker
  const schoon = await browser.newContext(
    mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  const sk = await schoon.newPage()
  await sk.goto(`${basis}?ui=oud`) // de oude interface met het stappenplan
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

// ---- UX fase 1: welkom, teller, één betekenis van onverhard, zoeken in de buurt, sneltoetsen ----
{
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const nieuw = await browser.newContext({ ...opties, geolocation: { latitude: 52.0116, longitude: 4.3571 }, permissions: ['geolocation'] })
  const w = await nieuw.newPage()
  const wf = []
  w.on('pageerror', (e) => wf.push('PAGEERROR ' + e.message))
  w.on('dialog', (d) => { wf.push('DIALOOG ' + d.message()); d.dismiss() })
  await w.goto(`${basis}?ui=oud`) // welkom en sneltoetsen horen bij de oude interface
  assert.equal(await w.locator('#intro').count(), 0, 'geen introslides meer')
  assert.ok(await w.locator('#welkom').isVisible(), 'welkom op de lege kaart')
  assert.match(await w.locator('#welkom').textContent(), /Hardlooprondjes over onverhard\. Tik op de kaart waar je wilt starten, of:/)
  await w.locator('#welkomLocatie').click()
  await w.waitForFunction(() => document.querySelectorAll('#punten li').length === 1, null, { timeout: 15000 })
  assert.equal(await w.locator('[data-modus="rondje"]').getAttribute('aria-pressed'), 'true', 'Gebruik mijn locatie start een rondje')
  assert.ok(await w.locator('#welkom').isHidden(), 'welkom weg zodra er een start is')
  stap('welkom: één zin en "Gebruik mijn locatie" zet de start van een rondje')

  // zoeken: treffers in de buurt van de start bovenaan
  if (mobiel) await w.evaluate(() => window.onverhard.sheet.zet('vol'))
  await w.locator('#zoek').fill('Kerkstraat')
  await w.waitForSelector('#zoekresultaten:not([hidden]) button', { timeout: 15000 })
  const eerste = await w.locator('#zoekresultaten button').first().textContent()
  assert.match(eerste, /Delft/, `eerste treffer bij Delft: ${eerste}`)
  await w.locator('#zoek').fill('')
  stap(`zoeken met de start erbij: "Kerkstraat" → ${eerste}`)

  // sneltoetsen in de volgorde van het scherm: 3 = Naar station
  await w.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {})
  await w.evaluate(() => document.activeElement && document.activeElement.blur())
  await w.keyboard.press('3')
  assert.equal(await w.locator('[data-modus="station"]').getAttribute('aria-pressed'), 'true', 'toets 3 = Naar station')
  await w.keyboard.press('2')
  assert.equal(await w.locator('[data-modus="rondje"]').getAttribute('aria-pressed'), 'true', 'toets 2 = Rondje')
  stap('sneltoetsen 1–6 in de volgorde van het scherm')

  // plannen via de knoppen
  await w.evaluate(() => document.getElementById('naar3').click())
  await w.evaluate(() => document.getElementById('plan').click())
  await w.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  assert.equal(await w.locator('#fout').textContent(), '')
  await w.waitForTimeout(800)
  const ondergrond = /\d+% onverhard · \d+% half/
  assert.match(await w.locator('#kern .ondergrondtegel').textContent(), /\d+%onverhard · \d+% half/, 'tegel: onverhard en half apart')
  assert.match(await w.locator('#opties .kies small').first().textContent(), ondergrond, 'lijst: onverhard en half apart')
  assert.match(await w.locator('#kern .waarom').textContent(), /Waarom.*onverhard \+ half samen \d+% \(telt 75%\)/, 'waarom bij de score')
  if (mobiel) {
    const piek = await w.locator('#piekbalk .psamen').evaluate((e) => ({ tekst: e.textContent, past: [...e.children].every((c) => c.scrollWidth <= c.clientWidth + 1) }))
    assert.match(piek.tekst, ondergrond, 'piekbalk: onverhard en half apart')
    assert.ok(piek.past, `piekbalk zonder afkapping: ${piek.tekst}`)
  }
  stap('overal "x% onverhard · y% half", met waarom bij de score')

  // afspelen: de knop heet Afspeelsnelheid
  if (mobiel) await w.evaluate(() => window.onverhard.sheet.zet('vol'))
  await w.locator('#afspeel').click()
  assert.match(await w.locator('#afspeelsnelheid').textContent(), /Afspeelsnelheid/)
  await w.locator('#afspeel').click()
  stap('afspelen: "Afspeelsnelheid"')

  // opnieuw: kaartlagen-knoppen leeg
  assert.ok(await w.locator('.kaartlagen').isVisible(), 'kaartlagen bij het resultaat')
  await w.locator('#opnieuw').click()
  assert.ok(await w.locator('.kaartlagen').isHidden(), 'kaartlagen-knoppen weg na opnieuw')
  stap('opnieuw beginnen haalt de kaartlagen-knoppen weg')

  // mijn gebruik onder [?]
  await w.locator('#uitleg').click()
  await w.locator('#gebruik summary').click()
  const tabel = await w.locator('#gebruiktabel').textContent()
  for (const t of ['app geopend', 'plannen gestart', 'plannen klaar']) assert.ok(tabel.includes(t), `teller: ${t} in ${tabel}`)
  const log = await w.evaluate(() => JSON.parse(localStorage.getItem('nopaves.log')))
  const start = log.find((r) => r.ev === 'plan_start')
  assert.equal(start.d.start, 'gps', 'plan_start weet dat de start van gps kwam')
  assert.ok(log.find((r) => r.ev === 'plan_done').d.ms > 0)
  assert.equal(log.find((r) => r.ev === 'app_open').d.geo, 'granted')
  await w.locator('#gebruikKopieer').click()
  await w.locator('#gebruikWis').click()
  assert.match(await w.locator('#gebruiktabel').textContent(), /Nog niets geteld/)
  await w.locator('#hulpDicht').click()
  assert.deepEqual(wf, [], 'geen paginafouten of browservensters')
  stap(`mijn gebruik: ${log.length} regels geteld, kopiëren en wissen werken`)
  await nieuw.close()
}

// ---- UX fase 2: de plankaart, alles via de knoppen ----
{
  const NIEUW = basis // de nieuwe interface is de standaard
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const pc = await browser.newContext({ ...opties, geolocation: { latitude: 52.0116, longitude: 4.3571 }, permissions: ['geolocation'], acceptDownloads: true })
  const q = await pc.newPage()
  const qf = []
  q.on('pageerror', (e) => qf.push('PAGEERROR ' + e.message))
  q.on('dialog', (d) => { qf.push('BROWSERVENSTER ' + d.type() + ': ' + d.message()); d.dismiss() })
  let planVerzoeken = 0
  q.on('request', (r) => { if (/openfreemap.*\/14\/|brouter/.test(r.url())) planVerzoeken += 1 })
  await q.goto(NIEUW)
  await q.waitForFunction(() => /Mijn locatie/.test(document.getElementById('startregel').textContent), null, { timeout: 15000 })
  assert.ok(await q.locator('#plankaart').isVisible(), 'plankaart zichtbaar')
  assert.ok(await q.locator('#stapper').isHidden(), 'geen stappenbalk bij een rondje')
  assert.equal(await q.locator('.leaflet-marker-icon .punt').count(), 1, 'een zichtbare pin op je locatie')
  assert.equal(await q.locator('[data-soort="rondje"]').getAttribute('aria-pressed'), 'true')
  assert.equal((await q.locator('#planKnop').textContent()).trim(), 'Plan rondje')
  await q.waitForTimeout(2500)
  assert.ok(await q.locator('#resultaat').isHidden(), 'nooit automatisch plannen bij openen')
  assert.equal(planVerzoeken, 0, 'geen planverzoeken bij openen')
  if (mobiel) {
    const pk = await q.evaluate(() => ({ stand: window.onverhard.sheet.stand(), knop: document.getElementById('planKnop').getBoundingClientRect().bottom, h: innerHeight }))
    assert.equal(pk.stand, 'piek', 'de plankaart staat in de piek')
    assert.ok(pk.knop <= pk.h, `de hoofdknop is zichtbaar in de piek (${Math.round(pk.knop)} ≤ ${pk.h})`)
  }
  stap('plankaart: Mijn locatie (toestemming was er al) met pin, geen stappenbalk, niet automatisch gepland')

  // soort onthouden
  await q.locator('[data-soort="station"]').click()
  assert.equal((await q.locator('#planKnop').textContent()).trim(), 'Zoek routes naar stations')
  await q.reload()
  await q.waitForSelector('#plankaart:not([hidden])')
  assert.equal(await q.locator('[data-soort="station"]').getAttribute('aria-pressed'), 'true', 'laatste soort onthouden')
  await q.locator('[data-soort="route"]').click()
  assert.ok(await q.locator('#afstandregel').isHidden(), 'geen afstand bij A naar B')
  assert.equal((await q.locator('#planKnop').textContent()).trim(), 'Plan route')
  await q.locator('[data-soort="rondje"]').click()
  stap('segmentknop: Station en A naar B, laatste keuze onthouden')

  // afstand: stepper, snelkeuze, typen
  await q.locator('#kmPlus').click()
  const km1 = Number(await q.locator('#kmGetal').textContent())
  await q.locator('#snelkeuzes [data-km="15"]').click()
  assert.equal(await q.locator('#kmGetal').textContent(), '15')
  await q.locator('#kmMin').click()
  assert.equal(await q.locator('#kmGetal').textContent(), '14')
  await q.locator('#kmWaarde').click()
  await q.locator('#kmInvoer').fill('99')
  await q.locator('#kmInvoer').press('Enter')
  assert.equal(await q.locator('#kmGetal').textContent(), '60', 'hooguit 60 km')
  await q.locator('#kmWaarde').click()
  await q.locator('#kmInvoer').fill('8')
  await q.locator('#kmInvoer').press('Enter')
  assert.equal(await q.locator('#kmGetal').textContent(), '8')
  await q.reload()
  await q.waitForSelector('#plankaart:not([hidden])')
  assert.equal(await q.locator('#kmGetal').textContent(), '8', 'laatste afstand onthouden')
  stap(`afstand: + (${km1}), 15, −, typen 99 → 60, typen 8 en onthouden`)

  // voorkeuren op één plek
  await q.locator('#voorkeurregel').click()
  assert.ok(await q.locator('#voorkeuren').isVisible())
  for (const id of ['ondergrond', 'strand', 'kaartje', 'heuvels', 'vorm', 'law', 'grondig', 'themakeuze', 'tempoWaarde']) assert.ok(await q.locator(`#voorkeuren #${id}`).count(), `voorkeur ${id} in het venster`)
  if (await q.locator('#strand').isChecked()) await q.locator('#voorkeuren label:has(#strand)').click()
  await q.locator('#themakeuze [data-thema="donker"]').click()
  assert.equal(await q.evaluate(() => document.documentElement.dataset.theme), 'dark')
  await q.locator('#themakeuze [data-thema="licht"]').click()
  await q.locator('#tempoPlus').click()
  assert.match(await q.locator('#tempoWaarde').textContent(), /6:00/)
  await q.locator('#tempoPlus').click()
  assert.match(await q.locator('#tempoWaarde').textContent(), /6:05/)
  await q.locator('#tempoWaarde').click()
  assert.equal(await q.locator('#tempoInvoer').getAttribute('inputmode'), 'numeric', 'numeriek toetsenbord')
  await q.locator('#tempoInvoer').fill('')
  await q.locator('#tempoInvoer').pressSequentially('545')
  assert.equal(await q.locator('#tempoInvoer').inputValue(), '5:45', 'masker m:ss')
  await q.locator('#tempoInvoer').press('Enter')
  assert.match(await q.locator('#tempoWaarde').textContent(), /5:45/)
  await q.locator('#voorkeurenDicht').click()
  const regel = await q.locator('#voorkeurtekst').textContent()
  assert.ok(!/strand overslaan/.test(regel) && /5:45\/km/.test(regel), `voorkeurregel: ${regel}`)
  // strand weer aan (zoals de standaard)
  await q.locator('#voorkeurregel').click()
  await q.locator('#voorkeuren label:has(#strand)').click()
  await q.locator('#voorkeurenDicht').click()
  stap(`voorkeuren op één plek: ${regel}`)

  // plannen met de hoofdknop
  await q.locator('#planKnop').click()
  await q.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  assert.equal(await q.locator('#fout').textContent(), '')
  await q.waitForTimeout(800)
  assert.match(await q.locator('#tijdregel').textContent(), /^ca\. \d+ min \(5:45\/km, vlak\)$/, 'tijdsindicatie met tempo')
  assert.equal(await q.locator('#opties .toon').count(), 0, 'geen op-kaart-vinkjes')
  assert.ok(await q.locator('#details').evaluate((d) => !d.open), 'Details ingeklapt')
  if (mobiel) {
    assert.match(await q.locator('#piekbalk').textContent(), /\d+% onverhard · \d+% half/)
    assert.ok(await q.locator('#piekbalk [data-proxy="gpx"]').isVisible(), 'GPX in de piek')
  }
  const n = await q.locator('#opties .optie').count()
  if (mobiel) await q.evaluate(() => window.onverhard.sheet.zet('half'))
  if (n > 1) {
    await q.locator('#andereRoute').click()
    assert.equal(await q.evaluate(() => window.onverhard.krijgPlan().naam), 'B', 'Andere route kiest B')
    await q.locator('#andereRoute').click()
  }
  await q.locator('#details > summary').click()
  assert.ok(await q.locator('#tabs').isVisible(), 'Details open: ondergrond en hoogte')
  await q.locator('#details > summary').click()
  stap(`resultaat: tijd, ${n} routes compact, Andere route, Details ingeklapt`)

  // GPX zonder tijdstempels
  const [dl] = await Promise.all([q.waitForEvent('download'), q.locator('#gpx').click()])
  const gpxTekst = (await import('node:fs')).readFileSync(await dl.path(), 'utf8')
  assert.ok(!/<time>/.test(gpxTekst), 'GPX zonder tijden')
  stap('GPX zonder <time>')

  // bewaren zonder browservenster, naam wijzigen, verwijderen met ongedaan maken
  await q.locator('#bewaar').click()
  await q.waitForSelector('#toast:not([hidden])')
  assert.match(await q.locator('#toast').textContent(), /Bewaard: Rondje/)
  await q.locator('#toast button', { hasText: 'Naam wijzigen' }).click()
  await q.locator('#toast input').fill('Mijn testrondje')
  await q.locator('#toast button[type="submit"]').click()
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('onverhard.routes'))[0].naam), 'Mijn testrondje')
  await q.locator('#deel').click()
  await q.waitForTimeout(300)
  assert.ok(/Gekopieerd/.test(await q.locator('#deel').textContent()) || await q.locator('#toast .kopieervak').isVisible(), 'link gekopieerd of zichtbaar om te kopiëren')
  stap('Bewaar slaat direct op, Naam wijzigen in de melding, Link kopiëren zonder browservenster')

  // Nieuw: één knop
  assert.ok(await q.locator('#nieuwKnop').isVisible())
  assert.equal(await q.locator('#opnieuw').isVisible(), false, '↺ weg in de nieuwe interface')
  await q.locator('#nieuwKnop').click()
  assert.ok(await q.locator('#resultaat').isHidden(), 'Nieuw: resultaat weg')
  assert.ok(await q.locator('#terug').isVisible(), '↶ zichtbaar: er is iets ongedaan te maken')
  assert.equal(await q.locator('[data-soort="rondje"]').getAttribute('aria-pressed'), 'true', 'soort blijft')

  // Meer: mijn routes en verwijderen met ongedaan maken
  await q.locator('[data-soort="meer"]').click()
  await q.locator('[data-meer="mijn"]').click()
  assert.match(await q.locator('#mijnplek').textContent(), /Mijn testrondje/)
  await q.locator('#bewaardlijst li button.klein').first().click()
  assert.match(await q.locator('#toast').textContent(), /Verwijderd/)
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('onverhard.routes')).length), 0)
  await q.locator('#toast button', { hasText: 'Ongedaan maken' }).click()
  assert.equal(await q.evaluate(() => JSON.parse(localStorage.getItem('onverhard.routes'))[0].naam), 'Mijn testrondje', 'ongedaan maken zet hem terug')
  // Tekenen onder Meer houdt het eigen stappenplan
  await q.locator('[data-meer="tekenen"]').click()
  assert.ok(await q.locator('#stapper').isVisible(), 'Tekenen: eigen stappenplan')
  assert.ok(await q.locator('#tekenpaneel').isVisible())
  await q.locator('[data-soort="rondje"]').click()
  assert.ok(await q.locator('#stapper').isHidden())
  stap('Nieuw, ↶ alleen als er iets te herstellen is, Mijn routes en Tekenen onder Meer, verwijderen met Ongedaan maken')

  // A naar B: twee tikken op de kaart, dan de knop
  await q.locator('[data-soort="route"]').click()
  await q.evaluate(() => { const k = window.onverhard.kaart; k.fire('click', { latlng: L.latLng(52.0116, 4.3571) }) })
  await q.waitForTimeout(500)
  await q.evaluate(() => { const k = window.onverhard.kaart; k.fire('click', { latlng: L.latLng(52.0, 4.37) }) })
  assert.equal(await q.locator('#planKnop').isDisabled(), false, 'A naar B: met twee punten kun je plannen')
  assert.match(await q.locator('#startregel').textContent(), /Start:/)
  await q.locator('[data-soort="rondje"]').click()
  stap('A naar B: start en eind op de kaart, dan Plan route')

  // terugknop en sluitknop (telefoon)
  if (mobiel) {
    await q.evaluate(() => window.onverhard.sheet.zet('piek'))
    await q.waitForTimeout(400)
    await q.locator('#sheetgreep').click()
    await q.waitForTimeout(400)
    assert.equal(await q.evaluate(() => window.onverhard.sheet.stand()), 'half')
    await q.goBack()
    await q.waitForTimeout(400)
    assert.equal(await q.evaluate(() => window.onverhard.sheet.stand()), 'piek', 'Back verkleint eerst het paneel')
    assert.ok(q.url().includes('/onverhard/'), 'en blijft in de app')
    await q.evaluate(() => window.onverhard.sheet.zet('vol'))
    await q.waitForTimeout(400)
    assert.ok(await q.locator('#sluitSheet').isVisible(), 'sluitknop in de vol-stand')
    await q.locator('#sluitSheet').click()
    await q.waitForTimeout(400)
    assert.equal(await q.evaluate(() => window.onverhard.sheet.stand()), 'piek')
    stap('terugknop verkleint eerst het paneel; sluitknop in de vol-stand')
  }

  // station met tempo: aankomsttijd
  await q.locator('[data-soort="station"]').click()
  await q.locator('#snelkeuzes [data-km="10"]').click()
  await q.locator('#planKnop').click()
  await q.waitForFunction(() => !document.getElementById('resultaat').hidden || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  assert.equal(await q.locator('#fout').textContent(), '')
  assert.match(await q.locator('#tijdregel').textContent(), /aankomst ca\. \d\d:\d\d bij vertrek nu/)
  const nummers = await q.locator('#opties .letter').allTextContents()
  assert.equal(nummers[0], '1', `stations genummerd: ${nummers}`)
  // popup op de route: eerst één korte regel
  if (mobiel) await q.evaluate(() => window.onverhard.sheet.zet('piek'))
  await q.evaluate(() => { const l = []; window.onverhard.kaart.eachLayer((x) => x.getPopup && x.getPopup() && x instanceof L.Polyline && l.push(x)); l[0].openPopup() })
  await q.waitForSelector('.leaflet-popup-content')
  const pop = await q.locator('.leaflet-popup-content').evaluate((e) => ({ eerste: e.querySelector('b').textContent, techniek: !!e.querySelector('details.techniek:not([open])') }))
  assert.match(pop.eerste, /^[a-z ]+, .*\d+ m$/, `korte regel: ${pop.eerste}`)
  assert.ok(pop.techniek, 'techniek ingeklapt')
  stap(`station met tempo: ${await q.locator('#tijdregel').textContent()}; popup "${pop.eerste}"`)
  assert.deepEqual(qf, [], 'geen paginafouten of browservensters')
  await pc.close()
}

await browser.close()
console.log(`klaar (${soort})`)
