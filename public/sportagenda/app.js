'use strict'

// ---------- Opslag ----------

const KEY = 'sportagenda.v1'
const APP_VERSION = '6' // ophogen bij elke release, samen met CACHE in sw.js

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
  calMode: 'week', // 'week' | 'maand'
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

function render() {
  const active = ui.active && state.sessions.find((s) => s.id === ui.active)
  document.body.classList.toggle('in-workout', !!active)
  if (active) {
    topActions.innerHTML = ''
    view.innerHTML = renderWorkout(active)
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
  view.innerHTML = renderers[ui.tab]()
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

function renderWeek() {
  if (ui.calMode === 'maand') return renderMonth()
  const ws = ui.weekStart
  const we = addDays(ws, 6)
  const list = sessionsBetween(toKey(ws), toKey(we))
  const done = list.filter((s) => s.done)
  const doneMin = done.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0
  const isCurrent = toKey(ws) === toKey(startOfWeek(new Date()))
  title.textContent = 'Sportagenda'

  const tKey = todayKey()
  let days = ''
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i)
    const k = toKey(d)
    const daySessions = sortSessions(list.filter((s) => s.date === k))
    days += `
      <div class="wday ${k === tKey ? 'today' : ''}">
        <div class="wday-label"><span>${DAYS_SHORT[i]}</span><strong>${d.getDate()}</strong></div>
        <div class="wday-items">
          ${daySessions.length ? daySessions.map(sessionRow).join('') : '<span class="rest">rust</span>'}
        </div>
        <button class="day-add" data-action="add" data-date="${k}" aria-label="Training toevoegen op ${DAYS[i]}">+</button>
      </div>`
  }

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
    <div class="wsummary">
      <span><strong>${done.length}/${list.length}</strong> gedaan · ${fmtMinutes(doneMin)}</span>
      <div class="progress"><div style="width:${pct}%"></div></div>
    </div>
    <div class="wdays">${days}</div>`
}

const MONTHS_FULL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

function renderMonth() {
  title.textContent = 'Sportagenda'
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
      .map((s) => `<span class="cal-mark ${s.done ? 'done' : ''}">${esc(typeById(s.typeId).emoji)}</span>`)
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
  const inProgress = s.log && !s.log.endedAt ? '▶ bezig' : ''
  const shin = Number.isInteger(s.shin)
    ? ` <span class="shin-badge ${shinClass(s.shin)}" title="Scheenpijn ${s.shin}/10">🦵${s.shin}</span>`
    : ''
  const meta = [inProgress, s.time, s.duration ? fmtMinutes(Number(s.duration)) : '', tpl ? tpl.name : '', s.note]
    .filter(Boolean)
    .map(esc)
    .join(' · ')
  return `
    <div class="session ${s.done ? 'done' : ''}">
      <button class="check" data-action="toggle" data-id="${s.id}" aria-label="${s.done ? 'Markeer als niet gedaan' : 'Afvinken'}">${s.done ? '✓' : ''}</button>
      <button class="s-body" data-action="edit" data-id="${s.id}">
        <span class="s-title">${esc(t.emoji)} ${esc(t.name)}${shin}</span>
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
      <p class="muted">Versie ${APP_VERSION}</p>
    </section>
    <section class="card">
      <h2>Installeren op iPhone</h2>
      <ol class="steps">
        <li>Open deze pagina in <strong>Safari</strong>.</li>
        <li>Tik op het deel-icoon (vierkant met pijl omhoog).</li>
        <li>Kies <strong>Zet op beginscherm</strong> en tik op <strong>Voeg toe</strong>.</li>
      </ol>
      <p class="muted">Daarna start de app vanaf je beginscherm, zonder browserbalk, en werkt ook offline.</p>
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
  sheet.showModal()
}

function closeSheet() {
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
      ${
        isNew
          ? `<label class="field">Herhalen
              <select name="repeat">
                <option value="1">Niet herhalen</option>
                <option value="4">Elke week, 4 weken</option>
                <option value="8">Elke week, 8 weken</option>
                <option value="12">Elke week, 12 weken</option>
              </select>
            </label>`
          : ''
      }
      <label class="field" id="shin-field" ${tracksShin(s.typeId) ? '' : 'hidden'}>Scheenpijn (0–10)
        <select name="shin">
          <option value="">Niet ingevuld</option>
          ${Array.from({ length: 11 }, (_, i) => `<option value="${i}" ${s.shin === i ? 'selected' : ''}>${i}${i === 0 ? ' – geen pijn' : i === 10 ? ' – ergst denkbaar' : ''}</option>`).join('')}
        </select>
      </label>
      <label class="field">Notitie<textarea name="note" rows="2" placeholder="Bijv. route, hal, met wie">${esc(s.note)}</textarea></label>
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
      if (isNew) {
        const count = Number(fd.get('repeat')) || 1
        const seriesId = count > 1 ? uid() : undefined
        const base = fromKey(data.date)
        for (let i = 0; i < count; i++) {
          state.sessions.push({ id: uid(), ...data, date: toKey(addDays(base, 7 * i)), done: false, seriesId })
        }
        ui.weekStart = startOfWeek(base)
      } else {
        Object.assign(session, data)
      }
      save()
      render()
    },
  )

  sheet.querySelector('#cancel').onclick = closeSheet
  sheet.querySelector('.type-grid').addEventListener('change', (e) => {
    sheet.querySelector('#shin-field').hidden = !tracksShin(e.target.value)
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
function beep() {
  navigator.vibrate?.([200, 100, 200])
  if (!audio) return
  for (const [i, freq] of [880, 880, 1320].entries()) {
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
            <span class="muted">${prev[j] ? esc(fmtSet(prev[j], ex.unit)) : '–'}</span>
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
}, 250)

function activeLog() {
  return state.sessions.find((s) => s.id === ui.active)?.log
}

const workoutActions = {
  'wo-back': () => {
    ui.restEnd = null
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
    set.done = !set.done
    const exs = activeLog().exercises
    const i = Number(row.dataset.ex)
    const { end } = supersetBounds(exs, i)
    // In een superset pas rusten na de laatste oefening van de ronde;
    // anders meteen door naar dezelfde set van de volgende oefening.
    const nextInSuperset = set.done && i < end ? i + 1 : null
    if (set.done && nextInSuperset === null && restSeconds() > 0) {
      unlockAudio()
      ui.restEnd = Date.now() + restSeconds() * 1000
    }
    save()
    render()
    renderRestBar()
    if (nextInSuperset !== null) {
      const sets = exs[nextInSuperset].sets
      const j = Math.min(Number(row.dataset.set), sets.length - 1)
      view.querySelector(`.set-row[data-ex="${nextInSuperset}"][data-set="${j}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
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

function deleteSession(session) {
  let ids = [session.id]
  if (session.seriesId) {
    const later = state.sessions.filter((s) => s.seriesId === session.seriesId && s.date > session.date)
    if (later.length && confirm(`Ook de ${later.length} volgende training(en) uit deze herhaling verwijderen?`)) {
      ids = ids.concat(later.map((s) => s.id))
    } else if (!confirm('Deze training verwijderen?')) return
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
    document.querySelector(`[data-date="${el.dataset.date}"]`)?.closest('.day')?.scrollIntoView({ block: 'center' })
  },
  'this-week': () => {
    ui.weekStart = startOfWeek(new Date())
    render()
  },
  add: (el) => openSessionSheet(null, el.dataset.date),
  edit: (el) => {
    const s = state.sessions.find((x) => x.id === el.dataset.id)
    if (isWorkoutSession(s)) openWorkoutSheet(s)
    else openSessionSheet(s)
  },
  ...workoutActions,
  toggle: (el) => {
    const s = state.sessions.find((x) => x.id === el.dataset.id)
    s.done = !s.done
    save()
    render()
    if (s.done && tracksShin(s.typeId)) openShinSheet(s)
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
  if (e.target.id !== 'type-form') return
  e.preventDefault()
  const fd = new FormData(e.target)
  const name = fd.get('name').trim()
  if (!name) return
  state.types.push({ id: uid(), name, emoji: fd.get('emoji').trim() || '⭐' })
  save()
  render()
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
    alert('Dit bestand is geen geldige Sportagenda-back-up.')
  }
})

async function exportData() {
  const json = JSON.stringify(state, null, 2)
  const name = `sportagenda-backup-${todayKey()}.json`
  const file = new File([json], name, { type: 'application/json' })
  // Op iPhone werkt het deelmenu beter dan een download ("Bewaar in Bestanden").
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Sportagenda back-up' })
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
  window.scrollTo(0, 0)
})

fab.addEventListener('click', () => {
  if (ui.tab === 'schemas') return openTemplateSheet(null)
  // In de huidige week: vandaag; anders de maandag van de getoonde week.
  const isCurrent = toKey(ui.weekStart) === toKey(startOfWeek(new Date()))
  openSessionSheet(null, isCurrent ? todayKey() : toKey(ui.weekStart))
})

// Bij terugkeren naar de app op een nieuwe dag: "vandaag" bijwerken.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render()
})

// Een niet-afgeronde training van de afgelopen 12 uur meteen weer openen,
// bijv. als iOS de app halverwege de training heeft afgesloten.
const unfinished = state.sessions.find((s) => s.log && !s.log.endedAt && Date.now() - s.log.startedAt < 12 * 3600e3)
if (unfinished) ui.active = unfinished.id

render()

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
  if (ui.restEnd || sheet.open) {
    reloadPending = true
    return
  }
  location.reload()
}
setInterval(() => {
  if (reloadPending && !ui.restEnd && !sheet.open) location.reload()
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
