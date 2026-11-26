// Sync-server (Cloudflare Worker + KV) voor Voeding in Tarapp, en het doorgeefluik
// naar Healthbridge.
//
//   Tarapp (telefoon) --PUT--> deze Worker (KV) <--GET export-- Healthbridge-app
//
// Zelfde patroon als proxy/parken-sync-worker.js: elke regel heeft een id en
// updatedAt, de jongste wint, verwijderen gaat met een tombstone (deleted: true).
// Wordt automatisch neergezet door .github/workflows/voeding-worker.yml (wrangler).
//
// Endpoints (alles JSON):
//   GET  /                                   statuspagina in gewone taal
//   POST /voeding/register                   { book, writeToken, readToken?, person, forward }
//   GET  /voeding/book/:book?months=YYYY-MM,… dagboek ophalen          (Authorization: Bearer <schrijf-token>)
//   PUT  /voeding/book/:book                 regels samenvoegen        (Bearer <schrijf-token>)
//   GET  /voeding/off/:barcode               Open Food Facts-product   (Bearer <schrijf-token>)
//   GET  /voeding/off-zoek?q=…               Open Food Facts zoeken    (Bearer <schrijf-token>)
//   GET  /voeding/export?person=oscar&from=YYYY-MM-DD&to=YYYY-MM-DD   (Bearer <lees-token>)
//
// Tokens staan alleen als SHA-256-hash in KV. Een dagboek ("book") is van één
// persoon op één of meer van zijn/haar apparaten. Het lees-token geeft alleen
// toegang tot de export, en alleen als "Doorsturen naar Healthbridge" aan staat.

import { OFF_FIELDS, BOOK_RE, TOKEN_RE, PERSONEN, bouwExport, datumsTussen, maandVan, parseOff, normaliseerBarcode, schoonRegel, voegSamen } from '../../public/sportagenda/voeding/kern.js'

const ALLOWED_ORIGINS = ['https://oscardillewaard-ai.github.io', 'http://localhost:5173', 'http://localhost:4173']
const MAX_BODY = 256 * 1024
const MAX_EXPORT_DAYS = 31
const MONTH_RE = /^\d{4}-\d{2}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cors(request) {
  const origin = request.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

const json = (data, status, headers, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  })

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Vergelijken in vaste tijd (beide zijn hex-hashes van gelijke lengte). */
function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

const bearer = (request) => {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)
  return m && TOKEN_RE.test(m[1]) ? m[1] : null
}

function findKv(env) {
  if (env.VOEDING) return env.VOEDING
  return Object.values(env || {}).find((v) => v && ['get', 'put', 'delete'].every((f) => typeof v[f] === 'function'))
}

// ---------- Eenvoudige limieten per Worker-instantie ----------
// Open Food Facts vraagt om maximaal 100 productverzoeken en 10 zoekverzoeken per
// minuut. De cache vangt herhalingen op; dit is de rem voor wat er overblijft.
const buckets = new Map()
function allow(name, perMinute, now = Date.now()) {
  const b = buckets.get(name) || []
  const recent = b.filter((t) => now - t < 60_000)
  if (recent.length >= perMinute) {
    buckets.set(name, recent)
    return false
  }
  recent.push(now)
  buckets.set(name, recent)
  return true
}

// ---------- Opslag ----------
// book:<id>              { person, forward, writeHash, readHash, created, updated }
// read:<readHash>        <book-id>
// days:<book>:<YYYY-MM>  { entries: { id: regel }, updated }

async function loadBook(kv, book) {
  return BOOK_RE.test(book) ? kv.get(`book:${book}`, 'json') : null
}

async function authWrite(kv, request, book) {
  const token = bearer(request)
  const meta = await loadBook(kv, book)
  if (!token || !meta) return null
  return sameHash(await sha256(token), meta.writeHash) ? meta : null
}

async function loadMonth(kv, book, month) {
  const stored = await kv.get(`days:${book}:${month}`, 'json')
  const out = {}
  for (const [id, r] of Object.entries(stored?.entries || {})) {
    const clean = schoonRegel(r)
    if (clean && clean.id === id && maandVan(clean.date) === month) out[id] = clean
  }
  return out
}

// ---------- Handlers ----------

async function register(kv, request, headers) {
  let body
  try {
    body = JSON.parse(await request.text())
  } catch {
    return json({ error: 'ongeldige JSON' }, 400, headers)
  }
  const { book, writeToken, readToken, person } = body || {}
  if (!BOOK_RE.test(book || '') || !TOKEN_RE.test(writeToken || '') || !PERSONEN.includes(person)) {
    return json({ error: 'ongeldige gegevens' }, 400, headers)
  }
  if (readToken != null && (!TOKEN_RE.test(readToken) || readToken === writeToken)) return json({ error: 'ongeldig lees-token' }, 400, headers)
  const writeHash = await sha256(writeToken)
  const existing = await loadBook(kv, book)
  if (existing && !sameHash(existing.writeHash, writeHash)) return json({ error: 'dit dagboek bestaat al' }, 403, headers)
  const meta = existing || { created: Date.now() }
  meta.person = person
  meta.writeHash = writeHash
  meta.forward = !!body.forward
  meta.updated = Date.now()
  if (readToken != null) {
    const readHash = await sha256(readToken)
    if (meta.readHash && meta.readHash !== readHash) await kv.delete(`read:${meta.readHash}`)
    meta.readHash = readHash
    await kv.put(`read:${readHash}`, book)
  }
  await kv.put(`book:${book}`, JSON.stringify(meta))
  return json({ ok: true, person: meta.person, forward: meta.forward, linked: !!meta.readHash }, 200, headers)
}

async function getBook(kv, request, headers, book, url) {
  const meta = await authWrite(kv, request, book)
  if (!meta) return json({ error: 'geen toegang' }, 401, headers)
  const months = (url.searchParams.get('months') || '').split(',').filter((m) => MONTH_RE.test(m)).slice(0, 12)
  const out = {}
  for (const m of months) out[m] = Object.values(await loadMonth(kv, book, m))
  return json({ months: out, forward: !!meta.forward, linked: !!meta.readHash }, 200, headers)
}

async function putBook(kv, request, headers, book) {
  const meta = await authWrite(kv, request, book)
  if (!meta) return json({ error: 'geen toegang' }, 401, headers)
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'te groot' }, 413, headers)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'ongeldige JSON' }, 400, headers)
  }
  const perMonth = {}
  for (const r of Array.isArray(body?.entries) ? body.entries : []) {
    const clean = schoonRegel(r)
    if (!clean) continue
    ;(perMonth[maandVan(clean.date)] ||= {})[clean.id] = clean
  }
  const months = {}
  for (const [m, incoming] of Object.entries(perMonth)) {
    const stored = await loadMonth(kv, book, m)
    const merged = voegSamen(stored, incoming)
    if (JSON.stringify(merged) !== JSON.stringify(stored)) {
      await kv.put(`days:${book}:${m}`, JSON.stringify({ entries: merged, updated: Date.now() }))
    }
    months[m] = Object.values(merged)
  }
  if (typeof body?.forward === 'boolean' && body.forward !== !!meta.forward) {
    meta.forward = body.forward
    meta.updated = Date.now()
    await kv.put(`book:${book}`, JSON.stringify(meta))
  }
  return json({ months, forward: !!meta.forward, linked: !!meta.readHash }, 200, headers)
}

async function exportDays(kv, request, headers, url) {
  const token = bearer(request)
  if (!token) return json({ error: 'geen toegang' }, 401, headers)
  const book = await kv.get(`read:${await sha256(token)}`)
  const meta = book ? await loadBook(kv, book) : null
  if (!meta || !sameHash(meta.readHash, await sha256(token))) return json({ error: 'geen toegang' }, 401, headers)
  const person = url.searchParams.get('person') || ''
  const from = url.searchParams.get('from') || ''
  const to = url.searchParams.get('to') || ''
  if (person !== meta.person) return json({ error: 'onbekende persoon voor dit token' }, 403, headers)
  if (!meta.forward) return json({ error: 'doorsturen naar Healthbridge staat uit in Tarapp' }, 403, headers)
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) return json({ error: 'ongeldige periode' }, 400, headers)
  const dates = datumsTussen(from, to)
  if (dates.length > MAX_EXPORT_DAYS) return json({ error: `maximaal ${MAX_EXPORT_DAYS} dagen` }, 400, headers)
  const regels = []
  for (const m of [...new Set(dates.map(maandVan))]) regels.push(...Object.values(await loadMonth(kv, book, m)))
  return json(bouwExport({ person, from, to, regels }), 200, headers)
}

async function offProduct(kv, request, headers, code, env, ctx) {
  if (!(await authByAnyBook(kv, request))) return json({ error: 'geen toegang' }, 401, headers)
  const barcode = normaliseerBarcode(code)
  if (!barcode) return json({ error: 'ongeldige barcode' }, 400, headers)
  const cache = globalThis.caches?.default
  const cacheKey = new Request(`https://voeding-cache.invalid/off/${barcode}`)
  const hit = cache && (await cache.match(cacheKey))
  if (hit) return json(await hit.json(), 200, headers, { 'X-Cache': 'HIT' })
  if (!allow('off', 90)) return json({ error: 'even te veel verzoeken, probeer het zo opnieuw' }, 429, headers, { 'Retry-After': '20' })
  let res
  try {
    res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}?fields=${OFF_FIELDS}`, {
      headers: { 'User-Agent': userAgent(env), Accept: 'application/json' },
    })
  } catch {
    return json({ error: 'Open Food Facts is niet bereikbaar' }, 502, headers)
  }
  if (res.status === 429) return json({ error: 'Open Food Facts vraagt om even te wachten' }, 429, headers, { 'Retry-After': '30' })
  let data = null
  if (res.ok || res.status === 404) data = await res.json().catch(() => null)
  else return json({ error: `Open Food Facts gaf fout ${res.status}` }, 502, headers)
  const product = parseOff(data, barcode)
  const body = { product, attribution: 'Productgegevens: Open Food Facts (ODbL)' }
  // Gevonden: een week bewaren; niet gevonden: een dag (iemand kan hem net toevoegen).
  const ttl = product ? 7 * 86400 : 86400
  if (cache) {
    const put = cache.put(cacheKey, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${ttl}` } }))
    if (ctx?.waitUntil) ctx.waitUntil(put)
    else await put
  }
  return json(body, 200, headers, { 'X-Cache': 'MISS' })
}

async function offSearch(kv, request, headers, url, env) {
  if (!(await authByAnyBook(kv, request))) return json({ error: 'geen toegang' }, 401, headers)
  const q = (url.searchParams.get('q') || '').trim().slice(0, 80)
  if (q.length < 2) return json({ products: [] }, 200, headers)
  if (!allow('off-zoek', 8)) return json({ error: 'even te veel zoekopdrachten, probeer het zo opnieuw' }, 429, headers, { 'Retry-After': '30' })
  const params = new URLSearchParams({ search_terms: q, search_simple: '1', json: '1', page_size: '20', fields: `code,${OFF_FIELDS}` })
  let data
  try {
    const res = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?${params}`, { headers: { 'User-Agent': userAgent(env), Accept: 'application/json' } })
    if (!res.ok) return json({ error: `Open Food Facts gaf fout ${res.status}` }, 502, headers)
    data = await res.json()
  } catch {
    return json({ error: 'Zoeken bij Open Food Facts lukt nu niet' }, 502, headers)
  }
  const products = (data?.products || [])
    .map((p) => (normaliseerBarcode(p.code) ? parseOff({ status: 1, code: p.code, product: p }, normaliseerBarcode(p.code)) : null))
    .filter(Boolean)
  return json({ products, attribution: 'Productgegevens: Open Food Facts (ODbL)' }, 200, headers)
}

// De OFF-proxy is alleen voor geregistreerde dagboeken (Authorization + X-Voeding-Book).
async function authByAnyBook(kv, request) {
  const book = request.headers.get('X-Voeding-Book') || ''
  return !!(await authWrite(kv, request, book))
}

const userAgent = (env) => `Tarapp/${env?.APP_VERSION || 'dev'} (${env?.OFF_CONTACT || 'https://github.com/oscardillewaard-ai/Tezt'})`

async function statusPage(kv) {
  const lines = ['Tarapp Voeding sync-server', '', '✅ De worker draait.']
  if (!kv) lines.push('❌ Er is nog geen opslag (KV) gekoppeld. De deploy-workflow maakt die normaal zelf aan.')
  else {
    try {
      await kv.put('health', String(Date.now()))
      lines.push('✅ De opslag is gekoppeld en werkt.')
    } catch (err) {
      lines.push(`❌ Opslag gekoppeld, maar schrijven lukt niet: ${err?.message || err}`)
    }
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export default {
  async fetch(request, env, ctx) {
    const headers = cors(request)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const kv = findKv(env)
    if (path === '/' && request.method === 'GET') return statusPage(kv)
    if (!kv) return json({ error: 'Geen opslag gekoppeld aan de sync-server' }, 500, headers)
    try {
      if (path === '/voeding/register' && request.method === 'POST') return await register(kv, request, headers)
      if (path === '/voeding/export' && request.method === 'GET') return await exportDays(kv, request, headers, url)
      if (path === '/voeding/off-zoek' && request.method === 'GET') return await offSearch(kv, request, headers, url, env)
      let m = path.match(/^\/voeding\/off\/(\d{8,14})$/)
      if (m && request.method === 'GET') return await offProduct(kv, request, headers, m[1], env, ctx)
      m = path.match(/^\/voeding\/book\/([^/]+)$/)
      if (m && BOOK_RE.test(m[1])) {
        if (request.method === 'GET') return await getBook(kv, request, headers, m[1], url)
        if (request.method === 'PUT') return await putBook(kv, request, headers, m[1])
        return json({ error: 'method not allowed' }, 405, headers)
      }
    } catch {
      return json({ error: 'interne fout' }, 500, headers)
    }
    return json({ error: 'not found' }, 404, headers)
  },
}

// Alleen voor de tests.
export const _test = { buckets }
