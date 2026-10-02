// Eigen liedjes: toevoegen met controle en voorbeeld, opslaan, starten, oefenen, bewerken, verwijderen, plakken van volledige ABC.
import { openApp, closeBrowser, state, suite, overflowX, APP, OUT } from './harness.mjs';
import { D, gotoTab } from './days.mjs';
const file = process.argv[2] || APP;
const S = suite('songs');
const { page, logs } = await openApp({ file, time: D('2026-10-05'), store: null });
await page.click('[data-act="startsong"]');
await gotoTab(page, 'liedjes');
S.ok((await page.textContent('main')).includes('Eigen liedjes'), 'own songs section');
await page.click('[data-act="newsong"]');
S.ok(await page.$('#f-abc') !== null, 'editor opens');
S.ok(await page.$eval('#edsave', e => e.disabled), 'save disabled while empty');
await page.fill('#f-title', 'Mijn liedje');
await page.fill('#f-abc', '"C"C D E F | "G"G4 | "C"E E F F | "G"D D G2 |');
await page.waitForTimeout(400);
S.ok((await page.textContent('#edmsg')).includes('4 maten'), 'summary of parsed song', await page.textContent('#edmsg'));
S.ok(await page.$('#preview svg') !== null, 'preview rendered');
S.ok(!(await page.$eval('#edsave', e => e.disabled)), 'save enabled when valid');
// Fout: te lange maat
await page.fill('#f-abc', '"C"C D E F G | "G"G4 |');
await page.waitForTimeout(400);
S.ok((await page.textContent('#edmsg')).includes('Maat 1 is te lang'), 'error shown for long bar', await page.textContent('#edmsg'));
S.ok(await page.$eval('#edsave', e => e.disabled), 'save disabled on error');
await page.screenshot({ path: OUT + '/n-20-editor-error.png', fullPage: true });
await page.fill('#f-abc', '"C"C D E F | "G"G4 | "C"E E F F | "G"D D G2 | "C"C4 |]');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + '/n-21-editor.png', fullPage: true });
S.ok((await overflowX(page)) <= 0, 'editor no horizontal overflow');
await page.click('[data-act="edsave"]');
const own = await page.$$eval('.songs h3', h => h.map(x => x.innerText));
S.ok(own.some(t => t.includes('Mijn liedje')), 'saved song listed', own);
const ls = await page.evaluate(() => JSON.parse(localStorage.getItem('drieroutes.songs.v1')));
const id = Object.keys(ls.songs)[0];
S.ok(/^u-/.test(id) && ls.songs[id].title === 'Mijn liedje', 'stored with u- id', ls);
// Starten en een oefenblok openen
await page.click(`[data-act="startsong"][data-song="${id}"]`);
await gotoTab(page, 'liedjes');
await page.click(`[data-act="free"][data-id="${id}:noten"]`);
await page.waitForTimeout(300);
S.ok((await page.textContent('.block h2')) === 'Mijn liedje', 'practice block for own song');
S.ok(await page.$('#score svg') !== null, 'own song score rendered');
await page.click('[data-act="done"]');
// Bewerken
await page.click(`[data-act="editsong"][data-song="${id}"]`);
S.ok((await page.inputValue('#f-title')) === 'Mijn liedje', 'edit loads song');
await page.fill('#f-title', 'Mijn liedje 2');
await page.click('[data-act="edsave"]');
S.ok((await page.textContent('main')).includes('Mijn liedje 2'), 'edit saved');
// Volledige ABC plakken: kopregels vullen titel, maatsoort en toonsoort
await page.click('[data-act="newsong"]');
await page.fill('#f-abc', 'X:1\nT:Geplakt wijsje\nM:3/4\nL:1/8\nK:G\n"G"G2 A2 B2 | "D"A4 F2 | "G"G6 |]');
await page.waitForTimeout(400);
S.ok((await page.inputValue('#f-title')) === 'Geplakt wijsje' && (await page.inputValue('#f-meter')) === '3/4' && (await page.inputValue('#f-key')) === 'G', 'pasted headers fill fields', [await page.inputValue('#f-title'), await page.inputValue('#f-meter'), await page.inputValue('#f-key')]);
S.ok((await page.textContent('#edmsg')).includes('3 maten'), 'pasted ABC parses', await page.textContent('#edmsg'));
await page.click('[data-act="edsave"]');
// Verwijderen (tik tweemaal)
await page.click(`[data-act="delsong"][data-song="${id}"]`);
S.ok((await page.textContent(`[data-act="delsong"][data-song="${id}"]`)).includes('Tik nogmaals'), 'delete arms first');
await page.click(`[data-act="delsong"][data-song="${id}"]`);
const after = await page.$$eval('.songs h3', h => h.map(x => x.innerText));
S.ok(!after.some(t => t.includes('Mijn liedje 2')) && after.some(t => t.includes('Geplakt wijsje')), 'song deleted, other kept', after);
const st = await state(page);
S.ok(!st.started.includes(id) && !st.items[id + ':noten'], 'progress of deleted song removed', st.started);
S.ok(logs.length === 0, 'no console errors', logs);
S.done();
await closeBrowser();
