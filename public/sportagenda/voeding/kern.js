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
// Vezel wordt bijgehouden en getoond, maar heeft geen dagdoel.
export const MACRO_KEYS = ['kcal', 'eiwit', 'kh', 'vet', 'vezel']

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

/** Per-100-waarden opschonen: altijd alle sleutels (kcal, eiwit, kh, vet, vezel), onbekend = null. */
export function per100(p = {}) {
  return { kcal: num(p.kcal), eiwit: num(p.eiwit), kh: num(p.kh), vet: num(p.vet), vezel: num(p.vezel) }
}

/** Macro's voor een hoeveelheid in gram (of ml). */
export function macrosVoor(p100, gram) {
  const g = num(gram)
  const p = per100(p100)
  const f = (v) => (v === null || g === null ? null : (v * g) / 100)
  return { kcal: f(p.kcal), eiwit: f(p.eiwit), kh: f(p.kh), vet: f(p.vet), vezel: f(p.vezel) }
}

/** Optellen; een som is null als geen enkele regel die waarde had. */
export function somMacros(lijst) {
  const out = { kcal: null, eiwit: null, kh: null, vet: null, vezel: null }
  for (const m of lijst) {
    for (const k of MACRO_KEYS) if (m[k] !== null && m[k] !== undefined) out[k] = (out[k] || 0) + m[k]
  }
  return out
}

// ---------- Doelen ----------

/** kcal per gram: eiwit en koolhydraten 4, vet 9 (de gangbare vuistregel). */
export const KCAL_PER_G = { eiwit: 4, kh: 4, vet: 9 }

/** Hoeveel kcal de macrodoelen samen zijn. */
export function macroKcal(d = {}) {
  return ['eiwit', 'kh', 'vet'].reduce((s, k) => s + (num(d[k]) || 0) * KCAL_PER_G[k], 0)
}

/**
 * Controle van de dagdoelen: de macro's mogen samen niet meer kcal geven dan het kcal-doel
 * (5 kcal speling voor afronding). Geeft null als het klopt, anders een uitleg.
 */
export function controleerDoelen(d) {
  const kcal = num(d?.kcal)
  if (kcal === null) return null
  const m = Math.round(macroKcal(d))
  if (m <= kcal + 5) return null
  return `Je macro's zijn samen ${m.toLocaleString('nl-NL')} kcal, meer dan je doel van ${kcal.toLocaleString('nl-NL')} kcal. Haal ${(m - kcal).toLocaleString('nl-NL')} kcal weg bij eiwit, koolhydraten of vet.`
}

/** Verdeling in procenten (samen 100) naar grammen, naar beneden afgerond: zo komt het nooit boven het kcal-doel. */
export function gramVanProcent(kcal, pct) {
  const k = num(kcal)
  const g = (key) => (k === null || num(pct?.[key]) === null ? null : Math.floor((k * num(pct[key])) / 100 / KCAL_PER_G[key] + 1e-9))
  return { kcal: k, eiwit: g('eiwit'), kh: g('kh'), vet: g('vet') }
}

/** Grammen naar procenten van het kcal-doel (voor oudere instellingen zonder procenten). */
export function procentVanGram(d) {
  const k = num(d?.kcal)
  const p = (key) => (!k || num(d[key]) === null ? null : Math.round(((num(d[key]) * KCAL_PER_G[key]) / k) * 100))
  return { eiwit: p('eiwit'), kh: p('kh'), vet: p('vet') }
}

/** De procenten moeten samen 100 zijn. Geeft null als het klopt, anders een uitleg. */
export function controleerProcenten(pct) {
  const vals = ['eiwit', 'kh', 'vet'].map((k) => num(pct?.[k]))
  if (vals.some((v) => v === null)) return 'Vul voor eiwit, koolhydraten en vet een percentage in.'
  const som = Math.round(vals.reduce((a, b) => a + b, 0) * 10) / 10
  if (Math.abs(som - 100) > 0.5) return `Samen is het ${som.toLocaleString('nl-NL')}%; dat moet 100% zijn (${som > 100 ? `${(som - 100).toLocaleString('nl-NL')}% te veel` : `nog ${(100 - som).toLocaleString('nl-NL')}%`}).`
  return null
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
  const totaal = { kcal: 0, eiwit: 0, kh: 0, vet: 0, vezel: 0 }
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
  const waarden = { kcal, eiwit: num(n.proteins_100g), kh: num(n.carbohydrates_100g), vet: num(n.fat_100g), vezel: num(n.fiber_100g) }
  const naam = String(p.product_name_nl || p.product_name || '').trim()
  if (!naam && ['kcal', 'eiwit', 'kh', 'vet'].every((k) => waarden[k] === null)) return null
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

// ---------- Etiket lezen (tekst uit OCR) ----------

/** Typische OCR-fouten in getallen herstellen: O/o → 0, l/I/| → 1, spaties in getallen. */
function herstelGetallen(t) {
  return t
    .replace(/(?<=[\d,.])[oO](?=[\d,.\s%gG]|$)|(?<=^|[\s:(<])[oO](?=[,.]\d)/gm, '0')
    // "Eiwitten Og", "VetOg": een losse O vlak voor de g is een nul (hoofdletter O na een woord: "VetOg").
    .replace(/(?<=[\s:(<])[oO](?=\s*g\b)|(?<=[a-z])O(?=\s*g\b)/g, '0')
    .replace(/(?<=\d)[lI|](?=[\d,.])|(?<=[\s:(])[lI|](?=\d)/g, '1')
    .replace(/(\d)\s+([,.])\s*(\d)/g, '$1$2$3')
    .replace(/(\d)\s*,\s*(\d)/g, '$1,$2')
}

const ETIKET = {
  // (?![a-z]) in plaats van \b, zodat "vet0g" (zonder spatie, zoals OCR het soms leest) ook werkt.
  vet: /^(totaal\s*)?(vetten|vet|fats|fat|matières grasses|fett)(?![a-z])/,
  kh: /^(koolhydraten|koolhydraat|carbohydrates?|glucides|kohlenhydrate)(?![a-z])/,
  eiwit: /^(eiwitten|eiwit|proteins?|protéines|eiweiß|eiweiss)(?![a-z])/,
  vezel: /^(voedingsvezels?|vezels?|fibres?|fibers?|dietary fib(re|er)|ballaststoffe)(?![a-z])/,
}
const WAARVAN = /waarvan|verzadig|onverzadig|suikers?\b|sugars?\b|saturat|of which|dont|davon|polyol|zetmeel|starch/

/**
 * Mogelijke waarden voor het eerste getal na een label. OCR leest de "g" vaak als "9" en laat soms de
 * komma vallen ("13 g" -> "139", "7,0 g" -> "7,09" of "709"). Zonder "g" erachter proberen we daarom ook
 * de varianten zonder die 9 en met de komma terug. `edits` telt hoeveel we moesten aannemen.
 */
function kandidaten(rest) {
  const m = rest.match(/<?\s*(\d+(?:[.,]\d+)?)(\s*)(mg|g|gr|gram)?\b/)
  if (!m) return []
  const raw = m[1]
  const vast = m[2] === '' // getal en eenheid aan elkaar, zoals OCR het leest als de komma wegvalt
  m[2] = m[3]
  const getal = (x) => Number(x.replace(',', '.'))
  if (m[2]) {
    const v = getal(raw) / (m[2] === 'mg' ? 1000 : 1)
    const out = v <= 100 ? [{ v, edits: 0, raw }] : []
    // "9,4 g" kan als "94g" binnenkomen (komma weg): ook die lezing meenemen, met meer aannames.
    if (m[2] !== 'mg' && vast && /^\d{2,3}$/.test(raw)) out.push({ v: getal(`${raw.slice(0, -1)}.${raw.slice(-1)}`), edits: 4, raw: `${raw.slice(0, -1)},${raw.slice(-1)}` })
    return out
  }
  const out = [{ v: getal(raw), edits: 0, raw }]
  if (raw.length > 1 && raw.endsWith('9')) {
    const zonder = raw.slice(0, -1).replace(/[.,]$/, '')
    if (zonder) {
      out.push({ v: getal(zonder), edits: 1, raw: zonder })
      if (!/[.,]/.test(zonder) && zonder.length >= 2) out.push({ v: getal(`${zonder.slice(0, -1)}.${zonder.slice(-1)}`), edits: 2, raw: `${zonder.slice(0, -1)},${zonder.slice(-1)}` })
    }
  }
  return out.filter((c) => Number.isFinite(c.v) && c.v >= 0 && c.v <= 100)
}

/** Etiketten ronden af: vanaf 10 g een heel getal, daaronder hooguit één decimaal. Anders: verdacht. */
function afrondStraf(c) {
  const dec = (c.raw.split(/[.,]/)[1] || '').length
  return (c.v >= 10 && dec > 0) || dec > 1 ? 1 : 0
}

/** Beste combinatie van kandidaten: past het best bij de kcal (4/4/9), met zo min mogelijk aannames. */
function kiesWaarden(cands, kcal) {
  const keys = ['eiwit', 'kh', 'vet']
  const opties = keys.map((k) => (cands[k].length ? cands[k] : [null]))
  let best = null
  for (const e of opties[0])
    for (const k of opties[1])
      for (const v of opties[2]) {
        const set = [e, k, v]
        let kosten = set.reduce((s, c) => s + (c ? c.edits * 0.03 + afrondStraf(c) * 0.15 : 0), 0)
        if (kcal && set.every(Boolean)) kosten += Math.abs(4 * e.v + 4 * k.v + 9 * v.v - kcal) / kcal
        // Meer dan 100 g macro's in 100 g product kan niet (2 g speling voor afronding op het etiket).
        if (set.reduce((s, c) => s + (c ? c.v : 0), 0) > 102) kosten += 10
        if (!best || kosten < best.kosten - 1e-9) best = { kosten, set }
      }
  return Object.fromEntries(keys.map((key, i) => [key, best.set[i] ? best.set[i].v : null]))
}

/**
 * Leest kcal, eiwit, koolhydraten en vet per 100 g (of 100 ml) uit de tekst van een voedingsetiket.
 * Werkt met Nederlandse (en Engelse, Franse, Duitse) etiketten. Wat niet gevonden wordt, blijft null.
 * `controle` vergelijkt kcal met 4/4/9 × de macro's: false betekent "goed nakijken".
 */
export function parseEtiket(tekst) {
  const t = herstelGetallen(String(tekst || '')).replace(/\r/g, '')
  const lines = t.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean)
  const flat = lines.join(' ')
  const out = { kcal: null, eiwit: null, kh: null, vet: null, vezel: null, eenheid: /per\s*100\s*m[l1i!|](?![a-z])/.test(flat) ? 'ml' : 'g', portie: null, controle: null }
  // Energie: eerst een getal vóór "kcal"; anders kJ omrekenen.
  const kcal = flat.match(/(\d+(?:[.,]\d+)?)\s*k\s*ca[l1i]/)
  if (kcal) out.kcal = Number(kcal[1].replace(',', '.'))
  else {
    const kj = flat.match(/(\d+(?:[.,]\d+)?)\s*k\s*j\b/)
    if (kj) out.kcal = round(kjNaarKcal(Number(kj[1].replace(',', '.'))), 0)
  }
  if (out.kcal !== null && (out.kcal < 0 || out.kcal > 950)) out.kcal = null
  const cands = { eiwit: [], kh: [], vet: [], vezel: [] }
  const gezien = new Set()
  for (const line of lines) {
    if (WAARVAN.test(line)) continue
    for (const [key, re] of Object.entries(ETIKET)) {
      if (gezien.has(key)) continue
      const m = line.match(re)
      if (m) {
        gezien.add(key)
        cands[key] = kandidaten(line.slice(m[0].length))
      }
    }
  }
  Object.assign(out, kiesWaarden(cands, out.kcal))
  // Vezel telt niet mee in de kcal-controle: de lezing met de minste aannames.
  const macroG = (out.eiwit || 0) + (out.kh || 0) + (out.vet || 0)
  const vz = cands.vezel
    .filter((c) => macroG + c.v <= 102)
    .sort((a, b) => a.edits + afrondStraf(a) * 5 - (b.edits + afrondStraf(b) * 5))[0]
  out.vezel = vz ? vz.v : null
  const p =
    flat.match(/(?:per\s*)?portie\s*\(?\s*(?:van\s*)?(\d+(?:[.,]\d+)?)\s*(g|ml|9(?=\s*\)))/) ||
    flat.match(/(?:per\s*)?(?:serving|portion)\s*\(?\s*(\d+(?:[.,]\d+)?)\s*(g|ml|9(?=\s*\)))/)
  if (p) out.portie = Number(p[1].replace(',', '.'))
  if ([out.kcal, out.eiwit, out.kh, out.vet].every((v) => v !== null)) {
    const schat = 4 * out.eiwit + 4 * out.kh + 9 * out.vet
    out.controle = Math.abs(schat - out.kcal) <= Math.max(25, 0.2 * out.kcal)
  }
  return out
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
    // Eigen eetmoment (bijv. 'Na de training'); 'meal' is de soort die Healthbridge krijgt.
    moment: /^[A-Za-z0-9_-]{1,40}$/.test(r.moment || '') ? r.moment : null,
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
    fiber_g: round(m.vezel, 1),
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

export const fold = (s) =>
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
    // _hay: vooraf genormaliseerde naam+merk (voor grote lijsten zoals off-nl.json)
    const hay = p._hay ?? fold(`${p.naam} ${p.merk || ''}`)
    if (!words.every((w) => hay.includes(w))) continue
    let score = 0
    if (hay.startsWith(words[0])) score += 10
    if ((p._naam ?? fold(p.naam)) === words.join(' ')) score += 20
    score -= hay.length / 100
    scored.push([score, p])
  }
  return scored
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map((x) => x[1])
}
