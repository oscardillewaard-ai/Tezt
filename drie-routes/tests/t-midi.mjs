// MIDI: verbinden, meespelen met fouten per maat, toets met voorstel, improvisatietoets, naspelen op gehoor.
import fs from 'node:fs';
import { openApp, closeBrowser, getBrowser, state, suite, APP } from './harness.mjs';
import { D, newDay, gotoTab } from './days.mjs';
const file = process.argv[2] || APP;
const S = suite('midi');
const CLAIR = [60,60,60,62,64,62,60,64,62,62,60, 60,60,60,62,64,62,60,64,62,62,60];
const live = page => page.$eval('#live', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
async function play(page, notes, gap = 140){ for (const m of notes){ await page.evaluate(x => window.__midi.tap(x, 60), m); await page.waitForTimeout(gap); } }

{
  const { page, logs } = await openApp({ file, time: D('2026-10-05'), store: null, midi: true, hash: '#test' });
  await page.click('[data-act="startsong"]');
  S.ok(await page.$('#pchip') !== null, 'piano chip shown when Web MIDI exists');
  S.ok((await page.textContent('#midicard')).includes('Digitale piano'), 'connect card on Vandaag');
  await page.click('#midicard [data-act="midi"]');
  await page.waitForTimeout(200);
  S.ok((await page.textContent('#pchip')).includes('Test Piano'), 'chip shows device name', await page.textContent('#pchip'));
  S.ok((await page.$eval('#midicard', e => e.innerHTML)) === '', 'card hidden after connecting');
  await page.evaluate(() => window.__midi.tap(65, 60));
  await page.waitForTimeout(150);
  S.ok(await page.$('[data-act="min"][data-min="20"][aria-pressed="true"]') !== null && await page.$('.plan') !== null, 'playing F on the piano picks 20 minutes');
  // Vrij oefenen: Noten
  await gotoTab(page, 'liedjes');
  await page.click('[data-act="free"][data-id="clair:noten"]');
  await page.waitForTimeout(300);
  S.ok((await live(page)).includes('Speel mee'), 'follower box visible in practice', await live(page));
  // Toets indrukken laat de toets op het scherm oplichten
  await page.evaluate(() => window.__midi.on(62));
  S.ok(await page.$('#kb g[data-m="62"].press') !== null, 'pressed key lights up');
  await page.evaluate(() => window.__midi.off(62));
  S.ok(await page.$('#kb g[data-m="62"].press') === null, 'released key goes dark');
  // De D hierboven was fout (eerste noot is C): telt als fout in maat 1. Daarna netjes doorspelen.
  S.ok(await page.$('#score .cur') !== null, 'cursor shown on first note at veel hulp');
  await play(page, CLAIR.slice(0, 8));
  const curBar = await page.$eval('#score .cur', e => (e.getAttribute('class').match(/abcjs-mm(\d+)/) || [])[1]);
  S.ok(curBar === '2', 'cursor advanced to bar 3 after 8 notes', curBar);
  // Fout in maat 3: een E in plaats van D
  await play(page, [64]);
  S.ok((await live(page)).includes('Niet goed. Zoek D'), 'wrong note hint at veel hulp', await live(page));
  await play(page, CLAIR.slice(8));
  const msg = await live(page);
  S.ok(/Doorgespeeld met 2 fouten, in maat 1 en maat 3/.test(msg), 'run summary lists bars', msg);
  const st = await state(page);
  S.ok(JSON.stringify(st.items['clair:noten'].hard) === '[1,3]', 'error bars added to hard bars', st.items['clair:noten'].hard);
  S.ok(await page.$('[data-act="hard"][data-bar="3"][aria-pressed="true"]') !== null, 'chip 3 pressed');
  // Tweede ronde zonder fouten
  await play(page, CLAIR);
  S.ok((await live(page)).includes('Helemaal goed'), 'clean run message', await live(page));
  await page.click('[data-act="done"]');
  for (const id of ['clair:akkoord', 'clair:impro']){ await gotoTab(page, 'liedjes'); await page.click('[data-act="free"][data-id="' + id + '"]'); await page.click('[data-act="done"]'); }
  // Toetsen de volgende dag: Noten en Akkoorden met meetvoorstel
  let day = '2026-10-06';
  await newDay(page, day);
  await page.click('[data-act="min"][data-min="45"]');
  await page.click('[data-act="start"]');
  const seen = [];
  for (let k = 0; k < 6; k++){
    await page.waitForTimeout(150);
    if (!await page.$('[data-act="checkok"]')) break;
    const help = await page.$eval('.help', e => e.innerText);
    if (help.startsWith('Noten')){
      await play(page, CLAIR, 120);
      await page.waitForTimeout(1300);
      const t = await live(page);
      const sug = await page.$eval('[data-act="checkok"]', e => e.classList.contains('suggest'));
      seen.push('noten:' + t);
      S.ok(/Voorstel: gehaald/.test(t) && sug, 'noten check: clean play suggests pass', t);
      await page.click('[data-act="checkok"]');
    } else if (help.startsWith('Akkoorden')){
      // melodie plus grondtonen; drie fouten: een maat overgeslagen
      const exp = await page.evaluate(() => window.__dr.expectedSeq(window.__dr.BUILTIN[0], 'akkoord').map(e => e.midi));
      const bad = exp.slice(0, 8).concat(exp.slice(12));
      await play(page, bad, 120);
      await page.click('[data-act="recdone"]').catch(() => {});
      await page.waitForTimeout(300);
      const t = await live(page);
      seen.push('akkoord:' + t);
      S.ok(/Voorstel: niet gehaald/.test(t), 'akkoord check: skipped notes suggest fail', t);
      S.ok(await page.$eval('[data-act="checkbad"]', e => e.classList.contains('suggest')), 'fail button highlighted');
      await page.click('[data-act="checkbad"]');
      await page.waitForTimeout(150);
      await page.click('[data-act="next"]');
    } else {
      // Improviseren: begeleiding één keer, sneller zetten
      for (let i = 0; i < 25; i++) await page.click('[data-act="tempo"][data-d="4"]');
      await page.click('[data-act="backing"]');
      const bpm = await page.textContent('#bpm');
      const spb = 60 / parseInt(bpm, 10);
      await page.waitForTimeout(4 * spb * 1000 + 150);
      // speel per maat een noot, de laatste is C
      for (let b = 0; b < 8; b++){ await page.evaluate(m => window.__midi.tap(m, 200), b === 7 ? 60 : 64); await page.waitForTimeout(4 * spb * 1000 - 200); }
      await page.waitForTimeout(800);
      const t = await live(page);
      seen.push('impro:' + t);
      S.ok(/Voorstel: gehaald/.test(t), 'impro check: no silent bar and ends on C suggests pass', t);
      await page.click('[data-act="checkok"]');
    }
  }
  console.log('  checks seen:\n   ' + seen.join('\n   '));
  const s2 = await state(page);
  const autos = s2.history.filter(e => e.k === 'check' && e.auto);
  S.ok(autos.length === 3, 'all three checks logged with auto suggestion', autos.map(e => e.item + ' ' + JSON.stringify(e.auto)));
  S.ok(logs.filter(l => !/AudioContext/.test(l)).length === 0, 'no console errors', logs);
  await page.context().close();
}
// Naspelen op gehoor: derde impro-oefenblok heeft de echo-opdracht
{
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null, midi: true, hash: '#test' });
  await page.click('[data-act="startsong"]');
  await page.click('#midicard [data-act="midi"]');
  for (let k = 0; k < 2; k++){ await gotoTab(page, 'liedjes'); await page.click('[data-act="free"][data-id="clair:impro"]'); await page.click('[data-act="done"]'); }
  await gotoTab(page, 'liedjes');
  await page.click('[data-act="free"][data-id="clair:impro"]');
  S.ok(await page.$('[data-act="echo"]') !== null, 'echo prompt on third impro practice', await page.$eval('.note-box', e => e.innerText).catch(() => ''));
  for (let i = 0; i < 25; i++) await page.click('[data-act="tempo"][data-d="4"]');
  await page.click('[data-act="echo"]');
  const spb = 60 / parseInt(await page.textContent('#bpm'), 10);
  await page.waitForFunction(() => /Speel het nu na/.test(document.getElementById('status').textContent), null, { timeout: 15000 });
  await play(page, [60, 60, 60, 62, 64, 62], 150);
  await page.waitForFunction(() => /nagespeeld|noten goed/.test(document.getElementById('status').textContent), null, { timeout: 6000 });
  const t = await page.textContent('#status');
  S.ok(/Precies goed nagespeeld/.test(t), 'echo of bars 1-2 judged correct', t + ' spb ' + spb);
  await page.context().close();
}
// Sustainpedaal: losgelaten toets telt als klinkend tot het pedaal omhoog gaat
{
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null, midi: true, hash: '#test' });
  await page.click('[data-act="startsong"]');
  await page.click('#midicard [data-act="midi"]');
  const r = await page.evaluate(async () => {
    const out = [];
    const rec = window.__dr.rec;
    rec.on = true; rec.offs = [];
    const send = b => { const inp = window.__dr.midi.access.inputs.get('in1'); inp.onmidimessage({ data: new Uint8Array(b), timeStamp: performance.now() }); };
    send([0xB0, 64, 127]); send([0x90, 60, 80]); send([0x80, 60, 0]);
    out.push(rec.offs.length);
    send([0xB0, 64, 0]);
    out.push(rec.offs.length);
    rec.on = false;
    return out;
  });
  S.ok(r[0] === 0 && r[1] === 1, 'pedal defers note-off until pedal up', r);
  await page.context().close();
}
// Geblokkeerd (zoals in een afgeschermde iframe) en niet ondersteund (Safari)
{
  const browser = await getBrowser();
  const html = fs.readFileSync(file, 'utf8');
  const open = async init => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    await p.addInitScript(init);
    await c.route('https://app.test/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await c.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com|fonts\.)/, r => r.abort());
    await p.goto('https://app.test/x.html');
    return { c, p };
  };
  const b1 = await open(() => { navigator.requestMIDIAccess = () => Promise.reject(Object.assign(new Error('blocked'), { name: 'SecurityError' })); });
  await b1.p.click('[data-act="startsong"]');
  await b1.p.click('#midicard [data-act="midi"]');
  await b1.p.waitForTimeout(200);
  const card = await b1.p.textContent('#midicard');
  S.ok(/MIDI is hier geblokkeerd/.test(card), 'blocked message', card);
  S.ok((await b1.p.textContent('#pchip')).includes('geblokkeerd'), 'chip shows blocked');
  await gotoTab(b1.p, 'liedjes');
  await b1.p.click('[data-act="free"][data-id="clair:noten"]');
  S.ok((await b1.p.$eval('#midictl', e => e.textContent)) === '', 'no MIDI button in blocks when blocked');
  await b1.c.close();
  const b2 = await open(() => { delete Navigator.prototype.requestMIDIAccess; });
  await b2.p.click('[data-act="startsong"]');
  S.ok(await b2.p.$('#pchip') === null && (await b2.p.$eval('#midicard', e => e.innerHTML)) === '', 'no MIDI UI without Web MIDI');
  await b2.c.close();
}
// Rekenwerk los: stoppen herkennen en een kort stuk zonder fouten
{
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null, hash: '#test' });
  const r = await page.evaluate(() => {
    const dr = window.__dr, song = dr.BUILTIN[0], exp = dr.expectedSeq(song, 'noten');
    const mk = (pitches, gaps) => { let t = 10; return pitches.map((m, i) => { t += gaps ? gaps(i) : 0.5; return { m, t }; }); };
    const clean = dr.judgePlay(exp, mk(exp.map(e => e.midi)));
    const oneWrong = dr.judgePlay(exp, mk(exp.map((e, i) => i === 5 ? e.midi + 2 : e.midi)));
    const twoWrong = dr.judgePlay(exp, mk(exp.map((e, i) => i === 5 || i === 15 ? e.midi + 2 : e.midi)));
    const stop = dr.judgePlay(exp, mk(exp.map(e => e.midi), i => i === 10 ? 4 : 0.5));
    const slowWhole = dr.judgePlay(exp, mk(exp.map(e => e.midi), i => 1.0 * (exp[i] && i > 0 ? exp[i].beat - exp[i - 1].beat : 1)));
    const restart = dr.judgePlay(exp, mk(exp.slice(0, 4).map(e => e.midi).concat(exp.map(e => e.midi))));
    const octave = dr.judgePlay(exp, mk(exp.map(e => e.midi + 12)));
    const impro = dr.judgeImpro(song, [0, 4, 8, 12, 16, 20, 24, 28].map((b, i) => ({ m: i === 7 ? 60 : 64, t: 100 + b * 0.5 + 0.1 })), [], 100, 0.5);
    const silentNotes = [0, 4, 8, 16, 20, 24, 28].map((b, i) => ({ m: i === 6 ? 60 : 64, t: 100 + b * 0.5 + 0.1 }));
    const improSilent = dr.judgeImpro(song, silentNotes, silentNotes.map(n => ({ m: n.m, t: n.t + 0.3 })), 100, 0.5);
    const improHeld = dr.judgeImpro(song, [{ m: 64, t: 100.1 }, { m: 60, t: 100 + 28 * 0.5 + 0.1 }], [{ m: 64, t: 100 + 27.9 * 0.5 }], 100, 0.5);
    return { clean, oneWrong, twoWrong, stop, slowWhole, restart, octave, impro, improSilent, improHeld };
  });
  S.ok(r.clean.ok && r.clean.errors === 0 && r.clean.stops === 0, 'judge: clean pass', r.clean);
  S.ok(r.oneWrong.ok && r.oneWrong.errors === 1, 'judge: one wrong note still passes', r.oneWrong);
  S.ok(!r.twoWrong.ok && r.twoWrong.errors === 2 && JSON.stringify(r.twoWrong.bars) === '[2,6]', 'judge: two wrong notes fail, bars 2 and 6', r.twoWrong);
  S.ok(!r.stop.ok && r.stop.stops === 1, 'judge: a 4 s pause is a stop', r.stop);
  S.ok(r.slowWhole.ok && r.slowWhole.stops === 0, 'judge: long notes held in tempo are not stops', r.slowWhole);
  S.ok(!r.restart.ok && r.restart.errors >= 4, 'judge: restart counts as errors', r.restart);
  S.ok(r.octave.ok, 'judge: an octave off is accepted', r.octave);
  S.ok(r.impro.ok, 'impro: note every bar ending on C passes', r.impro);
  S.ok(!r.improSilent.ok && JSON.stringify(r.improSilent.bars) === '[4]', 'impro: silent bar 4 fails', r.improSilent);
  S.ok(r.improHeld.ok, 'impro: one long held note through all bars counts as playing', r.improHeld);
  await page.context().close();
}
S.done();
await closeBrowser();
