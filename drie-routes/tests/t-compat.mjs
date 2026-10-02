// Bestaande voortgang uit de vorige versie blijft werken, ook via de accountopslag; en een herlaadbeurt midden in een sessie (hot reload) houdt de sessie vast.
import { openApp, closeBrowser, state, makeStore, suite, APP, OLD } from './harness.mjs';
import { D, addDaysStr, runSession, newDay, gotoTab } from './days.mjs';
const file = process.argv[2] || APP, oldFile = process.argv[3] || OLD;
const S = suite('compat');
// 1. Oude versie: drie dagen oefenen, met accountopslag
const store = makeStore();
const O = await openApp({ file: oldFile, time: D('2026-10-02'), store });
await O.page.waitForTimeout(400);
await O.page.click('[data-act="startsong"]');
let day = '2026-10-02';
for (let i = 0; i < 3; i++){
  await runSession(O.page, 15, info => info.help.startsWith('Improviseren') ? 'fail' : 'pass', { markBar: true });
  day = addDaysStr(day, 1); await newDay(O.page, day);
}
await O.page.waitForTimeout(500);
const oldState = await state(O.page);
const oldStorage = await O.ctx.storageState();
await O.ctx.close();
// 2. Nieuwe versie op hetzelfde apparaat (zelfde localStorage) en hetzelfde account
const N = await openApp({ file, time: D('2026-10-05'), store, storageState: oldStorage });
await N.page.waitForTimeout(600);
const ns = await state(N.page);
S.ok(JSON.stringify(Object.keys(ns.items).sort()) === JSON.stringify(Object.keys(oldState.items).sort()), 'all items kept', Object.keys(ns.items));
S.ok(ns.history.length === oldState.history.length, 'history kept', [ns.history.length, oldState.history.length]);
S.ok(['level', 'streak', 'fails', 'nextCheck', 'lastPractice', 'lastCheck', 'bpm'].every(k => Object.keys(ns.items).every(id => JSON.stringify(ns.items[id][k]) === JSON.stringify(oldState.items[id][k]))), 'item fields unchanged', ns.items);
S.ok(ns.epoch === oldState.epoch, 'same epoch', [ns.epoch, oldState.epoch]);
await gotoTab(N.page, 'voortgang');
const vt = await N.page.textContent('main');
S.ok(/alle toetsen gehaald/.test(vt) && !/Nog geen gegevens/.test(vt), 'progress view shows old data');
await gotoTab(N.page, 'vandaag');
const due = await N.page.textContent('main');
S.ok(/toets(en)? (staat|staan) vandaag klaar|geen toetsen klaar/.test(due), 'today view renders', due.slice(0, 200));
const r = await runSession(N.page, 10, () => 'pass');
S.ok(r.blocks.length > 0, 'can run a session on old data', r.plan);
// 3. Nieuw apparaat, alleen het account: voortgang komt uit de db
const F = await openApp({ file, time: D('2026-10-05'), store });
await F.page.waitForTimeout(700);
const fs2 = await state(F.page);
S.ok(fs2.history.length >= oldState.history.length + r.blocks.length - 1, 'fresh device loads account data', [fs2.history.length, oldState.history.length]);
S.ok(N.logs.length === 0 && F.logs.length === 0, 'no console errors', N.logs.concat(F.logs));
await N.ctx.close(); await F.ctx.close();
// 4. Hot reload: de viewer geeft een snapshot terug, de sessie gaat verder
{
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  await page.click('[data-act="min"][data-min="15"]');
  await page.click('[data-act="start"]');
  await page.click('[data-act="done"]');
  const snap = await page.evaluate(() => window.__snap ? window.__snap() : null);
  S.ok(snap === null, 'no hot api outside the viewer (sanity)');
  const sess = await page.evaluate(() => { const b = document.querySelector('.prog'); return b ? b.textContent : ''; });
  // Bouw dezelfde toestand opnieuw op met een nagebootste hot-API
  const st = await page.evaluate(() => localStorage.getItem('drieroutes.v1'));
  const ctx = page.context();
  const p2 = await ctx.newPage();
  await p2.addInitScript(() => {
    window.claude = { use: async () => null, hot: { data: null, snapshot(fn){ window.__snap = fn; }, ready(fn){ setTimeout(() => fn(window.__hotData || {}), 0); } } };
  });
  await p2.goto('https://app.test/drie-routes.html');
  await p2.waitForSelector('#app > *');
  const data = await p2.evaluate(() => window.__snap());
  S.ok(data && data.session === null, 'snapshot callback registered', data);
  // Nu met een sessie in de snapshot
  const p3 = await ctx.newPage();
  const fakeSession = { blocks: [{ kind: 'practice', id: 'clair:noten', min: 4 }, { kind: 'practice', id: 'clair:impro', min: 4 }], i: 1, minutes: 15, free: false, results: [{ kind: 'practice', id: 'clair:noten', min: 3 }], done: false, failedOpen: false, extraAdded: false, blockStart: Date.now() };
  await p3.addInitScript(sess => {
    window.__hotData = { session: sess, ui: { tab: 'vandaag' } };
    window.claude = { use: async () => null, hot: { snapshot(fn){ window.__snap = fn; }, ready(fn){ setTimeout(() => fn(window.__hotData), 0); } } };
  }, fakeSession);
  await p3.goto('https://app.test/drie-routes.html');
  await p3.waitForSelector('.prog');
  S.ok((await p3.textContent('.prog')) === 'Blok 2 van 2', 'session restored from hot data', await p3.textContent('.prog'));
  S.ok(st && sess, 'original page had state and a session');
  await ctx.close();
}
S.done();
await closeBrowser();
