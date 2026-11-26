// Gedeelde hulpjes voor de Voeding-tests: een nep-KV, localStorage en een fetch
// die rechtstreeks de echte Worker-code aanroept (zonder netwerk).
import worker from '../../proxy/voeding/worker.js'

export function nepKv() {
  const m = new Map()
  return {
    data: m,
    async get(k, type) {
      if (!m.has(k)) return null
      return type === 'json' ? JSON.parse(m.get(k)) : m.get(k)
    },
    async put(k, v) {
      m.set(k, String(v))
    },
    async delete(k) {
      m.delete(k)
    },
    async list() {
      return { keys: [...m.keys()].map((name) => ({ name })) }
    },
  }
}

export function nepLocalStorage() {
  const m = new Map()
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
    _map: m,
  }
  return globalThis.localStorage
}

/** fetch() die naar de Worker gaat, met een eigen KV-opslag. */
export function workerFetch(kv = nepKv(), env = {}) {
  const f = async (url, init = {}) => worker.fetch(new Request(url, init), { VOEDING: kv, ...env }, { waitUntil() {} })
  f.kv = kv
  return f
}

export const W = 'https://tarapp-voeding.oscar-dillewaard.workers.dev'

export async function call(fetchFn, path, { method = 'GET', token, book, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  if (book) headers['X-Voeding-Book'] = book
  const res = await fetchFn(`${W}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null) }
}
