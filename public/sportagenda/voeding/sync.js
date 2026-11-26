// Voeding: synchroniseren met de eigen Cloudflare Worker (proxy/voeding/worker.js).
// Zelfde idee als Parkenjacht: de app maakt zelf lange willekeurige codes
// (crypto.getRandomValues), registreert die bij de Worker en stuurt elke wijziging.
// Geen account, geen token intypen. Lukt het niet (offline, Worker weg), dan blijft
// alles lokaal staan en gaat het mee bij de volgende poging; de rest van Tarapp merkt er niets van.

import { BOOK_RE, TOKEN_RE, koppelLink, maandVan, pasToe, randomToken, schoonRegel } from './kern.js'
import { alle, bewaarSync, doorsturenAan, leesSync, zetVeel } from './opslag.js'

// Het vaste adres van de Worker (naam uit proxy/voeding/wrangler.toml).
export const WORKER_URL = 'https://tarapp-voeding.oscar-dillewaard.workers.dev'
const TIMEOUT_MS = 15000

export const syncStatus = { status: 'idle', last: 0, error: '', linked: false }
let busy = false
let again = false
let timer = null
let onChange = () => {}

export function opWijziging(fn) {
  onChange = fn
}

const workerUrl = () => leesSync()?.url || WORKER_URL

async function call(path, { method = 'GET', body, token, book, fetchFn = fetch } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const t = ctrl && setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = `Bearer ${token}`
    if (book) headers['X-Voeding-Book'] = book
    const res = await fetchFn(`${workerUrl()}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctrl?.signal, cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error(data.error || `fout ${res.status}`)
      err.status = res.status
      throw err
    }
    return data
  } finally {
    if (t) clearTimeout(t)
  }
}

/**
 * Zorgt dat dit apparaat een dagboek bij de Worker heeft. Maakt bij de eerste keer
 * een dagboek-id en schrijf-token. Registreert opnieuw als persoon of doorsturen veranderde.
 */
export async function zorgVoorDagboek(inst, { fetchFn = fetch, rng = globalThis.crypto } = {}) {
  if (!inst.persoon) return null
  let s = leesSync()
  const forward = doorsturenAan(inst)
  if (!s || !BOOK_RE.test(s.book || '') || !TOKEN_RE.test(s.writeToken || '')) {
    s = { url: WORKER_URL, book: randomToken(18, rng), writeToken: randomToken(32, rng), person: inst.persoon, forward, registered: false }
    bewaarSync(s)
  }
  if (!s.registered || s.person !== inst.persoon || s.forward !== forward) {
    const r = await call('/voeding/register', { method: 'POST', body: { book: s.book, writeToken: s.writeToken, person: inst.persoon, forward }, fetchFn })
    s = { ...s, person: inst.persoon, forward, registered: true }
    syncStatus.linked = !!r.linked
    bewaarSync(s)
  }
  return s
}

/**
 * "Koppel met Healthbridge": maakt een nieuw lees-token, registreert het bij de Worker
 * (een vorig lees-token vervalt daarmee) en geeft de deeplink voor Healthbridge terug.
 * Het lees-token wordt niet bewaard: wie opnieuw koppelt, krijgt een nieuw token.
 */
export async function koppelHealthbridge(inst, { fetchFn = fetch, rng = globalThis.crypto } = {}) {
  if (!doorsturenAan(inst)) throw new Error('Zet eerst "Doorsturen naar Healthbridge" aan.')
  const s = await zorgVoorDagboek(inst, { fetchFn, rng })
  if (!s) throw new Error('Kies eerst wie deze telefoon gebruikt.')
  const readToken = randomToken(32, rng)
  await call('/voeding/register', { method: 'POST', body: { book: s.book, writeToken: s.writeToken, readToken, person: s.person, forward: true }, fetchFn })
  syncStatus.linked = true
  return koppelLink(s.url || WORKER_URL, readToken, s.person)
}

/** Link om een tweede apparaat van dezelfde persoon aan hetzelfde dagboek te koppelen (#voeding=…). */
export function apparaatLink(baseUrl) {
  const s = leesSync()
  if (!s?.registered) return null
  const data = btoa(JSON.stringify({ b: s.book, w: s.writeToken, p: s.person })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${baseUrl}#voeding=${data}`
}

/** Een apparaat-link toepassen. Geeft de persoon terug, of null als de link niet klopt. */
export function leesApparaatLink(hash) {
  const m = String(hash || '').match(/voeding=([A-Za-z0-9_-]+)/)
  if (!m) return null
  try {
    const d = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (!BOOK_RE.test(d.b) || !TOKEN_RE.test(d.w) || !['oscar', 'tara'].includes(d.p)) return null
    bewaarSync({ url: WORKER_URL, book: d.b, writeToken: d.w, person: d.p, forward: null, registered: false })
    return d.p
  } catch {
    return null
  }
}

/** Open Food Facts via de Worker (de browser kan zelf geen User-Agent zetten). */
export async function zoekBarcode(inst, barcode, opts = {}) {
  const s = await zorgVoorDagboek(inst, opts)
  if (!s) throw new Error('Kies eerst wie deze telefoon gebruikt.')
  return call(`/voeding/off/${barcode}`, { token: s.writeToken, book: s.book, fetchFn: opts.fetchFn })
}

export async function zoekOff(inst, q, opts = {}) {
  const s = await zorgVoorDagboek(inst, opts)
  if (!s) throw new Error('Kies eerst wie deze telefoon gebruikt.')
  return call(`/voeding/off-zoek?q=${encodeURIComponent(q)}`, { token: s.writeToken, book: s.book, fetchFn: opts.fetchFn })
}

function vorigeMaand(m) {
  const [y, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mm - 2, 1))
  return d.toISOString().slice(0, 7)
}

/**
 * Eén synchronisatieronde: wijzigingen sturen, de stand van deze en vorige maand
 * ophalen en samenvoegen. Geeft true als er lokaal iets veranderde.
 */
export async function synchroniseer(inst, { fetchFn = fetch, rng = globalThis.crypto, vandaag } = {}) {
  const s = await zorgVoorDagboek(inst, { fetchFn, rng })
  if (!s) return false
  const lokaalLijst = await alle('dagboek')
  const dirty = lokaalLijst.filter((r) => r.dirty).map(schoonRegel).filter(Boolean)
  const remote = []
  const forward = doorsturenAan(inst)
  if (dirty.length) {
    for (let i = 0; i < dirty.length; i += 400) {
      const r = await call(`/voeding/book/${s.book}`, { method: 'PUT', token: s.writeToken, body: { entries: dirty.slice(i, i + 400), forward }, fetchFn })
      for (const list of Object.values(r.months || {})) remote.push(...list)
      syncStatus.linked = !!r.linked
    }
  }
  const nu = maandVan(vandaag || new Date().toISOString())
  const r = await call(`/voeding/book/${s.book}?months=${nu},${vorigeMaand(nu)}`, { token: s.writeToken, fetchFn })
  syncStatus.linked = !!r.linked
  for (const list of Object.values(r.months || {})) remote.push(...list)
  // Opnieuw lezen vlak voor het opslaan: wat de gebruiker tijdens deze ronde nog
  // wijzigde, is nieuwer dan het antwoord van de Worker en blijft dus staan.
  const vers = Object.fromEntries((await alle('dagboek')).map((x) => [x.id, x]))
  const opslaan = pasToe(vers, remote)
  await zetVeel('dagboek', opslaan)
  return opslaan.length > 0
}

/** Ronde starten (niet dubbel tegelijk); status bijwerken voor de interface. */
export async function syncNu(inst) {
  if (!inst?.persoon) return
  if (busy) {
    again = true
    return
  }
  busy = true
  syncStatus.status = 'busy'
  onChange(false)
  let changed = false
  try {
    changed = await synchroniseer(inst)
    syncStatus.status = 'ok'
    syncStatus.error = ''
    syncStatus.last = Date.now()
  } catch (err) {
    syncStatus.status = 'error'
    syncStatus.error = err?.status ? err.message : 'Sync-server niet bereikbaar'
  } finally {
    busy = false
    onChange(changed)
    if (again) {
      again = false
      setTimeout(() => syncNu(inst), 500)
    }
  }
}

/** Na een wijziging: even wachten (meer tikken achter elkaar = één verzoek). */
export function syncStraks(inst, ms = 1500) {
  clearTimeout(timer)
  timer = setTimeout(() => syncNu(inst), ms)
}
