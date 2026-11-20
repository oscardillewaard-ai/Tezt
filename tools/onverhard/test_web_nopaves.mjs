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

await page.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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
  await og.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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
  await sp.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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
  await w.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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
  q.on('request', (r) => { if (/brouter/.test(r.url())) planVerzoeken += 1 }) // tegels vooraf ophalen (stap 2) is geen plannen
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
  assert.ok(!(await q.evaluate(() => (JSON.parse(localStorage.getItem('nopaves.log') || '[]')).some((r) => r.ev === 'plan_start'))), 'niet gepland bij openen')
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
  await q.locator('#snelkeuzes [data-waarde="15"]').click()
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
  await q.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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
  await q.locator('#snelkeuzes [data-waarde="10"]').click()
  await q.locator('#planKnop').click()
  await q.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
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

// ---- UX fase 3: minuten en gebieden ----
{
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const c3 = await browser.newContext(opties)
  const m = await c3.newPage()
  const mf = []
  m.on('pageerror', (e) => mf.push('PAGEERROR ' + e.message))
  m.on('dialog', (d) => { mf.push('BROWSERVENSTER ' + d.message()); d.dismiss() })
  await m.goto(basis)
  await m.locator('[data-soort="rondje"]').click()
  assert.ok(await m.locator('#kmEenheid').isDisabled(), 'zonder tempo geen minuten')
  await m.locator('#voorkeurregel').click()
  await m.locator('#tempoWaarde').click()
  await m.locator('#tempoInvoer').pressSequentially('600')
  await m.locator('#tempoInvoer').press('Enter')
  await m.locator('#voorkeurenDicht').click()
  await m.locator('#kmEenheid').click()
  assert.equal(await m.locator('#kmEenheid').textContent(), 'min')
  await m.locator('#snelkeuzes [data-waarde="60"]').click()
  assert.equal(await m.locator('#afstandnoot').textContent(), '60 min ≈ 10,0 km', 'toon beide')
  await m.locator('#kmPlus').click()
  assert.equal(await m.locator('#afstandnoot').textContent(), '65 min ≈ 10,8 km')
  assert.equal(await m.evaluate(() => JSON.parse(localStorage.getItem('onverhard.v1')).km), 10.8, 'de planner krijgt km = minuten ÷ tempo')
  await m.locator('#kmEenheid').click()
  assert.equal(await m.locator('#kmEenheid').textContent(), 'km')
  assert.match(await m.locator('#afstandnoot').textContent(), /^11 km ≈ 66 min$/)
  stap('afstand in minuten (met tempo 6:00): 60 min ≈ 10,0 km, +5 min, terug naar km')

  // lang drukken in Meijendel: Rondjes in Meijendel & Berkheide
  await m.evaluate(() => window.onverhard.kaart.setView([52.13, 4.35], 14, { animate: false }))
  await m.waitForTimeout(300)
  if (mobiel) {
    await m.evaluate(() => {
      const k = window.onverhard.kaart
      const pt = k.latLngToContainerPoint([52.13, 4.35])
      k.fire('contextmenu', { latlng: L.latLng(52.13, 4.35), originalEvent: { clientX: pt.x, clientY: pt.y, preventDefault() {} } })
    })
  } else {
    const vak = await m.locator('#kaart').boundingBox()
    const pt = await m.evaluate(() => window.onverhard.kaart.latLngToContainerPoint([52.13, 4.35]))
    await m.mouse.click(vak.x + pt.x, vak.y + pt.y, { button: 'right' })
  }
  const item = m.locator('#kaartmenu .gebiedzoek:not([disabled])')
  await item.waitFor({ timeout: 30000 })
  assert.equal(await item.textContent(), 'Rondjes in Meijendel & Berkheide')
  await item.click()
  assert.ok(await m.locator('#binnenchip').isVisible(), 'chip Binnen')
  assert.equal(await m.locator('#binnenNaam').textContent(), 'Meijendel & Berkheide')
  assert.match(await m.locator('#startregel').textContent(), /Start: in Meijendel/)
  await m.locator('#kmEenheid').click() // weer minuten: 60 min = 10 km
  await m.locator('#snelkeuzes [data-waarde="60"]').click()
  await m.locator('#planKnop').click()
  await m.waitForFunction(() => (!document.getElementById('resultaat').hidden && !(window.onverhard.bezig && window.onverhard.bezig())) || !document.getElementById('fout').hidden, null, { timeout: 300000 })
  assert.equal(await m.locator('#fout').textContent(), '')
  // de route blijft binnen het gebied (met de marge die In gebied ook toestaat)
  const binnenDeel = await m.evaluate(() => {
    const ring = window.onverhard.binnen().ring
    const coords = window.onverhard.krijgPlan().traject.coords
    const pip = ([x, y]) => {
      let b = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [yi, xi] = ring[i]
        const [yj, xj] = ring[j]
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) b = !b
      }
      return b
    }
    return coords.filter(pip).length / coords.length
  })
  assert.ok(binnenDeel >= 0.9, `de route ligt (bijna) helemaal in het gebied: ${(100 * binnenDeel).toFixed(0)}%`)
  await m.locator('#binnenWeg').click()
  assert.ok(await m.locator('#binnenchip').isHidden(), '[x] haalt het gebied weg')
  // geen beschermd gebied: geen menu-item
  await m.evaluate(() => window.onverhard.kaart.setView([52.017, 4.383], 15, { animate: false }))
  await m.waitForTimeout(300)
  await m.evaluate(() => {
    const k = window.onverhard.kaart
    const pt = k.latLngToContainerPoint([52.017, 4.383])
    k.fire('contextmenu', { latlng: L.latLng(52.017, 4.383), originalEvent: { clientX: pt.x, clientY: pt.y, preventDefault() {} } })
  })
  await m.waitForFunction(() => !document.querySelector('#kaartmenu .gebiedzoek'), null, { timeout: 30000 })
  assert.deepEqual(mf, [])
  stap('lang drukken in Meijendel: "Rondjes in Meijendel & Berkheide", chip, plannen binnen het gebied; Delftse Hout: geen menu-item')
  await c3.close()
}

// ---- Snelheid: cache, vooraf ophalen, tussenresultaat, worker met echte Stop ----
{
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const cs = await browser.newContext(opties)
  const v = await cs.newPage()
  const vf = []
  v.on('pageerror', (e) => vf.push('PAGEERROR ' + e.message))
  await v.goto(basis)
  await v.locator('[data-soort="rondje"]').click()
  await v.locator('#snelkeuzes [data-waarde="10"]').click()
  // stap 2: een start tikken haalt de tegels alvast op
  await v.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0116, 4.3571) }))
  await v.waitForFunction(() => window.onverhard.vooraf && window.onverhard.vooraf.klaar, null, { timeout: 120000 })
  const vooraf = await v.evaluate(() => window.onverhard.vooraf)
  const inCache = () => v.evaluate(async () => (await (await caches.open('nopaves-data-v1')).keys()).length)
  const n0 = await inCache()
  assert.ok(vooraf.tegels > 10 && n0 >= vooraf.tegels, `vooraf opgehaald: ${vooraf.tegels} tegels in ${vooraf.ms} ms, ${n0} in de cache`)
  stap(`vooraf ophalen na het tikken van de start: ${vooraf.tegels} tegels in ${(vooraf.ms / 1000).toFixed(1)} s`)

  // stap 3: route A meteen (voorlopig), de rest daarna
  let gezien = { voorlopig: false, laad: false }
  await v.locator('#planKnop').click()
  const t0 = Date.now()
  while (Date.now() - t0 < 300000) {
    const s = await v.evaluate(() => ({ res: !document.getElementById('resultaat').hidden, laad: !!document.getElementById('laadregel'), vl: !!document.querySelector('#kern i.voorlopig'), bezig: window.onverhard.bezig(), fout: document.getElementById('fout').textContent }))
    if (s.res && s.laad) gezien.laad = true
    if (s.res && s.vl) gezien.voorlopig = true
    if ((s.res && !s.bezig) || s.fout) break
    await v.waitForTimeout(40)
  }
  assert.equal(await v.locator('#fout').textContent(), '')
  assert.ok(gezien.laad && gezien.voorlopig, `eerst voorlopig met een laadregel: ${JSON.stringify(gezien)}`)
  assert.equal(await v.locator('#laadregel').count(), 0, 'na afloop geen laadregel meer')
  assert.equal(await v.locator('#kern i.voorlopig').count(), 0, 'na de officiële kaart niet meer voorlopig')
  const ms = await v.evaluate(() => ({ eerste: window.onverhard.eersteMs(), totaal: window.onverhard.meting.rapport().totaal }))
  assert.ok(ms.eerste < ms.totaal, `eerst iets te zien (${ms.eerste} ms), daarna alles (${ms.totaal} ms)`)
  stap(`tussenresultaat: route A na ${(ms.eerste / 1000).toFixed(1)} s (voorlopig, met "Nog bezig"), alles na ${(ms.totaal / 1000).toFixed(1)} s`)

  // stap 1: tegels, BGT en AHN staan in de cache
  const soorten = await v.evaluate(async () => {
    const k = await (await caches.open('nopaves-data-v1')).keys()
    return { tegels: k.filter((r) => r.url.includes('openfreemap')).length, bgt: k.filter((r) => r.url.includes('/bgt/')).length, ahn: k.filter((r) => r.url.includes('/ahn/')).length }
  })
  assert.ok(soorten.tegels > 0 && soorten.bgt > 0 && soorten.ahn > 0, `cache: ${JSON.stringify(soorten)}`)
  stap(`cache: ${soorten.tegels} kaarttegels, ${soorten.bgt} BGT-tegels, ${soorten.ahn} AHN-blokken`)

  // stap 4: rekenen in een worker; Stop breekt echt af
  const werkerGeladen = await v.evaluate(() => performance.getEntriesByType('resource').some((e) => e.name.includes('rekenwerker.js')))
  assert.ok(werkerGeladen, 'de rekenwerker is gestart')
  await v.locator('[data-soort="station"]').click()
  await v.locator('#snelkeuzes [data-waarde="20"]').click()
  await v.locator('#planKnop').click()
  await v.waitForTimeout(1500)
  if (mobiel) await v.locator('#piekbalk [data-proxy="stop"]').click()
  else await v.locator('#stop').click()
  const tStop = Date.now()
  await v.waitForFunction(() => !window.onverhard.bezig(), null, { timeout: 5000 })
  assert.ok(Date.now() - tStop < 3000, 'Stop werkt meteen')
  assert.match(await v.locator('#fout').textContent(), /Gestopt/)
  // daarna gewoon weer plannen (een nieuwe worker)
  await v.locator('[data-soort="rondje"]').click()
  await v.locator('#planKnop').click()
  await v.waitForFunction(() => (!document.getElementById('resultaat').hidden && !window.onverhard.bezig()) || (document.getElementById('fout').textContent && !/Gestopt/.test(document.getElementById('fout').textContent)), null, { timeout: 300000 })
  assert.equal(await v.locator('#fout').textContent(), '')
  assert.deepEqual(vf, [])
  stap(`rekenwerker: Stop na 1,5 s breekt binnen 3 s af, daarna opnieuw plannen lukt`)
  await cs.close()
}

// ---- Snelheid stap 6: A naar B met de eigen router, versleepbaar ----
{
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const c6 = await browser.newContext(opties)
  const e = await c6.newPage()
  const ef = []
  e.on('pageerror', (x) => ef.push('PAGEERROR ' + x.message))
  let brouter = 0
  e.on('request', (r) => { if (/brouter\.de/.test(r.url())) brouter += 1 })
  await e.goto(`${basis}?router=eigen`)
  await e.locator('[data-soort="route"]').click()
  await e.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0116, 4.3571) }))
  await e.waitForTimeout(450)
  await e.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0170, 4.3830) }))
  await e.locator('#planKnop').click()
  await e.waitForFunction(() => (!document.getElementById('resultaat').hidden && !window.onverhard.bezig()) || !!document.getElementById('fout').textContent, null, { timeout: 300000 })
  assert.equal(await e.locator('#fout').textContent(), '')
  const info = await e.evaluate(() => ({ router: window.onverhard.uitslag().router, knopen: !!window.onverhard.uitslag().opties[0].knopen, km: window.onverhard.krijgPlan().opties[0].km }))
  assert.equal(info.router, 'eigen', 'A naar B met de eigen router')
  assert.equal(brouter, 0, 'geen BRouter-verzoeken')
  assert.ok(info.knopen, 'de route ligt op het eigen netwerk (versleepbaar)')
  // verslepen: een punt halverwege de route 80 px opzij trekken (alleen met een muis)
  if (!mobiel) {
    const voor = await e.evaluate(() => window.onverhard.krijgPlan().traject.coords.length)
    const pt = await e.evaluate(() => {
      const c = window.onverhard.krijgPlan().traject.coords
      const [lon, lat] = c[Math.floor(c.length / 2)]
      window.onverhard.kaart.setView([lat, lon], 16, { animate: false })
      return window.onverhard.kaart.latLngToContainerPoint([lat, lon])
    })
    await e.waitForTimeout(500)
    const vak = await e.locator('#kaart').boundingBox()
    await e.mouse.move(vak.x + pt.x, vak.y + pt.y)
    await e.mouse.down()
    for (let i = 1; i <= 8; i++) await e.mouse.move(vak.x + pt.x + i * 10, vak.y + pt.y - i * 6)
    await e.mouse.up()
    await e.waitForFunction((n) => window.onverhard.krijgPlan().traject.coords.length !== n, voor, { timeout: 30000 })
    stap(`eigen router: A naar B ${info.km.toFixed(2)} km zonder BRouter; route versleept`)
  } else stap(`eigen router: A naar B ${info.km.toFixed(2)} km zonder BRouter, op het eigen netwerk`)
  assert.deepEqual(ef, [])
  await c6.close()
}

// ---- Graaf-proef: de vooraf bewerkte graaf (?graaf=vooraf), via de knoppen ----
{
  const opties = mobiel ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }
  const cg = await browser.newContext(opties)
  let v = await cg.newPage()
  const vf = []
  v.on('pageerror', (x) => vf.push('PAGEERROR ' + x.message))
  let brouter = 0
  v.on('request', (r) => { if (/brouter\.de/.test(r.url())) brouter += 1 })
  const klaar = () => v.waitForFunction(() => (!document.getElementById('resultaat').hidden && !window.onverhard.bezig()) || !!document.getElementById('fout').textContent, null, { timeout: 300000 })
  const bronnen = () => v.evaluate(() => {
    const b = window.onverhard.meting.rapport().bronnen
    return { graaf: (b.graaf || {}).n || 0, bgt: (b.bgt || {}).n || 0, ahn: (b.ahn || {}).n || 0, bron: window.onverhard.uitslag().graafBron }
  })
  // rondje: start tikken haalt de blokken alvast op; plannen zonder BGT en AHN
  await v.goto(`${basis}?graaf=vooraf`)
  await v.locator('[data-soort="rondje"]').click()
  await v.locator('#snelkeuzes [data-waarde="10"]').click()
  await v.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0116, 4.3571) }))
  await v.waitForFunction(() => window.onverhard.vooraf && window.onverhard.vooraf.klaar, null, { timeout: 120000 })
  const blokkenInCache = await v.evaluate(async () => (await (await caches.open('nopaves-data-v1')).keys()).filter((r) => r.url.includes('/graaf/')).length)
  assert.ok(blokkenInCache >= 1, `blokken vooraf in de cache: ${blokkenInCache}`)
  await v.locator('#planKnop').click()
  await klaar()
  assert.equal(await v.locator('#fout').textContent(), '')
  let b = await bronnen()
  assert.equal(b.bron, 'vooraf', 'rondje uit de vooraf bewerkte graaf')
  assert.ok(b.bgt === 0 && b.ahn === 0, `geen BGT- of AHN-verzoeken: ${JSON.stringify(b)}`)
  const r1 = await v.evaluate(() => { const o = window.onverhard.uitslag().opties[0]; return { score: o.score, km: o.km, hoogte: !!(o.hoogte && o.hoogte.afstand.length > 10), stijgen: o.stijgen } })
  assert.ok(r1.score > 0 && r1.km > 7 && r1.hoogte, `rondje: ${JSON.stringify(r1)}`)
  assert.ok(Number(await v.locator('#kern .score b').textContent()) === r1.score, 'score in de tegel')
  stap(`graaf-proef rondje: ${blokkenInCache} blokken vooraf opgehaald, score ${r1.score}, ${r1.km.toFixed(1)} km, hoogteprofiel, 0 BGT/AHN-verzoeken`)
  // station via de segmentknop
  await v.locator('[data-soort="station"]').click()
  await v.locator('#snelkeuzes [data-waarde="15"]').click()
  await v.locator('#planKnop').click()
  await klaar()
  assert.equal(await v.locator('#fout').textContent(), '')
  b = await bronnen()
  assert.equal(b.bron, 'vooraf', 'station uit de vooraf bewerkte graaf')
  const nSt = await v.evaluate(() => window.onverhard.uitslag().opties.length)
  assert.ok(nSt >= 2, `routes naar stations: ${nSt}`)
  stap(`graaf-proef station: ${nSt} routes, 0 BGT/AHN-verzoeken (${b.bgt}/${b.ahn})`)
  // buiten de regio: gewoon de huidige werking
  await v.locator('[data-soort="rondje"]').click()
  await v.locator('#snelkeuzes [data-waarde="5"]').click()
  await v.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0907, 5.1214) }))
  await v.waitForTimeout(450)
  await v.locator('#planKnop').click()
  await klaar()
  assert.equal(await v.locator('#fout').textContent(), '')
  b = await bronnen()
  assert.equal(b.bron, 'tegels', 'buiten de regio: kaarttegels')
  assert.ok(b.bgt > 0, 'buiten de regio: BGT zoals altijd')
  stap('graaf-proef buiten de regio (Utrecht): terugval op kaarttegels + BGT')
  // A naar B met de eigen router op de vooraf bewerkte graaf, en verslepen (verse context: de start in
  // Utrecht van hierboven wordt onthouden, en dat zou terecht een terugval geven)
  await v.close()
  const cg2 = await browser.newContext(opties)
  v = await cg2.newPage()
  v.on('pageerror', (x) => vf.push('PAGEERROR ' + x.message))
  v.on('request', (r) => { if (/brouter\.de/.test(r.url())) brouter += 1 })
  await v.goto(`${basis}?graaf=vooraf&router=eigen`)
  await v.locator('[data-soort="route"]').click()
  await v.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0116, 4.3571) }))
  await v.waitForTimeout(450)
  await v.evaluate(() => window.onverhard.kaart.fire('click', { latlng: L.latLng(52.0170, 4.3830) }))
  await v.locator('#planKnop').click()
  await klaar()
  assert.equal(await v.locator('#fout').textContent(), '')
  b = await bronnen()
  const ab = await v.evaluate(() => ({ router: window.onverhard.uitslag().router, knopen: !!window.onverhard.uitslag().opties[0].knopen }))
  assert.equal(b.bron, 'vooraf')
  assert.equal(ab.router, 'eigen')
  assert.equal(brouter, 0, 'geen BRouter-verzoeken')
  assert.ok(ab.knopen, 'versleepbaar')
  if (!mobiel) {
    const voor = await v.evaluate(() => window.onverhard.krijgPlan().traject.coords.length)
    const pt = await v.evaluate(() => {
      const c = window.onverhard.krijgPlan().traject.coords
      const [lon, lat] = c[Math.floor(c.length / 2)]
      window.onverhard.kaart.setView([lat, lon], 16, { animate: false })
      return window.onverhard.kaart.latLngToContainerPoint([lat, lon])
    })
    await v.waitForTimeout(500)
    const vak = await v.locator('#kaart').boundingBox()
    await v.mouse.move(vak.x + pt.x, vak.y + pt.y)
    await v.mouse.down()
    for (let i = 1; i <= 8; i++) await v.mouse.move(vak.x + pt.x + i * 10, vak.y + pt.y - i * 6)
    await v.mouse.up()
    await v.waitForFunction((n) => window.onverhard.krijgPlan().traject.coords.length !== n, voor, { timeout: 30000 })
    const naSlepen = await bronnen()
    assert.equal(naSlepen.bgt, 0, 'verslepen op de vooraf bewerkte graaf: geen BGT')
    stap('graaf-proef A naar B: eigen router op de vooraf bewerkte graaf, zonder BRouter; versleept zonder BGT')
  } else stap('graaf-proef A naar B: eigen router op de vooraf bewerkte graaf, zonder BRouter')
  assert.deepEqual(vf, [])
  await cg.close()
  await cg2.close()
}

await browser.close()
console.log(`klaar (${soort})`)
