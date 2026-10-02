import { openApp, closeBrowser, suite, APP } from './harness.mjs';
const file = process.argv[2] || APP;
const S = suite('engine');
const { page, logs } = await openApp({ file, time: new Date('2026-10-05T09:00:00'), store: null, hash: '#test' });
await page.waitForFunction(() => !!window.ABCJS);
const info = await page.evaluate(() => {
  const dr = window.__dr;
  return dr.BUILTIN.map(s => ({
    id: s.id, bars: s.bars.length, lens: s.bars.map(b => b.len), meter: s.meter, key: s.key,
    notes: s.tl.notes.map(n => n.midi), names: s.tl.notes.map(n => n.name), chords: s.chordSyms, lh: s.lh,
    roots: s.chordSyms.map(c => dr.lhRoot(s, c)), fingers: s.chordSyms.map(c => dr.lhFinger(s, c)),
    length: s.tl.length, lo: s.lo, hi: s.hi,
    abcWarn: (() => { const d = document.createElement('div'); document.body.appendChild(d); const t = ABCJS.renderAbc(d, dr.abcFor(s, { names: true, chords: true, perLine: 4 }), { add_classes: true }); const w = t[0].warnings || []; const nEls = d.querySelectorAll('.abcjs-note').length; d.remove(); return { w, nEls }; })()
  }));
});
const exp = {
  clair: { bars: 8, notes: [60,60,60,62,64,62,60,64,62,62,60,60,60,60,62,64,62,60,64,62,62,60] },
  ode: { bars: 8, first: [64,64,65,67,67,65,64,62] },
  kortjakje: { bars: 12, first: [60,60,67,67,69,69,67] },
  jacob: { bars: 8, first: [60,62,64,60,60,62,64,60,64,65,67,64,65,67,67,69,67,65,64,60] },
  jingle: { bars: 16, first: [64,64,64,64,64,64,64,67,60,62,64] },
  canon: { bars: 9, first: [76,74,72,71,69,67,69,71,72,71,69,67,65,64,65,62,60] },
  jarig: { bars: 9, first: [67,67,69,67,72,71,67,67,69,67,74,72] },
  menuet: { bars: 16, first: [74,67,69,71,72,74,67,67,76,72,74,76,78,79,67,67] }
};
for (const s of info){
  const e = exp[s.id];
  const meterLen = s.meter === '3/4' ? 3 : 4;
  S.ok(s.bars === e.bars, s.id + ' bars', s.bars);
  S.ok(s.lens.every(l => Math.abs(l - meterLen) < 1e-9), s.id + ' every bar full', s.lens);
  if (e.notes) S.ok(JSON.stringify(s.notes) === JSON.stringify(e.notes), s.id + ' notes exact', s.notes);
  if (e.first) S.ok(JSON.stringify(s.notes.slice(0, e.first.length)) === JSON.stringify(e.first), s.id + ' first notes', s.notes.slice(0, e.first.length));
  S.ok(s.abcWarn.w.length === 0, s.id + ' abcjs no warnings', s.abcWarn.w);
  S.ok(s.abcWarn.nEls === s.notes.length, s.id + ' abcjs note elements = model notes', [s.abcWarn.nEls, s.notes.length]);
  console.log(s.id.padEnd(10), s.meter, s.key, 'bars', s.bars, 'range', s.lo + '-' + s.hi, 'chords', s.chords.join(','), '| LH', s.fingers.join('; '));
}
const menuet = info.find(s => s.id === 'menuet');
S.ok(menuet.names.includes('F♯') && !menuet.notes.includes(65) && menuet.notes.includes(66), 'menuet F is F sharp');
// Parser edge cases
const edge = await page.evaluate(() => {
  const dr = window.__dr, out = {};
  const tryp = (abc, o) => { try { const p = dr.parseAbc(abc, o || {}); return { ok: true, bars: p.bars.length, durs: p.bars.map(b => b.items.map(x => +x.dur.toFixed(3))), midi: p.bars.map(b => b.items.map(x => x.midi)), head: p.head }; } catch (e) { return { ok: false, msg: e.message }; } };
  out.broken = tryp('A>B C<D |]');
  out.tie = tryp('C2 C2- | C2 D2 |]');
  out.triplet = tryp('(3CDE C2 |]');
  out.repeat = tryp('|: C D E F :| G4 |]');
  out.accBar = tryp('^F F =F F | F4 |]', { key: 'G' });
  out.header = tryp('X:1\nT:Test liedje\nM:3/4\nL:1/8\nK:Em\nE2 G2 B2 | e6 |]');
  out.chordFallback = tryp('"D7sus4"D4 | "Am9"A4 |]');
  out.badChord = tryp('"Coda"C4 |]');
  out.tooLong = tryp('C D E F G | C4 |]');
  out.tooShort = tryp('C4 | C D E | C4 |]');
  out.pickup = tryp('G | C D E F | G4 |]');
  out.chordBrackets = tryp('[CEG]4 |]');
  out.ending = tryp('|: C4 |1 D4 :|2 E4 |]');
  out.unknownKey = tryp('C4 |]', { key: 'C#' });
  out.empty = tryp('');
  return out;
});
const E = edge;
S.ok(E.broken.ok && JSON.stringify(E.broken.durs[0]) === JSON.stringify([1.5, 0.5, 0.5, 1.5]), 'broken rhythm', E.broken);
S.ok(E.tie.ok, 'tie parses', E.tie);
S.ok(E.triplet.ok && Math.abs(E.triplet.durs[0].slice(0, 3).reduce((a, b) => a + b, 0) - 2) < 0.01, 'triplet = 2 beats', E.triplet);
S.ok(E.repeat.ok && E.repeat.bars === 3, 'repeat expands to 3 bars', E.repeat);
S.ok(E.accBar.ok && JSON.stringify(E.accBar.midi[0]) === JSON.stringify([66, 66, 65, 65]) && E.accBar.midi[1][0] === 66, 'accidentals carry within bar and reset', E.accBar.midi);
S.ok(E.header.ok && E.header.head.meter === '3/4' && E.header.head.key === 'Em' && E.header.head.title === 'Test liedje' && E.header.midi[0][0] === 64, 'header fields parsed', E.header);
S.ok(E.chordFallback.ok, 'chord fallback accepts D7sus4 and Am9', E.chordFallback);
S.ok(!E.badChord.ok && /Coda/.test(E.badChord.msg), 'text as chord rejected with hint', E.badChord.msg);
S.ok(!E.tooLong.ok && /Maat 1 is te lang/.test(E.tooLong.msg), 'too long bar message', E.tooLong.msg);
S.ok(!E.tooShort.ok && /Maat 2 is te kort/.test(E.tooShort.msg), 'too short bar message', E.tooShort.msg);
S.ok(E.pickup.ok, 'pickup bar allowed', E.pickup);
S.ok(!E.chordBrackets.ok, 'chord brackets rejected', E.chordBrackets.msg);
S.ok(!E.ending.ok, 'first/second endings rejected', E.ending.msg);
S.ok(!E.unknownKey.ok, 'unknown key rejected', E.unknownKey.msg);
S.ok(!E.empty.ok, 'empty rejected', E.empty.msg);
console.log('messages:', [E.badChord.msg, E.tooLong.msg, E.chordBrackets.msg, E.ending.msg, E.unknownKey.msg, E.empty.msg].join('\n  '));
S.ok(logs.length === 0, 'no console errors', logs);
S.done();
await closeBrowser();
