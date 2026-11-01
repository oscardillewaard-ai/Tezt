'use strict'

// ---------- Opslag ----------

const KEY = 'sportagenda.v1' // oude naam bewust behouden: hier staan de gegevens
const APP_VERSION = '21' // ophogen bij elke release, samen met CACHE in sw.js

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)

function defaultState() {
  const ex = (name, sets, reps, weight = '', unit = 'reps') => ({ id: uid(), name, sets, reps, weight, unit })
  return {
    version: 1,
    types: [
      { id: 'gym', name: 'Gym', emoji: '🏋️' },
      { id: 'klimmen', name: 'Klimmen', emoji: '🧗' },
      { id: 'boulderen', name: 'Boulderen', emoji: '🪨' },
      { id: 'wandelen', name: 'Wandelen', emoji: '🥾' },
      { id: 'hardlopen', name: 'Hardlopen', emoji: '🏃' },
      { id: 'fietsen', name: 'Fietsen', emoji: '🚴' },
      { id: 'zwemmen', name: 'Zwemmen', emoji: '🏊' },
      { id: 'yoga', name: 'Yoga / mobiliteit', emoji: '🧘' },
    ],
    templates: [
      {
        id: uid(),
        name: 'Push (borst, schouders, triceps)',
        exercises: [
          ex('Bankdrukken', 3, '8'),
          ex('Schouderdrukken dumbbells', 3, '10'),
          ex('Schuin bankdrukken dumbbells', 3, '10'),
          ex('Lateral raises', 3, '12'),
          ex('Triceps pushdown', 3, '12'),
        ],
      },
      {
        id: uid(),
        name: 'Pull (rug, biceps, grip)',
        exercises: [
          ex('Optrekken / lat pulldown', 3, '8'),
          ex('Kabelroeien', 3, '10'),
          ex('Face pulls', 3, '15'),
          ex('Biceps curls', 3, '12'),
          ex('Hangen aan stang', 3, '30', '', 'sec'),
        ],
      },
      {
        id: uid(),
        name: 'Benen & core',
        exercises: [
          ex('Squat', 3, '8'),
          ex('Roemeense deadlift', 3, '10'),
          ex('Lunges', 3, '10 p/been'),
          ex('Kuitheffen', 3, '15'),
          ex('Plank', 3, '45', '', 'sec'),
        ],
      },
    ],
    sessions: [],
    series: [],
    plans: [],
  }
}

function isValidState(s) {
  return (
    s &&
    typeof s === 'object' &&
    Array.isArray(s.types) &&
    Array.isArray(s.templates) &&
    Array.isArray(s.sessions)
  )
}

// Oudere gegevens: "30 s" als herhalingen -> eenheid seconden.
function normalize(s) {
  s.series ||= []
  s.plans ||= []
  const secMatch = (v) => /^\s*(\d+)\s*s(ec)?\s*$/i.exec(v ?? '')
  for (const t of s.templates) {
    for (const e of t.exercises) {
      if (e.unit) continue
      const m = secMatch(e.reps)
      e.unit = m ? 'sec' : 'reps'
      if (m) e.reps = m[1]
    }
  }
  for (const x of s.sessions) {
    for (const e of x.log?.exercises || []) {
      if (e.unit) continue
      const m = secMatch(e.target?.reps)
      e.unit = m ? 'sec' : 'reps'
      if (m) e.target.reps = m[1]
    }
  }
  return s
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isValidState(parsed)) return normalize(parsed)
    }
  } catch {
    // Corrupte of ontoegankelijke opslag: begin met de standaardgegevens.
  }
  return defaultState()
}

let state = load()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    alert('Opslaan is mislukt (opslag vol of geblokkeerd). Maak een back-up via "Meer".')
  }
}

// ---------- Datums ----------

const DAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag']
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

const pad = (n) => String(n).padStart(2, '0')
// Lokale datum als YYYY-MM-DD (niet toISOString: dat is UTC en verschuift rond middernacht).
const toKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromKey = (k) => {
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (d, n) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}
const startOfWeek = (d) => {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7))
  return r
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7)
}
const shortDate = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
const todayKey = () => toKey(new Date())

// ---------- Hulpjes ----------

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

const typeById = (id) => state.types.find((t) => t.id === id) || { id, name: 'Onbekend', emoji: '❔' }
const templateById = (id) => state.templates.find((t) => t.id === id)
// Bij hardlopen houden we scheenpijn bij (0 = geen, 10 = ergst denkbaar).
const tracksShin = (typeId) => typeId === 'hardlopen'
const isRunType = tracksShin
const shinClass = (v) => (v <= 2 ? 'low' : v <= 5 ? 'mid' : 'high')

function fmtMinutes(min) {
  if (!min) return '0 min'
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h}u${m ? ' ' + pad(m) : ''}` : `${m} min`
}

function sessionsBetween(fromK, toK) {
  return state.sessions.filter((s) => s.date >= fromK && s.date <= toK)
}

function sortSessions(list) {
  return list.slice().sort((a, b) => (a.time || '99').localeCompare(b.time || '99'))
}

// ---------- UI-state ----------

const ui = {
  tab: 'week',
  weekStart: startOfWeek(new Date()),
  persisted: null, // null = onbekend / niet ondersteund
  active: null, // id van de training die nu open staat in de workout-weergave
  restEnd: null, // tijdstip (ms) waarop de lopende rusttimer afloopt
  hold: null, // lopende aftelklok voor een set op tijd: { ex, set, target, startAt, name }
  calMode: 'week', // 'week' | 'maand'
  run: null, // id van de looptraining die nu in de intervaltimer staat
  scrollFrom: -2, // doorlopende agenda: weken t.o.v. deze week
  scrollTo: 10,
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
}

const view = document.getElementById('view')
const title = document.getElementById('title')
const fab = document.getElementById('fab')
const sheet = document.getElementById('sheet')
const topActions = document.getElementById('top-actions')

// Topbalk-knoppen (Week/Maand) vallen buiten #view en hebben een eigen klik-afhandeling.
topActions.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el)
})

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches

function renderWelcome() {
  const install = isStandalone()
    ? ''
    : `<div class="welcome-install">📲 Tip: tik in Safari op het deel-icoon en kies <strong>Zet op beginscherm</strong>. Dan werkt Tarapp als echte app, ook offline.</div>`
  return `
    <div class="welcome-screen">
      <img class="welcome-logo" src="icons/icon-192.png" alt="" />
      <h1>Hoi Tara! 💛</h1>
      <p class="tagline">Welkom in Tarapp, jouw eigen sportagenda.<br />${esc(dailyCompliment())}</p>
      <ul class="welcome-list">
        <li><span>📅</span><div><strong>Agenda</strong>Plan gym, klimmen, wandelen en meer, per week of per maand.</div></li>
        <li><span>🏋️</span><div><strong>Gymtraining</strong>Log kg en herhalingen per set, met supersets, rusttimer en aftelklok.</div></li>
        <li><span>📊</span><div><strong>Overzicht</strong>Je weken op rij, minuten per activiteit en scheenpijn na het hardlopen.</div></li>
        <li><span>🔒</span><div><strong>Alleen op jouw telefoon</strong>Geen account nodig. Alles blijft op je telefoon, tenzij je zelf je horloge koppelt. Maak af en toe een back-up via Meer.</div></li>
      </ul>
      ${install}
      <button class="btn primary block" data-action="welcome-done">Aan de slag</button>
    </div>`
}

function render() {
  if (state.series.length) {
    const horizon = [
      toKey(addDays(new Date(), 84)),
      toKey(addDays(ui.weekStart, 6)),
      toKey(addDays(ui.month, 41)),
      toKey(addDays(startOfWeek(new Date()), 7 * ui.scrollTo + 6)),
    ]
      .sort()
      .pop()
    ensureRecurring(horizon)
  }
  const welcome = !state.settings?.welcomed
  document.body.classList.toggle('welcome', welcome)
  if (welcome) {
    view.innerHTML = renderWelcome()
    return
  }
  const running = runSession()
  if (ui.run && !running) ui.run = null
  const active = !running && ui.active && state.sessions.find((s) => s.id === ui.active)
  document.body.classList.toggle('in-workout', !!(active || running))
  document.body.classList.toggle('in-run', !!running)
  if (running) {
    topActions.innerHTML = ''
    view.innerHTML = renderRunPlayer(running)
    // De timer vult de hele hoogte onder de bovenbalk.
    view.style.setProperty('--rp-height', `${window.innerHeight - topbarBottom()}px`)
    return
  }
  if (active) {
    topActions.innerHTML = ''
    view.innerHTML = renderWorkout(active)
    renderHoldBar()
    return
  }
  ui.active = null
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab)
  })
  // De agenda heeft per dag een +; de zwevende knop alleen bij schema's.
  fab.hidden = ui.tab !== 'schemas'
  topActions.innerHTML = ui.tab === 'week' ? calToggle() : ''
  const renderers = { week: renderWeek, overzicht: renderOverview, schemas: renderSchemas, meer: renderMore }
  const scrolling = ui.tab === 'week' && ui.calMode === 'week' && agendaScrolls()
  const anchor = scrolling ? scrollAnchor() : null
  view.innerHTML = renderers[ui.tab]()
  if (anchor) restoreScrollAnchor(anchor)
  watchMoreWeeks(scrolling)
}

// ---------- Complimentjes voor Tara ----------

const COMPLIMENTS = [
  'Tara, jij bent de beste.',
  'Tara, jij bent de liefste.',
  'Tara, jij bent de leukste.',
  'Tara, jij bent de meest inspirerende persoon die er is.',
  'Tara, jij maakt iedereen om je heen blijer.',
  'Tara, jouw doorzettingsvermogen is ongelooflijk.',
  'Tara, jij bent sterker dan je denkt.',
  'Tara, jij straalt gewoon.',
  'Tara, jij bent een topper.',
  'Tara, de wereld is mooier met jou erin.',
  'Tara, jij bent grappig, slim én sterk.',
  'Tara, jij laat zien hoe het moet.',
  'Tara, jij bent een voorbeeld voor iedereen.',
  'Tara, jouw lach is de beste.',
  'Tara, jij kunt alles aan.',
  'Tara, jij bent goud waard.',
  'Tara, niemand doet het zoals jij.',
  'Tara, jij bent zo lief voor iedereen.',
  'Tara, jij bent de allerleukste.',
  'Tara, met jou is alles leuker.',
  'Tara, jij bent gewoon geweldig.',
  'Tara, jij inspireert iedereen om je heen.',
  'Tara, jij bent een kanjer.',
  'Tara, jij bent uniek en dat is prachtig.',
]

const CHEERS = [
  'Goed bezig, Tara! Jij bent echt de beste. 💛',
  'Weer een gedaan! Tara, je bent een topper. 💪',
  'Yes Tara! Zo inspirerend. ✨',
  'Kijk jou eens gaan, Tara! De leukste én de sterkste. 🔥',
  'Tara, wat ben je goed bezig. Echt de liefste. 💛',
  'Afgevinkt! Niemand doet het zoals jij, Tara. 🌟',
  'Tara, jij bent onstopbaar. 💪',
  'Trots op je, Tara! 💛',
]

// Elke dag hetzelfde complimentje, de volgende dag een ander.
function dailyCompliment() {
  const d = new Date()
  const dayNr = Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 86400000)
  return COMPLIMENTS[dayNr % COMPLIMENTS.length]
}

function cheer() {
  showToast(CHEERS[Math.floor(Math.random() * CHEERS.length)])
}

// ---------- Wat is er nieuw ----------

// Nieuwste bovenaan. Bij een release: APP_VERSION ophogen en hier een regel toevoegen.
const CHANGELOG = [
  {
    v: 21,
    items: ['Het weekritme bij het 5 km-plan laat nu precies zien wat je kiest, met een voorbeeldweek: bij 2× per week staan er ook echt 2 loopdagen 💛'],
  },
  {
    v: 20,
    items: [
      '⌚ Koppel je Amazfit-horloge (Zepp) via Intervals.icu: je looptrainingen staan dan op je pols 💛',
      'Gelopen trainingen van je horloge vinken zichzelf af, met tijd en afstand',
      'Daarna vraagt Tarapp meteen naar je scheenpijn 🦵',
    ],
  },
  { v: 19, items: ['🏃 Bij het 5 km-plan kun je nu kiezen voor 2× per week lopen in plaats van 3× 💛'] },
  {
    v: 18,
    items: [
      '🏃 Terug naar 5 km: je herstelplan in je agenda, beginnend in de week die bij jou past 💛',
      'Intervaltraining met timer: lopen en wandelen, met piepjes en een stem die je erdoorheen helpt 🎧',
      'De pijn bepaalt het tempo: met één tik een week herhalen 🟡 of een stap terug 🔴',
      'Swipe links en rechts door je weken 👆',
      'Of zet onder Meer "doorlopend scrollen" aan 📜💖',
    ],
  },
  {
    v: 17,
    items: [
      'Na elke update krijg je nu een liefdevol overzicht van wat er nieuw is 💌',
      'Onder Meer kun je alle versies teruglezen 📖💛',
    ],
  },
  { v: 16, items: ['Pas je een herhalende training aan? Dan kies je zelf: alleen deze of alle volgende weken 💛'] },
  {
    v: 15,
    items: ['Elke week herhalen met één vinkje 🔁, want jij houdt het vol 💪💖', 'Ook achteraf aan te zetten bij een training die al in je agenda staat'],
  },
  { v: 13, items: ['Elke dag een complimentje, want jij bent de beste 💖', 'Een aanmoediging bij elke training die je afvinkt 🎉💛'] },
  { v: 12, items: ['Geen per ongeluk verversen meer als je naar beneden scrolt 🙌'] },
  { v: 11, items: ['De prullenbak staat nu netjes boven de tabbalk ✨'] },
  { v: 10, items: ['Sleep wat weg mag naar de prullenbak 🗑️', 'Met "Ongedaan maken" voor als je je bedenkt 💛'] },
  { v: 9, items: ['Houd een training vast en sleep hem naar een andere dag 🤏', 'Oefeningen in je schema verslepen met ⠿'] },
  { v: 8, items: ['De app heet nu Tarapp, naar de allerleukste 💛', 'Zonnig geel, een nieuw icoon en een welkomstscherm speciaal voor jou ☀️'] },
  { v: 7, items: ['Aftelklok voor plank en dead hang ⏱️, jij houdt het langer vol dan wie ook 💪💖'] },
  { v: 6, items: ['Supersets 🔗', 'Oefeningen in seconden in plaats van herhalingen ⏱️', 'Oefeningen herschikken met ▲▼'] },
  { v: 5, items: ['Scheenpijn bijhouden bij het hardlopen, want we zorgen goed voor jou 🦵💛'] },
  {
    v: 4,
    items: [
      'Updates komen vanzelf binnen, zonder opnieuw installeren ✨',
      'Je hele week in één scherm 📅',
      'Gymtraining met kg en herhalingen per set, rusttimer en opmerkingen 🏋️💛',
      'Maandoverzicht 🗓️',
    ],
  },
]

function openChangelog(sinceVersion = 0) {
  const entries = CHANGELOG.filter((e) => e.v > sinceVersion)
  const updated = sinceVersion > 0
  openSheet(
    `
    <form method="dialog">
      <div class="cl-hearts" aria-hidden="true"><span>💛</span><span>💖</span><span>💛</span><span>💗</span><span>💛</span></div>
      <h2 class="cl-title">${updated ? 'Nieuw voor jou, Tara! 💛' : 'Alles wat er nieuw is, Tara 💛'}</h2>
      <p class="muted cl-intro">${updated ? `Tarapp is bijgewerkt naar versie ${APP_VERSION}, speciaal voor de liefste 💖` : 'Alles wat er voor jou gemaakt is, met liefde 💖'}</p>
      <div class="changelog">
        ${entries
          .map(
            (e) => `
          <section>
            <h3>💛 Versie ${e.v}</h3>
            <ul>${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>
          </section>`,
          )
          .join('')}
      </div>
      <button type="submit" class="btn primary block">Dankjewel! 💛</button>
    </form>`,
    () => {},
  )
}

// Eenmalig na een update laten zien wat er nieuw is.
function showChangesSinceLastVisit() {
  state.settings ||= {}
  const current = Number(APP_VERSION)
  // Bestaande gebruikers van vóór deze functie: laat de laatste paar versies zien.
  const seen = Number(state.settings.seenVersion || (state.settings.welcomed ? 15 : current))
  state.settings.seenVersion = current
  save()
  if (seen < current && state.settings.welcomed) openChangelog(seen)
}

// ---------- Week ----------

function calToggle() {
  return `
    <div class="segmented">
      <button class="${ui.calMode === 'week' ? 'on' : ''}" data-action="cal-mode" data-mode="week">Week</button>
      <button class="${ui.calMode === 'maand' ? 'on' : ''}" data-action="cal-mode" data-mode="maand">Maand</button>
    </div>`
}

const DAYS_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

// De zeven dagregels van één week.
function weekDaysHtml(ws, list) {
  const tKey = todayKey()
  let days = ''
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i)
    const k = toKey(d)
    const daySessions = sortSessions(list.filter((s) => s.date === k))
    days += `
      <div class="wday ${k === tKey ? 'today' : ''}" data-drop-date="${k}">
        <div class="wday-label"><span>${DAYS_SHORT[i]}</span><strong>${d.getDate()}</strong></div>
        <div class="wday-items">
          ${daySessions.length ? daySessions.map(sessionRow).join('') : '<span class="rest">rust</span>'}
        </div>
        <button class="day-add" data-action="add" data-date="${k}" aria-label="Training toevoegen op ${DAYS[i]}">+</button>
      </div>`
  }
  return days
}

function renderWeek() {
  if (ui.calMode === 'maand') return renderMonth()
  if (agendaScrolls()) return renderWeekScroll()
  const ws = ui.weekStart
  const we = addDays(ws, 6)
  const list = sessionsBetween(toKey(ws), toKey(we))
  const done = list.filter((s) => s.done)
  const doneMin = done.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0
  const isCurrent = toKey(ws) === toKey(startOfWeek(new Date()))
  title.textContent = 'Tarapp'

  const days = weekDaysHtml(ws, list)

  return `
    <div class="weeknav compact">
      <button class="iconbtn" data-action="prev-week" aria-label="Vorige week">‹</button>
      <div class="label">
        <strong>Week ${isoWeek(ws)}</strong>
        <span class="muted">${shortDate(ws)} – ${shortDate(we)}</span>
        ${isCurrent ? '' : '<button class="linkbtn" data-action="this-week">Vandaag</button>'}
      </div>
      <button class="iconbtn" data-action="next-week" aria-label="Volgende week">›</button>
    </div>
    <div class="compliment">💛 ${esc(dailyCompliment())}</div>
    <div class="wsummary">
      <span><strong>${done.length}/${list.length}</strong> gedaan · ${fmtMinutes(doneMin)}</span>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>
    <div class="wdays">${days}</div>`
}

// ---------- Doorlopende agenda ----------
// Instelling onder Meer: alle weken onder elkaar, verder laden bij het scrollen.

const agendaScrolls = () => !!state.settings?.agendaScroll

function renderWeekScroll() {
  title.textContent = 'Tarapp'
  const base = startOfWeek(new Date())
  let html = `
    <div class="compliment">💛 ${esc(dailyCompliment())}</div>
    <button class="btn block load-earlier" data-action="weeks-earlier">↑ Eerdere weken</button>`
  for (let w = ui.scrollFrom; w <= ui.scrollTo; w++) {
    const ws = addDays(base, 7 * w)
    const we = addDays(ws, 6)
    const list = sessionsBetween(toKey(ws), toKey(we))
    const done = list.filter((s) => s.done).length
    html += `
      <div class="wk-head ${w === 0 ? 'current' : ''}" id="wk-${toKey(ws)}">
        <strong>Week ${isoWeek(ws)}</strong>
        <span class="muted">${shortDate(ws)} – ${shortDate(we)}</span>
        <span class="wk-count">${list.length ? `${done}/${list.length}` : ''}</span>
      </div>
      <div class="wdays">${weekDaysHtml(ws, list)}</div>`
  }
  return html + '<div id="weeks-more" class="muted load-more">Meer weken…</div>'
}

const topbarBottom = () => document.querySelector('.topbar').getBoundingClientRect().bottom

// Bij opnieuw opbouwen dezelfde week op dezelfde hoogte houden.
function scrollAnchor() {
  const head = [...view.querySelectorAll('.wk-head')].find((h) => h.getBoundingClientRect().bottom > topbarBottom())
  return head && { id: head.id, top: head.getBoundingClientRect().top }
}
function restoreScrollAnchor({ id, top }) {
  const el = document.getElementById(id)
  if (el) window.scrollBy(0, el.getBoundingClientRect().top - top)
}

function scrollToWeek(d) {
  const off = Math.round(daysBetween(toKey(startOfWeek(new Date())), toKey(startOfWeek(d))) / 7)
  if (off - 1 < ui.scrollFrom || off + 4 > ui.scrollTo) {
    ui.scrollFrom = Math.min(ui.scrollFrom, off - 1)
    ui.scrollTo = Math.max(ui.scrollTo, off + 4)
    render()
  }
  const el = document.getElementById(`wk-${toKey(startOfWeek(d))}`)
  if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - topbarBottom() - 8)
}

let moreObserver
function watchMoreWeeks(on) {
  moreObserver?.disconnect()
  const el = on && document.getElementById('weeks-more')
  if (!el || !('IntersectionObserver' in window)) return
  moreObserver = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting) || ui.scrollTo > 156) return
      ui.scrollTo += 8
      render()
    },
    { rootMargin: '400px' },
  )
  moreObserver.observe(el)
}

// ---------- Swipen tussen weken ----------
// Snel horizontaal vegen = vorige/volgende week (of maand). Niet vanaf de
// schermrand (systeemgebaren) en niet tijdens slepen of in de doorlopende agenda.

let swipe = null
view.addEventListener(
  'touchstart',
  (e) => {
    swipe = null
    if (ui.tab !== 'week' || ui.active || ui.run || e.touches.length !== 1) return
    if (ui.calMode === 'week' && agendaScrolls()) return
    const t = e.touches[0]
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) return
    swipe = { x: t.clientX, y: t.clientY, t: Date.now() }
  },
  { passive: true },
)
view.addEventListener(
  'touchend',
  (e) => {
    const sw = swipe
    swipe = null
    if (!sw || document.body.classList.contains('is-dragging') || sheet.open) return
    const t = e.changedTouches[0]
    const dx = t.clientX - sw.x
    const dy = t.clientY - sw.y
    if (Date.now() - sw.t > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    const dir = dx < 0 ? 1 : -1
    if (ui.calMode === 'maand') ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + dir, 1)
    else ui.weekStart = addDays(ui.weekStart, 7 * dir)
    render()
    view.classList.remove('swipe-next', 'swipe-prev')
    void view.offsetWidth
    view.classList.add(dir > 0 ? 'swipe-next' : 'swipe-prev')
  },
  { passive: true },
)
view.addEventListener('animationend', () => view.classList.remove('swipe-next', 'swipe-prev'))

const MONTHS_FULL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

function renderMonth() {
  title.textContent = 'Tarapp'
  const m = ui.month
  const first = toKey(m)
  const last = toKey(new Date(m.getFullYear(), m.getMonth() + 1, 0))
  const list = sessionsBetween(first, last)
  const done = list.filter((s) => s.done)
  const doneMin = done.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
  const now = new Date()
  const isCurrent = m.getFullYear() === now.getFullYear() && m.getMonth() === now.getMonth()
  const tKey = todayKey()

  let cells = DAYS.map((d) => `<div class="cal-dow">${d.slice(0, 2)}</div>`).join('')
  // Altijd vanaf de maandag van de week waarin de 1e valt, tot en met de zondag van de laatste week.
  const start = startOfWeek(m)
  const end = addDays(startOfWeek(fromKey(last)), 6)
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const k = toKey(d)
    const inMonth = d.getMonth() === m.getMonth()
    const day = sortSessions(state.sessions.filter((s) => s.date === k))
    const marks = day
      .map((s) => `<span class="cal-mark ${s.done ? 'done' : ''} ${s.planId ? 'plan' : ''}">${esc(typeById(s.typeId).emoji)}</span>`)
      .join('')
    cells += `
      <button class="cal-day ${inMonth ? '' : 'out'} ${k === tKey ? 'today' : ''}" data-action="cal-day" data-date="${k}">
        <span class="cal-num">${d.getDate()}</span>
        <span class="cal-marks">${marks}</span>
      </button>`
  }

  return `
    <div class="weeknav compact">
      <button class="iconbtn" data-action="prev-month" aria-label="Vorige maand">‹</button>
      <div class="label">
        <strong>${MONTHS_FULL[m.getMonth()]} ${m.getFullYear()}</strong>
        ${isCurrent ? '' : '<button class="linkbtn" data-action="this-month">Naar deze maand</button>'}
      </div>
      <button class="iconbtn" data-action="next-month" aria-label="Volgende maand">›</button>
    </div>
    <section class="card">
      <div><strong>${done.length}</strong> van <strong>${list.length}</strong> trainingen gedaan · ${fmtMinutes(doneMin)}</div>
      <div class="progress"><div style="width:${list.length ? Math.round((done.length / list.length) * 100) : 0}%"></div></div>
    </section>
    <div class="cal">${cells}</div>
    <p class="muted">Groen omrand = gedaan. Tik op een dag om die week te openen.</p>`
}

function sessionRow(s) {
  const t = typeById(s.typeId)
  const tpl = s.templateId && templateById(s.templateId)
  const busy = (s.log && !s.log.endedAt) || (s.runLog && !s.runLog.endedAt)
  const inProgress = [busy ? '▶ bezig' : '', seriesOf(s) ? '🔁' : ''].filter(Boolean).join(' ')
  const shin = Number.isInteger(s.shin)
    ? ` <span class="shin-badge ${shinClass(s.shin)}" title="Scheenpijn ${s.shin}/10">🦵${s.shin}</span>`
    : ''
  // Bij plantrainingen zegt de notitie (planweek) meer dan de schemanaam.
  const meta = [
    inProgress,
    s.time,
    s.run?.label,
    s.duration ? fmtMinutes(Number(s.duration)) : '',
    s.distance ? `${fmtNum(Math.round(s.distance / 100) / 10)} km` : '',
    s.icuId ? '⌚' : '',
    tpl && !s.planId ? tpl.name : '',
    s.note,
  ]
    .filter(Boolean)
    .map(esc)
    .join(' · ')
  return `
    <div class="session ${s.done ? 'done' : ''} ${s.planId ? 'plan' : ''}">
      <button class="check" data-action="toggle" data-id="${s.id}" aria-label="${s.done ? 'Markeer als niet gedaan' : 'Afvinken'}">${s.done ? '✓' : ''}</button>
      <button class="s-body" data-action="edit" data-id="${s.id}">
        <span class="s-title">${esc(t.emoji)} ${esc(t.name)}${s.planId ? ' <span class="plan-badge">5K</span>' : ''}${shin}</span>
        ${meta ? `<span class="s-meta">${meta}</span>` : ''}
      </button>
    </div>`
}

// ---------- Overzicht ----------

function renderOverview() {
  title.textContent = 'Overzicht'
  const thisWeek = startOfWeek(new Date())
  const weeks = []
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i)
    const list = sessionsBetween(toKey(ws), toKey(addDays(ws, 6)))
    weeks.push({ ws, planned: list.length, done: list.filter((s) => s.done).length, current: i === 0 })
  }
  const max = Math.max(1, ...weeks.map((w) => w.planned))
  const bars = weeks
    .map(
      (w) => `
      <div class="bar ${w.current ? 'current' : ''}">
        <span>${w.done}</span>
        <div class="col" style="height:${(w.planned / max) * 100}%">
          <div style="height:${w.planned ? (w.done / w.planned) * 100 : 0}%"></div>
        </div>
        <span>wk ${isoWeek(w.ws)}</span>
      </div>`,
    )
    .join('')

  // Reeks: aaneengesloten weken met minstens één afgevinkte training.
  // De lopende week telt mee als er al iets gedaan is, maar breekt de reeks niet.
  let streak = 0
  for (let i = 0; ; i++) {
    const ws = addDays(thisWeek, -7 * i)
    const any = sessionsBetween(toKey(ws), toKey(addDays(ws, 6))).some((s) => s.done)
    if (any) streak++
    else if (i > 0) break
    if (i > 520) break
  }

  const now = new Date()
  const monthStart = toKey(new Date(now.getFullYear(), now.getMonth(), 1))
  const monthEnd = toKey(new Date(now.getFullYear(), now.getMonth() + 1, 0))
  const monthDone = sessionsBetween(monthStart, monthEnd).filter((s) => s.done)
  const monthMin = monthDone.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)

  const perType = {}
  for (const s of monthDone) {
    const p = (perType[s.typeId] ||= { n: 0, min: 0 })
    p.n++
    p.min += Number(s.duration) || 0
  }
  const rows = Object.entries(perType)
    .sort((a, b) => b[1].n - a[1].n)
    .map(([id, p]) => {
      const t = typeById(id)
      return `<tr><td>${esc(t.emoji)} ${esc(t.name)}</td><td>${p.n}×</td><td>${fmtMinutes(p.min)}</td></tr>`
    })
    .join('')

  return `
    <section class="card">
      <div class="stat-grid">
        <div><strong>${streak}</strong><span class="muted">weken op rij</span></div>
        <div><strong>${monthDone.length}</strong><span class="muted">gedaan in ${MONTHS[now.getMonth()]}</span></div>
        <div><strong>${fmtMinutes(monthMin)}</strong><span class="muted">deze maand</span></div>
      </div>
    </section>
    <section class="card">
      <h2>Laatste 8 weken</h2>
      <div class="muted">Grijs = gepland, groen = gedaan</div>
      <div class="bars">${bars}</div>
    </section>
    ${renderShinTrend()}
    <section class="card">
      <h2>Per activiteit (${MONTHS[now.getMonth()]})</h2>
      ${rows ? `<table class="types">${rows}</table>` : '<div class="muted">Deze maand nog niets afgevinkt.</div>'}
    </section>`
}

function renderShinTrend() {
  const runs = state.sessions
    .filter((s) => tracksShin(s.typeId) && Number.isInteger(s.shin))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
    .slice(-10)
  if (!runs.length) return ''
  const bars = runs
    .map((s) => {
      const d = fromKey(s.date)
      return `
      <div class="bar">
        <span>${s.shin}</span>
        <div class="col shin ${shinClass(s.shin)}" style="height:${Math.max(4, s.shin * 10)}%"></div>
        <span>${d.getDate()}/${d.getMonth() + 1}</span>
      </div>`
    })
    .join('')
  const avg = runs.reduce((n, s) => n + s.shin, 0) / runs.length
  return `
    <section class="card">
      <h2>Scheenpijn bij hardlopen</h2>
      <div class="muted">Laatste ${runs.length} run${runs.length === 1 ? '' : 's'} · gemiddeld ${avg.toFixed(1).replace('.', ',')}/10</div>
      <div class="bars" style="grid-template-columns: repeat(${runs.length}, 1fr)">${bars}</div>
    </section>`
}

// ---------- Schema's ----------

function renderSchemas() {
  title.textContent = "Trainingsschema's"
  const items = state.templates
    .map(
      (t) => `
      <div class="list-item">
        <button class="grow" data-action="edit-template" data-id="${t.id}">
          <div class="s-title">${esc(t.name)}</div>
          <div class="s-meta">${t.exercises.length} oefeningen · ${esc(t.exercises.map((e) => (e.superset ? '+ ' : '') + e.name).join(', ').replaceAll(', + ', ' + '))}</div>
        </button>
        <span class="muted">›</span>
      </div>`,
    )
    .join('')
  return `
    ${renderPlanCard()}
    <section class="card">
      ${items || '<div class="muted">Nog geen schema\'s. Tik op + om er een te maken.</div>'}
    </section>
    <p class="muted">Koppel een schema aan een training in je agenda, dan kun je per oefening afvinken wat je gedaan hebt.</p>`
}

// ---------- Meer ----------

function renderMore() {
  title.textContent = 'Meer'
  const visible = state.types.filter((t) => !t.hidden)
  const types = visible
    .map(
      (t) => `
      <div class="list-item">
        <span style="font-size:1.4rem">${esc(t.emoji)}</span>
        <span class="grow">${esc(t.name)}</span>
        <button class="btn danger" data-action="delete-type" data-id="${t.id}" aria-label="${esc(t.name)} verwijderen">✕</button>
      </div>`,
    )
    .join('')
  return `
    ${renderIcuCard()}
    <section class="card">
      <h2>Activiteiten</h2>
      ${types}
      <form class="inline-form" id="type-form">
        <input name="emoji" placeholder="🤸" maxlength="4" aria-label="Emoji" />
        <input name="name" placeholder="Bijv. Kajakken" required aria-label="Naam" />
        <button class="btn primary" type="submit">Toevoegen</button>
      </form>
    </section>
    <section class="card">
      <h2>Agenda</h2>
      <label class="ss-toggle"><input type="checkbox" data-setting="agendaScroll" ${agendaScrolls() ? 'checked' : ''} /> 📜 Doorlopend scrollen door de weken</label>
      <p class="muted">Uit: één week per scherm. Swipe naar links of rechts voor de volgende of vorige week.</p>
      <label class="ss-toggle"><input type="checkbox" data-setting="voice" ${state.settings?.voice === false ? '' : 'checked'} /> 🎧 Gesproken aanwijzingen bij intervaltraining</label>
    </section>
    <section class="card">
      <h2>Back-up</h2>
      <p class="muted">Je gegevens staan alleen op dit toestel. Maak af en toe een back-up, of gebruik dit om over te zetten naar een ander toestel.</p>
      ${
        ui.persisted === true
          ? '<p class="muted">✅ Opslag is als blijvend gemarkeerd.</p>'
          : ui.persisted === false
            ? '<p class="muted">⚠️ Opslag is niet als blijvend gemarkeerd. Installeer de app op je beginscherm en maak regelmatig een back-up.</p>'
            : ''
      }
      <div class="actions">
        <button class="btn" data-action="export">Exporteren</button>
        <button class="btn" data-action="import">Importeren</button>
      </div>
      <input type="file" id="import-file" accept="application/json,.json" hidden />
    </section>
    <section class="card">
      <h2>App bijwerken</h2>
      <p class="muted">Updates worden automatisch binnengehaald als je de app opent. Lukt dat niet, tik dan hieronder. Je gegevens blijven bewaard.</p>
      <button class="btn block" data-action="force-update">Nu bijwerken</button>
      <p></p>
      <button class="btn block" data-action="show-welcome">Welkomstscherm tonen</button>
      <p></p>
      <button class="btn block" data-action="show-changelog">✨ Wat is er nieuw?</button>
      <p class="muted">Versie ${APP_VERSION}</p>
    </section>
    <section class="card">
      <h2>Installeren op iPhone</h2>
      <ol class="steps">
        <li>Open deze pagina in <strong>Safari</strong>.</li>
        <li>Tik op het deel-icoon (vierkant met pijl omhoog).</li>
        <li>Kies <strong>Zet op beginscherm</strong> en tik op <strong>Voeg toe</strong>.</li>
      </ol>
      <p class="muted">Daarna start Tarapp vanaf je beginscherm, zonder browserbalk, en werkt ook offline.</p>
    </section>
    <section class="card">
      <button class="btn danger block" data-action="reset">Alles wissen</button>
    </section>`
}

// ---------- Sheets ----------

function openSheet(html, onSubmit) {
  sheet.innerHTML = html
  const form = sheet.querySelector('form')
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (onSubmit(new FormData(form), form) !== false) closeSheet()
  })
  // Een vervolgvraag kan in het al geopende venster verschijnen.
  if (!sheet.open) sheet.showModal()
}

function closeSheet() {
  sheet.querySelectorAll('.toast').forEach((t) => t.remove())
  sheet.close()
  sheet.innerHTML = ''
}

// Tik op de achtergrond sluit de sheet.
sheet.addEventListener('click', (e) => {
  if (e.target === sheet) closeSheet()
})

function openSessionSheet(session, date) {
  const isNew = !session
  const s = session || {
    typeId: state.types.find((t) => !t.hidden)?.id,
    date: date || todayKey(),
    time: '',
    duration: '',
    templateId: '',
    note: '',
  }
  const typeOptions = state.types
    .filter((t) => !t.hidden || t.id === s.typeId)
    .map(
      (t) => `
      <label>
        <input type="radio" name="typeId" value="${t.id}" ${t.id === s.typeId ? 'checked' : ''} required />
        <span><b>${esc(t.emoji)}</b>${esc(t.name)}</span>
      </label>`,
    )
    .join('')
  const tplOptions = state.templates
    .map((t) => `<option value="${t.id}" ${t.id === s.templateId ? 'selected' : ''}>${esc(t.name)}</option>`)
    .join('')
  const sr = simpleRun(s.run)
  openSheet(
    `
    <form method="dialog">
      <h2>${isNew ? 'Training plannen' : 'Training bewerken'}</h2>
      <div class="type-grid">${typeOptions}</div>
      <div class="row">
        <label class="field">Datum<input type="date" name="date" value="${s.date}" required /></label>
        <label class="field">Tijd<input type="time" name="time" value="${esc(s.time)}" /></label>
      </div>
      <div class="row">
        <label class="field">Duur (min)<input type="number" name="duration" min="0" step="5" inputmode="numeric" value="${esc(s.duration)}" /></label>
        <label class="field">Schema
          <select name="templateId"><option value="">Geen</option>${tplOptions}</select>
        </label>
      </div>
      <div id="run-field" ${isRunType(s.typeId) ? '' : 'hidden'}>
        <div class="field">🏃 Intervallen <span class="muted">(leeg laten = geen)</span></div>
        ${s.run && !sr ? `<p class="muted">Uit je plan: <strong>${esc(s.run.label)}</strong>. Vul hieronder iets in om dit te vervangen.</p>` : ''}
        <div class="run-grid">
          <label>Herhalingen<input name="runReps" inputmode="numeric" value="${sr ? sr.reps : ''}" placeholder="5" /></label>
          <label>Lopen (min)<input name="runRun" inputmode="decimal" value="${sr ? fmtNum(sr.run) : ''}" placeholder="2" /></label>
          <label>Wandelen (min)<input name="runWalk" inputmode="decimal" value="${sr ? fmtNum(sr.walk) : ''}" placeholder="2" /></label>
        </div>
        <label class="ss-toggle"><input type="checkbox" name="runWarm" ${!s.run || s.run.warmup ? 'checked' : ''} /> 5 min wandelen vooraf en achteraf</label>
      </div>
      <label class="ss-toggle repeat-toggle">
        <input type="checkbox" name="weekly" ${!isNew && seriesOf(session) ? 'checked' : ''} /> 🔁 Elke week herhalen
      </label>
      <label class="field" id="shin-field" ${tracksShin(s.typeId) ? '' : 'hidden'}>Scheenpijn (0–10)
        <select name="shin">
          <option value="">Niet ingevuld</option>
          ${Array.from({ length: 11 }, (_, i) => `<option value="${i}" ${s.shin === i ? 'selected' : ''}>${i}${i === 0 ? ' – geen pijn' : i === 10 ? ' – ergst denkbaar' : ''}</option>`).join('')}
        </select>
      </label>
      <label class="field">Notitie<textarea name="note" rows="2" placeholder="Bijv. route, hal, met wie">${esc(s.note)}</textarea></label>
      ${isNew ? '' : planRemoveButton(s)}
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del-session">Verwijderen</button>'}
        <button type="button" class="btn" id="cancel">Annuleren</button>
        <button type="submit" class="btn primary">Opslaan</button>
      </div>
    </form>`,
    (fd) => {
      const data = {
        typeId: fd.get('typeId'),
        date: fd.get('date'),
        time: fd.get('time') || '',
        duration: fd.get('duration') ? Number(fd.get('duration')) : '',
        templateId: fd.get('templateId') || '',
        note: (fd.get('note') || '').trim(),
        shin: tracksShin(fd.get('typeId')) && fd.get('shin') !== '' && fd.get('shin') !== null ? Number(fd.get('shin')) : undefined,
      }
      if (isRunType(data.typeId)) {
        const reps = parseInt(fd.get('runReps'))
        const runMin = parseNum(fd.get('runRun'))
        const warm = fd.get('runWarm') === 'on'
        if (reps > 0 && runMin > 0) data.run = makeRun(reps, runMin, parseNum(fd.get('runWalk')) || 0, warm)
        // Een reeks uit het plan die niet in het formulier past: bewaren.
        else if (s.run && !sr) data.run = { ...s.run, warmup: warm ? RUN_WARMUP : 0, cooldown: warm ? RUN_WARMUP : 0 }
        if (data.run && !data.duration) data.duration = Math.round(runTotal(data.run))
      }
      if (!data.run) data.run = undefined
      let target
      if (isNew) {
        target = { id: uid(), ...data, done: false }
        state.sessions.push(target)
        ui.weekStart = startOfWeek(fromKey(data.date))
      } else {
        // Wijziging aan een herhalende training: vragen of de volgende weken meegaan.
        const changes = Object.fromEntries(
          SERIES_FIELDS.filter((k) => JSON.stringify(data[k] ?? '') !== JSON.stringify(session[k] ?? '')).map((k) => [k, data[k]]),
        )
        const dayDelta = daysBetween(session.date, data.date)
        if (seriesOf(session) && fd.get('weekly') === 'on' && (Object.keys(changes).length || dayDelta)) {
          const origDate = session.date
          askSeriesScope((all) => {
            Object.assign(session, data)
            if (all) applyToFollowing(session, origDate, changes, dayDelta)
            save()
            render()
            if (all) showToast('🔁 Aangepast voor alle volgende weken')
          })
          return false
        }
        target = Object.assign(session, data)
      }
      const wasWeekly = !!seriesOf(target)
      const weekly = fd.get('weekly') === 'on'
      let message = ''
      if (weekly && !wasWeekly) {
        startWeekly(target)
        message = '🔁 Komt nu elke week terug'
      } else if (!weekly && wasWeekly) {
        message = stopWeekly(target)
      }
      save()
      render()
      if (message && !isNew) {
        // Eerst het venster dicht, anders belandt (en verdwijnt) de melding daarin.
        closeSheet()
        showToast(message)
      }
    },
  )

  sheet.querySelector('#cancel').onclick = closeSheet
  sheet.querySelector('.type-grid').addEventListener('change', (e) => {
    sheet.querySelector('#shin-field').hidden = !tracksShin(e.target.value)
    sheet.querySelector('#run-field').hidden = !isRunType(e.target.value)
  })
  const del = sheet.querySelector('#del-session')
  if (del) del.onclick = () => deleteSession(session)
}

// ---------- Actieve training ----------

const isWorkoutSession = (s) => !!(s.templateId || s.typeId === 'gym' || s.log)
const parseNum = (v) => parseFloat(String(v).replace(',', '.'))

// De oefening met dezelfde naam uit de meest recente afgeronde training.
function previousExercise(name, sessionId) {
  const n = name.trim().toLowerCase()
  const past = state.sessions
    .filter((s) => s.id !== sessionId && s.log?.endedAt)
    .sort((a, b) => b.log.endedAt - a.log.endedAt)
  for (const s of past) {
    const ex = s.log.exercises.find((e) => e.name.trim().toLowerCase() === n)
    if (ex && ex.sets.some((x) => x.done)) return { ...ex, sets: ex.sets.filter((x) => x.done) }
  }
  return null
}

const restSeconds = () => state.settings?.rest ?? 90

// iOS staat geluid pas toe na een tik; maak de AudioContext aan bij het afvinken.
let audio
function unlockAudio() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)()
    if (audio.state === 'suspended') audio.resume()
  } catch {
    // Geen geluid beschikbaar; de timer werkt ook zonder.
  }
}
function beep(freqs = [880, 880, 1320]) {
  navigator.vibrate?.(freqs.length > 1 ? [200, 100, 200] : 100)
  if (!audio) return
  for (const [i, freq] of freqs.entries()) {
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    const t0 = audio.currentTime + i * 0.25
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.3, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2)
    osc.connect(gain).connect(audio.destination)
    osc.start(t0)
    osc.stop(t0 + 0.2)
  }
}

// Aftelklok voor een set op tijd: eerst 3 s om in positie te komen.
const HOLD_LEAD_IN = 3
let wakeLock = null
async function keepScreenOn(on) {
  try {
    if (on && !wakeLock) wakeLock = await navigator.wakeLock?.request('screen')
    if (!on && wakeLock) {
      await wakeLock.release()
      wakeLock = null
    }
  } catch {
    // Niet ondersteund: scherm kan op slot gaan, de klok loopt op tijdstempels door.
  }
}

function holdState() {
  const h = ui.hold
  const sinceStart = (Date.now() - h.startAt) / 1000
  if (sinceStart < 0) return { phase: 'lead', left: Math.ceil(-sinceStart) }
  return { phase: 'hold', elapsed: Math.floor(sinceStart), left: Math.max(0, Math.ceil(h.target - sinceStart)) }
}

function renderHoldBar() {
  const bar = document.getElementById('hold-bar')
  if (!bar) return
  bar.hidden = !ui.hold
  if (!ui.hold) return
  const st = holdState()
  bar.classList.toggle('lead', st.phase === 'lead')
  bar.querySelector('span').textContent = st.phase === 'lead' ? `${ui.hold.name} · klaar maken` : ui.hold.name
  bar.querySelector('strong').textContent = st.phase === 'lead' ? String(st.left) : fmtClock(st.left * 1000)
}

// Lopende aftelklok bijhouden (aangeroepen vanuit de klok-interval).
let lastLeadBeep = null
function tickHold() {
  if (!ui.hold) return
  const st = holdState()
  if (st.phase === 'lead' && st.left !== lastLeadBeep) {
    lastLeadBeep = st.left
    beep([660])
  }
  if (st.phase === 'hold' && lastLeadBeep !== 0) {
    lastLeadBeep = 0
    beep([1320])
  }
  if (st.phase === 'hold' && st.left <= 0) finishHold(ui.hold.target)
  renderHoldBar()
}

function finishHold(seconds) {
  const { ex, set } = ui.hold
  ui.hold = null
  lastLeadBeep = null
  keepScreenOn(false)
  const s = activeLog().exercises[ex].sets[set]
  s.reps = String(seconds)
  beep()
  completeSet(ex, set)
}

function renderRestBar() {
  const bar = document.getElementById('rest-bar')
  if (!bar) return
  const left = ui.restEnd ? Math.ceil((ui.restEnd - Date.now()) / 1000) : 0
  bar.hidden = left <= 0
  if (left > 0) bar.querySelector('strong').textContent = fmtClock(left * 1000)
}

const unitLabel = (unit) => (unit === 'sec' ? 'Sec' : 'Herh.')

// "40×10", of bij seconden "30 s" (met gewicht: "10 kg · 30 s").
function fmtSet(x, unit) {
  if (unit === 'sec') return `${x.kg ? x.kg + ' kg · ' : ''}${x.reps || '–'} s`
  return `${x.kg || '–'} × ${x.reps || '–'}`
}

// Een superset is een rij oefeningen waarvan elke volgende `superset: true` heeft.
function supersetBounds(exs, i) {
  let start = i
  while (start > 0 && exs[start].superset) start--
  let end = i
  while (exs[end + 1]?.superset) end++
  return { start, end }
}

// Oefening i een plek omhoog (dir -1) of omlaag (dir 1) zetten zonder
// supersets uit elkaar te trekken. Binnen een superset wisselt de oefening
// met de buur (de koppelingen blijven op hun plek); aan de rand van een
// superset, of bij een losse oefening, schuift het hele blok langs het
// volgende blok. Geeft de nieuwe index van oefening i terug.
function moveExercise(exs, i, dir) {
  const b = supersetBounds(exs, i)
  const j = i + dir
  if (b.end > b.start && j >= b.start && j <= b.end) {
    ;[exs[i], exs[j]] = [exs[j], exs[i]]
    ;[exs[i].superset, exs[j].superset] = [exs[j].superset, exs[i].superset]
    return j
  }
  const size = b.end - b.start + 1
  if (dir < 0) {
    if (b.start === 0) return i
    const nb = supersetBounds(exs, b.start - 1)
    exs.splice(nb.start, 0, ...exs.splice(b.start, size))
    return i - (nb.end - nb.start + 1)
  }
  if (b.end === exs.length - 1) return i
  const nb = supersetBounds(exs, b.end + 1)
  const shift = nb.end - nb.start + 1
  exs.splice(b.start + shift, 0, ...exs.splice(b.start, size))
  return i + shift
}

function newLogExercise(name, target, opts = {}) {
  const count = Math.max(1, Math.min(20, parseInt(target?.sets) || 3))
  return {
    id: uid(),
    name,
    unit: opts.unit || 'reps',
    superset: !!opts.superset,
    note: '',
    target: target || null,
    sets: Array.from({ length: count }, () => ({ kg: '', reps: '', note: '', done: false })),
  }
}

function startWorkout(session) {
  if (!session.log) {
    const tpl = session.templateId && templateById(session.templateId)
    session.log = {
      startedAt: Date.now(),
      endedAt: null,
      exercises: tpl
        ? tpl.exercises.map((e, i) =>
            newLogExercise(
              e.name,
              { sets: e.sets, reps: e.reps, weight: e.weight },
              { unit: e.unit, superset: i > 0 && e.superset },
            ),
          )
        : [],
    }
  } else if (session.log.endedAt) {
    // Afgeronde training bekijken/aanpassen: de klok blijft staan.
  }
  save()
  closeSheet()
  ui.active = session.id
  render()
  window.scrollTo(0, 0)
}

function fmtClock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(sec % 60)}` : `${m}:${pad(sec % 60)}`
}

function workoutElapsed(log) {
  return (log.endedAt || Date.now()) - log.startedAt
}

function renderWorkout(s) {
  const log = s.log
  const tpl = s.templateId && templateById(s.templateId)
  const t = typeById(s.typeId)
  title.textContent = tpl ? tpl.name : `${t.emoji} ${t.name}`
  const doneSets = log.exercises.reduce((n, e) => n + e.sets.filter((x) => x.done).length, 0)
  const allSets = log.exercises.reduce((n, e) => n + e.sets.length, 0)

  // Letters voor supersets (A, B, ...) in volgorde van voorkomen.
  const ssLetter = {}
  let letters = 0
  log.exercises.forEach((ex, i) => {
    const b = supersetBounds(log.exercises, i)
    if (b.end > b.start && i === b.start) ssLetter[i] = String.fromCharCode(65 + letters++)
  })

  const exercises = log.exercises
    .map((ex, i) => {
      const b = supersetBounds(log.exercises, i)
      const inSS = b.end > b.start
      const ssLabel = inSS
        ? `<div class="ss-label">🔗 Superset ${ssLetter[b.start]} · ${i - b.start + 1}/${b.end - b.start + 1}</div>`
        : ''
      const isSec = ex.unit === 'sec'
      const prevEx = previousExercise(ex.name, s.id)
      const prev = prevEx ? prevEx.sets : []
      const tg = ex.target
      const targetReps = tg && /^\d+$/.test(String(tg.reps).trim()) ? String(tg.reps).trim() : ''
      const target = tg
        ? `Doel: ${esc(tg.sets)} × ${esc(tg.reps)}${isSec ? ' s' : ''}${tg.weight ? ' · ' + esc(tg.weight) + ' kg' : ''}`
        : ''
      const rows = ex.sets
        .map((st, j) => {
          const p = prev[j] || prev[prev.length - 1]
          const phKg = p?.kg || tg?.weight || ''
          const phReps = p?.reps || targetReps
          return `
          <div class="set-row ${st.done ? 'done' : ''}" data-ex="${i}" data-set="${j}">
            <button type="button" class="set-no" data-action="wo-set-note" aria-label="Opmerking bij set ${j + 1}">${j + 1}</button>
            <span class="muted prev-cell">${isSec && !st.done ? `<button type="button" class="mini play" data-action="wo-hold" aria-label="Aftellen voor set ${j + 1}">▶</button>` : ''}${prev[j] ? esc(fmtSet(prev[j], ex.unit)) : isSec && !st.done ? '' : '–'}</span>
            <input data-field="kg" inputmode="decimal" enterkeyhint="next" value="${esc(st.kg)}" placeholder="${esc(phKg)}" aria-label="Set ${j + 1} gewicht in kg" />
            <input data-field="reps" inputmode="numeric" enterkeyhint="done" value="${esc(st.reps)}" placeholder="${esc(phReps)}" aria-label="Set ${j + 1} ${isSec ? 'seconden' : 'herhalingen'}" />
            <button type="button" class="check" data-action="wo-set" aria-label="Set ${j + 1} afvinken">${st.done ? '✓' : ''}</button>
          </div>
          ${st.note ? `<div class="set-note">💬 ${esc(st.note)}</div>` : ''}
          ${prev[j]?.note ? `<div class="set-note prev">Vorige keer: ${esc(prev[j].note)}</div>` : ''}`
        })
        .join('')
      return `
        <section class="card wo-ex ${inSS ? 'ss' : ''} ${inSS && i > b.start ? 'ss-cont' : ''} ${inSS && i < b.end ? 'ss-mid' : ''}" data-wo-ex="${i}">
          ${ssLabel}
          <div class="wo-ex-head">
            <h3>${esc(ex.name)}</h3>
            <div class="mini-btns">
              ${i > 0 ? `<button type="button" class="mini" data-action="wo-move" data-ex="${i}" data-dir="-1" aria-label="Omhoog">▲</button>` : ''}
              ${i < log.exercises.length - 1 ? `<button type="button" class="mini" data-action="wo-move" data-ex="${i}" data-dir="1" aria-label="Omlaag">▼</button>` : ''}
              ${i > 0 ? `<button type="button" class="mini ${ex.superset ? 'on' : ''}" data-action="wo-ss" data-ex="${i}" aria-label="Superset met vorige oefening">🔗</button>` : ''}
              <button type="button" class="mini del" data-action="wo-del-ex" data-ex="${i}" aria-label="${esc(ex.name)} verwijderen">✕</button>
            </div>
          </div>
          ${target ? `<div class="muted">${target}</div>` : ''}
          ${prevEx?.note ? `<div class="muted">Vorige keer: ${esc(prevEx.note)}</div>` : ''}
          <input class="ex-note" data-field="note" data-ex="${i}" value="${esc(ex.note)}" placeholder="Opmerking (bijv. rode band, smalle grip)" aria-label="Opmerking bij ${esc(ex.name)}" />
          <div class="set-row set-head"><span>Set</span><span>Vorige</span><span>kg</span><button type="button" class="unit-btn" data-action="wo-unit" data-ex="${i}" aria-label="Wissel tussen herhalingen en seconden">${unitLabel(ex.unit)} ⇄</button><span></span></div>
          ${rows}
          <div class="wo-set-actions">
            <button type="button" class="linkbtn" data-action="wo-add-set" data-ex="${i}">+ Set</button>
            ${ex.sets.length > 1 ? `<button type="button" class="linkbtn muted-link" data-action="wo-del-set" data-ex="${i}">− Set</button>` : ''}
          </div>
        </section>`
    })
    .join('')

  return `
    <div class="wo-head">
      <button class="iconbtn" data-action="wo-back" aria-label="Terug naar agenda">‹</button>
      <div class="label">
        <strong id="wo-timer">${fmtClock(workoutElapsed(log))}</strong>
        <span class="muted">${doneSets}/${allSets} sets${log.endedAt ? ' · afgerond' : ''}</span>
      </div>
      <button class="btn primary" data-action="wo-finish">${log.endedAt ? 'Opslaan' : 'Afronden'}</button>
    </div>
    <div class="rest-setting">
      <span>⏱ Rust na elke set</span>
      <button type="button" class="iconbtn" data-action="wo-rest" data-delta="-15" aria-label="15 seconden korter">−</button>
      <strong>${fmtClock(restSeconds() * 1000)}</strong>
      <button type="button" class="iconbtn" data-action="wo-rest" data-delta="15" aria-label="15 seconden langer">+</button>
    </div>
    ${exercises ? '<p class="muted hint">Tik op een setnummer voor een opmerking bij die set.</p>' + exercises : '<p class="muted">Nog geen oefeningen. Voeg er hieronder een toe.</p>'}
    <button class="btn block" data-action="wo-add-ex">+ Oefening toevoegen</button>
    <p></p>
    <button class="btn danger block" data-action="wo-discard">${log.endedAt ? 'Log wissen' : 'Training annuleren'}</button>
    <div class="rest-bar hold-bar" id="hold-bar" hidden>
      <span></span>
      <strong></strong>
      <button type="button" class="btn" data-action="wo-hold-cancel" aria-label="Aftellen annuleren">✕</button>
      <button type="button" class="btn primary" data-action="wo-hold-stop">Stop</button>
    </div>
    <div class="rest-bar" id="rest-bar" hidden>
      <span>Rust</span>
      <strong></strong>
      <button type="button" class="btn" data-action="wo-rest-adjust" data-delta="-15">−15</button>
      <button type="button" class="btn" data-action="wo-rest-adjust" data-delta="15">+15</button>
      <button type="button" class="btn primary" data-action="wo-rest-skip">Klaar</button>
    </div>`
}

// Lopende klok in de workout-weergave.
setInterval(() => {
  const el = document.getElementById('wo-timer')
  const s = ui.active && state.sessions.find((x) => x.id === ui.active)
  if (el && s?.log && !s.log.endedAt) el.textContent = fmtClock(workoutElapsed(s.log))
  if (ui.restEnd && Date.now() >= ui.restEnd) {
    ui.restEnd = null
    beep()
  }
  renderRestBar()
  tickHold()
  tickRun()
}, 250)

// Set afvinken en daarna rust starten, of in een superset doorgaan naar de
// volgende oefening (rust pas na de laatste oefening van de ronde).
function completeSet(i, j) {
  const exs = activeLog().exercises
  exs[i].sets[j].done = true
  const { end } = supersetBounds(exs, i)
  const nextInSuperset = i < end ? i + 1 : null
  if (nextInSuperset === null && restSeconds() > 0) {
    unlockAudio()
    ui.restEnd = Date.now() + restSeconds() * 1000
  }
  save()
  render()
  renderRestBar()
  if (nextInSuperset !== null) {
    const k = Math.min(j, exs[nextInSuperset].sets.length - 1)
    view
      .querySelector(`.set-row[data-ex="${nextInSuperset}"][data-set="${k}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function activeLog() {
  return state.sessions.find((s) => s.id === ui.active)?.log
}

const workoutActions = {
  'wo-back': () => {
    ui.restEnd = null
    if (ui.hold) workoutActions['wo-hold-cancel']()
    ui.active = null
    render()
  },
  'wo-set': (el) => {
    const row = el.closest('.set-row')
    const set = activeLog().exercises[row.dataset.ex].sets[row.dataset.set]
    if (!set.done) {
      // Leeg veld = de voorgestelde waarde (vorige keer / doel) overnemen.
      for (const input of row.querySelectorAll('input')) {
        if (!input.value && input.placeholder) set[input.dataset.field] = input.placeholder
      }
    }
    if (set.done) {
      set.done = false
      save()
      render()
      return
    }
    completeSet(Number(row.dataset.ex), Number(row.dataset.set))
  },
  'wo-hold': (el) => {
    const row = el.closest('.set-row')
    const i = Number(row.dataset.ex)
    const ex = activeLog().exercises[i]
    const input = row.querySelector('[data-field="reps"]')
    const target = parseInt(input.value || input.placeholder) || 30
    const kg = row.querySelector('[data-field="kg"]')
    if (!kg.value && kg.placeholder) ex.sets[row.dataset.set].kg = kg.placeholder
    unlockAudio()
    keepScreenOn(true)
    ui.restEnd = null
    lastLeadBeep = null
    ui.hold = { ex: i, set: Number(row.dataset.set), target, startAt: Date.now() + HOLD_LEAD_IN * 1000, name: ex.name }
    renderRestBar()
    renderHoldBar()
  },
  'wo-hold-stop': () => {
    if (!ui.hold) return
    const st = holdState()
    // Tijdens het klaarmaken stoppen = annuleren; anders de volgehouden tijd bewaren.
    if (st.phase === 'lead') return workoutActions['wo-hold-cancel']()
    finishHold(st.elapsed)
  },
  'wo-hold-cancel': () => {
    ui.hold = null
    lastLeadBeep = null
    keepScreenOn(false)
    renderHoldBar()
  },
  'wo-move': (el) => {
    const exs = activeLog().exercises
    const j = moveExercise(exs, Number(el.dataset.ex), Number(el.dataset.dir))
    save()
    render()
    view.querySelector(`[data-wo-ex="${j}"]`)?.scrollIntoView({ block: 'nearest' })
  },
  'wo-ss': (el) => {
    const ex = activeLog().exercises[el.dataset.ex]
    ex.superset = !ex.superset
    save()
    render()
  },
  'wo-unit': (el) => {
    const ex = activeLog().exercises[el.dataset.ex]
    ex.unit = ex.unit === 'sec' ? 'reps' : 'sec'
    save()
    render()
  },
  'wo-set-note': (el) => {
    const row = el.closest('.set-row')
    const set = activeLog().exercises[row.dataset.ex].sets[row.dataset.set]
    const note = prompt(`Opmerking bij set ${Number(row.dataset.set) + 1}`, set.note || '')
    if (note === null) return
    set.note = note.trim()
    save()
    render()
    renderRestBar()
  },
  'wo-rest': (el) => {
    state.settings ||= {}
    state.settings.rest = Math.max(0, Math.min(600, restSeconds() + Number(el.dataset.delta)))
    save()
    render()
    renderRestBar()
  },
  'wo-rest-adjust': (el) => {
    if (!ui.restEnd) return
    ui.restEnd += Number(el.dataset.delta) * 1000
    if (ui.restEnd <= Date.now()) ui.restEnd = null
    renderRestBar()
  },
  'wo-rest-skip': () => {
    ui.restEnd = null
    renderRestBar()
  },
  'wo-add-set': (el) => {
    const ex = activeLog().exercises[el.dataset.ex]
    const last = ex.sets[ex.sets.length - 1]
    ex.sets.push({ kg: last?.kg || '', reps: last?.reps || '', note: '', done: false })
    save()
    render()
  },
  'wo-del-set': (el) => {
    activeLog().exercises[el.dataset.ex].sets.pop()
    save()
    render()
  },
  'wo-add-ex': () => {
    const name = prompt('Naam van de oefening')?.trim()
    if (!name) return
    activeLog().exercises.push(newLogExercise(name, null))
    save()
    render()
    window.scrollTo(0, document.body.scrollHeight)
  },
  'wo-del-ex': (el) => {
    const log = activeLog()
    if (!confirm(`"${log.exercises[el.dataset.ex].name}" uit deze training halen?`)) return
    log.exercises.splice(el.dataset.ex, 1)
    if (log.exercises[0]) log.exercises[0].superset = false
    save()
    render()
  },
  'wo-finish': () => {
    const s = state.sessions.find((x) => x.id === ui.active)
    const justFinished = !s.log.endedAt
    if (!s.log.endedAt) {
      const anyDone = s.log.exercises.some((e) => e.sets.some((x) => x.done))
      if (!anyDone && !confirm('Je hebt nog geen sets afgevinkt. Toch afronden?')) return
      s.log.endedAt = Date.now()
      s.duration = Math.max(1, Math.round(workoutElapsed(s.log) / 60000))
      s.done = true
    }
    save()
    ui.restEnd = null
    ui.active = null
    render()
    if (justFinished) cheer()
  },
  'wo-discard': () => {
    const s = state.sessions.find((x) => x.id === ui.active)
    const msg = s.log.endedAt
      ? 'Alle gelogde sets van deze training wissen?'
      : 'Training annuleren? Ingevulde sets gaan verloren.'
    if (!confirm(msg)) return
    delete s.log
    if (s.done) s.done = false
    save()
    ui.active = null
    render()
  },
}

function openWorkoutSheet(s) {
  const t = typeById(s.typeId)
  const tpl = s.templateId && templateById(s.templateId)
  const d = fromKey(s.date)
  const when = [`${DAYS[(d.getDay() + 6) % 7]} ${shortDate(d)}`, s.time, s.duration ? fmtMinutes(Number(s.duration)) : '']
    .filter(Boolean)
    .join(' · ')
  let summary = ''
  if (s.log) {
    let volume = 0
    summary = s.log.exercises
      .map((e) => {
        const done = e.sets.filter((x) => x.done)
        if (e.unit !== 'sec') for (const x of done) volume += (parseNum(x.kg) || 0) * (parseInt(x.reps) || 0)
        const sets = done.map((x) => esc(fmtSet(x, e.unit))).join(', ')
        const notes = [e.note, ...done.map((x, i) => (x.note ? `set ${i + 1}: ${x.note}` : ''))].filter(Boolean)
        return `<div class="ex"><span class="grow">${esc(e.name)}<br><span class="muted">${sets || 'geen sets afgevinkt'}</span>${notes.length ? `<br><span class="muted">💬 ${esc(notes.join(' · '))}</span>` : ''}</span></div>`
      })
      .join('')
    if (volume) summary += `<p class="muted">Totaal volume: ${Math.round(volume).toLocaleString('nl-NL')} kg</p>`
  } else if (tpl) {
    summary = tpl.exercises
      .map(
        (e) =>
          `<div class="ex"><span class="grow">${e.superset ? '🔗 ' : ''}${esc(e.name)}<br><span class="muted">${esc(e.sets)} × ${esc(e.reps)}${e.unit === 'sec' ? ' s' : ''}${e.weight ? ' · ' + esc(e.weight) + ' kg' : ''}</span></span></div>`,
      )
      .join('')
  }
  const startLabel = !s.log ? '▶ Training starten' : s.log.endedAt ? 'Log bekijken / aanpassen' : '▶ Doorgaan met training'
  openSheet(
    `
    <form method="dialog">
      <h2>${esc(t.emoji)} ${esc(t.name)}${tpl ? ' · ' + esc(tpl.name) : ''}</h2>
      <p class="muted">${esc(when)}${s.note ? '<br>' + esc(s.note) : ''}</p>
      ${summary}
      <p></p>
      <button type="button" class="btn primary block" id="start">${startLabel}</button>
      ${planRemoveButton(s)}
      <div class="actions">
        <button type="button" class="btn" id="edit">Bewerken</button>
        <button type="button" class="btn" id="cancel">Sluiten</button>
      </div>
    </form>`,
    () => {},
  )
  sheet.querySelector('#start').onclick = () => startWorkout(s)
  sheet.querySelector('#edit').onclick = () => {
    closeSheet()
    openSessionSheet(s)
  }
  sheet.querySelector('#cancel').onclick = closeSheet
}

function openShinSheet(s) {
  const buttons = Array.from(
    { length: 11 },
    (_, i) => `<button type="button" class="shin-btn ${shinClass(i)} ${s.shin === i ? 'on' : ''}" data-shin="${i}">${i}</button>`,
  ).join('')
  openSheet(
    `
    <form method="dialog">
      <h2>🏃 Scheenpijn na deze run?</h2>
      <p class="muted">0 = geen pijn · 10 = ergst denkbare pijn</p>
      <div class="shin-grid">${buttons}</div>
      <div class="actions">
        <button type="button" class="btn" id="cancel">Overslaan</button>
      </div>
    </form>`,
    () => {},
  )
  sheet.querySelector('#cancel').onclick = closeSheet
  sheet.querySelectorAll('[data-shin]').forEach((btn) => {
    btn.onclick = () => {
      s.shin = Number(btn.dataset.shin)
      save()
      closeSheet()
      render()
    }
  })
}

// ---------- Hardlopen: intervallen ----------
// Een looptraining kan `run` hebben: { label, steps: [{ t: 'run'|'walk', min }],
// warmup, cooldown } (minuten). Tijdens het lopen houdt `runLog` de klok bij:
// { startedAt, paused (ms), pausedAt, endedAt }, op tijdstempels, zodat de stand
// klopt als de telefoon even op slot is geweest.

const RUN_WARMUP = 5
const fmtNum = (n) => String(Math.round(n * 100) / 100).replace('.', ',')
const PHASE_NAMES = { warm: 'Warming-up', run: 'Lopen', walk: 'Wandelen', cool: 'Cooling-down' }
const PHASE_SPOKEN = {
  warm: 'Warming-up. Rustig wandelen.',
  run: 'Lopen!',
  walk: 'Wandelen.',
  cool: 'Cooling-down. Rustig uitwandelen.',
}

// n × (lopen / wandelen), met na elk loopblok een wandelblok (zoals het 5 km-plan).
function makeRun(reps, run, walk, warm = true) {
  const steps = []
  for (let i = 0; i < reps; i++) {
    steps.push({ t: 'run', min: run })
    if (walk) steps.push({ t: 'walk', min: walk })
  }
  const label = walk
    ? `${reps} × (${fmtNum(run)} L / ${fmtNum(walk)} W)`
    : reps > 1
      ? `${reps} × ${fmtNum(run)} min lopen`
      : `${fmtNum(run)} min aan één stuk`
  return { label, steps, warmup: warm ? RUN_WARMUP : 0, cooldown: warm ? RUN_WARMUP : 0 }
}

// De simpele vorm (herhalingen, lopen, wandelen) voor het formulier, of null
// als het een losse reeks is (zoals "15 L + 2 W + 10 L" uit het plan).
function simpleRun(run) {
  const st = run?.steps || []
  const runs = st.filter((x) => x.t === 'run')
  const walks = st.filter((x) => x.t === 'walk')
  if (!runs.length || runs.some((x) => x.min !== runs[0].min)) return null
  const alternates = walks.length === runs.length && walks.every((x) => x.min === walks[0].min) && st.every((x, i) => x.t === (i % 2 ? 'walk' : 'run'))
  if (walks.length && !alternates) return null
  return { reps: runs.length, run: runs[0].min, walk: walks[0]?.min || 0 }
}

function runPhases(run) {
  const ph = []
  if (run.warmup) ph.push({ t: 'warm', min: run.warmup })
  for (const x of run.steps) ph.push({ ...x })
  if (run.cooldown) ph.push({ t: 'cool', min: run.cooldown })
  return ph
}
const runTotal = (run) => runPhases(run).reduce((n, p) => n + p.min, 0)
const runMinutes = (run) => run.steps.filter((x) => x.t === 'run').reduce((n, x) => n + x.min, 0)

// Balk zoals in het plan: lopen donker, wandelen licht, breedte naar duur.
function runBar(run, big = false) {
  const total = runTotal(run)
  return `<div class="run-bar ${big ? 'big' : ''}">${runPhases(run)
    .map((p, i) => `<span class="seg seg-${p.t}" data-seg="${i}" style="flex-grow:${((p.min / total) * 100).toFixed(2)}"></span>`)
    .join('')}</div>`
}

function runElapsed(lg) {
  const now = lg.endedAt || lg.pausedAt || Date.now()
  return Math.max(0, (now - lg.startedAt - lg.paused) / 1000)
}

// Waar zit je na `sec` seconden? Index van de fase, en hoeveel er nog over is.
function runPosition(run, sec) {
  const ph = runPhases(run)
  let acc = 0
  for (let i = 0; i < ph.length; i++) {
    const len = ph[i].min * 60
    if (sec < acc + len) return { i, ph, left: acc + len - sec }
    acc += len
  }
  return { i: ph.length - 1, ph, left: 0, done: true }
}

function speak(text) {
  if (state.settings?.voice === false) return
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'nl-NL'
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  } catch {
    // Geen spraak beschikbaar; de piepjes werken ook zonder.
  }
}

function openRunSheet(s) {
  const run = s.run
  const d = fromKey(s.date)
  const when = [`${DAYS[(d.getDay() + 6) % 7]} ${shortDate(d)}`, s.time].filter(Boolean).join(' · ')
  const busy = s.runLog && !s.runLog.endedAt
  const parts = [
    run.warmup ? `${fmtNum(run.warmup)} min wandelen (warming-up)` : '',
    run.label,
    run.cooldown ? `${fmtNum(run.cooldown)} min wandelen (cooling-down)` : '',
  ].filter(Boolean)
  const planTools = planOf(s)
    ? `
      <div class="plan-tools">
        <p class="muted">Hoe ging het? De pijn bepaalt het tempo, niet de kalender.</p>
        <div class="actions">
          <button type="button" class="btn" id="plan-repeat">🟡 Week herhalen</button>
          <button type="button" class="btn" id="plan-back">🔴 Week terug</button>
        </div>
      </div>`
    : ''
  openSheet(
    `
    <form method="dialog">
      <h2>🏃 ${esc(run.label)}</h2>
      <p class="muted">${esc(when)} · ${fmtNum(runMinutes(run))} min lopen · ${fmtNum(runTotal(run))} min totaal${s.note ? '<br>' + esc(s.note) : ''}</p>
      ${runBar(run)}
      ${icu?.sent?.[s.id] ? '<p class="muted">⌚ Staat op je horloge (via Intervals.icu)</p>' : ''}
      <p class="run-parts">${parts.map(esc).join(' → ')}</p>
      <button type="button" class="btn primary block" id="start">${busy ? '▶ Doorgaan' : s.done ? '▶ Nog een keer lopen' : '▶ Intervaltraining starten'}</button>
      ${planTools}
      ${planRemoveButton(s)}
      <div class="actions">
        <button type="button" class="btn" id="edit">Bewerken</button>
        <button type="button" class="btn" id="cancel">Sluiten</button>
      </div>
    </form>`,
    () => {},
  )
  sheet.querySelector('#start').onclick = () => startRun(s)
  sheet.querySelector('#edit').onclick = () => {
    closeSheet()
    openSessionSheet(s)
  }
  sheet.querySelector('#cancel').onclick = closeSheet
  sheet.querySelector('#plan-repeat')?.addEventListener('click', () => askRepeatPlanWeek(s, false))
  sheet.querySelector('#plan-back')?.addEventListener('click', () => askRepeatPlanWeek(s, true))
}

let lastRunPhase = null
let lastCountBeep = null

function startRun(s) {
  if (!s.runLog || s.runLog.endedAt) s.runLog = { startedAt: Date.now(), paused: 0, pausedAt: null, endedAt: null }
  unlockAudio()
  keepScreenOn(true)
  closeSheet()
  ui.run = s.id
  lastRunPhase = null
  lastCountBeep = null
  save()
  render()
  window.scrollTo(0, 0)
  const pos = runPosition(s.run, runElapsed(s.runLog))
  speak(PHASE_SPOKEN[pos.ph[pos.i].t])
}

const runSession = () => ui.run && state.sessions.find((x) => x.id === ui.run)

function renderRunPlayer(s) {
  const run = s.run
  const lg = s.runLog
  const sec = runElapsed(lg)
  const pos = runPosition(run, sec)
  const p = pos.ph[pos.i]
  const next = pos.ph[pos.i + 1]
  const runBlocks = pos.ph.filter((x) => x.t === 'run').length
  const runNo = pos.ph.slice(0, pos.i + 1).filter((x) => x.t === 'run').length
  const total = runTotal(run) * 60
  title.textContent = '🏃 Intervaltraining'
  return `
    <div class="run-player ph-${p.t} ${lg.pausedAt ? 'paused' : ''}">
      <div class="rp-top">
        <button class="iconbtn" data-action="run-back" aria-label="Terug naar agenda">‹</button>
        <div class="rp-title">${esc(run.label)}</div>
      </div>
      <div class="rp-phase">${lg.pausedAt ? '⏸ Pauze' : PHASE_NAMES[p.t]}</div>
      <div class="rp-clock" id="rp-clock">${fmtClock(pos.left * 1000)}</div>
      <div class="rp-sub">${p.t === 'run' ? `Loopblok ${runNo} van ${runBlocks}` : p.t === 'walk' ? 'Lekker op adem komen' : ''}</div>
      <div class="rp-next">${next ? `Straks: ${PHASE_NAMES[next.t].toLowerCase()} ${fmtNum(next.min)} min` : 'Laatste stuk, Tara! 💛'}</div>
      ${runBar(run, true)}
      <div class="rp-times"><span id="rp-elapsed">${fmtClock(sec * 1000)}</span><span>${fmtClock(total * 1000)}</span></div>
      <div class="rp-btns">
        <button class="btn" data-action="run-pause">${lg.pausedAt ? '▶ Verder' : '⏸ Pauze'}</button>
        <button class="btn" data-action="run-skip">⏭ Volgende</button>
        <button class="btn" data-action="run-stop">■ Stoppen</button>
      </div>
    </div>`
}

// Elke 250 ms: klok bijwerken, 3-2-1 piepjes voor een wissel, en bij een nieuwe
// fase piepen, de fase uitspreken en het scherm opnieuw opbouwen.
function tickRun() {
  const s = runSession()
  if (!s?.runLog) return
  const lg = s.runLog
  const sec = runElapsed(lg)
  const pos = runPosition(s.run, sec)
  if (pos.done) return finishRun(s)
  if (lastRunPhase !== null && pos.i !== lastRunPhase) {
    lastRunPhase = pos.i
    lastCountBeep = null
    beep(pos.ph[pos.i].t === 'run' ? [880, 1320] : [1320, 880])
    speak(PHASE_SPOKEN[pos.ph[pos.i].t])
    render()
    return
  }
  lastRunPhase = pos.i
  const left = Math.ceil(pos.left)
  if (!lg.pausedAt && left <= 3 && left >= 1 && left !== lastCountBeep) {
    lastCountBeep = left
    beep([660])
  }
  const clock = document.getElementById('rp-clock')
  if (clock) clock.textContent = fmtClock(pos.left * 1000)
  const el = document.getElementById('rp-elapsed')
  if (el) el.textContent = fmtClock(sec * 1000)
  view.querySelectorAll('.run-bar.big .seg').forEach((seg, i) => {
    seg.classList.toggle('past', i < pos.i)
    seg.classList.toggle('now', i === pos.i)
  })
}

function finishRun(s) {
  const lg = s.runLog
  if (lg.pausedAt) {
    lg.paused += Date.now() - lg.pausedAt
    lg.pausedAt = null
  }
  lg.endedAt = Date.now()
  s.done = true
  s.duration = Math.max(1, Math.round(runElapsed(lg) / 60))
  ui.run = null
  keepScreenOn(false)
  beep()
  speak('Klaar! Goed gedaan, Tara.')
  save()
  render()
  openShinSheet(s)
  cheer()
}

const runActions = {
  'run-back': () => {
    ui.run = null
    keepScreenOn(false)
    render()
  },
  'run-pause': () => {
    const lg = runSession().runLog
    if (lg.pausedAt) {
      lg.paused += Date.now() - lg.pausedAt
      lg.pausedAt = null
    } else lg.pausedAt = Date.now()
    save()
    render()
  },
  'run-skip': () => {
    const s = runSession()
    const pos = runPosition(s.run, runElapsed(s.runLog))
    s.runLog.paused -= pos.left * 1000 + 1
    save()
    tickRun()
  },
  'run-stop': () => {
    if (!confirm('Training stoppen? Wat je gelopen hebt wordt bewaard en de training afgevinkt.')) return
    finishRun(runSession())
  },
}

// ---------- Terug naar 5 km ----------
// Het plan staat als data in plan5k.js. Een plan in de agenda is
// { id, version, rhythm, strength, cross, extra, startDate, startWeek };
// de trainingen dragen `planId` en `planWeek` (bijv. 'B2' of '7').

const planWeeks = (plan) => PLAN_5K.versions[plan.version].weeks.filter((w) => plan.extra || !w.extra)
const weekName = (id) => (id.startsWith('B') ? `brugweek ${id}` : `week ${id}`)
const activePlan = () => state.plans[state.plans.length - 1]

// Maandag van deze week als het vandaag maandag is, anders volgende maandag.
function nextMonday() {
  const today = new Date()
  const m = startOfWeek(today)
  return toKey(toKey(m) === toKey(today) ? m : addDays(m, 7))
}

// Activiteit (uit de standaardlijst of het plan) terugzetten of toevoegen.
const PLAN_TYPES = [{ id: 'kracht', name: 'Kracht & springen', emoji: '💪' }]
function ensureType(id) {
  const t = state.types.find((x) => x.id === id)
  if (t) delete t.hidden
  else state.types.push([...defaultState().types, ...PLAN_TYPES].find((x) => x.id === id))
}

function strengthTemplateId() {
  const def = PLAN_5K.strength
  let tpl = state.templates.find((t) => t.name === def.name)
  if (!tpl) {
    tpl = { id: uid(), name: def.name, exercises: def.exercises.map((e) => ({ id: uid(), ...e })) }
    state.templates.push(tpl)
  }
  return tpl.id
}

// Eén planweek in de agenda zetten, in de kalenderweek die op `monday` begint.
function addPlanWeek(plan, week, monday) {
  const r = PLAN_5K.rhythms.find((x) => x.id === plan.rhythm)
  const tag = `5 km-plan · ${weekName(week.id)}`
  const at = (day) => toKey(addDays(monday, day))
  const add = (s) => state.sessions.push({ id: uid(), time: '', templateId: '', done: false, planId: plan.id, planWeek: week.id, ...s })
  const strength = (date, extra = '') =>
    add({ typeId: 'kracht', templateId: strengthTemplateId(), date, duration: 30, note: `${tag}${extra}` })
  let n = 0
  if (week.kind === 'run') {
    // 2× per week: training 1 en de langste van de andere twee, op de eerste
    // en laatste loopdag van het ritme (zo blijft er ruim rust tussen).
    const picks = plan.twice ? [0, runMinutes(week.runs[2]) > runMinutes(week.runs[1]) ? 2 : 1] : [0, 1, 2]
    const days = plan.twice ? [r.run[0], r.run[2]] : r.run
    picks.forEach((i, k) => {
      const spec = week.runs[i]
      const run = { label: spec.label, steps: spec.steps.map((x) => ({ ...x })), warmup: RUN_WARMUP, cooldown: RUN_WARMUP }
      add({ typeId: 'hardlopen', date: at(days[k]), run, duration: Math.round(runTotal(run)), note: `${tag} · training ${i + 1}` })
      n++
    })
    if (plan.strength) r.strength.forEach((d) => (strength(at(d)), n++))
  } else {
    // Brugweek: nog niet hardlopen. Kracht (en springen) op de loopdagen, wandelen op de krachtdagen.
    r.run.forEach((d, i) => (strength(at(d), week.jumps[i] ? ` · springen: ${week.jumps[i]}` : ' · zonder springen'), n++))
    r.strength.forEach((d, i) => (add({ typeId: 'wandelen', date: at(d), duration: week.walkMin[i], note: `${tag} · ${week.walk}` }), n++))
  }
  if (plan.cross) {
    add({ typeId: 'fietsen', date: at(r.cross), duration: 40, note: `${tag} · fietsen of zwemmen, 30–45 min${week.kind === 'bridge' ? ' (2–3× per week)' : ''}` })
    n++
  }
  return n
}

function schedulePlan(opts) {
  for (const id of ['hardlopen', 'kracht', 'wandelen', 'fietsen']) ensureType(id)
  const plan = { id: uid(), ...opts }
  state.plans.push(plan)
  const weeks = planWeeks(plan)
  const start = weeks.findIndex((w) => w.id === plan.startWeek)
  let monday = fromKey(plan.startDate)
  let n = 0
  for (const week of weeks.slice(start)) {
    n += addPlanWeek(plan, week, monday)
    monday = addDays(monday, 7)
  }
  return n
}

// Alle nog niet gedane trainingen van het plan weghalen; wat al gedaan is blijft
// als geschiedenis staan. Geeft de weggehaalde trainingen terug (voor ongedaan maken).
const openPlanSession = (s, plan) => s.planId === plan.id && !s.done && !s.log && !s.runLog
function removePlan(plan) {
  const removed = state.sessions.filter((s) => openPlanSession(s, plan))
  state.sessions = state.sessions.filter((s) => !openPlanSession(s, plan))
  state.plans = state.plans.filter((p) => p.id !== plan.id)
  return removed
}

const planOf = (s) => s?.planId && state.plans.find((p) => p.id === s.planId)

function askRemovePlan(planId) {
  const plan = state.plans.find((p) => p.id === planId)
  if (!plan) return
  const count = state.sessions.filter((s) => openPlanSession(s, plan)).length
  if (!confirm(`Het hele 5 km-plan uit je agenda halen? Dat zijn ${count} trainingen. Wat je al gedaan hebt, blijft staan.`)) return
  const removed = removePlan(plan)
  save()
  closeSheet()
  render()
  showToast(`🗑️ ${removed.length} trainingen van het plan weggehaald`, () => {
    state.plans.push(plan)
    state.sessions.push(...removed)
    save()
    render()
  })
}

// Knop "hele plan weghalen" in de vensters van plantrainingen.
const planRemoveButton = (s) =>
  planOf(s)
    ? `<button type="button" class="btn danger block plan-remove-all" data-plan="${s.planId}">🗑️ Hele 5 km-plan uit agenda halen</button>`
    : ''
sheet.addEventListener('click', (e) => {
  const btn = e.target.closest('.plan-remove-all')
  if (btn) askRemovePlan(btn.dataset.plan)
})

// 🟡 week herhalen / 🔴 week terug: alles van het plan vanaf volgende week schuift
// een week op, en volgende week komt deze (of de vorige) planweek nog een keer.
function repeatPlanWeek(s, back) {
  const plan = state.plans.find((p) => p.id === s.planId)
  const weeks = planWeeks(plan)
  const idx = Math.max(0, weeks.findIndex((w) => w.id === s.planWeek))
  const nextMon = addDays(startOfWeek(fromKey(s.date)), 7)
  for (const x of state.sessions) {
    if (x.planId === plan.id && x.date >= toKey(nextMon)) x.date = toKey(addDays(fromKey(x.date), 7))
  }
  const src = weeks[back ? Math.max(0, idx - 1) : idx]
  addPlanWeek(plan, src, nextMon)
  return src
}

function askRepeatPlanWeek(s, back) {
  const plan = state.plans.find((p) => p.id === s.planId)
  if (!plan) return
  const weeks = planWeeks(plan)
  const idx = Math.max(0, weeks.findIndex((w) => w.id === s.planWeek))
  const src = weeks[back ? Math.max(0, idx - 1) : idx]
  const msg = back
    ? `🔴 Een week terug: volgende week doe je ${weekName(src.id)}. De rest van het plan schuift een week op.\n\nStop met lopen en neem eerst 2 rustdagen. Twee keer rood achter elkaar: bel je fysio.`
    : `🟡 Week herhalen: volgende week doe je ${weekName(src.id)} nog een keer. De rest van het plan schuift een week op.\n\nHerhalen is geen falen 💛`
  if (!confirm(msg)) return
  repeatPlanWeek(s, back)
  save()
  closeSheet()
  ui.tab = 'week'
  ui.calMode = 'week'
  ui.weekStart = addDays(startOfWeek(fromKey(s.date)), 7)
  render()
  showToast(back ? '🔴 Een stapje terug. Rustig aan, Tara 💛' : '🟡 Week herhaald. Goed dat je naar je been luistert 💛')
}

const DAY_ABBR = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

// Welke dagen in een loopweek wat zijn, met de gekozen opties (zelfde keuzes als addPlanWeek).
function rhythmDays(r, { twice, strength, cross }) {
  return {
    run: twice ? [r.run[0], r.run[2]] : r.run,
    strength: strength ? r.strength : [],
    cross: cross ? [r.cross] : [],
  }
}

function rhythmLabel(r, opts) {
  const d = rhythmDays(r, opts)
  const list = (days) => days.map((i) => DAY_ABBR[i]).join(' · ')
  return [`${list(d.run)} lopen`, d.strength.length && `kracht ${list(d.strength)}`, d.cross.length && `fietsen ${list(d.cross)}`]
    .filter(Boolean)
    .join(' — ')
}

function weekPreview(r, opts) {
  const d = rhythmDays(r, opts)
  return DAY_ABBR.map((name, i) => {
    const [kind, icon] = d.run.includes(i)
      ? ['run', '🏃']
      : d.strength.includes(i)
        ? ['strength', '💪']
        : d.cross.includes(i)
          ? ['cross', '🚴']
          : ['rest', '·']
    return `<span class="wp-day wp-${kind}"><b>${name}</b>${icon}</span>`
  }).join('')
}

function planWeekOptions(version, extra) {
  return PLAN_5K.versions[version].weeks
    .filter((w) => extra || !w.extra)
    .map((w) => {
      const what = w.kind === 'bridge' ? 'wandelen, kracht, springen' : w.runs[0].label
      return `<option value="${w.id}">${w.id.startsWith('B') ? 'Brug ' + w.id : 'Week ' + w.id} · ${esc(what)}${w.extra ? ' (extra)' : ''}</option>`
    })
    .join('')
}

function openPlanSheet() {
  const v = PLAN_5K.versions
  const versionOpt = (id, checked) => `
    <label class="plan-opt">
      <input type="radio" name="version" value="${id}" ${checked ? 'checked' : ''} />
      <span><strong>${esc(v[id].name)}</strong><small>${esc(v[id].info)}</small></span>
    </label>`
  openSheet(
    `
    <form method="dialog">
      <h2>🏃 Terug naar 5 km</h2>
      <p class="muted">Het herstelplan van Tara, stap voor stap in je agenda 💛</p>
      <div class="plan-versions">${versionOpt('B', true)}${versionOpt('A', false)}</div>
      <label class="field">Beginnen in
        <select name="startWeek">${planWeekOptions('B', false)}</select>
      </label>
      <label class="field">Vanaf de week van
        <input type="date" name="startDate" value="${nextMonday()}" required />
      </label>
      <label class="ss-toggle"><input type="checkbox" name="twice" /> 🏃 2× per week lopen in plaats van 3×</label>
      <p class="muted">Je houdt dan per week training 1 en de langste training, op de eerste en laatste loopdag.</p>
      <label class="ss-toggle"><input type="checkbox" name="strength" checked /> 💪 Kracht + springen, 2× per week op dagen zonder lopen</label>
      <label class="ss-toggle"><input type="checkbox" name="cross" checked /> 🚴 Fietsen of zwemmen, 1× per week</label>
      <label class="ss-toggle"><input type="checkbox" name="extra" /> Extra weken meenemen</label>
      <p class="muted" id="extra-note">${esc(v.B.fiveKmNote)}</p>
      <label class="field">Weekritme
        <select name="rhythm"></select>
      </label>
      <div class="week-preview" id="week-preview" aria-label="Voorbeeld van een loopweek"></div>
      <p class="muted" id="bridge-note">In de brugweken loop je nog niet: dan kracht en springen op de loopdagen, en wandelen op de krachtdagen.</p>
      <details class="plan-rules">
        <summary>De spelregels</summary>
        <ul>${PLAN_5K.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </details>
      <div class="actions">
        <button type="button" class="btn" id="cancel">Annuleren</button>
        <button type="submit" class="btn primary">In agenda zetten</button>
      </div>
    </form>`,
    (fd) => {
      const old = activePlan()
      if (old && !confirm('Er staat al een 5 km-plan in je agenda. Vervangen? De nog niet gedane trainingen van het oude plan worden weggehaald.')) return false
      if (old) removePlan(old)
      const startDate = toKey(startOfWeek(fromKey(fd.get('startDate'))))
      const n = schedulePlan({
        version: fd.get('version'),
        startWeek: fd.get('startWeek'),
        startDate,
        rhythm: fd.get('rhythm'),
        twice: fd.get('twice') === 'on',
        strength: fd.get('strength') === 'on',
        cross: fd.get('cross') === 'on',
        extra: fd.get('extra') === 'on',
      })
      save()
      closeSheet()
      ui.tab = 'week'
      ui.calMode = 'week'
      ui.weekStart = fromKey(startDate)
      render()
      if (agendaScrolls()) scrollToWeek(fromKey(startDate))
      showToast(`📅 ${n} trainingen ingepland. Succes, Tara! 💛`)
    },
  )
  const form = sheet.querySelector('form')
  const refresh = () => {
    const version = form.version.value
    const keep = form.startWeek.value
    form.startWeek.innerHTML = planWeekOptions(version, form.extra.checked)
    if ([...form.startWeek.options].some((o) => o.value === keep)) form.startWeek.value = keep
    sheet.querySelector('#extra-note').textContent = PLAN_5K.versions[version].fiveKmNote
    // Weekritme en voorbeeldweek volgen de vinkjes (2×, kracht, fietsen).
    const opts = { twice: form.twice.checked, strength: form.strength.checked, cross: form.cross.checked }
    const rhythm = form.rhythm.value || PLAN_5K.rhythms[0].id
    form.rhythm.innerHTML = PLAN_5K.rhythms.map((r) => `<option value="${r.id}">${esc(rhythmLabel(r, opts))}</option>`).join('')
    form.rhythm.value = rhythm
    sheet.querySelector('#week-preview').innerHTML = weekPreview(PLAN_5K.rhythms.find((r) => r.id === rhythm), opts)
    sheet.querySelector('#bridge-note').hidden = !form.startWeek.value.startsWith('B')
  }
  refresh()
  form.addEventListener('change', refresh)
  sheet.querySelector('#cancel').onclick = closeSheet
}

function renderPlanCard() {
  const plan = activePlan()
  if (!plan) {
    return `
      <section class="card plan-card">
        <h2>🏃 Terug naar 5 km</h2>
        <p class="muted">Het herstelplan van Tara: stap voor stap weer naar 5 km. Kies je versie en de week waarin je begint, en Tarapp zet alles in je agenda 💛</p>
        <button class="btn primary block" data-action="plan-new">In agenda zetten</button>
      </section>`
  }
  const v = PLAN_5K.versions[plan.version]
  const sessions = state.sessions.filter((s) => s.planId === plan.id)
  const runs = sessions.filter((s) => s.typeId === 'hardlopen')
  const doneRuns = runs.filter((s) => s.done).length
  const ws = toKey(startOfWeek(new Date()))
  const we = toKey(addDays(startOfWeek(new Date()), 6))
  const now = sessions.find((s) => s.date >= ws && s.date <= we)
  const next = sessions.filter((s) => s.date >= todayKey() && !s.done).sort((a, b) => a.date.localeCompare(b.date))[0]
  const status = now
    ? `Deze week: <strong>${weekName(now.planWeek)}</strong>`
    : next
      ? `Begint ${shortDate(fromKey(next.date))} met ${weekName(next.planWeek)}`
      : 'Alles gedaan! 🎉'
  return `
    <section class="card plan-card">
      <h2>🏃 Terug naar 5 km</h2>
      <p>${esc(v.short)}${plan.twice ? ' · 2× per week lopen' : ''} · ${status}</p>
      <p class="muted"><span class="plan-badge">5K</span> Trainingen uit het plan herken je aan de paarse streep.</p>
      <div class="progress"><div style="width:${runs.length ? Math.round((doneRuns / runs.length) * 100) : 0}%"></div></div>
      <p class="muted">${doneRuns} van ${runs.length} looptrainingen gedaan 💛</p>
      ${
        now
          ? `<div class="actions">
              <button class="btn" data-action="plan-repeat" data-id="${now.id}">🟡 Week herhalen</button>
              <button class="btn" data-action="plan-back" data-id="${now.id}">🔴 Week terug</button>
            </div>`
          : ''
      }
      <details class="plan-rules">
        <summary>De spelregels</summary>
        <ul>${PLAN_5K.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </details>
      ${
        icu
          ? '<button class="btn block" data-action="icu-sync">⌚ Naar mijn horloge sturen</button>'
          : '<button class="btn block" data-action="icu-setup">⌚ Horloge koppelen (Zepp)</button>'
      }
      <div class="actions">
        <button class="btn" data-action="plan-new">Opnieuw plannen</button>
        <button class="btn danger" data-action="plan-remove">Uit agenda halen</button>
      </div>
    </section>`
}

// ---------- Horloge: Zepp via Intervals.icu ----------
// Zepp (Amazfit) heeft geen open API, maar koppelt sinds Zepp OS 5 met
// Intervals.icu: geplande trainingen gaan daar naar het horloge, gelopen
// trainingen komen er terug. Tarapp praat met de API van Intervals.icu met de
// persoonlijke API-sleutel (Basic auth "API_KEY:<sleutel>", athlete-ID 0 = de
// eigenaar van de sleutel).
//
// De sleutel staat in een eigen localStorage-item, niet in `state`, zodat hij
// niet in back-ups terechtkomt. `sent` onthoudt welke training als welk
// Intervals.icu-event is verstuurd; bij een wijziging wordt het oude event
// verwijderd en een nieuw aangemaakt (alleen aanmaken en verwijderen, zodat we
// niet afhangen van upsert, dat volgens het forum niet met API-sleutels werkt).

const ICU_STORE = 'tarapp.icu'
const ICU_DAYS_AHEAD = 21
const ICU_DAYS_BACK = 14

function icuLoad() {
  try {
    return JSON.parse(localStorage.getItem(ICU_STORE)) || null
  } catch {
    return null
  }
}
function icuSave() {
  try {
    if (icu) localStorage.setItem(ICU_STORE, JSON.stringify(icu))
    else localStorage.removeItem(ICU_STORE)
  } catch {
    // Opslag geblokkeerd: de koppeling geldt dan alleen voor deze sessie.
  }
}
let icu = icuLoad() // { key, athlete, base, name, sent: { [sessionId]: { id, hash } }, lastSync, lastError, auto }
let icuBusy = false

async function icuFetch(path, opts = {}, conf = icu) {
  const base = (conf.base || 'https://intervals.icu').replace(/\/+$/, '')
  let res
  try {
    res = await fetch(`${base}/api/v1/athlete/${encodeURIComponent(conf.athlete || '0')}${path}`, {
      ...opts,
      headers: {
        Authorization: `Basic ${btoa(`API_KEY:${conf.key}`)}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new Error('netwerk')
  }
  if (res.status === 401 || res.status === 403) throw new Error('sleutel')
  if (!res.ok) throw new Error(`http ${res.status}`)
  return res.json().catch(() => null)
}

function icuErrorText(err) {
  if (err.message === 'netwerk')
    return 'Intervals.icu is niet bereikbaar vanuit de app. Controleer je internet. Blijft dit zo, dan laat intervals.icu de app er waarschijnlijk niet rechtstreeks bij (CORS) en is een tussenstation nodig (zie Geavanceerd).'
  if (err.message === 'sleutel')
    return 'De API-sleutel wordt niet geaccepteerd. Kopieer hem opnieuw uit intervals.icu → Settings → Developer Settings.'
  return `Intervals.icu gaf een fout (${err.message}). Probeer het later nog eens.`
}

// "1m", "30s", "1m30s"
function icuDuration(min) {
  const m = Math.floor(min)
  const s = Math.round((min - m) * 60)
  return s ? (m ? `${m}m${s}s` : `${s}s`) : `${m}m`
}

// Training in het tekstformaat van de Intervals.icu workout builder; de tekst
// vóór de duur is de aanwijzing die het horloge laat zien.
function icuWorkoutText(run) {
  const step = (t, min) => `- ${t === 'run' ? 'Lopen' : 'Wandelen'} ${icuDuration(min)}`
  const lines = []
  if (run.warmup) lines.push('Warmup', step('walk', run.warmup), '')
  const sr = simpleRun(run)
  if (sr && sr.reps > 1) {
    lines.push(`${sr.reps}x`, step('run', sr.run))
    if (sr.walk) lines.push(step('walk', sr.walk))
  } else {
    for (const x of run.steps) lines.push(step(x.t, x.min))
  }
  lines.push('')
  if (run.cooldown) lines.push('Cooldown', step('walk', run.cooldown))
  return lines.join('\n').trim()
}

const icuHash = (s) => JSON.stringify([s.date, s.run.label, s.run.steps, s.run.warmup, s.run.cooldown])

function icuEvent(s) {
  const label = s.run.label.replaceAll('×', 'x')
  return {
    category: 'WORKOUT',
    type: 'Run',
    start_date_local: `${s.date}T00:00:00`,
    name: s.planId ? `5K ${weekName(s.planWeek)}: ${label}` : `Tarapp: ${label}`,
    description: icuWorkoutText(s.run),
    external_id: `tarapp-${s.id}`,
  }
}

// Looptrainingen met intervallen die de komende weken op het horloge horen.
const icuWanted = (s) =>
  isRunType(s.typeId) && s.run && !s.done && !s.runLog && s.date >= todayKey() && s.date <= toKey(addDays(new Date(), ICU_DAYS_AHEAD))

async function icuPushRuns(result) {
  icu.sent ||= {}
  const want = new Map(state.sessions.filter(icuWanted).map((s) => [s.id, s]))
  for (const [sid, ev] of Object.entries(icu.sent)) {
    const s = state.sessions.find((x) => x.id === sid)
    // Gelopen: het event mag blijven staan (Intervals.icu koppelt het aan de run).
    if (s && (s.done || s.runLog)) {
      delete icu.sent[sid]
      continue
    }
    const w = want.get(sid)
    if (w && ev.hash === icuHash(w)) continue
    // Verwijderd, verplaatst, aangepast of voorbij: oude event weghalen.
    if (ev.id != null) {
      await icuFetch(`/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }).catch((err) => {
        if (err.message !== 'http 404') throw err
      })
    }
    delete icu.sent[sid]
    icuSave()
    result.removed++
  }
  for (const s of want.values()) {
    if (icu.sent[s.id]) continue
    const ev = await icuFetch('/events', { method: 'POST', body: JSON.stringify(icuEvent(s)) })
    icu.sent[s.id] = { id: ev?.id ?? null, hash: icuHash(s) }
    icuSave()
    result.sent++
  }
}

// Soort activiteit in Intervals.icu -> activiteit(en) in Tarapp.
const ICU_TYPES = {
  Run: ['hardlopen'],
  TrailRun: ['hardlopen'],
  VirtualRun: ['hardlopen'],
  Walk: ['wandelen'],
  Hike: ['wandelen'],
  Ride: ['fietsen'],
  VirtualRide: ['fietsen'],
  GravelRide: ['fietsen'],
  MountainBikeRide: ['fietsen'],
  EBikeRide: ['fietsen'],
  Swim: ['zwemmen'],
  OpenWaterSwim: ['zwemmen'],
  WeightTraining: ['kracht', 'gym'],
  RockClimbing: ['klimmen', 'boulderen'],
  Yoga: ['yoga'],
}

// Gelopen trainingen van de afgelopen twee weken ophalen: een geplande training
// van dezelfde soort op dezelfde dag wordt afgevinkt; een run zonder planning
// komt er als nieuwe (gedane) training bij.
async function icuImportActivities(result) {
  const oldest = toKey(addDays(new Date(), -ICU_DAYS_BACK))
  const acts = await icuFetch(`/activities?oldest=${oldest}&newest=${todayKey()}`)
  for (const act of Array.isArray(acts) ? acts : []) {
    const id = String(act.id)
    if (state.sessions.some((s) => s.icuId === id)) continue
    const types = ICU_TYPES[act.type] || []
    const when = String(act.start_date_local || act.start_date || '')
    const date = when.slice(0, 10)
    if (!types.length || !/^\d{4}-\d\d-\d\d$/.test(date)) continue
    const minutes = Math.max(1, Math.round((act.moving_time || act.elapsed_time || 0) / 60))
    const info = { icuId: id, distance: act.distance > 0 ? act.distance : undefined, duration: minutes }
    const match = state.sessions
      .filter((s) => s.date === date && types.includes(s.typeId) && !s.icuId)
      .sort((x, y) => Number(x.done) - Number(y.done))[0]
    if (match) {
      const wasDone = match.done
      Object.assign(match, info, { done: true })
      if (!wasDone) result.done.push(match)
    } else if (types[0] === 'hardlopen') {
      const s = {
        id: uid(),
        typeId: 'hardlopen',
        date,
        time: when.slice(11, 16),
        templateId: '',
        note: act.name ? `⌚ ${act.name}` : '⌚ Van je horloge',
        done: true,
        ...info,
      }
      state.sessions.push(s)
      result.done.push(s)
    }
  }
}

async function icuSync({ quiet = false } = {}) {
  if (!icu || icuBusy) return
  icuBusy = true
  const result = { sent: 0, removed: 0, done: [] }
  try {
    await icuPushRuns(result)
    await icuImportActivities(result)
    icu.lastSync = Date.now()
    icu.lastError = null
    icuSave()
    save()
    render()
    const parts = []
    if (result.sent) parts.push(`${result.sent} op je horloge gezet`)
    if (result.done.length) parts.push(`${result.done.length} van je horloge afgevinkt`)
    if (parts.length || !quiet) showToast(`⌚ ${parts.join(', ') || 'Alles is bijgewerkt'} 💛`)
    // Scheenpijn invullen voor de laatste run die net binnenkwam.
    const run = result.done.filter((s) => isRunType(s.typeId) && !Number.isInteger(s.shin)).pop()
    if (run && !sheet.open && !ui.active && !ui.run) setTimeout(() => !sheet.open && openShinSheet(run), 600)
  } catch (err) {
    icu.lastError = icuErrorText(err)
    icuSave()
    if (ui.tab === 'meer') render()
    if (!quiet) alert(icu.lastError)
  } finally {
    icuBusy = false
  }
}

// Bij openen (en terugkomen in) de app, hooguit eens per 10 minuten.
function icuAutoSync() {
  if (icu && icu.auto !== false && Date.now() - (icu.lastSync || 0) > 10 * 60e3) icuSync({ quiet: true })
}

async function icuConnect(form) {
  const fd = new FormData(form)
  const conf = {
    key: String(fd.get('key') || '').trim(),
    athlete: String(fd.get('athlete') || '').trim() || '0',
    base: String(fd.get('base') || '').trim() || 'https://intervals.icu',
  }
  if (!conf.key) return
  const btn = form.querySelector('button[type=submit]')
  btn.disabled = true
  btn.textContent = 'Bezig met koppelen…'
  try {
    const me = await icuFetch('', {}, conf)
    icu = { ...conf, athlete: me?.id || conf.athlete, name: me?.name || '', sent: {}, auto: true }
    icuSave()
    render()
    await icuSync()
  } catch (err) {
    alert(icuErrorText(err))
    btn.disabled = false
    btn.textContent = 'Koppelen'
  }
}

async function icuDisconnect() {
  if (!confirm('Horloge ontkoppelen? De trainingen die Tarapp naar Intervals.icu heeft gestuurd, worden daar weggehaald. Je trainingen in Tarapp blijven staan.')) return
  for (const ev of Object.values(icu.sent || {})) {
    if (ev.id != null) await icuFetch(`/events/${encodeURIComponent(ev.id)}`, { method: 'DELETE' }).catch(() => {})
  }
  icu = null
  icuSave()
  render()
  showToast('⌚ Horloge ontkoppeld')
}

function renderIcuCard() {
  if (!icu) {
    return `
      <section class="card">
        <h2>⌚ Horloge (Zepp)</h2>
        <p class="muted">Stuur je looptrainingen met intervallen naar je Amazfit-horloge, en laat gelopen trainingen vanzelf afvinken. Dat gaat via Intervals.icu (gratis), want Zepp koppelt alleen met dat soort diensten.</p>
        <details class="plan-rules">
          <summary>Zo koppel je het (eenmalig)</summary>
          <ol>
            <li>Maak een gratis account op <strong>intervals.icu</strong>.</li>
            <li>Zepp-app → Profiel → accounts van derden koppelen → <strong>Intervals.icu</strong> (Zepp OS 5).</li>
            <li>Op intervals.icu: Settings → <strong>Developer Settings</strong> → API key. Kopieer de sleutel.</li>
            <li>Plak hem hieronder en tik op Koppelen.</li>
          </ol>
          <p class="muted">Let op: daarna staan je looptrainingen en gelopen trainingen ook bij Intervals.icu. Scheenpijn en notities blijven alleen in Tarapp.</p>
        </details>
        <form id="icu-form" class="icu-form">
          <input name="key" placeholder="API-sleutel van intervals.icu" autocomplete="off" autocapitalize="off" spellcheck="false" required />
          <details class="plan-rules">
            <summary>Geavanceerd</summary>
            <input name="athlete" placeholder="Athlete-ID (leeg = automatisch)" autocomplete="off" autocapitalize="off" />
            <input name="base" placeholder="Tussenstation (leeg = https://intervals.icu)" autocomplete="off" autocapitalize="off" inputmode="url" />
          </details>
          <button type="submit" class="btn primary block">Koppelen</button>
        </form>
      </section>`
  }
  const sentCount = Object.keys(icu.sent || {}).length
  const last = icu.lastSync ? new Date(icu.lastSync) : null
  const lastText = last ? `${shortDate(last)} ${pad(last.getHours())}:${pad(last.getMinutes())}` : 'nog niet'
  return `
    <section class="card">
      <h2>⌚ Horloge (Zepp)</h2>
      <p>✅ Gekoppeld met Intervals.icu${icu.name ? ` als <strong>${esc(icu.name)}</strong>` : ''}</p>
      <p class="muted">Laatst bijgewerkt: ${lastText} · ${sentCount} looptraining${sentCount === 1 ? '' : 'en'} op je horloge gezet (de komende ${ICU_DAYS_AHEAD / 7} weken)</p>
      ${icu.lastError ? `<p class="icu-error">⚠️ ${esc(icu.lastError)}</p>` : ''}
      <button class="btn primary block" data-action="icu-sync">⌚ Nu bijwerken</button>
      <label class="ss-toggle"><input type="checkbox" data-icu="auto" ${icu.auto === false ? '' : 'checked'} /> Automatisch bijwerken als je de app opent</label>
      <button class="btn danger block" data-action="icu-disconnect">Ontkoppelen</button>
    </section>`
}

// ---------- Elke week herhalen ----------
// Een herhaling is een regel { id, every, last, tpl }: vanaf de laatst
// ingeplande datum (`last`) vult de app steeds nieuwe trainingen aan tot een
// stuk vooruit. Wat vóór `last` is verwijderd of versleept komt dus niet terug.

const seriesOf = (s) => s?.seriesId && state.series.find((r) => r.id === s.seriesId)

function startWeekly(s) {
  s.seriesId ||= uid()
  state.series.push({
    id: s.seriesId,
    every: 7,
    last: s.date,
    tpl: { typeId: s.typeId, time: s.time, duration: s.duration, templateId: s.templateId, note: s.note, run: s.run },
  })
  ensureRecurring()
}

// Herhaling stoppen; de nog niet gedane trainingen ná deze mogen weg.
function stopWeekly(s) {
  state.series = state.series.filter((r) => r.id !== s.seriesId)
  const later = state.sessions.filter((x) => x.seriesId === s.seriesId && x.date > s.date && !x.done && !x.log)
  if (later.length && confirm(`Herhaling stopt. Ook de ${later.length} al ingeplande training(en) hierna verwijderen?`)) {
    const ids = new Set(later.map((x) => x.id))
    state.sessions = state.sessions.filter((x) => !ids.has(x.id))
  }
  return 'Herhaling gestopt'
}

const SERIES_FIELDS = ['typeId', 'time', 'duration', 'templateId', 'note', 'run']
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000)

// Wijziging ook doorvoeren in de nog niet gedane trainingen van deze reeks ná
// `fromDate`, en in de regel zelf zodat nieuwe weken het ook krijgen. Een
// andere dag schuift alle volgende weken evenveel dagen op.
function applyToFollowing(s, fromDate, changes, dayDelta) {
  const r = seriesOf(s)
  for (const x of state.sessions) {
    if (x.seriesId !== s.seriesId || x.id === s.id || x.date <= fromDate || x.done || x.log) continue
    Object.assign(x, changes)
    if (dayDelta) x.date = toKey(addDays(fromKey(x.date), dayDelta))
  }
  Object.assign(r.tpl, changes)
  if (dayDelta) r.last = toKey(addDays(fromKey(r.last), dayDelta))
}

// Vraag: alleen deze training, of ook alle volgende weken? `apply(all)` wordt
// alleen aangeroepen bij een keuze; Annuleren laat alles zoals het was.
function askSeriesScope(apply) {
  openSheet(
    `
    <form method="dialog">
      <h2>🔁 Herhalende training</h2>
      <p class="muted">Geldt deze wijziging alleen voor deze training, of ook voor alle volgende weken?</p>
      <div class="scope-btns">
        <button type="button" class="btn block" id="scope-one">Alleen deze</button>
        <button type="button" class="btn primary block" id="scope-all">Deze en alle volgende</button>
        <button type="button" class="btn block" id="cancel">Annuleren</button>
      </div>
    </form>`,
    () => {},
  )
  const choose = (all) => () => {
    closeSheet()
    apply(all)
  }
  sheet.querySelector('#scope-one').onclick = choose(false)
  sheet.querySelector('#scope-all').onclick = choose(true)
  sheet.querySelector('#cancel').onclick = closeSheet
}

// Herhalingen aanvullen tot `until` (standaard 12 weken vanaf vandaag).
function ensureRecurring(until = toKey(addDays(new Date(), 84))) {
  let changed = false
  for (const r of state.series) {
    let next = addDays(fromKey(r.last), r.every)
    while (toKey(next) <= until) {
      state.sessions.push({ id: uid(), ...JSON.parse(JSON.stringify(r.tpl)), date: toKey(next), done: false, seriesId: r.id })
      r.last = toKey(next)
      next = addDays(next, r.every)
      changed = true
    }
  }
  if (changed) save()
}

function deleteSession(session) {
  let ids = [session.id]
  if (session.seriesId) {
    const later = state.sessions.filter((s) => s.seriesId === session.seriesId && s.date > session.date)
    if (later.length && confirm(`Ook de ${later.length} volgende training(en) uit deze herhaling verwijderen? De herhaling stopt dan.`)) {
      ids = ids.concat(later.map((s) => s.id))
      state.series = state.series.filter((r) => r.id !== session.seriesId)
    } else if (!confirm('Alleen deze training verwijderen?')) return
  } else if (!confirm('Deze training verwijderen?')) return
  state.sessions = state.sessions.filter((s) => !ids.includes(s.id))
  save()
  closeSheet()
  render()
}

function exerciseRow(e = { id: uid(), name: '', sets: 3, reps: '10', weight: '', unit: 'reps', superset: false }) {
  return `
    <div class="ex-edit ${e.superset ? 'ss' : ''}" data-id="${e.id}">
      <div class="ex-edit-top">
        <span class="drag-handle" aria-label="Slepen om te verplaatsen">⠿</span>
        <input name="name" value="${esc(e.name)}" placeholder="Oefening" aria-label="Oefening" />
        <button type="button" class="mini" data-move="-1" aria-label="Omhoog">▲</button>
        <button type="button" class="mini" data-move="1" aria-label="Omlaag">▼</button>
        <button type="button" class="mini del" aria-label="Oefening verwijderen">✕</button>
      </div>
      <div class="ex-edit-grid">
        <label>Sets<input name="sets" value="${esc(e.sets)}" inputmode="numeric" /></label>
        <label>
          <select name="unit" aria-label="Eenheid">
            <option value="reps" ${e.unit !== 'sec' ? 'selected' : ''}>Herhalingen</option>
            <option value="sec" ${e.unit === 'sec' ? 'selected' : ''}>Seconden</option>
          </select>
          <input name="reps" value="${esc(e.reps)}" inputmode="numeric" aria-label="Aantal" />
        </label>
        <label>Kg<input name="weight" value="${esc(e.weight)}" inputmode="decimal" placeholder="–" /></label>
      </div>
      <label class="ss-toggle"><input type="checkbox" name="superset" ${e.superset ? 'checked' : ''} /> 🔗 Superset met vorige oefening</label>
    </div>`
}

function readExerciseRows(root) {
  const rows = [...root.querySelectorAll('.ex-edit')].map((row) => {
    const v = (n) => row.querySelector(`[name="${n}"]`).value.trim()
    return {
      id: row.dataset.id,
      name: v('name'),
      sets: v('sets'),
      reps: v('reps'),
      weight: v('weight'),
      unit: v('unit'),
      superset: row.querySelector('[name="superset"]').checked,
    }
  })
  if (rows[0]) rows[0].superset = false
  return rows
}

function openTemplateSheet(tpl) {
  const isNew = !tpl
  const t = tpl || { name: '', exercises: [] }
  const rows = (t.exercises.length ? t.exercises : [undefined]).map((e) => exerciseRow(e)).join('')
  openSheet(
    `
    <form method="dialog">
      <h2>${isNew ? 'Nieuw schema' : 'Schema bewerken'}</h2>
      <label class="field">Naam<input name="tplName" value="${esc(t.name)}" placeholder="Bijv. Full body A" required /></label>
      <div id="ex-rows">${rows}</div>
      <button type="button" class="linkbtn" id="add-ex">+ Oefening toevoegen</button>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del-tpl">Verwijderen</button>'}
        <button type="button" class="btn" id="cancel">Annuleren</button>
        <button type="submit" class="btn primary">Opslaan</button>
      </div>
    </form>`,
    (fd, form) => {
      const exercises = readExerciseRows(form).filter((e) => e.name)
      if (exercises[0]) exercises[0].superset = false
      const name = fd.get('tplName').trim()
      if (isNew) state.templates.push({ id: uid(), name, exercises })
      else Object.assign(tpl, { name, exercises })
      save()
      render()
    },
  )
  const rowsEl = sheet.querySelector('#ex-rows')
  sheet.querySelector('#cancel').onclick = closeSheet
  sheet.querySelector('#add-ex').onclick = () => {
    rowsEl.insertAdjacentHTML('beforeend', exerciseRow())
    rowsEl.lastElementChild.querySelector('input').focus()
  }
  rowsEl.addEventListener('click', (e) => {
    const row = e.target.closest('.ex-edit')
    if (e.target.classList.contains('del')) row.remove()
    if (e.target.dataset.move) {
      const exs = readExerciseRows(rowsEl)
      const i = [...rowsEl.children].indexOf(row)
      const j = moveExercise(exs, i, Number(e.target.dataset.move))
      rowsEl.innerHTML = exs.map((x) => exerciseRow(x)).join('')
      rowsEl.children[j]?.scrollIntoView({ block: 'nearest' })
    }
  })
  rowsEl.addEventListener('change', (e) => {
    if (e.target.name === 'superset') e.target.closest('.ex-edit').classList.toggle('ss', e.target.checked)
  })
  // Invoegpositie = vóór de eerste rij waarvan het midden onder de vinger ligt.
  const dropIndex = (y) => {
    const rows = [...rowsEl.children]
    const k = rows.findIndex((r) => {
      const b = r.getBoundingClientRect()
      return y < b.top + b.height / 2
    })
    return k === -1 ? rows.length : k
  }
  const clearMarks = () => rowsEl.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'))
  makeDraggable(rowsEl, {
    item: '.ex-edit',
    handle: '.drag-handle',
    scroller: sheet,
    onMove: (x, y) => {
      clearMarks()
      if (!Number.isFinite(y)) return
      const rows = rowsEl.children
      const k = dropIndex(y)
      if (k < rows.length) rows[k].classList.add('drop-before')
      else rows[rows.length - 1]?.classList.add('drop-after')
    },
    onDrop: (x, y, el) => {
      clearMarks()
      if (!Number.isFinite(y)) return
      const exs = readExerciseRows(rowsEl)
      const k = dragExercise(exs, [...rowsEl.children].indexOf(el), dropIndex(y))
      rowsEl.innerHTML = exs.map((x) => exerciseRow(x)).join('')
      rowsEl.children[k]?.classList.add('just-dropped')
    },
    onTrash: (el) => {
      const exs = readExerciseRows(rowsEl)
      const backup = exs.map((x) => ({ ...x }))
      const i = [...rowsEl.children].indexOf(el)
      const [removed] = exs.splice(i, 1)
      // Was dit het begin van een superset, dan begint die nu bij de volgende.
      if (!removed.superset && exs[i]?.superset) exs[i].superset = false
      if (exs[0]) exs[0].superset = false
      rowsEl.innerHTML = exs.map((x) => exerciseRow(x)).join('')
      showToast(`${removed.name || 'Oefening'} verwijderd`, () => {
        rowsEl.innerHTML = backup.map((x) => exerciseRow(x)).join('')
      })
    },
  })
  const del = sheet.querySelector('#del-tpl')
  if (del)
    del.onclick = () => {
      const used = state.sessions.filter((s) => s.templateId === tpl.id).length
      const msg = used
        ? `Dit schema is gekoppeld aan ${used} training(en). Die blijven bestaan, maar zonder schema. Verwijderen?`
        : 'Dit schema verwijderen?'
      if (!confirm(msg)) return
      state.templates = state.templates.filter((x) => x.id !== tpl.id)
      for (const s of state.sessions) if (s.templateId === tpl.id) s.templateId = ''
      save()
      closeSheet()
      render()
    }
}

// ---------- Slepen ----------

// Slepen met de vinger (pointer events; HTML5 drag-and-drop werkt niet op de
// iPhone). Met `delay` moet je eerst even vasthouden, zodat gewoon scrollen en
// tikken blijven werken; met delay 0 sleept een aparte greep direct.
// Met `onTrash` verschijnt tijdens het slepen onderin een prullenbak.
function makeDraggable(root, { item, handle, delay = 0, scroller, onStart, onMove, onDrop, onTrash }) {
  let st = null

  const overTrash = () => {
    if (!st?.trash) return false
    const r = st.trash.getBoundingClientRect()
    return st.y >= r.top && st.y <= r.bottom && st.x >= r.left && st.x <= r.right
  }

  // Bij de rand van een scrollend venster blijven = meescrollen
  // (niet boven de prullenbak, die zit zelf onderaan).
  const autoScroll = () => {
    if (!st?.active) return
    const win = scroller === window
    const r = win ? { top: topbarBottom(), bottom: window.innerHeight } : scroller.getBoundingClientRect()
    const bottom = st.trash ? Math.min(r.bottom, st.trash.getBoundingClientRect().top) : r.bottom
    const edge = 64
    const speed = overTrash() ? 0 : st.y < r.top + edge ? -12 : st.y > bottom - edge ? 12 : 0
    if (speed) {
      if (win) window.scrollBy(0, speed)
      else scroller.scrollTop += speed
      onMove?.(st.x, st.y, st.el)
    }
    st.raf = requestAnimationFrame(autoScroll)
  }

  const cleanup = () => {
    clearTimeout(st?.timer)
    cancelAnimationFrame(st?.raf)
    st?.ghost?.remove()
    st?.trash?.remove()
    st?.el.classList.remove('dragging')
    document.body.classList.remove('is-dragging')
    st = null
  }

  const activate = () => {
    st.active = true
    const r = st.el.getBoundingClientRect()
    st.dx = st.x - r.left
    st.dy = st.y - r.top
    st.ghost = st.el.cloneNode(true)
    st.ghost.classList.add('drag-ghost')
    st.ghost.style.width = `${r.width}px`
    // In een modaal venster (top layer) moet het spook ín dat venster staan om zichtbaar te zijn.
    const layer = root.closest('dialog') || document.body
    if (onTrash) {
      st.trash = document.createElement('div')
      st.trash.className = 'trash-zone'
      st.trash.innerHTML = '<span>🗑️</span> Sleep hierheen om te verwijderen'
      // Boven de tabbalk zetten in plaats van eroverheen.
      const tabbar = document.querySelector('.tabbar')
      if (layer === document.body && tabbar?.getBoundingClientRect().height > 0) {
        st.trash.style.bottom = `${window.innerHeight - tabbar.getBoundingClientRect().top + 10}px`
      }
      layer.append(st.trash)
    }
    layer.append(st.ghost)
    st.el.classList.add('dragging')
    document.body.classList.add('is-dragging')
    navigator.vibrate?.(20)
    onStart?.(st.el)
    position()
    if (scroller) autoScroll()
  }

  const position = () => {
    st.ghost.style.transform = `translate(${st.x - st.dx}px, ${st.y - st.dy}px)`
    const hot = overTrash()
    st.trash?.classList.toggle('hot', hot)
    st.ghost.classList.toggle('to-trash', hot)
    // Boven de prullenbak geen dag/plek markeren.
    onMove?.(hot ? NaN : st.x, hot ? NaN : st.y, st.el)
  }

  root.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return
    const h = e.target.closest(handle)
    const el = h?.closest(item)
    if (!el || !root.contains(el)) return
    st = { el, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, active: false }
    if (delay) st.timer = setTimeout(activate, delay)
    else {
      e.preventDefault()
      activate()
    }
  })

  window.addEventListener('pointermove', (e) => {
    if (!st) return
    st.x = e.clientX
    st.y = e.clientY
    // Bewegen vóór het vasthouden voorbij is = scrollen, geen slepen.
    if (!st.active) {
      if (Math.hypot(st.x - st.x0, st.y - st.y0) > 8) cleanup()
      return
    }
    position()
  })

  window.addEventListener('pointerup', () => {
    if (!st) return
    if (st.active) {
      if (overTrash()) {
        onMove?.(NaN, NaN, st.el)
        onTrash(st.el)
      } else onDrop?.(st.x, st.y, st.el)
      // De klik die na het loslaten volgt mag geen venster openen.
      const swallow = (ev) => {
        ev.stopPropagation()
        ev.preventDefault()
      }
      const release = () => {
        window.removeEventListener('click', swallow, { capture: true })
        window.removeEventListener('pointerdown', release, { capture: true })
      }
      window.addEventListener('click', swallow, { capture: true, once: true })
      // Alleen de klik van dít loslaten; een volgende aanraking telt gewoon.
      window.addEventListener('pointerdown', release, { capture: true, once: true })
      setTimeout(release, 100)
    }
    cleanup()
  })

  window.addEventListener('pointercancel', () => {
    if (st?.active) onDrop?.(NaN, NaN, st.el)
    cleanup()
  })

  // Tijdens slepen niet laten scrollen (iOS negeert touch-action halverwege een gebaar).
  document.addEventListener(
    'touchmove',
    (e) => {
      if (st?.active) e.preventDefault()
    },
    { passive: false },
  )
  // Lang indrukken opent op iOS/desktop anders een contextmenu.
  root.addEventListener('contextmenu', (e) => {
    if (st) e.preventDefault()
  })
}

// Melding onderin met een knop "Ongedaan maken" (verdwijnt na 5 s).
let toastTimer
function showToast(text, undo) {
  document.querySelectorAll('.toast').forEach((t) => t.remove())
  const t = document.createElement('div')
  t.className = 'toast'
  t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button">Ongedaan maken</button>' : ''}`
  if (undo)
    t.querySelector('button').onclick = () => {
      t.remove()
      undo()
    }
  // In een open venster moet de melding in dat venster staan om zichtbaar te zijn.
  ;(sheet.open ? sheet : document.body).append(t)
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.remove(), 5000)
}

// Element onder de vinger, met het sleep-spook zelf genegeerd (pointer-events: none).
const elementAt = (x, y) => (Number.isFinite(x) ? document.elementFromPoint(x, y) : null)

// Agenda: training naar een andere dag slepen.
makeDraggable(view, {
  item: '.session',
  handle: '.s-body',
  delay: 350,
  scroller: window,
  onStart: () => {
    swipe = null
  },
  onMove: (x, y) => {
    const target = elementAt(x, y)?.closest('[data-drop-date]')
    view.querySelectorAll('.drop-target').forEach((d) => d !== target && d.classList.remove('drop-target'))
    target?.classList.add('drop-target')
  },
  onDrop: (x, y, el) => {
    view.querySelectorAll('.drop-target').forEach((d) => d.classList.remove('drop-target'))
    const date = elementAt(x, y)?.closest('[data-drop-date]')?.dataset.dropDate
    const id = el.querySelector('[data-id]')?.dataset.id
    const s = state.sessions.find((x) => x.id === id)
    if (!s || !date || date === s.date) return
    const move = (all) => {
      const origDate = s.date
      s.date = date
      if (all) applyToFollowing(s, origDate, {}, daysBetween(origDate, date))
      save()
      render()
      if (all) showToast('🔁 Alle volgende weken ook verplaatst')
    }
    if (seriesOf(s)) askSeriesScope(move)
    else move(false)
  },
  onTrash: (el) => {
    const id = el.querySelector('[data-id]')?.dataset.id
    const i = state.sessions.findIndex((x) => x.id === id)
    if (i === -1) return
    const [removed] = state.sessions.splice(i, 1)
    save()
    render()
    const t = typeById(removed.typeId)
    showToast(`${t.emoji} ${t.name} verwijderd`, () => {
      state.sessions.splice(i, 0, removed)
      save()
      render()
    })
  },
})

// Oefening in een lijst van i naar positie `to` (index vóór het verwijderen)
// verplaatsen. Supersets blijven kloppen: wie uit het begin van een superset
// wordt gehaald draagt die rol over, en wie midden in een superset landt doet mee.
function dragExercise(exs, i, to) {
  if (to === i || to === i + 1) return i
  const [moved] = exs.splice(i, 1)
  if (!moved.superset && exs[i]?.superset) exs[i].superset = false
  const k = to > i ? to - 1 : to
  moved.superset = k > 0 && !!exs[k]?.superset
  exs.splice(k, 0, moved)
  if (exs[0]) exs[0].superset = false
  return k
}

// ---------- Acties ----------

const actions = {
  'prev-week': () => {
    ui.weekStart = addDays(ui.weekStart, -7)
    render()
  },
  'next-week': () => {
    ui.weekStart = addDays(ui.weekStart, 7)
    render()
  },
  'cal-mode': (el) => {
    ui.calMode = el.dataset.mode
    if (ui.calMode === 'maand') ui.month = new Date(ui.weekStart.getFullYear(), addDays(ui.weekStart, 3).getMonth(), 1)
    render()
    if (ui.calMode === 'week' && agendaScrolls()) scrollToWeek(ui.weekStart)
    else window.scrollTo(0, 0)
  },
  'prev-month': () => {
    ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() - 1, 1)
    render()
  },
  'next-month': () => {
    ui.month = new Date(ui.month.getFullYear(), ui.month.getMonth() + 1, 1)
    render()
  },
  'this-month': () => {
    ui.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    render()
  },
  'cal-day': (el) => {
    ui.weekStart = startOfWeek(fromKey(el.dataset.date))
    ui.calMode = 'week'
    render()
    if (agendaScrolls()) scrollToWeek(ui.weekStart)
    document.querySelector(`[data-date="${el.dataset.date}"]`)?.closest('.day')?.scrollIntoView({ block: 'center' })
  },
  'this-week': () => {
    ui.weekStart = startOfWeek(new Date())
    render()
  },
  'weeks-earlier': () => {
    ui.scrollFrom -= 8
    render()
  },
  'plan-new': () => openPlanSheet(),
  'icu-sync': () => icuSync(),
  'icu-disconnect': () => icuDisconnect(),
  'icu-setup': () => {
    ui.tab = 'meer'
    render()
    window.scrollTo(0, 0)
  },
  'plan-repeat': (el) => askRepeatPlanWeek(state.sessions.find((s) => s.id === el.dataset.id), false),
  'plan-back': (el) => askRepeatPlanWeek(state.sessions.find((s) => s.id === el.dataset.id), true),
  'plan-remove': () => askRemovePlan(activePlan()?.id),
  add: (el) => openSessionSheet(null, el.dataset.date),
  edit: (el) => {
    const s = state.sessions.find((x) => x.id === el.dataset.id)
    if (s.run && isRunType(s.typeId)) openRunSheet(s)
    else if (isWorkoutSession(s)) openWorkoutSheet(s)
    else openSessionSheet(s)
  },
  ...workoutActions,
  ...runActions,
  toggle: (el) => {
    const s = state.sessions.find((x) => x.id === el.dataset.id)
    s.done = !s.done
    save()
    render()
    if (s.done && tracksShin(s.typeId)) openShinSheet(s)
    if (s.done) cheer()
  },
  'edit-template': (el) => openTemplateSheet(templateById(el.dataset.id)),
  'delete-type': (el) => {
    const t = typeById(el.dataset.id)
    if (state.types.filter((x) => !x.hidden).length <= 1) return alert('Je hebt minstens één activiteit nodig.')
    if (!confirm(`"${t.name}" verwijderen?`)) return
    // Gebruikte types alleen verbergen, zodat oude trainingen hun naam houden.
    if (state.sessions.some((s) => s.typeId === t.id)) t.hidden = true
    else state.types = state.types.filter((x) => x.id !== t.id)
    save()
    render()
  },
  export: exportData,
  'welcome-done': () => {
    state.settings ||= {}
    state.settings.welcomed = true
    state.settings.seenVersion = Number(APP_VERSION)
    save()
    render()
    window.scrollTo(0, 0)
  },
  'show-changelog': () => openChangelog(0),
  'show-welcome': () => {
    state.settings ||= {}
    state.settings.welcomed = false
    save()
    render()
    window.scrollTo(0, 0)
  },
  'force-update': async () => {
    // Alleen de app-cache wissen (niet localStorage) en vers ophalen.
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
      for (const k of await caches.keys()) await caches.delete(k)
    } catch {
      // Geen cache-API: gewoon herladen.
    }
    location.reload()
  },
  import: () => document.getElementById('import-file').click(),
  reset: () => {
    if (!confirm('Alle trainingen, schema\'s en activiteiten wissen? Dit kan niet ongedaan worden gemaakt.')) return
    state = defaultState()
    save()
    render()
  },
}

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]')
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el)
})

view.addEventListener('input', (e) => {
  const field = e.target.dataset.field
  if (!field || !ui.active) return
  const row = e.target.closest('.set-row')
  const ex = activeLog().exercises[row ? row.dataset.ex : e.target.dataset.ex]
  const target = row ? ex.sets[row.dataset.set] : ex
  target[field] = field === 'note' ? e.target.value : e.target.value.trim()
  save()
})

view.addEventListener('submit', (e) => {
  if (e.target.id === 'icu-form') {
    e.preventDefault()
    icuConnect(e.target)
    return
  }
  if (e.target.id !== 'type-form') return
  e.preventDefault()
  const fd = new FormData(e.target)
  const name = fd.get('name').trim()
  if (!name) return
  state.types.push({ id: uid(), name, emoji: fd.get('emoji').trim() || '⭐' })
  save()
  render()
})

view.addEventListener('change', (e) => {
  if (e.target.dataset.icu === 'auto' && icu) {
    icu.auto = e.target.checked
    icuSave()
  }
  const key = e.target.dataset.setting
  if (!key) return
  state.settings ||= {}
  state.settings[key] = e.target.checked
  save()
})

view.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return
  try {
    const parsed = JSON.parse(await e.target.files[0].text())
    if (!isValidState(parsed)) throw new Error('ongeldig')
    if (!confirm('Huidige gegevens vervangen door deze back-up?')) return
    state = normalize(parsed)
    save()
    render()
    alert('Back-up teruggezet.')
  } catch {
    alert('Dit bestand is geen geldige Tarapp-back-up.')
  }
})

async function exportData() {
  const json = JSON.stringify(state, null, 2)
  const name = `tarapp-backup-${todayKey()}.json`
  const file = new File([json], name, { type: 'application/json' })
  // Op iPhone werkt het deelmenu beter dan een download ("Bewaar in Bestanden").
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Tarapp back-up' })
      return
    } catch (err) {
      if (err.name === 'AbortError') return
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

document.querySelector('.tabbar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]')
  if (!btn) return
  ui.tab = btn.dataset.tab
  render()
  if (ui.tab === 'week' && ui.calMode === 'week' && agendaScrolls()) scrollToWeek(new Date())
  else window.scrollTo(0, 0)
})

fab.addEventListener('click', () => {
  if (ui.tab === 'schemas') return openTemplateSheet(null)
  // In de huidige week: vandaag; anders de maandag van de getoonde week.
  const isCurrent = toKey(ui.weekStart) === toKey(startOfWeek(new Date()))
  openSessionSheet(null, isCurrent ? todayKey() : toKey(ui.weekStart))
})

// Bij terugkeren naar de app op een nieuwe dag: "vandaag" bijwerken.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return
  render()
  icuAutoSync()
})

// Een niet-afgeronde training van de afgelopen 12 uur meteen weer openen,
// bijv. als iOS de app halverwege de training heeft afgesloten.
const unfinished = state.sessions.find((s) => s.log && !s.log.endedAt && Date.now() - s.log.startedAt < 12 * 3600e3)
if (unfinished) ui.active = unfinished.id
const unfinishedRun = state.sessions.find((s) => s.runLog && !s.runLog.endedAt && Date.now() - s.runLog.startedAt < 3 * 3600e3)
if (unfinishedRun) ui.run = unfinishedRun.id

render()
showChangesSinceLastVisit()
icuAutoSync()

// Vraag de browser de opslag niet op te ruimen bij ruimtegebrek.
async function requestPersistence() {
  if (!navigator.storage?.persist) return
  try {
    ui.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist())
    if (ui.tab === 'meer') render()
  } catch {
    // Niet ondersteund of geweigerd: status blijft onbekend.
  }
}
requestPersistence()

// ---------- Updates ----------

// Een nieuwe service worker neemt het over -> pagina herladen zodat de nieuwe
// versie meteen zichtbaar is. Niet tijdens een lopende rusttimer of open sheet;
// dan wachten tot die klaar is. Gegevens staan in localStorage en blijven staan.
let reloadPending = false
function reloadWhenIdle() {
  if (ui.restEnd || ui.hold || ui.run || sheet.open) {
    reloadPending = true
    return
  }
  location.reload()
}
setInterval(() => {
  if (reloadPending && !ui.restEnd && !ui.hold && !ui.run && !sheet.open) location.reload()
}, 1000)

async function checkForUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    await reg?.update()
  } catch {
    // Offline: gewoon de huidige versie blijven gebruiken.
  }
}

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Bij de allereerste installatie is er niets te verversen.
    if (hadController) reloadWhenIdle()
  })
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {})
  // iOS houdt de app vaak "open" op de achtergrond; check bij terugkomen.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate()
  })
}
