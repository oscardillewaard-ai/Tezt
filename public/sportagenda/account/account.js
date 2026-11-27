// Account: inloggen met Google en al je Tarapp-gegevens op je telefoons en laptop gelijk houden.
// app.js laadt dit pas als je ingelogd bent of de pagina Meer → Account opent.
//
// - Inloggen gaat via "Inloggen met Google" (Google Identity Services). Google geeft een
//   ondertekend token; de Worker controleert dat en of je op de toegangslijst staat.
// - Daarna een eigen sessiecode (localStorage "tarapp.account"), 180 dagen geldig.
// - Synchroniseren per record (zie kern.js): na een wijziging, als je de app opent of wegzet,
//   en elke minuut zolang de app open staat.
// - De laatst gesynchroniseerde stand ("schaduw") staat in IndexedDB "tarapp-account".
// - Bij de eerste keer inloggen: account leeg → alles van dit apparaat erin. Staat er al iets in →
//   kiezen: samenvoegen of het account gebruiken. Vooraf altijd een back-up van dit apparaat.

import { heeftGegevens, naarRecords, pasRemoteToe, uitRecords, wijzigingen } from './kern.js'

export const WORKER_URL = 'https://tarapp-voeding.oscar-dillewaard.workers.dev'
const LS_SESSIE = 'tarapp.account'
const GIS = 'https://accounts.google.com/gsi/client'
// Instellingen die bij één apparaat horen en niet mee gaan.
const ALLEEN_HIER = ['seenVersion', 'reminderLast']

let ctx = null
let fetchFn = (...a) => fetch(...a)
const status = { bezig: false, fout: '', laatst: 0 }
let timer = null
let interval = null
let nogmaals = false
let luistert = false

// ---------- Kleine opslag ----------

function lees() {
  try {
    return JSON.parse(localStorage.getItem(LS_SESSIE)) || null
  } catch {
    return null
  }
}
function bewaar(s) {
  try {
    if (s) localStorage.setItem(LS_SESSIE, JSON.stringify(s))
    else localStorage.removeItem(LS_SESSIE)
  } catch {
    // opslag geblokkeerd: dan blijf je alleen deze sessie ingelogd
  }
}
export const ingelogd = () => {
  const s = lees()
  return !!(s?.sessie && s.exp > Date.now())
}

let dbP = null
function db() {
  dbP ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('tarapp-account', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('kv')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      dbP = null
      reject(req.error)
    }
  })
  return dbP
}
async function kv(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode)
    const req = fn(tx.objectStore('kv'))
    tx.oncomplete = () => resolve(req?.result)
    tx.onerror = () => reject(tx.error)
  })
}
const kvGet = (k) => kv('readonly', (s) => s.get(k))
const kvSet = (k, v) => kv('readwrite', (s) => s.put(v, k))
const kvWis = () => kv('readwrite', (s) => s.clear())

// ---------- Gegevens verzamelen en terugzetten ----------

const voedingOpslag = () => import('../voeding/opslag.js')

async function verzamel() {
  const state = structuredClone(ctx.getState())
  if (state.settings) for (const k of ALLEEN_HIER) delete state.settings[k]
  const voeding = {}
  try {
    const o = await voedingOpslag()
    voeding.producten = await o.alle('producten')
    voeding.dagboek = await o.alle('dagboek')
    if (localStorage.getItem(o.LS.instellingen)) voeding.instellingen = o.leesInstellingen()
    const s = o.leesSync()
    if (s?.book) voeding.boek = s
  } catch {
    // Voeding niet beschikbaar (geen IndexedDB): dan alleen Tarapp zelf.
  }
  return { state, voeding, records: naarRecords(state, voeding) }
}

const zelfde = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** Nieuwe records lokaal neerzetten; alleen wat echt anders is. Geeft true als er iets veranderde. */
async function zetLokaal(oud, nieuw) {
  const veranderd = Object.keys({ ...oud, ...nieuw }).filter((k) => !zelfde(oud[k], nieuw[k]))
  if (!veranderd.length) return false
  const { state, voeding } = uitRecords(nieuw)
  if (veranderd.some((k) => !/^(vp:|vinst$|vboek$)/.test(k))) {
    const huidig = ctx.getState()
    state.settings = { ...(state.settings || {}) }
    for (const k of ALLEEN_HIER) if (huidig.settings?.[k] !== undefined) state.settings[k] = huidig.settings[k]
    ctx.zetState(state)
  }
  if (veranderd.some((k) => /^(vp:|vinst$|vboek$)/.test(k))) {
    const o = await voedingOpslag()
    const weg = veranderd.filter((k) => k.startsWith('vp:') && !(k in nieuw)).map((k) => k.slice(3))
    const gewijzigd = veranderd.filter((k) => k.startsWith('vp:') && k in nieuw).map((k) => nieuw[k])
    if (gewijzigd.length) await o.zetVeel('producten', gewijzigd)
    for (const id of weg) await o.wis('producten', id)
    if (veranderd.includes('vinst') && voeding.instellingen) o.bewaarInstellingen(voeding.instellingen)
    if (veranderd.includes('vboek') && voeding.boek?.book) {
      const was = o.leesSync()
      o.bewaarSync(voeding.boek)
      // Ander dagboek dan dit apparaat had: de eigen regels daar ook heen sturen.
      if (was?.book !== voeding.boek.book) {
        const regels = await o.alle('dagboek')
        if (regels.length) await o.zetVeel('dagboek', regels.map((r) => ({ ...r, dirty: 1 })))
      }
    }
  }
  ctx.naExtern?.()
  return true
}

// ---------- Netwerk ----------

async function api(pad, { body, sessie } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (sessie) headers.Authorization = `Bearer ${sessie}`
  const res = await fetchFn(WORKER_URL + pad, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Fout ${res.status}`)
    err.status = res.status
    throw err
  }
  return data
}

function sessieVerlopen() {
  bewaar(null)
  stop()
  ctx?.showToast('Je bent uitgelogd. Log opnieuw in om te synchroniseren.')
  ctx?.naExtern?.()
}

// ---------- Synchroniseren ----------

/** Eén ronde: eigen wijzigingen sturen en die van andere apparaten ophalen. */
export async function syncNu() {
  const s = lees()
  if (!s?.sessie || !ctx) return
  if (status.bezig) {
    nogmaals = true
    return
  }
  status.bezig = true
  try {
    const schaduw = (await kvGet('schaduw')) || {}
    const rev = (await kvGet('rev')) || 0
    const { records } = await verzamel()
    const verstuurd = wijzigingen(records, schaduw)
    const r = await api('/account/sync', { sessie: s.sessie, body: { base: rev, changes: verstuurd } })
    // Opnieuw lezen: wat je tijdens het versturen nog wijzigde, blijft staan.
    const vers = (await verzamel()).records
    const uit = pasRemoteToe(vers, schaduw, r.records || {}, verstuurd)
    await kvSet('schaduw', uit.schaduw)
    await kvSet('rev', r.rev)
    await zetLokaal(vers, uit.records)
    if (s.beheerder && (s.wachtend || 0) !== (r.wachtend || 0)) {
      bewaar({ ...lees(), wachtend: r.wachtend || 0 })
      if (r.wachtend > (s.wachtend || 0)) ctx.showToast(`Nieuwe aanvraag voor Tarapp: kijk bij Meer → Account`)
    }
    status.fout = ''
    status.laatst = Date.now()
  } catch (err) {
    if (err.status === 401) return sessieVerlopen()
    status.fout = err.status ? err.message : 'Geen verbinding met de server'
  } finally {
    status.bezig = false
    ververs()
    if (nogmaals) {
      nogmaals = false
      setTimeout(syncNu, 500)
    }
  }
}

export function syncStraks(ms = 2000) {
  if (!ingelogd()) return
  clearTimeout(timer)
  timer = setTimeout(syncNu, ms)
}

function stop() {
  clearTimeout(timer)
  clearInterval(interval)
  interval = null
}

/** Opstarten (app.js roept dit aan als je ingelogd bent). */
export function start(c, opts = {}) {
  ctx = c
  if (opts.fetchFn) fetchFn = opts.fetchFn
  if (!ingelogd()) return
  if (!luistert) {
    luistert = true
    addEventListener('tarapp:opgeslagen', () => syncStraks())
    document.addEventListener('visibilitychange', () => syncStraks(document.visibilityState === 'hidden' ? 0 : 300))
  }
  interval ||= setInterval(() => document.visibilityState === 'visible' && syncNu(), 60_000)
  syncStraks(300)
}

// ---------- Inloggen en overzetten ----------

async function backupMaken(state, voeding) {
  const backup = { gemaakt: new Date().toISOString(), state, voeding }
  await kvSet('backup', backup)
  return backup
}

function downloadBackup(b) {
  const data = { ...b.state, voeding: b.voeding?.producten ? { schema: 1, instellingen: b.voeding.instellingen, producten: b.voeding.producten, dagboek: (b.voeding.dagboek || []).map(({ dirty: _d, ...r }) => r) } : undefined }
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: `tarapp-voor-inloggen-${b.gemaakt.slice(0, 10)}.json` })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function naInloggen(idToken) {
  let login
  try {
    login = await api('/account/login', { body: { idToken } })
  } catch (err) {
    if (err.status === 403) {
      aanvraagMelding = err.message
      ververs()
    } else ctx.showToast(err.message)
    return
  }
  // Wat staat er al in het account?
  let account
  try {
    account = (await api('/account/sync', { sessie: login.sessie, body: { base: 0, changes: {} } })).records || {}
  } catch (err) {
    ctx.showToast(err.message)
    return
  }
  const accountVol = Object.values(account).some((r) => !r.del)
  const lokaal = await verzamel()
  const lokaalVol = heeftGegevens(lokaal.state, lokaal.voeding)
  await kvWis()
  if (lokaalVol) await backupMaken(lokaal.state, lokaal.voeding)
  aanvraagMelding = ''
  const sessie = { sessie: login.sessie, email: login.email, naam: login.naam, exp: login.exp, beheerder: !!login.beheerder }
  if (accountVol && lokaalVol) return kiesOverzetten(login, sessie, account)
  // Leeg account: alles van hier erin. Leeg apparaat: alles uit het account hierheen.
  bewaar(sessie)
  await eersteKeer(accountVol ? 'account' : 'samenvoegen', account)
  ctx.showToast(accountVol ? 'Ingelogd. Je gegevens uit je account staan nu hier.' : 'Ingelogd. Je gegevens staan nu veilig in je account.')
  ververs()
}

function kiesOverzetten(login, sessie, account) {
  let keuze = 'samenvoegen'
  ctx.openSheet(
    `<form method="dialog" class="sheet-form">
      <h2 tabindex="-1" autofocus>Er staat al iets in je account</h2>
      <p class="muted">Ingelogd als ${ctx.esc(login.email)}. Op dit apparaat staan ook gegevens. Wat wil je?</p>
      <p class="muted">Van dit apparaat is eerst een back-up gemaakt; die kun je later downloaden via Meer → Account.</p>
      <div class="actions" style="flex-direction:column">
        <button class="btn primary block" value="samenvoegen">Samenvoegen<small style="display:block;font-weight:400">Alles van hier erbij. Staat hetzelfde item op beide plekken, dan houdt het account zijn versie.</small></button>
        <button class="btn block" value="account">Account gebruiken<small style="display:block;font-weight:400">Wat hier staat wordt vervangen door je account.</small></button>
      </div>
    </form>`,
    () => {
      // Pas ingelogd na een keuze: sluit je dit venster, dan blijf je uitgelogd en verandert er niets.
      bewaar(sessie)
      eersteKeer(keuze, account)
        .then(() => {
          ververs()
          ctx.showToast(keuze === 'account' ? 'Je account staat nu op dit apparaat.' : 'Samengevoegd. Alles staat nu in je account.')
        })
        .catch((err) => ctx.showToast(`Overzetten mislukt: ${err.message}`))
    },
  )
  // Safari geeft knoppen geen focus bij een tik: de keuze daarom zelf onthouden.
  ctx.sheet.querySelectorAll('button[value]').forEach((b) => b.addEventListener('click', () => (keuze = b.value)))
}

/**
 * Eerste ronde na inloggen. 'samenvoegen': alles van hier sturen met tijdstip 1, zodat bij een
 * dubbel item de versie in het account wint. 'account': lokale gegevens vervangen door het account.
 */
export async function eersteKeer(keuze, account) {
  const s = lees()
  const lokaal = (await verzamel()).records
  let r
  if (keuze === 'samenvoegen') {
    const verstuurd = wijzigingen(lokaal, {}, 1)
    r = await api('/account/sync', { sessie: s.sessie, body: { base: 0, changes: verstuurd } })
    const uit = pasRemoteToe(lokaal, {}, r.records || {}, verstuurd)
    await kvSet('schaduw', uit.schaduw)
    await kvSet('rev', r.rev)
    await zetLokaal(lokaal, uit.records)
  } else {
    r = { records: account }
    const records = Object.fromEntries(Object.entries(account).filter(([, x]) => !x.del).map(([k, x]) => [k, x.v]))
    const rev = Math.max(0, ...Object.values(account).map((x) => x.r || 0))
    await kvSet('schaduw', records)
    await kvSet('rev', rev)
    // Producten die alleen hier stonden niet weggooien, alleen Tarapp-gegevens vervangen.
    for (const k of Object.keys(lokaal)) if (k.startsWith('vp:') && !(k in records)) records[k] = lokaal[k]
    await zetLokaal(lokaal, records)
  }
  start(ctx)
}

function laadGoogle() {
  if (globalThis.google?.accounts?.id) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: GIS, async: true })
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Google-inloggen kon niet laden'))
    document.head.append(s)
  })
}

async function toonGoogleKnop(el) {
  const knop = el.querySelector('#account-google')
  if (!knop) return
  try {
    const cfg = await api('/account/config')
    if (!cfg.actief || !cfg.googleClientId) {
      knop.innerHTML = '<p class="muted">Inloggen is nog niet ingesteld op de server (zie docs/account-stappen-voor-oscar.md).</p>'
      return
    }
    await laadGoogle()
    google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (r) => naInloggen(r.credential), ux_mode: 'popup', auto_select: false, use_fedcm_for_button: true })
    knop.innerHTML = ''
    google.accounts.id.renderButton(knop, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: 'nl', width: Math.min(320, knop.clientWidth || 320) })
  } catch (err) {
    knop.innerHTML = `<p class="muted">${ctx.esc(err.message || 'Inloggen kan nu niet laden.')} Controleer je internet.</p>`
  }
}

// ---------- Beheer: aanvragen goedkeuren (alleen de beheerder) ----------

function beheerHtml() {
  const rij = (x) => `
    <div class="list-item account-toegang">
      <div><strong>${ctx.esc(x.naam || x.email)}</strong><br><small class="muted">${ctx.esc(x.email)} · ${x.status === 'wacht' ? `vraagt toegang sinds ${new Date(x.sinds).toLocaleDateString('nl-NL')}` : 'heeft toegang'}</small></div>
      <div class="actions">
        ${x.status === 'wacht' ? `<button class="btn primary" data-acc="ja" data-email="${ctx.esc(x.email)}">Goedkeuren</button><button class="btn" data-acc="nee" data-email="${ctx.esc(x.email)}">Weigeren</button>` : `<button class="btn" data-acc="nee" data-email="${ctx.esc(x.email)}">Intrekken</button>`}
      </div>
    </div>`
  const inhoud = !toegang ? '<p class="muted">Laden…</p>' : toegang.length ? toegang.map(rij).join('') : '<p class="muted">Nog niemand heeft toegang gevraagd.</p>'
  return `
    <section class="card">
      <h2>Toegang</h2>
      <p class="muted">Wie inlogt met Google en nog geen toegang heeft, komt hier te staan. Pas na jouw goedkeuring kan diegene inloggen; intrekken werkt meteen.</p>
      ${inhoud}
    </section>`
}

async function laadToegang(email, besluit) {
  const s = lees()
  try {
    const r = await api('/account/toegang', { sessie: s.sessie, body: besluit ? { email, besluit } : undefined })
    toegang = r.lijst || []
    bewaar({ ...lees(), wachtend: toegang.filter((x) => x.status === 'wacht').length })
  } catch (err) {
    if (err.status === 401) return sessieVerlopen()
    ctx.showToast(err.message)
  }
  ververs(false)
}

// ---------- Pagina Meer → Account ----------

let root = null
let aanvraagMelding = ''
let toegang = null // lijst voor de beheerder

function tijd(ms) {
  if (!ms) return 'nog niet'
  const min = Math.round((Date.now() - ms) / 60000)
  return min < 1 ? 'zojuist' : min < 60 ? `${min} min geleden` : new Date(ms).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PRIVACY = `
  <details class="account-privacy">
    <summary>Hoe zit het met je privacy?</summary>
    <ul>
      <li>Alleen Google-accounts die Oscar heeft goedgekeurd, kunnen inloggen. Wie het zonder goedkeuring probeert, komt niet verder dan een aanvraag.</li>
      <li>Je gegevens staan versleuteld (AES-256) op de server van Tarapp bij Cloudflare in Europa en de VS. Zonder de geheime sleutel van de server is het onleesbare tekst.</li>
      <li>Google ziet alleen dát je inlogt bij Tarapp, niet wat je traint of eet.</li>
      <li>Er wordt niets gedeeld of verkocht. Uitloggen kan altijd; je gegevens blijven dan ook op dit apparaat staan.</li>
      <li>Niet mee: je Zepp-koppeling (die sleutel blijft op dit apparaat).</li>
    </ul>
  </details>`

function html() {
  const s = lees()
  if (!ingelogd()) {
    return `
      <section class="card">
        <h2>Inloggen</h2>
        <p class="muted">Log in met Google en zie je trainingen, gewicht en voeding op je telefoon én laptop. Wat je nu op dit apparaat hebt, zet je meteen over naar je account.</p>
        ${aanvraagMelding ? `<p class="account-aanvraag">⏳ ${ctx.esc(aanvraagMelding)}</p>` : ''}
        <div id="account-google" class="account-google"><p class="muted">Laden…</p></div>
        <p class="muted">Tarapp is privé: een nieuw account kan pas inloggen nadat Oscar het heeft goedgekeurd.</p>
        ${PRIVACY}
      </section>`
  }
  return `
    <section class="card">
      <h2>Ingelogd</h2>
      <p>${s.naam ? `${ctx.esc(s.naam)} · ` : ''}<span class="muted">${ctx.esc(s.email || '')}</span></p>
      <p class="muted">${status.bezig ? 'Bezig met synchroniseren…' : status.fout ? `⚠️ ${ctx.esc(status.fout)}` : `Laatst gesynchroniseerd: ${tijd(status.laatst)}`}</p>
      <div class="actions">
        <button class="btn" data-acc="sync">Nu synchroniseren</button>
        <button class="btn" data-acc="uitloggen">Uitloggen</button>
      </div>
      ${PRIVACY}
    </section>
    ${s.beheerder ? beheerHtml() : ''}
    <section class="card" id="account-backup" hidden>
      <h2>Back-up van voor het inloggen</h2>
      <p class="muted">Zo stond alles op dit apparaat vlak voordat je inlogde.</p>
      <button class="btn" data-acc="backup">Back-up downloaden</button>
    </section>`
}

function ververs(opnieuwLaden = true) {
  if (!root?.isConnected) return
  root.innerHTML = html()
  if (opnieuwLaden && lees()?.beheerder && ingelogd()) laadToegang()
  if (!ingelogd()) toonGoogleKnop(root)
  else kvGet('backup').then((b) => b && root.querySelector('#account-backup')?.removeAttribute('hidden')).catch(() => {})
}

/** Pagina tekenen in [el] (Meer → Account). */
export function mount(el, c) {
  ctx = c
  root = el
  ververs()
  el.onclick = async (e) => {
    const a = e.target.closest('[data-acc]')?.dataset.acc
    if (a === 'sync') syncNu()
    if (a === 'ja' || a === 'nee') {
      const email = e.target.closest('[data-email]').dataset.email
      if (a === 'nee' && !confirm(`Toegang van ${email} weigeren of intrekken?`)) return
      laadToegang(email, a)
    }
    if (a === 'backup') kvGet('backup').then((b) => b && downloadBackup(b))
    if (a === 'uitloggen') {
      if (!confirm('Uitloggen? Je gegevens blijven op dit apparaat staan, maar synchroniseren stopt.')) return
      const s = lees()
      await syncNu()
      api('/account/logout', { sessie: s?.sessie, body: {} }).catch(() => {})
      bewaar(null)
      stop()
      await kvWis().catch(() => {})
      globalThis.google?.accounts?.id?.disableAutoSelect?.()
      ctx.showToast('Uitgelogd')
      ververs()
    }
  }
}

// Alleen voor de tests.
export const _test = { status, naInloggen, zetLokaal, verzamel }
