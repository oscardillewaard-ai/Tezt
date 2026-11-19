// Cache voor kaarttegels (OpenFreeMap), BGT-tegels en AHN-blokken (snelheid, stap 1): eerst uit de
// cache, op de achtergrond verversen. Max leeftijd 30 dagen, max grootte, oudste eerst weg. Alleen
// in de browser (Cache Storage); in Node (tests, benchmarks) doet dit niets. App-bestanden horen
// hier niet bij: die blijven via de service worker eerst netwerk.
export const NAAM = 'nopaves-data-v1'
export const MAX_LEEFTIJD = 30 * 24 * 3600 * 1000
export const VERVERS_NA = 7 * 24 * 3600 * 1000
export const MAX_AANTAL = 8000 // ~ 8000 tegels; samen met MAX_BYTES de grens
export const MAX_BYTES = 300 * 1024 * 1024
const TIJD = 'x-nopaves-tijd'

const kan = () => typeof caches !== 'undefined' && typeof Response !== 'undefined'

/** Welke adressen in deze cache horen. */
export function cachebaar(url) {
  const u = String(url)
  return (/tiles\.openfreemap\.org\/.+\/\d+\/\d+\/\d+\.pbf/.test(u) && !u.endsWith('/planet')) || /api\.pdok\.nl\/kadaster\/bgt\/ogc\/v1\/tiles\//.test(u) || /service\.pdok\.nl\/rws\/ahn\/wcs\//.test(u)
}

/** Is een opgeslagen antwoord (tijd in ms) nog bruikbaar, en moet het ververst worden? */
export function versheid(tijd, nu = Date.now()) {
  const leeftijd = nu - tijd
  return { bruikbaar: leeftijd >= 0 && leeftijd < MAX_LEEFTIJD, verversen: leeftijd >= VERVERS_NA }
}

let cachePromise = null
const open = () => (cachePromise ||= caches.open(NAAM))
const zuinig = () => {
  try {
    return !!(navigator.connection && navigator.connection.saveData)
  } catch {
    return false
  }
}

/** Uit de cache: {bytes, status} of null. Een oud (maar bruikbaar) antwoord wordt op de achtergrond ververst. */
export async function uitCache(url) {
  if (!kan()) return null
  try {
    const r = await (await open()).match(url)
    if (!r) return null
    const tijd = Number(r.headers.get(TIJD)) || 0
    const v = versheid(tijd)
    if (!v.bruikbaar) return null
    if (v.verversen) setTimeout(() => ververs(url), 3000)
    return { bytes: await r.arrayBuffer(), status: r.status, headers: r.headers }
  } catch {
    return null
  }
}

/** Een binnengehaald antwoord bewaren (alleen 200). */
export async function inCache(url, bytes, status, headers) {
  if (!kan() || status !== 200) return
  try {
    const h = new Headers()
    const type = headers && headers.get && headers.get('content-type')
    if (type) h.set('content-type', type)
    h.set(TIJD, String(Date.now()))
    await (await open()).put(url, new Response(bytes, { status: 200, headers: h }))
    planOpruimen()
  } catch {
    // opslag vol of geweigerd: dan niet bewaren
  }
}

async function ververs(url) {
  if (zuinig()) return
  try {
    const r = await fetch(url, { priority: 'low' })
    if (r.ok) await inCache(url, await r.arrayBuffer(), 200, r.headers)
  } catch {
    // later nog eens
  }
}

let opruimTimer = null
function planOpruimen() {
  if (opruimTimer) return
  opruimTimer = setTimeout(() => {
    opruimTimer = null
    opruimen()
  }, 15000)
}

/** Boven de grens (aantal of bytes): de oudste kwart weg. Cache Storage geeft de sleutels in volgorde van opslaan. */
export async function opruimen() {
  if (!kan()) return 0
  try {
    const c = await open()
    const sleutels = await c.keys()
    let teVeel = sleutels.length > MAX_AANTAL
    if (!teVeel && navigator.storage && navigator.storage.estimate) {
      const { usage } = await navigator.storage.estimate()
      teVeel = usage > MAX_BYTES
    }
    if (!teVeel) return 0
    const weg = sleutels.slice(0, Math.max(sleutels.length - MAX_AANTAL, Math.ceil(sleutels.length / 4)))
    for (const k of weg) await c.delete(k)
    return weg.length
  } catch {
    return 0
  }
}
