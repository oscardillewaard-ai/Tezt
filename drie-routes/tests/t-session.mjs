// Sessieflow: samenvatting, nog 5 minuten, stoppen, waarschuwing bij vrij oefenen, bladmuziek die niet laadt, akkoordkaart.
import { openApp, closeBrowser, suite, APP } from './harness.mjs';
import { D, runSession, newDay, gotoTab } from './days.mjs';
const file = process.argv[2] || APP;
const S = suite('session');
{
  const { page, logs } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  await page.click('[data-act="min"][data-min="10"]');
  await page.click('[data-act="start"]');
  // Stoppen vraagt een tweede tik
  await page.click('[data-act="stop"]');
  S.ok((await page.textContent('[data-act="stop"]')).includes('Tik nogmaals'), 'stop arms first');
  await page.click('[data-act="done"]');
  await page.click('[data-act="stop"]'); await page.click('[data-act="stop"]');
  S.ok((await page.textContent('h2')) === 'Sessie klaar', 'stop after a block shows summary');
  await page.click('[data-act="more"]');
  S.ok(await page.$('.prog') !== null, 'more time adds blocks', await page.textContent('main').catch(() => ''));
  await page.click('[data-act="stop"]'); await page.click('[data-act="stop"]');
  await page.click('[data-act="finish"]');
  // Volgende dag: vrij oefenen op een onderdeel met een toets van vandaag waarschuwt eerst
  await newDay(page, '2026-10-06');
  await gotoTab(page, 'liedjes');
  const dueBtn = await page.$('[data-act="free"][data-due="1"]');
  S.ok(!!dueBtn, 'due item marked in songs list');
  await dueBtn.click();
  S.ok((await dueBtn.textContent()).includes('schuift dan naar morgen'), 'free practice on due item warns first', await dueBtn.textContent());
  await dueBtn.click();
  S.ok((await page.textContent('.prog')) === 'Vrij oefenen', 'second tap starts free practice');
  await page.click('[data-act="done"]');
  S.ok(logs.length === 0, 'no console errors', logs);
  await page.context().close();
}
{
  // Mislukte toets zonder later oefenblok: extra blok wordt ingevoegd, maatkeuze verschijnt
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  await runSession(page, 15, () => 'pass');
  await newDay(page, '2026-10-06');
  await page.click('[data-act="min"][data-min="5"]');
  const plan = await page.$$eval('.plan li', l => l.length);
  await page.click('[data-act="start"]');
  const before = await page.textContent('.prog');
  if (await page.$('[data-act="checkbad"]')){
    await page.click('[data-act="checkbad"]');
    const route = await page.$eval('.help .rname', e => e.textContent);
    const note = await page.textContent('.actionbar');
    S.ok(/extra oefenblok|Straks oefen|Morgen komt/.test(note), 'fail note shown', note);
    if (route !== 'Improviseren') S.ok(await page.$('.chip[data-act="hard"]') !== null, 'bar chips after failed check');
    await page.click('[data-act="next"]');
    S.ok(/van/.test(await page.textContent('.prog')), 'continues after fail', [before, plan]);
  } else S.ok(false, 'expected a check first on day 2', before);
  await page.context().close();
}
{
  // Bladmuziek laadt niet: eerst laden, daarna noten als tekst
  const { page, logs } = await openApp({ file, time: D('2026-10-05'), store: null, abc: false });
  await page.click('[data-act="startsong"]');
  await gotoTab(page, 'liedjes');
  await page.click('[data-act="free"][data-id="clair:noten"]');
  await page.waitForTimeout(300);
  S.ok(await page.$$eval('#kb rect.w', r => r.length) === 8 && await page.$eval('#kb g[data-m="60"]', g => g.classList.contains('rh')), 'noten keyboard is C4-C5 with C marked', await page.$$eval('#kb rect.w', r => r.length));
  const txt = await page.textContent('#score');
  S.ok(/De bladmuziek laadt niet/.test(txt) && /maat 1/.test(txt), 'fallback text after load failure', txt.slice(0, 120));
  S.ok(logs.every(l => /ERR_FAILED|net::/.test(l)), 'only network errors in console', logs);
  await page.context().close();
}
{
  // Akkoordkaart: een maat met twee akkoorden noemt veilige noten voor allebei
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  await gotoTab(page, 'liedjes');
  await page.click('[data-act="free"][data-id="clair:impro"]');
  await page.click('[data-act="selbar"][data-bar="1"]');
  S.ok(await page.$$eval('#kb rect.w', r => r.length) >= 8, 'impro keyboard spans at least an octave', await page.$$eval('#kb rect.w', r => r.length));
  const t = await page.textContent('#safeTxt');
  S.ok(/Bij C klinken C en E veilig\. Bij G klinken D veilig\./.test(t), 'two chords in a bar: both listed', t);
  S.ok(await page.$('#chart button.sel[data-bar="1"]') !== null, 'selected bar highlighted');
  await page.context().close();
}
S.done();
await closeBrowser();
