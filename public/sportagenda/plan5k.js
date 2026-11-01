'use strict'

// "Terug naar 5 km – het herstelplan van Tara" (oktober 2026), als data.
// Overgenomen uit de weekschema's van hoofdstuk 5 (Versie A) en 6 (Versie B),
// de brugfase (fase 0) en de oefeningen uit hoofdstuk 7. Minuten zijn
// hardloop- en wandelminuten zonder warming-up en cooling-down; die (5 min
// wandelen) voegt de app er zelf aan toe.

// n × (lopen / wandelen): na elk loopblok een wandelblok, zoals in het plan
// ("5 × (2 L / 2 W)" = 10 min lopen, 20 min totaal).
function planIntervals(reps, run, walk) {
  const steps = []
  for (let i = 0; i < reps; i++) {
    steps.push({ t: 'run', min: run })
    if (walk) steps.push({ t: 'walk', min: walk })
  }
  return { label: `${reps} × (${run} L / ${walk} W)`, steps }
}

// Aaneengesloten lopen.
function planContinuous(min) {
  return { label: `${min} min aan één stuk`, steps: [{ t: 'run', min }] }
}

// Losse reeks, bijv. "15 L + 2 W + 10 L".
function planCombo(...parts) {
  const steps = parts.map(([t, min]) => ({ t, min }))
  return { label: parts.map(([t, min]) => `${min} ${t === 'run' ? 'L' : 'W'}`).join(' + '), steps }
}

// Een loopweek: drie trainingen (training 1, 2 en 3 van die week).
const runWeek = (id, runs, extra = false) => ({ id, kind: 'run', runs, extra })
const same3 = (r) => [r, r, r]
const cont3 = (a, b, c) => [planContinuous(a), planContinuous(b), planContinuous(c)]

const PLAN_5K = {
  title: 'Terug naar 5 km',
  versions: {
    A: {
      name: 'Versie A: zonder stressfractuur',
      short: 'Versie A',
      info: 'Alleen als een sportarts heeft vastgesteld dat het MTSS is. ± 10–13 weken.',
      fiveKmNote: 'Extra weken 11–13 alleen als 5 km je meer dan 33 minuten kost.',
      weeks: [
        runWeek('1', same3(planIntervals(5, 2, 2))),
        runWeek('2', same3(planIntervals(5, 3, 2))),
        runWeek('3', same3(planIntervals(4, 5, 2))),
        runWeek('4', same3(planIntervals(3, 8, 2))),
        runWeek('5', [planIntervals(2, 12, 2), planIntervals(2, 12, 2), planCombo(['run', 15], ['walk', 2], ['run', 10])]),
        runWeek('6', cont3(20, 22, 20)),
        runWeek('7', cont3(22, 25, 22)),
        runWeek('8', cont3(25, 27, 25)),
        runWeek('9', cont3(27, 30, 27)),
        runWeek('10', cont3(30, 33, 30)),
        runWeek('11', cont3(32, 36, 32), true),
        runWeek('12', cont3(35, 39, 35), true),
        runWeek('13', cont3(37, 42, 37), true),
      ],
    },
    B: {
      name: 'Versie B: met stressfractuur',
      short: 'Versie B',
      info: 'De standaardroute zolang een botstressletsel niet is uitgesloten. Bij twijfel: Versie B. ± 15–18 weken.',
      fiveKmNote: 'Extra weken 14–15 alleen als 5 km je meer dan 34 minuten kost.',
      weeks: [
        {
          id: 'B1',
          kind: 'bridge',
          walk: 'Elke dag 30 min stevig wandelen',
          walkMin: [30, 30],
          jumps: ['2 × 10 sprongetjes op twee benen', '2 × 10 sprongetjes op twee benen', ''],
        },
        {
          id: 'B2',
          kind: 'bridge',
          walk: '30–45 min wandelen, één keer 60 min',
          walkMin: [45, 60],
          jumps: Array(3).fill('3 × 10 op twee benen + 1 × 5 op één been'),
        },
        {
          id: 'B3',
          kind: 'bridge',
          walk: '45 min wandelen',
          walkMin: [45, 45],
          jumps: Array(3).fill('2 × 10 op één been per kant (de hinktest)'),
        },
        runWeek('1', same3(planIntervals(5, 1, 4))),
        runWeek('2', same3(planIntervals(5, 2, 3))),
        runWeek('3', same3(planIntervals(5, 3, 2))),
        runWeek('4', same3(planIntervals(5, 4, 1))),
        runWeek('5', same3(planIntervals(4, 5, 1))),
        runWeek('6', same3(planIntervals(3, 8, 1))),
        runWeek('7', [planIntervals(2, 10, 1), planIntervals(2, 10, 1), planCombo(['run', 15], ['walk', 1], ['run', 8])]),
        runWeek('8', cont3(20, 22, 20)),
        runWeek('9', cont3(22, 24, 22)),
        runWeek('10', cont3(24, 26, 24)),
        runWeek('11', cont3(26, 28, 26)),
        runWeek('12', cont3(28, 31, 28)),
        runWeek('13', cont3(30, 34, 30)),
        runWeek('14', cont3(33, 37, 33), true),
        runWeek('15', cont3(36, 40, 36), true),
      ],
    },
  },

  // Weekritme uit hoofdstuk 4 ("Ma lopen, Di kracht + springen, ...") plus
  // varianten met dezelfde regel: nooit twee loopdagen achter elkaar.
  // Dagen: 0 = maandag ... 6 = zondag.
  rhythms: [
    { id: 'mwv', label: 'Ma · Wo · Vr lopen (kracht Di · Za, fietsen Do)', run: [0, 2, 4], strength: [1, 5], cross: 3 },
    { id: 'dds', label: 'Di · Do · Za lopen (kracht Wo · Zo, fietsen Vr)', run: [1, 3, 5], strength: [2, 6], cross: 4 },
    { id: 'mdz', label: 'Ma · Do · Za lopen (kracht Di · Vr, fietsen Wo)', run: [0, 3, 5], strength: [1, 4], cross: 2 },
    { id: 'dvz', label: 'Di · Vr · Zo lopen (kracht Wo · Za, fietsen Ma)', run: [1, 4, 6], strength: [2, 5], cross: 0 },
  ],

  // Hoofdstuk 7: kracht en springen.
  strength: {
    name: 'Kracht & springen (herstelplan)',
    exercises: [
      { name: 'Staande heel raise', sets: 3, reps: '15', weight: '', unit: 'reps' },
      { name: 'Zittende soleus raise', sets: 3, reps: '12', weight: '', unit: 'reps' },
      { name: 'Tibialis raise', sets: 3, reps: '15', weight: '', unit: 'reps' },
      { name: 'Zijplank (per kant)', sets: 3, reps: '20', weight: '', unit: 'sec' },
      { name: 'Bulgarian split squat (per been)', sets: 3, reps: '8', weight: '', unit: 'reps' },
      { name: 'Glute bridge', sets: 3, reps: '12', weight: '', unit: 'reps' },
      { name: 'Pogo-sprongetjes', sets: 1, reps: '20', weight: '', unit: 'reps' },
    ],
  },

  rules: [
    'Maximaal 3× per week lopen, nooit twee dagen achter elkaar. Een gemiste training vervalt.',
    '🟢 Pijn 0 tijdens, direct na en de ochtend erna: door naar de volgende week.',
    '🟡 Lichte pijn (1–2) die binnen een uur weg is: week herhalen.',
    '🔴 Pijn die blijft, ochtend- of nachtpijn, of scherpe pijn op één punt: stoppen, 2 rustdagen, een week terug.',
    'Elke looptraining begint en eindigt met 5 minuten wandelen. Wat je fysio zegt, gaat voor.',
  ],
}
