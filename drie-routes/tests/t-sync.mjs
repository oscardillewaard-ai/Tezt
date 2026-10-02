// Opslag: twee apparaten op één account, eigen liedjes via het tweede document, wissen, opslagfout, en meenemen via kopie.
import { openApp, closeBrowser, state, makeStore, suite, APP } from './harness.mjs';
import { D, runSession, gotoTab } from './days.mjs';
const file = process.argv[2] || APP;
const S = suite('sync');
const store = makeStore();
const A = await openApp({ file, time: D('2026-10-05'), store });
await A.page.waitForTimeout(400);
S.ok((await A.page.textContent('#sync')) === 'Bewaard in je account', 'A synced label');
await A.page.click('[data-act="startsong"]');
await runSession(A.page, 5, () => 'pass');
// Eigen liedje op A
await gotoTab(A.page, 'liedjes');
await A.page.click('[data-act="newsong"]');
await A.page.fill('#f-title', 'Gedeeld liedje');
await A.page.fill('#f-abc', '"C"C D E C | "G"D2 G2 |]');
await A.page.waitForTimeout(350);
await A.page.click('[data-act="edsave"]');
await A.page.waitForTimeout(400);
S.ok(store.docs.has('data/users/u_test_user/state') && store.docs.has('data/users/u_test_user/songs'), 'state and songs docs written', [...store.docs.keys()]);
const B = await openApp({ file, time: D('2026-10-05'), store });
await B.page.waitForTimeout(800);
await gotoTab(B.page, 'liedjes');
S.ok((await B.page.textContent('main')).includes('Gedeeld liedje'), 'B sees own song from A');
const sb = await state(B.page);
S.ok(sb.started.includes('clair') && sb.history.length === 2, 'B got progress', sb && sb.history.length);
// B start het eigen liedje; A ziet het
const sid = Object.keys(store.docs.get('data/users/u_test_user/songs').data.songs)[0];
await B.page.click(`[data-act="startsong"][data-song="${sid}"]`);
await A.page.waitForTimeout(900);
const sa = await state(A.page);
S.ok(sa.started.includes(sid) && sa.items[sid + ':impro'], 'A sees song started on B', sa.started);
// Wissen op A: B wordt leeg, eigen liedjes blijven
await gotoTab(A.page, 'voortgang');
await A.page.click('[data-act="reset"]'); await A.page.click('[data-act="reset"]');
await B.page.waitForTimeout(900);
const sb2 = await state(B.page);
S.ok(sb2.history.length === 0 && sb2.started.length === 0, 'reset propagates to B', sb2.started);
await gotoTab(B.page, 'liedjes');
S.ok((await B.page.textContent('main')).includes('Gedeeld liedje'), 'own song survives reset');
// Opslagfout: melding onder Voortgang
store.failNext = 'quota_exceeded';
await A.page.click('[data-act="startsong"]');
await A.page.waitForTimeout(400);
await gotoTab(A.page, 'voortgang');
S.ok((await A.page.textContent('main')).includes('de opslag is vol'), 'quota error explained', (await A.page.textContent('main')).slice(0, 300));
S.ok((await A.page.textContent('#sync')) === 'Bewaard op dit apparaat', 'label falls back to device');
S.ok(A.logs.length === 0 && B.logs.length === 0, 'no console errors', A.logs.concat(B.logs));
await A.ctx.close(); await B.ctx.close();

// Meenemen via kopie: los apparaat zonder account, kopie van A samenvoegen
const P = await openApp({ file, time: D('2026-10-06'), store: null });
await P.page.click('[data-act="startsong"]');
await runSession(P.page, 5, () => 'pass');
await gotoTab(P.page, 'voortgang');
await P.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://app.test' });
await P.page.click('[data-act="export"]');
await P.page.waitForTimeout(200);
S.ok((await P.page.textContent('#iomsg')).includes('Gekopieerd'), 'copy message', await P.page.textContent('#iomsg'));
const copied = await P.page.evaluate(() => navigator.clipboard.readText());
const data = JSON.parse(copied);
S.ok(data.app === 'drie-routes' && data.state.history.length === 2, 'export contains state', data.state.history.length);
// Ander apparaat met eigen geschiedenis: samenvoegen
const Q = await openApp({ file, time: D('2026-10-07'), store: null });
await Q.page.click('[data-act="startsong"]');
await runSession(Q.page, 5, () => 'pass');
await gotoTab(Q.page, 'voortgang');
await Q.page.click('[data-act="ioopen"]');
await Q.page.fill('#f-import', 'onzin');
await Q.page.click('[data-act="import"]');
S.ok((await Q.page.textContent('#iomsg')).includes('geen kopie'), 'rejects garbage', await Q.page.textContent('#iomsg'));
S.ok(await Q.page.$('#f-import') !== null, 'import box stays open after an error');
await Q.page.fill('#f-import', copied);
await Q.page.click('[data-act="import"]');
const sq = await state(Q.page);
S.ok(sq.history.length === 4, 'merged history from both devices', sq.history.length);
S.ok((await Q.page.textContent('#iomsg')).includes('2 nieuwe gebeurtenissen'), 'merge message', await Q.page.textContent('#iomsg'));
// Bestand: in een losse browser maakt de knop een download
const [dl] = await Promise.all([Q.page.waitForEvent('download', { timeout: 5000 }).catch(() => null), Q.page.click('[data-act="exportfile"]')]);
S.ok(dl && /drie-routes-2026-10-07\.json/.test(dl.suggestedFilename()), 'file export downloads json', dl && dl.suggestedFilename());
S.done();
await closeBrowser();
