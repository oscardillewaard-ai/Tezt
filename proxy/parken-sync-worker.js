// Sync-server (Cloudflare Worker + KV) voor Parkenjacht.
//
// Twee (of meer) telefoons met dezelfde groepscode delen één voortgang. De
// app stuurt haar stand met PUT, de worker voegt die samen met wat er al
// lag en geeft het resultaat terug; met GET haalt de app de stand op.
//
// Samenvoegen gebeurt per park: de wijziging met het jongste tijdstip `t`
// wint, ook als dat een uitvinking is (`gone: true`). Omdat de app na elke
// sync zelf ook samenvoegt en opnieuw stuurt als zij nog iets nieuwers had,
// komen alle telefoons altijd op dezelfde stand uit, ook als KV twee
// gelijktijdige schrijfacties niet in volgorde verwerkt.
//
// Neerzetten (gratis):
// 1. dash.cloudflare.com -> Storage & Databases -> KV -> Create namespace,
//    bijv. "parkenjacht".
// 2. Workers & Pages -> Create -> Worker, plak dit script, Deploy.
// 3. Worker -> Settings -> Bindings -> Add -> KV namespace: naam PARKEN
//    (een andere naam werkt ook), kies de namespace van stap 1. Deploy opnieuw.
//    Controle: open het adres van de worker in je browser; hij vertelt dan
//    of alles klopt.
// 4. Vul in Parkenjacht onder ⚙️ -> Samen synchroniseren het adres van de
//    worker in (bijv. https://parkenjacht.<jouw-naam>.workers.dev), of zet
//    het als DEFAULT_SYNC_URL in public/parken/app.js.
//
// De groepscode is het enige "wachtwoord": wie hem kent, kan meekijken en
// afvinken. De app maakt er een lange, willekeurige van.

const ALLOWED_ORIGINS = ['https://oscardillewaard-ai.github.io', 'http://localhost:5173', 'http://localhost:4173']
const MAX_BODY = 64 * 1024
const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/
const ID_RE = /^[a-z0-9-]{1,40}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function cors(request) {
  const origin = request.headers.get('Origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

// Alleen nette records doorlaten: { id: { t, date, note } } of { id: { t, gone: true } }.
function clean(entries) {
  const out = {}
  if (!entries || typeof entries !== 'object') return out
  for (const [id, e] of Object.entries(entries)) {
    if (!ID_RE.test(id) || !e || typeof e !== 'object') continue
    const t = Number(e.t)
    if (!Number.isFinite(t) || t < 0) continue
    if (e.gone) out[id] = { t, gone: true }
    else if (DATE_RE.test(e.date)) out[id] = { t, date: e.date, note: String(e.note || '').slice(0, 2000) }
  }
  return out
}

function merge(a, b) {
  const out = { ...a }
  for (const [id, e] of Object.entries(b)) if (!out[id] || e.t > out[id].t) out[id] = e
  return out
}

// De opslag zoeken: bij voorkeur de binding PARKEN, anders de eerste
// KV-binding die er is (scheelt gedoe als de naam net anders is getypt).
function findKv(env) {
  if (env.PARKEN) return env.PARKEN
  return Object.values(env || {}).find((v) => v && ['get', 'put', 'list'].every((f) => typeof v[f] === 'function'))
}

// Statuspagina op het hoofdadres, in gewone taal.
async function statusPage(kv) {
  const lines = ['Parkenjacht sync-server', '', '✅ De worker draait.']
  if (!kv) {
    lines.push(
      '❌ Er is nog geen opslag gekoppeld.',
      '',
      'Zo los je het op:',
      '1. Maak een KV namespace (Storage & Databases -> KV -> Create), bijv. "parkenjacht".',
      '2. Ga naar deze worker -> Settings -> Bindings -> Add -> KV namespace.',
      '3. Variable name: PARKEN, kies de namespace van stap 1, opslaan/deployen.',
      '4. Ververs deze pagina.',
    )
  } else {
    try {
      await kv.put('health', String(Date.now()))
      lines.push('✅ De opslag is gekoppeld en werkt.', '', 'Klaar! Vul dit adres in Parkenjacht in onder ⚙️ -> Samen synchroniseren.')
    } catch (err) {
      lines.push(`❌ Opslag gekoppeld, maar schrijven lukt niet: ${err?.message || err}`)
    }
  }
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export default {
  async fetch(request, env) {
    const headers = cors(request)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const kv = findKv(env)
    const path = new URL(request.url).pathname
    if (path === '/' && request.method === 'GET') return statusPage(kv)
    const m = path.match(/^\/room\/([^/]+)$/)
    if (!m || !ROOM_RE.test(m[1])) return json({ error: 'not found' }, 404, headers)
    if (!kv) return json({ error: 'Geen opslag gekoppeld aan de sync-server' }, 500, headers)
    const key = `room:${m[1]}`
    const stored = clean((await kv.get(key, 'json'))?.entries)

    if (request.method === 'GET') return json({ entries: stored }, 200, headers)

    if (request.method === 'PUT') {
      const body = await request.text()
      if (body.length > MAX_BODY) return json({ error: 'te groot' }, 413, headers)
      let incoming
      try {
        incoming = clean(JSON.parse(body).entries)
      } catch {
        return json({ error: 'ongeldige JSON' }, 400, headers)
      }
      const merged = merge(stored, incoming)
      if (JSON.stringify(merged) !== JSON.stringify(stored)) {
        await kv.put(key, JSON.stringify({ entries: merged, updated: Date.now() }))
      }
      return json({ entries: merged }, 200, headers)
    }

    return json({ error: 'method not allowed' }, 405, headers)
  },
}
