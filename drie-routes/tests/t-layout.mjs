// Schermen: geen horizontaal scrollen op 390 px, geen consolefouten, schermafbeeldingen in licht en donker.
import { openApp, closeBrowser, suite, overflowX, APP, OUT } from './harness.mjs';
import { D, gotoTab } from './days.mjs';
const file = process.argv[2] || APP;
const tag = process.argv[3] || 'n';
const S = suite('layout');
async function tour(opts, label){
  const { page, logs } = await openApp(Object.assign({ file, time: D('2026-10-05'), store: null, midi: true }, opts));
  const shot = async (n, full) => page.screenshot({ path: `${OUT}/${tag}-${label}-${n}.png`, fullPage: !!full });
  const check = async n => { const o = await overflowX(page); S.ok(o <= 0, label + ' ' + n + ' no horizontal overflow', o); };
  await shot('01-onboarding'); await check('onboarding');
  await page.click('[data-act="startsong"]');
  await page.click('[data-act="min"][data-min="15"]');
  await shot('02-plan', true); await check('plan');
  // Liedjes starten voor de rondleiding
  await gotoTab(page, 'liedjes');
  for (const id of ['canon', 'menuet', 'jarig']) await page.click(`[data-act="startsong"][data-song="${id}"]`).then(() => gotoTab(page, 'liedjes'));
  await shot('03-liedjes', true); await check('liedjes');
  const blocks = [['clair:noten', 'noten'], ['canon:akkoord', 'canon-akkoord'], ['menuet:noten', 'menuet-noten'], ['jarig:impro', 'jarig-impro'], ['menuet:impro', 'menuet-impro']];
  for (const [id, n] of blocks){
    await gotoTab(page, 'liedjes');
    await page.click(`[data-act="free"][data-id="${id}"]`);
    await page.waitForTimeout(250);
    await shot('04-' + n, true); await check(n);
    await page.click('[data-act="done"]');
  }
  // MIDI verbinden en een blok met meespeelbalk
  await gotoTab(page, 'vandaag');
  await page.click('#midicard [data-act="midi"]').catch(() => {});
  await gotoTab(page, 'liedjes');
  await page.click('[data-act="free"][data-id="clair:akkoord"]');
  await page.waitForTimeout(250);
  await page.evaluate(() => window.__midi.on(48));
  await shot('05-midi-akkoord'); await check('midi-akkoord');
  await page.evaluate(() => window.__midi.off(48));
  await page.click('[data-act="done"]');
  await gotoTab(page, 'voortgang');
  await shot('06-voortgang', true); await check('voortgang');
  await page.click('[data-act="ioopen"]');
  await check('voortgang-import');
  await gotoTab(page, 'uitleg');
  await shot('07-uitleg', true); await check('uitleg');
  S.ok(logs.length === 0, label + ' no console errors', logs);
  await page.context().close();
}
await tour({}, 'm');
await tour({ colorScheme: 'dark' }, 'md');
await tour({ viewport: { width: 1280, height: 900 } }, 'd');
await tour({ viewport: { width: 360, height: 740 } }, 's');
S.done();
await closeBrowser();
