'use strict'

// ---------- Opslag ----------

const KEY = 'sportagenda.v1'

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4)

function defaultState() {
  const ex = (name, sets, reps, weight = '') => ({ id: uid(), name, sets, reps, weight })
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
          ex('Hangen aan stang', 3, '30 s'),
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
          ex('Plank', 3, '45 s'),
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

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (isValidState(parsed)) return parsed
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
}

const view = document.getElementById('view')
const title = document.getElementById('title')
const fab = document.getElementById('fab')
const sheet = document.getElementById('sheet')

function render() {
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === ui.tab)
  })
  fab.hidden = ui.tab !== 'week' && ui.tab !== 'schemas'
  const renderers = { week: renderWeek, overzicht: renderOverview, schemas: renderSchemas, meer: renderMore }
  view.innerHTML = renderers[ui.tab]()
}

// ---------- Week ----------

function renderWeek() {
  const ws = ui.weekStart
  const we = addDays(ws, 6)
  const list = sessionsBetween(toKey(ws), toKey(we))
  const done = list.filter((s) => s.done)
  const doneMin = done.reduce((sum, s) => sum + (Number(s.duration) || 0), 0)
  const pct = list.length ? Math.round((done.length / list.length) * 100) : 0
  const isCurrent = toKey(ws) === toKey(startOfWeek(new Date()))
  title.textContent = 'Sportagenda'

  const perType = {}
  for (const s of done) perType[s.typeId] = (perType[s.typeId] || 0) + 1
  const chips = Object.entries(perType)
    .map(([id, n]) => {
      const t = typeById(id)
      return `<span class="chip">${esc(t.emoji)} ${esc(t.name)} × ${n}</span>`
    })
    .join('')

  let html = `
    <div class="weeknav">
      <button class="iconbtn" data-action="prev-week" aria-label="Vorige week">‹</button>
      <div class="label">
        <strong>Week ${isoWeek(ws)}</strong>
        <span class="muted">${shortDate(ws)} – ${shortDate(we)} ${we.getFullYear()}</span>
        ${isCurrent ? '' : '<br><button class="linkbtn" data-action="this-week">Naar deze week</button>'}
      </div>
      <button class="iconbtn" data-action="next-week" aria-label="Volgende week">›</button>
    </div>
    <section class="card">
      <h2>Weekoverzicht</h2>
      <div><strong>${done.length}</strong> van <strong>${list.length}</strong> trainingen gedaan · ${fmtMinutes(doneMin)}</div>
      <div class="progress"><div style="width:${pct}%"></div></div>
      ${chips ? `<div class="chips">${chips}</div>` : '<div class="muted">Nog niets afgevinkt deze week.</div>'}
    </section>`

  const tKey = todayKey()
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i)
    const k = toKey(d)
    const daySessions = sortSessions(list.filter((s) => s.date === k))
    html += `
      <section class="day ${k === tKey ? 'today' : ''}">
        <div class="day-head">
          <span><span class="name">${DAYS[i]}</span> <span class="muted">${shortDate(d)}${k === tKey ? ' · vandaag' : ''}</span></span>
          <button class="day-add" data-action="add" data-date="${k}" aria-label="Training toevoegen op ${DAYS[i]}">+</button>
        </div>
        ${daySessions.length ? daySessions.map(sessionRow).join('') : '<div class="empty">Rustdag</div>'}
      </section>`
  }
  return html
}

function sessionRow(s) {
  const t = typeById(s.typeId)
  const tpl = s.templateId && templateById(s.templateId)
  const meta = [s.time, s.duration ? fmtMinutes(Number(s.duration)) : '', tpl ? tpl.name : '', s.note]
    .filter(Boolean)
    .map(esc)
    .join(' · ')
  return `
    <div class="session ${s.done ? 'done' : ''}">
      <button class="check" data-action="toggle" data-id="${s.id}" aria-label="${s.done ? 'Markeer als niet gedaan' : 'Afvinken'}">${s.done ? '✓' : ''}</button>
      <button class="s-body" data-action="edit" data-id="${s.id}">
        <div class="s-title">${esc(t.emoji)} ${esc(t.name)}</div>
        ${meta ? `<div class="s-meta">${meta}</div>` : ''}
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
    <section class="card">
      <h2>Per activiteit (${MONTHS[now.getMonth()]})</h2>
      ${rows ? `<table class="types">${rows}</table>` : '<div class="muted">Deze maand nog niets afgevinkt.</div>'}
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
          <div class="s-meta">${t.exercises.length} oefeningen · ${esc(t.exercises.map((e) => e.name).join(', '))}</div>
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
  const tpl = !isNew && s.templateId && templateById(s.templateId)
  const exDone = s.exDone || {}
  const checklist = tpl
    ? `
      <div class="field">Oefeningen afvinken</div>
      <div id="ex-list">
        ${tpl.exercises
          .map(
            (e) => `
          <div class="ex ${exDone[e.id] ? 'done' : ''}">
            <button type="button" class="check" data-ex="${e.id}">${exDone[e.id] ? '✓' : ''}</button>
            <span class="grow">${esc(e.name)}<br><span class="muted">${esc(e.sets)} × ${esc(e.reps)}${e.weight ? ' · ' + esc(e.weight) + ' kg' : ''}</span></span>
          </div>`,
          )
          .join('')}
      </div>
      <p></p>`
    : ''

  openSheet(
    `
    <form method="dialog">
      <h2>${isNew ? 'Training plannen' : 'Training'}</h2>
      ${checklist}
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
      }
      if (isNew) {
        const count = Number(fd.get('repeat')) || 1
        const seriesId = count > 1 ? uid() : undefined
        const base = fromKey(data.date)
        for (let i = 0; i < count; i++) {
          state.sessions.push({ id: uid(), ...data, date: toKey(addDays(base, 7 * i)), done: false, exDone: {}, seriesId })
        }
        ui.weekStart = startOfWeek(base)
      } else {
        if (data.templateId !== session.templateId) session.exDone = {}
        Object.assign(session, data)
      }
      save()
      render()
    },
  )

  sheet.querySelector('#cancel').onclick = closeSheet
  const del = sheet.querySelector('#del-session')
  if (del) del.onclick = () => deleteSession(session)
  sheet.querySelectorAll('[data-ex]').forEach((btn) => {
    btn.onclick = () => {
      session.exDone ||= {}
      const id = btn.dataset.ex
      session.exDone[id] = !session.exDone[id]
      btn.textContent = session.exDone[id] ? '✓' : ''
      btn.closest('.ex').classList.toggle('done', session.exDone[id])
      // Alle oefeningen gedaan = training gedaan.
      const all = tpl.exercises.every((e) => session.exDone[e.id])
      if (all) session.done = true
      save()
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

function exerciseRow(e = { id: uid(), name: '', sets: 3, reps: '10', weight: '' }) {
  return `
    <div class="ex-edit" data-id="${e.id}">
      <input name="name" value="${esc(e.name)}" placeholder="Oefening" aria-label="Oefening" />
      <input name="sets" value="${esc(e.sets)}" inputmode="numeric" aria-label="Sets" />
      <input name="reps" value="${esc(e.reps)}" aria-label="Herhalingen" />
      <input name="weight" value="${esc(e.weight)}" inputmode="decimal" placeholder="–" aria-label="Gewicht in kg" />
      <button type="button" class="del" aria-label="Oefening verwijderen">✕</button>
    </div>`
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
      <div class="ex-head"><span>Oefening</span><span>Sets</span><span>Herh.</span><span>Kg</span><span></span></div>
      <div id="ex-rows">${rows}</div>
      <button type="button" class="linkbtn" id="add-ex">+ Oefening toevoegen</button>
      <div class="actions">
        ${isNew ? '' : '<button type="button" class="btn danger" id="del-tpl">Verwijderen</button>'}
        <button type="button" class="btn" id="cancel">Annuleren</button>
        <button type="submit" class="btn primary">Opslaan</button>
      </div>
    </form>`,
    (fd, form) => {
      const exercises = [...form.querySelectorAll('.ex-edit')]
        .map((row) => {
          const v = (n) => row.querySelector(`[name="${n}"]`).value.trim()
          return { id: row.dataset.id, name: v('name'), sets: v('sets'), reps: v('reps'), weight: v('weight') }
        })
        .filter((e) => e.name)
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
    if (e.target.classList.contains('del')) e.target.closest('.ex-edit').remove()
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
  'this-week': () => {
    ui.weekStart = startOfWeek(new Date())
    render()
  },
  add: (el) => openSessionSheet(null, el.dataset.date),
  edit: (el) => openSessionSheet(state.sessions.find((s) => s.id === el.dataset.id)),
  toggle: (el) => {
    const s = state.sessions.find((x) => x.id === el.dataset.id)
    s.done = !s.done
    save()
    render()
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
    state = parsed
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

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
