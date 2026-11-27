// Account voor Tarapp: inloggen met Google en al je gegevens synchroniseren.
// Onderdeel van de Worker (worker.js stuurt /account/* hierheen).
//
// Beveiliging:
// - Inloggen: de app krijgt van Google een ondertekend ID-token. Wij controleren de handtekening
//   (RS256) met de openbare sleutels van Google, en dat het token voor Tarapp is (aud), van Google
//   komt (iss), niet verlopen is (exp) en het e-mailadres bevestigd is.
// - Toegang alleen na goedkeuring: de beheerder(s) (Worker-secret ADMIN_EMAILS) mogen altijd in.
//   Logt iemand anders in, dan wordt dat een aanvraag; de beheerder keurt die goed of af in
//   Tarapp (Meer → Account). Goedkeuring is in te trekken; de sessies van die persoon werken dan
//   meteen niet meer. De lijst staat in KV onder "toegang".
// - Daarna een eigen sessiecode (willekeurig, 256 bit); in KV staat alleen de SHA-256-hash, met een
//   vervaldatum. Geen wachtwoorden.
// - Gegevens staan per account versleuteld in KV (AES-256-GCM, sleutel = Worker-secret DATA_KEY,
//   per opslag een nieuwe IV, het account-id als extra controle).
//
// Instellen (doet .github/workflows/voeding-worker.yml): GOOGLE_CLIENT_ID, ADMIN_EMAILS en
// DATA_KEY als secrets van de Worker.

import { sinds, voegSamenOpServer } from '../../public/sportagenda/account/kern.js'

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs'
const GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com']
const SESSIE_DAGEN = 180
const MAX_BODY = 4 * 1024 * 1024
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/
const MAX_WACHTEND = 25 // niet meer openstaande aanvragen tegelijk (tegen volspammen)
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}$/

const enc = new TextEncoder()
const dec = new TextDecoder()
const b64urlNaarBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0))
const bytesNaarB64 = (b) => btoa(String.fromCharCode(...b))
const b64NaarBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function randomToken() {
  return bytesNaarB64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// ---------- Google ID-token ----------

let certCache = null // { keys, tot }

async function googleSleutels(fetchFn) {
  if (certCache && certCache.tot > Date.now()) return certCache.keys
  const res = await fetchFn(GOOGLE_CERTS)
  if (!res.ok) throw new Error('Sleutels van Google niet op te halen')
  const maxAge = Number((res.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1]) || 3600
  const { keys } = await res.json()
  certCache = { keys, tot: Date.now() + Math.min(maxAge, 86400) * 1000 }
  return keys
}

/**
 * Controleert een Google ID-token. Geeft { sub, email, naam } of gooit een Error.
 * [fetchFn] en [nu] zijn er voor de tests.
 */
export async function controleerGoogleToken(idToken, clientId, { fetchFn = fetch, nu = Date.now() } = {}) {
  const delen = String(idToken || '').split('.')
  if (delen.length !== 3) throw new Error('Ongeldig token')
  const kop = JSON.parse(dec.decode(b64urlNaarBytes(delen[0])))
  const inhoud = JSON.parse(dec.decode(b64urlNaarBytes(delen[1])))
  if (kop.alg !== 'RS256') throw new Error('Onverwacht algoritme')
  const sleutels = await googleSleutels(fetchFn)
  const jwk = sleutels.find((k) => k.kid === kop.kid)
  if (!jwk) throw new Error('Onbekende sleutel')
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
  const geldig = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlNaarBytes(delen[2]), enc.encode(`${delen[0]}.${delen[1]}`))
  if (!geldig) throw new Error('Handtekening klopt niet')
  if (!GOOGLE_ISS.includes(inhoud.iss)) throw new Error('Niet van Google')
  if (!clientId || inhoud.aud !== clientId) throw new Error('Token is niet voor Tarapp')
  if (!(Number(inhoud.exp) * 1000 > nu - 60_000)) throw new Error('Token verlopen')
  if (inhoud.email_verified !== true && inhoud.email_verified !== 'true') throw new Error('E-mailadres niet bevestigd')
  return { sub: String(inhoud.sub), email: String(inhoud.email || '').toLowerCase(), naam: String(inhoud.given_name || inhoud.name || '') }
}

export const toegestaan = (email, lijst) =>
  String(lijst || '')
    .split(/[\s,;]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .includes(String(email || '').toLowerCase())

// ---------- Toegang en aanvragen ----------
// KV "toegang": { [email]: { status: 'wacht' | 'ja', naam, sinds, besluit? } }

const leesToegang = async (kv) => (await kv.get('toegang', 'json')) || {}
const bewaarToegang = (kv, t) => kv.put('toegang', JSON.stringify(t))
const isBeheerder = (env, email) => toegestaan(email, env.ADMIN_EMAILS)

async function magErin(env, kv, email) {
  if (isBeheerder(env, email)) return true
  return (await leesToegang(kv))[String(email).toLowerCase()]?.status === 'ja'
}

/** Inlogpoging van iemand zonder toegang: als aanvraag bewaren. Geeft de status ('wacht'). */
async function vraagAan(kv, wie) {
  const t = await leesToegang(kv)
  if (!t[wie.email]) {
    const wachtend = Object.values(t).filter((x) => x.status === 'wacht').length
    if (wachtend >= MAX_WACHTEND) return 'vol'
    t[wie.email] = { status: 'wacht', naam: wie.naam.slice(0, 60), sinds: Date.now() }
    await bewaarToegang(kv, t)
  }
  return t[wie.email].status
}

// ---------- Versleuteling ----------

async function dataSleutel(env) {
  const raw = env?.DATA_KEY ? b64NaarBytes(env.DATA_KEY) : null
  if (!raw || raw.length !== 32) throw new Error('DATA_KEY ontbreekt of is geen 32 bytes (base64)')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function versleutel(env, sub, data) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(sub) }, await dataSleutel(env), enc.encode(JSON.stringify(data)))
  return JSON.stringify({ v: 1, iv: bytesNaarB64(iv), ct: bytesNaarB64(new Uint8Array(ct)) })
}

export async function ontsleutel(env, sub, tekst) {
  if (!tekst) return null
  const o = JSON.parse(tekst)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64NaarBytes(o.iv), additionalData: enc.encode(sub) }, await dataSleutel(env), b64NaarBytes(o.ct))
  return JSON.parse(dec.decode(pt))
}

// ---------- Sessies ----------

async function sessieVan(kv, request) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)
  if (!m || !TOKEN_RE.test(m[1])) return null
  const s = await kv.get(`sess:${await sha256(m[1])}`, 'json')
  return s && s.exp > Date.now() ? { ...s, hash: await sha256(m[1]) } : null
}

// ---------- Endpoints ----------

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export async function accountRoute(path, request, env, kv, headers, { fetchFn = fetch } = {}) {
  // Openbare instelling voor de app: welke Google-client (geen geheim).
  if (path === '/account/config' && request.method === 'GET') {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || null, actief: !!(env.GOOGLE_CLIENT_ID && env.ADMIN_EMAILS && env.DATA_KEY) }, 200, headers)
  }

  if (path === '/account/login' && request.method === 'POST') {
    if (!env.GOOGLE_CLIENT_ID || !env.ADMIN_EMAILS || !env.DATA_KEY) return json({ error: 'Inloggen is nog niet ingesteld' }, 503, headers)
    let body
    try {
      body = JSON.parse(await request.text())
    } catch {
      return json({ error: 'ongeldige JSON' }, 400, headers)
    }
    let wie
    try {
      wie = await controleerGoogleToken(body?.idToken, env.GOOGLE_CLIENT_ID, { fetchFn })
    } catch (err) {
      return json({ error: `Inloggen mislukt: ${err.message}` }, 401, headers)
    }
    if (!(await magErin(env, kv, wie.email))) {
      const st = await vraagAan(kv, wie)
      return json(
        { error: st === 'vol' ? 'Er staan te veel aanvragen open. Probeer het later opnieuw.' : 'Je aanvraag is verstuurd. Zodra Oscar hem goedkeurt, kun je inloggen.', aangevraagd: st === 'wacht' },
        403,
        headers,
      )
    }
    const sessie = randomToken()
    const exp = Date.now() + SESSIE_DAGEN * 86400_000
    await kv.put(`sess:${await sha256(sessie)}`, JSON.stringify({ sub: wie.sub, email: wie.email, exp }), { expirationTtl: SESSIE_DAGEN * 86400 })
    return json({ sessie, email: wie.email, naam: wie.naam, exp, beheerder: isBeheerder(env, wie.email) }, 200, headers)
  }

  const sessie = await sessieVan(kv, request)
  if (!sessie) return json({ error: 'Niet ingelogd (of sessie verlopen)' }, 401, headers)
  // Toegang ingetrokken: ook een lopende sessie stopt meteen.
  if (!(await magErin(env, kv, sessie.email))) {
    await kv.delete(`sess:${sessie.hash}`)
    return json({ error: 'Je toegang tot Tarapp is ingetrokken' }, 401, headers)
  }

  if (path === '/account/logout' && request.method === 'POST') {
    await kv.delete(`sess:${sessie.hash}`)
    return json({ ok: true }, 200, headers)
  }

  // Beheer: aanvragen bekijken en goed- of afkeuren (alleen voor ADMIN_EMAILS).
  if (path === '/account/toegang') {
    if (!isBeheerder(env, sessie.email)) return json({ error: 'Alleen voor de beheerder' }, 403, headers)
    const t = await leesToegang(kv)
    if (request.method === 'POST') {
      let body
      try {
        body = JSON.parse(await request.text())
      } catch {
        return json({ error: 'ongeldige JSON' }, 400, headers)
      }
      const email = String(body?.email || '').trim().toLowerCase()
      if (!EMAIL_RE.test(email)) return json({ error: 'ongeldig e-mailadres' }, 400, headers)
      if (body.besluit === 'ja') t[email] = { ...(t[email] || { naam: '', sinds: Date.now() }), status: 'ja', besluit: Date.now() }
      else if (body.besluit === 'nee') delete t[email]
      else return json({ error: "besluit moet 'ja' of 'nee' zijn" }, 400, headers)
      await bewaarToegang(kv, t)
    } else if (request.method !== 'GET') return json({ error: 'not found' }, 404, headers)
    const lijst = Object.entries(t)
      .map(([email, x]) => ({ email, ...x }))
      .sort((a, b) => (a.status === b.status ? b.sinds - a.sinds : a.status === 'wacht' ? -1 : 1))
    return json({ lijst }, 200, headers)
  }

  if (path === '/account/sync' && request.method === 'POST') {
    const text = await request.text()
    if (text.length > MAX_BODY) return json({ error: 'te groot' }, 413, headers)
    let body
    try {
      body = JSON.parse(text)
    } catch {
      return json({ error: 'ongeldige JSON' }, 400, headers)
    }
    const sleutel = `acct:${sessie.sub}`
    let opslag
    try {
      opslag = (await ontsleutel(env, sessie.sub, await kv.get(sleutel))) || { rev: 0, records: {} }
    } catch {
      return json({ error: 'Gegevens konden niet worden ontsleuteld' }, 500, headers)
    }
    const changes = body?.changes && typeof body.changes === 'object' ? body.changes : {}
    const nieuw = Object.keys(changes).length ? voegSamenOpServer(opslag, changes) : opslag
    if (nieuw.rev !== opslag.rev) await kv.put(sleutel, await versleutel(env, sessie.sub, nieuw))
    const base = Math.max(0, Number(body?.base) || 0)
    // Wie Tarapp gebruikt, blijft ingelogd: de sessie schuift op (hooguit eens per week een schrijfactie).
    let exp = sessie.exp
    if (exp - Date.now() < (SESSIE_DAGEN - 7) * 86400_000) {
      exp = Date.now() + SESSIE_DAGEN * 86400_000
      await kv.put(`sess:${sessie.hash}`, JSON.stringify({ sub: sessie.sub, email: sessie.email, exp }), { expirationTtl: SESSIE_DAGEN * 86400 })
    }
    const wachtend = isBeheerder(env, sessie.email) ? Object.values(await leesToegang(kv)).filter((x) => x.status === 'wacht').length : 0
    return json({ rev: nieuw.rev, records: sinds(nieuw, base), email: sessie.email, wachtend, exp }, 200, headers)
  }

  return json({ error: 'not found' }, 404, headers)
}

// Alleen voor de tests.
export const _test = { reset: () => (certCache = null) }
