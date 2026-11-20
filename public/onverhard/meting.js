// Snelheid meten (stap 0): hoe lang elke fase van het plannen duurt, en hoeveel verzoeken, bytes en
// cachetreffers per bron. Alleen in het geheugen; window.onverhard.meting.rapport() geeft het
// overzicht van de laatste planning (de benchmark leest dat uit). Verstuurt niets.
const fasen = new Map()
const bronnen = new Map()
let begin = 0
let eind = null

export function reset() {
  fasen.clear()
  bronnen.clear()
  begin = performance.now()
  eind = null
}

/** Het plannen is klaar (het resultaat staat er). */
export function klaar() {
  eind = performance.now()
}

export function tijd(fase, ms) {
  fasen.set(fase, (fasen.get(fase) || 0) + ms)
}

export async function meet(fase, fn) {
  const t = performance.now()
  try {
    return await fn()
  } finally {
    tijd(fase, performance.now() - t)
  }
}

export function meetSync(fase, fn) {
  const t = performance.now()
  try {
    return fn()
  } finally {
    tijd(fase, performance.now() - t)
  }
}

/** Welke bron hoort bij een adres. */
export function bronVan(url) {
  const u = String(url)
  if (u.includes('tiles.openfreemap.org')) return 'tegels'
  if (u.includes('/bgt/')) return 'bgt'
  if (u.includes('/ahn/')) return 'ahn'
  if (u.includes('overpass')) return 'water'
  if (u.includes('brouter')) return 'brouter'
  if (u.includes('natura2000')) return 'natura2000'
  return 'overig'
}

/** Eén verzoek: bytes, duur en of het uit een cache kwam ('cache', 'net' of null = onbekend). */
export function verzoek(url, bytes, ms, cache = null) {
  const bron = bronVan(url)
  const b = bronnen.get(bron) || { n: 0, bytes: 0, cache: 0, ms: 0 }
  b.n += 1
  b.bytes += bytes
  b.ms += ms
  if (cache === null) {
    // de browser zegt het via Resource Timing (als de server dat toestaat), anders: heel snel = cache
    try {
      const e = performance.getEntriesByName(String(url)).at(-1)
      if (e && e.decodedBodySize > 0) cache = e.transferSize === 0 ? 'cache' : 'net'
    } catch {
      // geen Resource Timing
    }
    if (cache === null) cache = ms < 5 ? 'cache' : 'net'
  }
  if (cache === 'cache') b.cache += 1
  bronnen.set(bron, b)
}

/** Verzoeken die in de rekenwerker zijn gedaan, bij deze meting optellen. */
export function voegBronnenToe(andere = {}) {
  for (const [bron, v] of Object.entries(andere)) {
    const b = bronnen.get(bron) || { n: 0, bytes: 0, cache: 0, ms: 0 }
    b.n += v.n
    b.bytes += v.bytes
    b.cache += v.cache
    b.ms += v.ms
    bronnen.set(bron, b)
  }
}

export function rapport() {
  return {
    totaal: Math.round((eind ?? performance.now()) - begin),
    fasen: Object.fromEntries([...fasen].map(([k, v]) => [k, Math.round(v)])),
    bronnen: Object.fromEntries([...bronnen].map(([k, v]) => [k, { ...v, ms: Math.round(v.ms) }])),
  }
}
