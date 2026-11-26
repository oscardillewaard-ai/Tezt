// Voeding: rekenkern zonder DOM, netwerk of opslag.
// Gebruikt door de app (ui.js, sync.js), door de Worker (proxy/voeding/worker.js,
// meegebundeld door wrangler) en door de tests (tests/voeding/).
// Alle voedingswaarden van een product staan per 100 g (of 100 ml).
// Een onbekende waarde is null, nooit 0.

export const SCHEMA_VERSIE = 1 // schema van de Voeding-gegevens in Tarapp (opslag en back-up)
export const EXPORT_SCHEMA = 1 // schemaVersion van GET /voeding/export
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack']
export const MEAL_NL = { breakfast: 'Ontbijt', lunch: 'Lunch', dinner: 'Diner', snack: 'Snack' }
export const PERSONEN = ['oscar', 'tara']
export const BRONNEN = ['off', 'usda', 'eigen', 'recept', 'nevo']
export const MACRO_KEYS = ['kcal', 'eiwit', 'kh', 'vet']

const KJ_PER_KCAL = 4.184

// ---------- Getallen ----------

/** Getal of null; lege tekst, NaN en negatieve waarden worden null. Komma als decimaalteken mag. */
export function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

export const round = (v, d = 1) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d)

export const kjNaarKcal = (kj) => (num(kj) === null ? null : num(kj) / KJ_PER_KCAL)

/** Per-100-waarden opschonen: altijd alle vier de sleutels, onbekend = null. */
export function per100(p = {}) {
  return { kcal: num(p.kcal), eiwit: num(p.eiwit), kh: num(p.kh), vet: num(p.vet) }
}

/** Macro's voor een hoeveelheid in gram (of ml). */
export function macrosVoor(p100, gram) {
  const g = num(gram)
  const p = per100(p100)
  const f = (v) => (v === null || g === null ? null : (v * g) / 100)
  return { kcal: f(p.kcal), eiwit: f(p.eiwit), kh: f(p.kh), vet: f(p.vet) }
}

/** Optellen; een som is null als geen enkele regel die waarde had. */
export function somMacros(lijst) {
  const out = { kcal: null, eiwit: null, kh: null, vet: null }
  for (const m of lijst) {
    for (const k of MACRO_KEYS) if (m[k] !== null && m[k] !== undefined) out[k] = (out[k] || 0) + m[k]
  }
  return out
}

// ---------- Recepten ----------

/**
 * Recept: ingrediënten met gram en per-100-waarden, plus een aantal porties.
 * Geeft het totaalgewicht, de waarden per 100 g en per portie. Een waarde is null
 * als één ingrediënt hem niet heeft (anders zou het recept stilletjes te laag uitvallen).
 */
export function receptWaarden(recept) {
  const ingr = (recept?.ingredienten || []).filter((i) => num(i.gram))
  const porties = Math.max(1, num(recept?.porties) || 1)
  const totaalGram = ingr.reduce((s, i) => s + num(i.gram), 0)
  const totaal = { kcal: 0, eiwit: 0, kh: 0, vet: 0 }
  for (const i of ingr) {
    const m = macrosVoor(i.per100, i.gram)
    for (const k of MACRO_KEYS) totaal[k] = totaal[k] === null || m[k] === null ? null : totaal[k] + m[k]
  }
  if (!ingr.length) for (const k of MACRO_KEYS) totaal[k] = null
  const deel = (n) => Object.fromEntries(MACRO_KEYS.map((k) => [k, totaal[k] === null ? null : totaal[k] / n]))
  return {
    totaalGram,
    porties,
    portieGram: totaalGram / porties,
    totaal,
    perPortie: deel(porties),
    per100: totaalGram ? Object.fromEntries(MACRO_KEYS.map((k) => [k, totaal[k] === null ? null : (totaal[k] / totaalGram) * 100])) : per100(),
  }
}

// ---------- Open Food Facts ----------

export const OFF_FIELDS = 'product_name,product_name_nl,brands,nutriments,serving_size,quantity'
export const BARCODE_RE = /^\d{8}$|^\d{12,14}$/

/** EAN-13/EAN-8/UPC-A (12)/GTIN-14: controlecijfer klopt. UPC-E (8) heeft dezelfde check na uitklappen; we accepteren 8 cijfers als EAN-8. */
export function geldigeBarcode(code) {
  const c = String(code || '').trim()
  if (!BARCODE_RE.test(c)) return false
  const digits = c.split('').map(Number)
  const check = digits.pop()
  let sum = 0
  digits.reverse().forEach((d, i) => (sum += d * (i % 2 === 0 ? 3 : 1)))
  return (10 - (sum % 10)) % 10 === check
}

/** UPC-E (6 cijfers tussen systeemcijfer en controlecijfer) uitklappen naar UPC-A. */
export function upcENaarA(code) {
  const c = String(code)
  if (!/^[01]\d{7}$/.test(c)) return null
  const [s, d1, d2, d3, d4, d5, d6, check] = c.split('')
  let mid
  if ('012'.includes(d6)) mid = `${d1}${d2}${d6}0000${d3}${d4}${d5}`
  else if (d6 === '3') mid = `${d1}${d2}${d3}00000${d4}${d5}`
  else if (d6 === '4') mid = `${d1}${d2}${d3}${d4}00000${d5}`
  else mid = `${d1}${d2}${d3}${d4}${d5}0000${d6}`
  return `${s}${mid}${check}`
}

/**
 * Normaliseert een barcode van de scanner of uit het formulier; null als hij niet klopt.
 * [format] is het formaat dat de scanner meldt ('upc_e' wordt uitgeklapt naar UPC-A).
 */
export function normaliseerBarcode(code, format = '') {
  const c = String(code || '').replace(/\s/g, '')
  const a = upcENaarA(c)
  if (format === 'upc_e' && a && geldigeBarcode(a)) return a
  if (geldigeBarcode(c)) return c
  if (a && geldigeBarcode(a)) return a
  return null
}

/** "20g", "1 portion (330 ml)", "30 g (2 stuks)" -> { g: 20, eenheid: 'g' } of null. */
export function parsePortie(text) {
  const t = String(text || '').toLowerCase()
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(g|gr|gram|ml|cl|l)\b/)
  if (!m) return null
  let g = Number(m[1].replace(',', '.'))
  const u = m[2]
  if (u === 'cl') g *= 10
  if (u === 'l') g *= 1000
  if (!(g > 0) || g > 5000) return null
  return { g, eenheid: ['ml', 'cl', 'l'].includes(u) ? 'ml' : 'g' }
}

/**
 * Een product uit de OFF-API (v2 /product) naar ons formaat. Geeft null als het
 * product niet bestaat of geen naam en geen waarden heeft.
 * Velden per 100 g: energy-kcal_100g, proteins_100g, carbohydrates_100g, fat_100g.
 * Ontbreekt kcal maar staat er kJ (energy-kj_100g of energy_100g), dan rekenen we om.
 */
export function parseOff(json, barcode) {
  if (!json || json.status === 0 || !json.product) return null
  const p = json.product
  const n = p.nutriments || {}
  let kcal = num(n['energy-kcal_100g'])
  if (kcal === null) {
    const kj = num(n['energy-kj_100g']) ?? num(n.energy_100g)
    if (kj !== null) kcal = round(kjNaarKcal(kj), 1)
  }
  const waarden = { kcal, eiwit: num(n.proteins_100g), kh: num(n.carbohydrates_100g), vet: num(n.fat_100g) }
  const naam = String(p.product_name_nl || p.product_name || '').trim()
  if (!naam && MACRO_KEYS.every((k) => waarden[k] === null)) return null
  const portie = parsePortie(p.serving_size)
  const inhoud = parsePortie(p.quantity)
  const eenheid = (portie || inhoud)?.eenheid === 'ml' ? 'ml' : 'g'
  const merk = String(p.brands || '').split(',')[0].trim()
  return {
    id: `off:${barcode || json.code}`,
    naam: naam || 'Onbekend product',
    merk: merk || null,
    per100: waarden,
    eenheid,
    portie: portie ? { g: portie.g, naam: `1 portie (${portie.g} ${eenheid})` } : null,
    bron: 'off',
    barcode: String(barcode || json.code || '') || null,
  }
}

// ---------- Dagboekregels ----------

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const clip = (s, n) => (s === null || s === undefined || s === '' ? null : String(s).slice(0, n))

/**
 * Een dagboekregel opschonen (in de app vóór het versturen en in de Worker bij binnenkomst).
 * Alleen bekende velden blijven over. null als de regel onbruikbaar is.
 * Verwijderd: { id, date, updatedAt, deleted: true } (tombstone).
 */
export function schoonRegel(r) {
  if (!r || typeof r !== 'object') return null
  const id = String(r.id || '')
  const updatedAt = Number(r.updatedAt)
  if (!ID_RE.test(id) || !DATE_RE.test(r.date) || !Number.isFinite(updatedAt) || updatedAt < 0) return null
  if (r.deleted) return { id, date: r.date, updatedAt, deleted: true }
  const grams = num(r.grams)
  if (grams === null || grams <= 0 || grams > 10000) return null
  return {
    id,
    date: r.date,
    time: TIME_RE.test(r.time) ? r.time : '12:00',
    meal: MEALS.includes(r.meal) ? r.meal : 'snack',
    name: clip(r.name, 200) || 'Onbekend product',
    brand: clip(r.brand, 100),
    grams,
    unit: r.unit === 'ml' ? 'ml' : 'g',
    per100: per100(r.per100),
    source: BRONNEN.includes(r.source) ? r.source : 'eigen',
    barcode: r.barcode && BARCODE_RE.test(String(r.barcode)) ? String(r.barcode) : null,
    productId: clip(r.productId, 80),
    updatedAt,
  }
}

/** Welke van twee versies van dezelfde regel wint: de jongste; bij gelijk tijdstip wint verwijderen, dan de tekstvolgorde (zodat elk apparaat hetzelfde kiest). */
export function nieuwste(a, b) {
  if (!a) return b
  if (!b) return a
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b
  if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b
}

/** Twee verzamelingen regels ({ id: regel }) samenvoegen per id. */
export function voegSamen(a = {}, b = {}) {
  const out = { ...a }
  for (const [id, r] of Object.entries(b)) out[id] = nieuwste(out[id], r)
  return out
}

/**
 * Antwoord van de Worker toepassen op wat er lokaal staat.
 * [lokaal]: { id: regel } (lokale regels kunnen `dirty: 1` hebben = nog niet verstuurd).
 * Geeft de regels die lokaal opgeslagen moeten worden (zonder dirty: de Worker heeft
 * dezelfde of een nieuwere versie). Lokale regels die nieuwer zijn dan de Worker
 * blijven staan zoals ze zijn (dirty) en gaan bij de volgende ronde mee.
 */
export function pasToe(lokaal, remote) {
  const opslaan = []
  for (const r of remote) {
    const clean = schoonRegel(r)
    if (!clean) continue
    const l = lokaal[clean.id]
    const lClean = l ? schoonRegel(l) : null
    const wint = lClean ? nieuwste(lClean, clean) : clean
    if (wint === clean || JSON.stringify(wint) === JSON.stringify(clean)) {
      // Remote wint of is gelijk: overnemen (en daarmee is de lokale wijziging aangekomen).
      if (!l || l.dirty || JSON.stringify(lClean) !== JSON.stringify(clean)) opslaan.push(clean)
    }
  }
  return opslaan
}

/** Tijdstempel voor een wijziging: nooit lager dan de vorige versie van dezelfde regel. */
export const volgendeTijd = (vorige, nu = Date.now()) => Math.max(nu, (Number(vorige) || 0) + 1)

/** Maand-sleutel (YYYY-MM) van een datum, voor de opslag in de Worker. */
export const maandVan = (date) => String(date).slice(0, 7)

/** Huidige tijd (HH:mm) in Europe/Amsterdam. */
export function tijdAmsterdam(d = new Date()) {
  const parts = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour').value
  const m = parts.find((p) => p.type === 'minute').value
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/** Datum (YYYY-MM-DD) in Europe/Amsterdam. */
export function datumAmsterdam(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Alle datums van from t/m to (YYYY-MM-DD), op kalenderdagen. */
export function datumsTussen(from, to) {
  const out = []
  const d = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (d <= end && out.length < 400) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** Eén regel in het exportformaat voor Healthbridge (schemaVersion 1). */
export function exportRegel(r) {
  const m = macrosVoor(r.per100, r.grams)
  const out = {
    id: r.id,
    date: r.date,
    time: r.time,
    meal: r.meal,
    name: r.name,
  }
  if (r.brand) out.brand = r.brand
  Object.assign(out, {
    grams: round(r.grams, 1),
    unit: r.unit,
    kcal: round(m.kcal, 1),
    protein_g: round(m.eiwit, 1),
    carbs_g: round(m.kh, 1),
    fat_g: round(m.vet, 1),
    // USDA-basisproducten heten in de export 'usda'; 'nevo' blijft gereserveerd (geen NEVO-data in Tarapp).
    source: r.source,
  })
  if (r.barcode) out.barcode = r.barcode
  return out
}

/**
 * Export voor Healthbridge: per dag van from t/m to de regels (zonder verwijderde),
 * op tijd gesorteerd. Een dag zonder regels staat er met een lege lijst, zodat
 * Healthbridge weet dat die dag leeg is (en niet onbekend).
 */
export function bouwExport({ person, from, to, regels, nu = new Date() }) {
  const days = {}
  for (const d of datumsTussen(from, to)) days[d] = []
  for (const r of regels) {
    if (!r || r.deleted || !days[r.date]) continue
    days[r.date].push(exportRegel(r))
  }
  for (const d of Object.keys(days)) days[d].sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id))
  return { schemaVersion: EXPORT_SCHEMA, person, from, to, generatedAt: nu.toISOString(), days }
}

// ---------- Koppelen en tokens ----------

/** Lange willekeurige code (base64url) met crypto.getRandomValues. */
export function randomToken(bytes = 32, rng = globalThis.crypto) {
  const b = rng.getRandomValues(new Uint8Array(bytes))
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/
export const BOOK_RE = /^[A-Za-z0-9_-]{16,64}$/

/** Deeplink die Healthbridge opent: healthbridge://koppel?url=...&token=...&person=... */
export function koppelLink(workerUrl, readToken, person) {
  const q = new URLSearchParams({ url: workerUrl, token: readToken, person })
  return `healthbridge://koppel?${q.toString()}`
}

/** Leest een koppel-deeplink (gebruikt in de tests als spiegel van de controle in Healthbridge). */
export function leesKoppelLink(link, verwachteHost) {
  let u
  try {
    u = new URL(link)
  } catch {
    return null
  }
  if (u.protocol !== 'healthbridge:' || u.host !== 'koppel') return null
  const url = u.searchParams.get('url') || ''
  const token = u.searchParams.get('token') || ''
  const person = u.searchParams.get('person') || ''
  let w
  try {
    w = new URL(url)
  } catch {
    return null
  }
  if (w.protocol !== 'https:' || w.host !== verwachteHost || w.pathname.replace(/\/$/, '') !== '' || w.search || w.username) return null
  if (!TOKEN_RE.test(token) || !PERSONEN.includes(person)) return null
  return { url: w.origin, token, person }
}

// ---------- Zoeken ----------

const fold = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Producten zoeken op naam en merk: alle woorden moeten voorkomen; begint-met telt zwaarder. */
export function zoek(producten, query, max = 40) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored = []
  for (const p of producten) {
    const hay = fold(`${p.naam} ${p.merk || ''}`)
    if (!words.every((w) => hay.includes(w))) continue
    let score = 0
    if (hay.startsWith(words[0])) score += 10
    if (fold(p.naam) === words.join(' ')) score += 20
    score -= hay.length / 100
    scored.push([score, p])
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map((x) => x[1])
}
