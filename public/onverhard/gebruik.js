// Een lokale teller: wat je in de app doet, alleen bewaard in deze browser (localStorage) en nooit
// verstuurd. Bedoeld om te meten welke knoppen en voorkeuren je echt gebruikt, voordat de interface
// verandert. Een ringbuffer van hooguit MAX regels {t, ev, d}. Alles in try/catch: een volle of
// uitgezette opslag mag de app nooit breken.

export const SLEUTEL = 'nopaves.log'
export const MAX = 500

let opslag = null
try {
  opslag = globalThis.localStorage || null
} catch {
  opslag = null
}

/** Alleen voor tests: een andere opslag (iets met getItem, setItem, removeItem), of null. */
export function zetOpslag(o) {
  opslag = o
}

/** Alle regels, oudste eerst. Een lege lijst als er niets is of als de opslag niet werkt. */
export function lees() {
  try {
    const regels = JSON.parse(opslag.getItem(SLEUTEL) || '[]')
    return Array.isArray(regels) ? regels : []
  } catch {
    return []
  }
}

/** Schrijf één gebeurtenis. ev: korte naam (bijvoorbeeld 'plan_start'), d: een klein object. */
export function log(ev, d = {}, nu = Date.now()) {
  try {
    const regels = lees()
    regels.push({ t: nu, ev, d })
    if (regels.length > MAX) regels.splice(0, regels.length - MAX)
    opslag.setItem(SLEUTEL, JSON.stringify(regels))
    return true
  } catch {
    return false
  }
}

export function wis() {
  try {
    opslag.removeItem(SLEUTEL)
    return true
  } catch {
    return false
  }
}

const mediaan = (getallen) => {
  if (!getallen.length) return null
  const s = getallen.slice().sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Tellingen voor het overzicht "Mijn gebruik". */
export function samenvatting(regels = lees()) {
  const tel = (kies) => {
    const t = {}
    for (const r of regels) {
      const k = kies(r)
      if (k === null || k === undefined || k === '') continue
      t[k] = (t[k] || 0) + 1
    }
    return t
  }
  const klaar = regels.filter((r) => r.ev === 'plan_done')
  return {
    regels: regels.length,
    van: regels.length ? regels[0].t : null,
    tot: regels.length ? regels[regels.length - 1].t : null,
    gebeurtenissen: tel((r) => r.ev),
    perSoort: tel((r) => (r.ev === 'plan_start' ? r.d && r.d.soort : null)),
    perStart: tel((r) => (r.ev === 'plan_start' ? r.d && r.d.start : null)),
    perAfstand: tel((r) => (r.ev === 'plan_start' && r.d && r.d.km ? `${r.d.km} km` : null)),
    voorkeuren: tel((r) => (r.ev === 'pref_change' ? r.d && r.d.sleutel : null)),
    onderdelen: tel((r) => (r.ev === 'details_open' ? r.d && r.d.deel : null)),
    sheet: tel((r) => (r.ev === 'sheet_state' ? r.d && r.d.stand : null)),
    weergave: tel((r) => (r.ev === 'app_open' ? r.d && r.d.weergave : null)),
    locatie: tel((r) => (r.ev === 'app_open' ? r.d && r.d.locatie : null)),
    planGelukt: klaar.filter((r) => r.d && r.d.ok).length,
    planMislukt: klaar.filter((r) => r.d && !r.d.ok).length,
    planDuurMediaanMs: mediaan(klaar.filter((r) => r.d && r.d.ok && typeof r.d.ms === 'number').map((r) => r.d.ms)),
  }
}

/** De weergave en de locatietoestemming, zonder ooit om toestemming te vragen. */
export async function openInfo() {
  let weergave = 'onbekend'
  try {
    weergave = globalThis.matchMedia && globalThis.matchMedia('(display-mode: standalone)').matches ? 'standalone' : 'browser'
  } catch {
    // laat 'onbekend' staan
  }
  let locatie = 'onbekend'
  try {
    if (globalThis.navigator && navigator.permissions && navigator.permissions.query) {
      locatie = (await navigator.permissions.query({ name: 'geolocation' })).state
    }
  } catch {
    // sommige browsers kennen deze vraag niet
  }
  return { weergave, locatie }
}
