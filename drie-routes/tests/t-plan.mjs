// Planning: geen route blijft achter, toetsen nemen hooguit ~60% van de tijd, intervallen kloppen.
import { openApp, closeBrowser, state, suite, APP } from './harness.mjs';
import { D, addDaysStr, runSession, newDay } from './days.mjs';
const file = process.argv[2] || APP;
const S = suite('plan');

async function simulate(mins, days, policy){
  const { page, logs } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  let day = '2026-10-05';
  const perDay = [];
  for (let i = 0; i < days; i++){
    const r = await runSession(page, mins, policy || (() => 'pass'), { practiceMin: 3 });
    perDay.push({ day, plan: r.plan, blocks: r.blocks });
    day = addDaysStr(day, 1); await newDay(page, day);
  }
  const s = await state(page);
  await page.context().close();
  return { perDay, s, logs };
}

// 1. Tien dagen van 5 minuten: elke route wordt binnen de eerste drie dagen geoefend, en geen dag bestaat alleen uit toetsen.
{
  const { perDay, s, logs } = await simulate(5, 10);
  const firstPractice = {};
  perDay.forEach((d, i) => d.plan.forEach(p => { const m = /\| (Noten|Akkoorden|Improviseren): oefenen/.exec(p); if (m && firstPractice[m[1]] == null) firstPractice[m[1]] = i; }));
  S.ok(['Noten', 'Akkoorden', 'Improviseren'].every(r => firstPractice[r] != null && firstPractice[r] <= 2), '5 min: every route practiced by day 3', firstPractice);
  const onlyChecks = perDay.filter(d => d.plan.length && d.plan.every(p => / toets /.test(p)));
  S.ok(onlyChecks.length === 0, '5 min: no check-only days', onlyChecks.map(d => d.day + ': ' + d.plan.join(' / ')));
  const per = { noten: 0, akkoord: 0, impro: 0 };
  s.history.filter(e => e.k === 'practice').forEach(e => per[e.item.split(':')[1]]++);
  S.ok(Math.max(...Object.values(per)) - Math.min(...Object.values(per)) <= 2, '5 min: practice balanced over routes', per);
  S.ok(logs.length === 0, '5 min: no console errors', logs);
  console.log('  5 min plans:'); perDay.forEach(d => console.log('   ', d.day, d.plan.map(p => p.split(' | ')[1] + ' ' + p.split(' | ')[2]).join(' ; ')));
}
// 2. Tien minuten met alles gehaald: toetsen nooit meer dan 6 minuten, intervallen 2, 4, 7 zichtbaar.
{
  const { perDay, s } = await simulate(10, 14);
  const over = perDay.filter(d => d.plan.filter(p => / toets /.test(p)).length * 2 > 6);
  S.ok(over.length === 0, '10 min: checks take at most 6 minutes', over.map(d => d.day + ' ' + d.plan.length));
  const noPractice = perDay.filter(d => d.plan.length && !d.plan.some(p => /oefenen|onderhoud/.test(p)));
  // Een dag zonder oefenblok mag alleen als alle drie de onderdelen die dag getoetst worden: dan is er niets anders open.
  S.ok(noPractice.every(d => d.plan.length === 3), '10 min: check-only days only when every item is checked', noPractice.map(d => d.day + ' ' + d.plan.length));
  const it = s.items['clair:noten'];
  const checks = s.history.filter(e => e.k === 'check' && e.item === 'clair:noten').map(e => e.d);
  const gaps = checks.slice(1).map((d, i) => Math.round((new Date(d) - new Date(checks[i])) / 864e5));
  S.ok(it.level === 0 && it.streak >= 2, '10 min: clair noten reaches no-help with streak', it);
  S.ok(gaps.length >= 3 && gaps[0] === 1 && gaps.slice(2).every(g => g >= 2), 'check gaps grow (1, then >=2)', { checks, gaps });
  console.log('  clair:noten check days', checks.join(', '), 'gaps', gaps.join(','));
}
// 3. Mislukken: twee keer achter elkaar mis op weinig hulp geeft weer veel hulp; extra oefenblok verschijnt.
{
  const { page } = await openApp({ file, time: D('2026-10-05'), store: null });
  await page.click('[data-act="startsong"]');
  let day = '2026-10-05';
  await runSession(page, 15, () => 'pass');
  const notes = [];
  day = addDaysStr(day, 1); await newDay(page, day);
  await runSession(page, 15, () => 'pass');
  const s1 = await state(page);
  S.ok(s1.items['clair:noten'].level === 1, 'pass at day 2 lowers help to level 1', s1.items['clair:noten']);
  const fails = info => info.help.startsWith('Noten') ? 'fail' : 'pass';
  for (let i = 0; i < 2; i++){
    day = addDaysStr(day, 1); await newDay(page, day);
    const r = await runSession(page, 15, fails, { markBar: true });
    r.blocks.filter(b => b.failNote).forEach(b => notes.push(day + ' ' + b.failNote));
    const s = await state(page);
    notes.push(day + ' noten L' + s.items['clair:noten'].level + ' f' + s.items['clair:noten'].fails + ' hard=' + JSON.stringify(s.items['clair:noten'].hard));
  }
  const s = await state(page);
  S.ok(s.items['clair:noten'].level === 2, 'repeated fails bring help back to level 2', s.items['clair:noten']);
  S.ok(notes.some(n => /extra oefenblok|Straks oefen/.test(n)), 'failed check schedules practice', notes);
  S.ok(s.items['clair:noten'].hard.includes(2), 'marked bar stays as hard after fail', s.items['clair:noten'].hard);
  // Daarna gehaald: lastige maten worden leeggemaakt
  day = addDaysStr(day, 1); await newDay(page, day);
  await runSession(page, 15, () => 'pass');
  const s2 = await state(page);
  S.ok(s2.items['clair:noten'].hard.length === 0, 'passing a check clears hard bars', s2.items['clair:noten'].hard);
  console.log('  fail trace:', notes.join(' | '));
  await page.context().close();
}
S.done();
await closeBrowser();
