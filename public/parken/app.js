// Parkenjacht: vink de Nederlandse nationale parken af op een kaart.
// Plain JS zonder build-stap, net als Tarapp. Gegevens in localStorage.

const APP_VERSION = '1' // ophogen bij elke release, samen met CACHE in sw.js
const KEY = 'parken.v1'

// Nieuwste bovenaan. Bij een release: APP_VERSION ophogen en hier een regel toevoegen.
const CHANGELOG = [
  {
    v: 1,
    items: [
      'Alle 22 nationale parken op de kaart 🗺️',
      'Afvinken met datum en een notitie per bezoek ✅',
      'Voortgang delen met je reisgenoot via een link 🔗',
      'Confetti als jullie ze allemaal gehad hebben 🎉',
    ],
  },
]

const PARKS = window.PARKS
const byId = Object.fromEntries(PARKS.map((p) => [p.id, p]))

// ---------- Opslag ----------

function defaultState() {
  return { visits: {}, settings: {} }
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY))
    if (s && typeof s === 'object' && s.visits) return { ...defaultState(), ...s }
  } catch {
    // Kapotte of geblokkeerde opslag: met een lege lijst beginnen.
  }
  return defaultState()
}

let state = load()

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    toast('⚠️ Opslaan lukt niet in deze browser. Maak een back-up!')
  }
}

const ui = { filter: 'all', persisted: null }

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const todayKey = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const fmtDate = (k) => {
  if (!k) return ''
  const [y, m, d] = k.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
}
const isDone = (id) => !!state.visits[id]
const doneCount = () => PARKS.filter((p) => isDone(p.id)).length

// ---------- Kaart ----------

const map = L.map('map', {
  zoomControl: false,
  minZoom: 6,
  maxBounds: [[49.8, 1.0], [55.3, 9.5]],
  maxBoundsViscosity: 0.8,
})
// Heel Nederland in beeld, naast het zijpaneel (desktop) of boven de
// ingeklapte lijst (telefoon).
const wide = matchMedia('(min-width: 820px)').matches
map.fitBounds([[50.75, 3.35], [53.55, 7.2]], {
  paddingTopLeft: [wide ? 392 : 10, 10],
  paddingBottomRight: [10, wide ? 10 : 66],
})
L.control.zoom({ position: 'topright' }).addTo(map)
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map)

const markers = {}
function pinIcon(p) {
  const done = isDone(p.id)
  return L.divIcon({
    className: '',
    html: `<div class="pin${done ? ' done' : ''}" aria-hidden="true">${done ? '✓' : '🌲'}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}
for (const p of PARKS) {
  markers[p.id] = L.marker([p.lat, p.lng], { icon: pinIcon(p), title: p.name, keyboard: true })
    .bindTooltip(p.name, { direction: 'top', offset: [0, -16], className: 'pin-label' })
    .on('click', () => openPark(p.id))
    .addTo(map)
}

// ---------- Lijst en voortgang ----------

const list = document.getElementById('list')
const panel = document.getElementById('panel')
const handle = document.getElementById('handle')

function taglineText(n, total) {
  if (n === 0) return 'Nog alles te ontdekken. Waar beginnen jullie? 🥾'
  if (n === total) return 'Allemaal gedaan! Jullie zijn officieel parkhelden 🏆'
  if (n >= total - 3) return `Nog maar ${total - n} te gaan, de eindstreep is in zicht! 🔥`
  if (n >= total / 2) return 'Over de helft, lekker bezig! 🌿'
  return `${n} parken binnen, ${total - n} te gaan 🌱`
}

function render() {
  const n = doneCount()
  const total = PARKS.length
  document.getElementById('count').textContent = `${n}/${total}`
  document.getElementById('ring').style.strokeDashoffset = String(100 - (n / total) * 100)
  document.getElementById('tagline').textContent = taglineText(n, total)
  document.getElementById('handle-text').textContent = `Lijst · ${n} van ${total} bezocht`

  for (const p of PARKS) markers[p.id].setIcon(pinIcon(p))

  const shown = PARKS.filter((p) => (ui.filter === 'done' ? isDone(p.id) : ui.filter === 'todo' ? !isDone(p.id) : true))
    .slice()
    .sort((a, b) => a.name.replace(/^De /, '').localeCompare(b.name.replace(/^De /, ''), 'nl'))
  list.innerHTML = shown.length
    ? shown
        .map((p) => {
          const v = state.visits[p.id]
          return `
        <li>
          <button type="button" class="check${v ? ' done' : ''}" data-toggle="${p.id}"
            aria-label="${esc(p.name)} ${v ? 'niet meer als bezocht markeren' : 'als bezocht markeren'}" aria-pressed="${!!v}">✓</button>
          <button type="button" class="item" data-open="${p.id}">
            <strong>${esc(p.name)}</strong>
            <small>${v ? `✅ ${esc(fmtDate(v.date))}` : esc(p.prov)}</small>
          </button>
        </li>`
        })
        .join('')
    : `<li class="empty">${ui.filter === 'done' ? 'Nog niets afgevinkt. Tijd voor een uitje! 🚗' : 'Alles bezocht! 🎉'}</li>`
}

list.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]')
  if (t) return toggle(t.dataset.toggle)
  const o = e.target.closest('[data-open]')
  if (o) {
    const p = byId[o.dataset.open]
    map.flyTo([p.lat, p.lng], 10, { duration: 0.8 })
    openPark(p.id)
  }
})

document.querySelector('.filters').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]')
  if (!b) return
  ui.filter = b.dataset.filter
  for (const x of document.querySelectorAll('.filters button')) x.classList.toggle('active', x === b)
  render()
})

handle.addEventListener('click', () => {
  const open = panel.classList.toggle('open')
  handle.setAttribute('aria-expanded', String(open))
})

// ---------- Afvinken ----------

function setVisited(id, visit) {
  const before = doneCount()
  if (visit) state.visits[id] = visit
  else delete state.visits[id]
  save()
  render()
  const after = doneCount()
  if (after > before) {
    if (after === PARKS.length) {
      confetti(true)
      toast('🏆 ALLE nationale parken bezocht! Wat een avonturiers!')
    } else {
      confetti(false)
      toast(`🎉 ${byId[id].name} afgevinkt! Nog ${PARKS.length - after} te gaan.`)
    }
  }
}

function toggle(id) {
  if (isDone(id)) {
    if (!confirm(`${byId[id].name} niet meer als bezocht markeren?`)) return
    setVisited(id, null)
  } else {
    setVisited(id, { date: todayKey(), note: '' })
  }
}

// ---------- Vensters ----------

const sheet = document.getElementById('sheet')

function openSheet(html) {
  sheet.innerHTML = `<div class="sheet-in"><button type="button" class="close" data-close aria-label="Sluiten">×</button>${html}</div>`
  if (!sheet.open) sheet.showModal()
}
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close]')) sheet.close()
})
sheet.addEventListener('close', () => {
  if (reloadPending) location.reload()
})

function openPark(id) {
  const p = byId[id]
  const v = state.visits[id]
  const route = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
  openSheet(`
    <h2>${esc(p.name)}</h2>
    <p class="prov">${esc(p.prov)}</p>
    ${v ? `<span class="badge">✅ Bezocht op ${esc(fmtDate(v.date))}</span>` : ''}
    <p>${esc(p.blurb)}</p>
    <form id="visit-form">
      <label class="field">Datum van bezoek
        <input type="date" name="date" value="${esc(v?.date || todayKey())}" max="${todayKey()}" required />
      </label>
      <label class="field">Notitie (wat jullie zagen, waar jullie liepen…)
        <textarea name="note" placeholder="Bijv. bevers gespot bij de kreek 🦫">${esc(v?.note || '')}</textarea>
      </label>
      <div class="row">
        <button type="submit" class="btn primary">${v ? 'Opslaan' : '✓ Bezocht!'}</button>
        <a class="btn" href="${route}" target="_blank" rel="noopener">🧭 Route</a>
      </div>
      ${v ? '<p></p><button type="button" class="btn ghost" data-unvisit style="width:100%">Toch niet bezocht</button>' : ''}
    </form>`)
  const form = document.getElementById('visit-form')
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const fd = new FormData(form)
    setVisited(id, { date: String(fd.get('date')), note: String(fd.get('note')).trim() })
    sheet.close()
  })
  form.querySelector('[data-unvisit]')?.addEventListener('click', () => {
    if (!confirm(`${p.name} niet meer als bezocht markeren?`)) return
    setVisited(id, null)
    sheet.close()
  })
}

// ---------- Delen tussen reisgenoten ----------
// De voortgang gaat mee in het #-deel van de link, dus niet naar een server.

function encodeShare() {
  const data = Object.fromEntries(Object.entries(state.visits).map(([id, v]) => [id, [v.date, v.note || '']]))
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeShare(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  const json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  const data = JSON.parse(json)
  const out = {}
  for (const [id, v] of Object.entries(data)) {
    if (!byId[id] || !Array.isArray(v) || !/^\d{4}-\d{2}-\d{2}$/.test(v[0])) continue
    out[id] = { date: v[0], note: String(v[1] || '').slice(0, 2000) }
  }
  return out
}

// Samenvoegen: wat een van beiden bezocht heeft, telt. Bij allebei: vroegste
// datum, en verschillende notities blijven allebei bewaard.
function mergeVisits(incoming) {
  let added = 0
  for (const [id, v] of Object.entries(incoming)) {
    const mine = state.visits[id]
    if (!mine) {
      state.visits[id] = v
      added++
      continue
    }
    const notes = [mine.note, v.note].filter(Boolean)
    state.visits[id] = {
      date: mine.date < v.date ? mine.date : v.date,
      note: [...new Set(notes)].join('\n'),
    }
  }
  return added
}

document.getElementById('share').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#samen=${encodeShare()}`
  const text = `Onze Parkenjacht: ${doneCount()} van ${PARKS.length} nationale parken bezocht! 🌳`
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Parkenjacht', text, url })
      return
    }
    await navigator.clipboard.writeText(url)
    toast('🔗 Link gekopieerd! Stuur hem naar je reisgenoot.')
  } catch (err) {
    if (err?.name === 'AbortError') return
    prompt('Kopieer deze link:', url)
  }
})

function handleIncomingShare() {
  const m = location.hash.match(/samen=([\w-]+)/)
  if (!m) return
  history.replaceState(null, '', location.pathname + location.search)
  let incoming
  try {
    incoming = decodeShare(m[1])
  } catch {
    toast('⚠️ Deze deellink is kapot, vraag om een nieuwe.')
    return
  }
  const n = Object.keys(incoming).length
  if (!confirm(`Je hebt een deellink geopend met ${n} bezochte parken. Samenvoegen met jouw voortgang? Er gaat niets verloren.`)) return
  const added = mergeVisits(incoming)
  save()
  render()
  toast(added ? `🤝 Samengevoegd: ${added} nieuwe parken erbij!` : '🤝 Samengevoegd, jullie waren al gelijk!')
}

// ---------- Meer: back-up, opslag, updates, installeren ----------

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches

function openMore() {
  openSheet(`
    <h2>Meer</h2>
    <h3>Back-up</h3>
    <p class="muted">Je voortgang staat alleen op dit toestel. Maak af en toe een back-up, of gebruik dit om over te zetten naar een nieuw toestel.</p>
    ${
      ui.persisted === true
        ? '<p class="muted">✅ Opslag is als blijvend gemarkeerd.</p>'
        : ui.persisted === false
          ? '<p class="muted">⚠️ Opslag is niet als blijvend gemarkeerd. Installeer de app op je beginscherm en maak regelmatig een back-up.</p>'
          : ''
    }
    <div class="row">
      <button type="button" class="btn" data-act="export">⬇️ Exporteren</button>
      <button type="button" class="btn" data-act="import">⬆️ Importeren</button>
    </div>
    <h3>App bijwerken</h3>
    <p class="muted">Updates komen vanzelf binnen als je de app opent. Lukt dat niet, tik dan hieronder. Je voortgang blijft bewaard.</p>
    <div class="stack">
      <button type="button" class="btn" data-act="force-update">Nu bijwerken</button>
      <button type="button" class="btn" data-act="changelog">✨ Wat is er nieuw?</button>
    </div>
    ${
      isStandalone()
        ? ''
        : `<h3>Installeren op iPhone</h3>
    <ol class="steps">
      <li>Open deze pagina in <strong>Safari</strong>.</li>
      <li>Tik op het deel-icoon (vierkant met pijl omhoog).</li>
      <li>Kies <strong>Zet op beginscherm</strong>.</li>
    </ol>
    <p class="muted">Op Android: menu ⋮ in Chrome → <strong>App installeren</strong>.</p>`
    }
    <p class="muted">Versie ${APP_VERSION}</p>`)
}

document.getElementById('more').addEventListener('click', openMore)

sheet.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]')
  if (!b) return
  const act = b.dataset.act
  if (act === 'export') exportData()
  if (act === 'import') document.getElementById('import-file').click()
  if (act === 'changelog') openChangelog(0)
  if (act === 'force-update') {
    // Alleen de app-cache wissen (niet localStorage) en vers ophalen.
    try {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
      for (const k of await caches.keys()) await caches.delete(k)
    } catch {
      // Geen cache-API: gewoon herladen.
    }
    location.reload()
  }
})

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'parkenjacht', version: 1, ...state }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `parkenjacht-${todayKey()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (!data || typeof data.visits !== 'object') throw new Error('geen visits')
    const clean = {}
    for (const [id, v] of Object.entries(data.visits)) {
      if (byId[id] && v && /^\d{4}-\d{2}-\d{2}$/.test(v.date)) clean[id] = { date: v.date, note: String(v.note || '') }
    }
    if (!confirm(`Back-up met ${Object.keys(clean).length} bezochte parken samenvoegen met wat er nu staat?`)) return
    mergeVisits(clean)
    save()
    render()
    sheet.close()
    toast('✅ Back-up teruggezet')
  } catch {
    toast('⚠️ Dit bestand is geen Parkenjacht-back-up.')
  }
})

function openChangelog(sinceVersion) {
  const entries = CHANGELOG.filter((e) => e.v > sinceVersion)
  openSheet(`
    <h2>${sinceVersion > 0 ? 'Nieuw in Parkenjacht ✨' : 'Wat is er nieuw ✨'}</h2>
    ${sinceVersion > 0 ? `<p class="muted">Bijgewerkt naar versie ${APP_VERSION}.</p>` : ''}
    <div class="changelog">
      ${entries.map((e) => `<h3>🌿 Versie ${e.v}</h3><ul>${e.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`).join('')}
    </div>
    <button type="button" class="btn primary" data-close style="width:100%">Top! 🌳</button>`)
}

// Eenmalig na een update laten zien wat er nieuw is (niet bij de eerste keer).
function showChangesSinceLastVisit() {
  const current = Number(APP_VERSION)
  const seen = Number(state.settings.seenVersion || current)
  state.settings.seenVersion = current
  save()
  if (seen < current && !sheet.open) openChangelog(seen)
}

// ---------- Kleine extra's ----------

const toastEl = document.getElementById('toast')
let toastTimer
function toast(msg) {
  toastEl.textContent = msg
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 3200)
}

function confetti(big) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const c = document.getElementById('confetti')
  const ctx = c.getContext('2d')
  const dpr = devicePixelRatio || 1
  c.width = innerWidth * dpr
  c.height = innerHeight * dpr
  ctx.scale(dpr, dpr)
  const colors = ['#22c55e', '#86efac', '#f59e0b', '#facc15', '#38bdf8', '#f472b6']
  const bits = Array.from({ length: big ? 220 : 90 }, () => ({
    x: innerWidth / 2,
    y: innerHeight / 3,
    vx: (Math.random() - 0.5) * (big ? 16 : 11),
    vy: Math.random() * -12 - 3,
    s: Math.random() * 6 + 4,
    r: Math.random() * Math.PI,
    c: colors[(Math.random() * colors.length) | 0],
  }))
  const end = performance.now() + (big ? 4000 : 2200)
  ;(function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    for (const b of bits) {
      b.vy += 0.35
      b.x += b.vx
      b.y += b.vy
      b.r += 0.2
      ctx.save()
      ctx.translate(b.x, b.y)
      ctx.rotate(b.r)
      ctx.fillStyle = b.c
      ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2)
      ctx.restore()
    }
    if (t < end) requestAnimationFrame(frame)
    else ctx.clearRect(0, 0, innerWidth, innerHeight)
  })(performance.now())
}

// ---------- Start ----------

render()
handleIncomingShare()
showChangesSinceLastVisit()

// Vraag de browser de opslag niet op te ruimen bij ruimtegebrek.
;(async () => {
  if (!navigator.storage?.persist) return
  try {
    ui.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    // Niet ondersteund of geweigerd: status blijft onbekend.
  }
})()

// ---------- Updates ----------
// Een nieuwe service worker neemt het over -> herladen zodat de nieuwe versie
// meteen zichtbaar is, maar niet terwijl er een venster openstaat (dan na
// sluiten). Gegevens staan in localStorage en blijven staan.

let reloadPending = false
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return // eerste installatie: niets te verversen
    if (sheet.open) reloadPending = true
    else location.reload()
  })
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {})
  // iOS houdt de app vaak "open" op de achtergrond; check bij terugkomen.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    } catch {
      // Offline: huidige versie blijven gebruiken.
    }
  })
}
