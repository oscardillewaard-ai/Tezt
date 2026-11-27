// Voeding: eigen opslag, los van de rest van Tarapp.
// - IndexedDB-database "tarapp-voeding": producten (eigen, recepten, gescande OFF-producten)
//   en het dagboek. De databaseversie is het schema; MIGRATIES zet oudere versies om.
// - localStorage alleen onder sleutels met het voorvoegsel "voeding.". Bestaande
//   Tarapp-sleutels (sportagenda.v1) worden nooit gelezen of aangepast.

import { MEALS, SCHEMA_VERSIE, PERSONEN, procentVanGram } from './kern.js'

export const DB_NAAM = 'tarapp-voeding'
export const LS = {
  instellingen: 'voeding.instellingen', // persoon, doelen, doorsturen, vaste items, favorieten (gaat mee in de back-up)
  sync: 'voeding.sync', // dagboek-id en tokens voor de Worker (niet in de back-up)
  tonen: 'voeding.tonen', // "Voeding tonen" ('0' = uit); gelezen door app.js zonder deze module te laden
}

// Per databaseversie wat er bij een upgrade moet gebeuren. Nooit een bestaande stap
// aanpassen: voeg een nieuwe toe en hoog SCHEMA_VERSIE (kern.js) op.
const MIGRATIES = {
  1: (db) => {
    const p = db.createObjectStore('producten', { keyPath: 'id' })
    p.createIndex('barcode', 'barcode', { unique: false })
    const d = db.createObjectStore('dagboek', { keyPath: 'id' })
    d.createIndex('date', 'date', { unique: false })
    d.createIndex('dirty', 'dirty', { unique: false })
  },
}

let dbPromise = null

export function openDb(idb = globalThis.indexedDB) {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (!idb) return reject(new Error('Geen IndexedDB in deze browser'))
    const req = idb.open(DB_NAAM, SCHEMA_VERSIE)
    req.onupgradeneeded = (e) => {
      for (let v = e.oldVersion + 1; v <= SCHEMA_VERSIE; v++) MIGRATIES[v]?.(req.result, req.transaction)
    }
    req.onsuccess = () => {
      const db = req.result
      // Een nieuwere Tarapp in een ander tabblad wil upgraden: netjes loslaten.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
    req.onblocked = () => reject(new Error('Voeding-opslag is bezet door een ander venster'))
  })
  return dbPromise
}

const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

async function store(name, mode = 'readonly') {
  const db = await openDb()
  return db.transaction(name, mode).objectStore(name)
}

export async function alle(name) {
  return done((await store(name)).getAll())
}

export async function haal(name, id) {
  return done((await store(name)).get(id))
}

// Producten en instellingen gaan mee met het account (account/account.js): laat weten dat er iets veranderde.
// Het dagboek niet: dat synchroniseert al zelf via de Worker.
const meld = (name) => name !== 'dagboek' && globalThis.dispatchEvent?.(new Event('tarapp:opgeslagen'))

export async function zet(name, value) {
  const r = await done((await store(name, 'readwrite')).put(value))
  meld(name)
  return r
}

export async function zetVeel(name, values) {
  if (!values.length) return
  const db = await openDb()
  const tx = db.transaction(name, 'readwrite')
  const s = tx.objectStore(name)
  for (const v of values) s.put(v)
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      meld(name)
      resolve()
    }
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function wis(name, id) {
  const r = await done((await store(name, 'readwrite')).delete(id))
  meld(name)
  return r
}

export async function wisAlles() {
  const db = await openDb()
  const tx = db.transaction(['producten', 'dagboek'], 'readwrite')
  tx.objectStore('producten').clear()
  tx.objectStore('dagboek').clear()
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function regelsVanDag(date) {
  return done((await store('dagboek')).index('date').getAll(date))
}

export async function productOpBarcode(barcode) {
  const list = await done((await store('producten')).index('barcode').getAll(barcode))
  // Eigen product gaat voor een opgeslagen OFF-product.
  return list.find((p) => p.bron === 'eigen') || list[0] || null
}

// ---------- localStorage (alleen voeding.*) ----------

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const standaardMomenten = () => [
  { id: 'breakfast', naam: 'Ontbijt', soort: 'breakfast' },
  { id: 'lunch', naam: 'Lunch', soort: 'lunch' },
  { id: 'dinner', naam: 'Diner', soort: 'dinner' },
  { id: 'snack', naam: 'Snack', soort: 'snack' },
]

/** Eetmomenten opschonen: geldige id, naam en soort; minstens één. */
export function schoonMomenten(lijst) {
  const ids = new Set()
  const out = (Array.isArray(lijst) ? lijst : [])
    .map((m) => ({ id: String(m?.id || ''), naam: String(m?.naam || '').trim().slice(0, 40), soort: MEALS.includes(m?.soort) ? m.soort : 'snack' }))
    .filter((m) => /^[A-Za-z0-9_-]{1,40}$/.test(m.id) && m.naam && !ids.has(m.id) && ids.add(m.id))
  return out.length ? out : standaardMomenten()
}

export function standaardInstellingen() {
  return {
    schema: SCHEMA_VERSIE,
    persoon: null, // 'oscar' | 'tara'; gevraagd bij de eerste keer openen
    doorsturen: null, // null = volgt de persoon (Oscar aan, Tara uit)
    // 25% eiwit, 45% koolhydraten, 30% vet van 2000 kcal (4/4/9).
    doelen: { kcal: 2000, eiwit: 125, kh: 225, vet: 66 },
    doelenPct: { eiwit: 25, kh: 45, vet: 30 },
    // Eetmomenten: naam en volgorde zelf te kiezen; 'soort' is wat Healthbridge te zien krijgt.
    momenten: standaardMomenten(),
    vasteItems: [], // [{ productId, naam, grams, meal (= eetmoment-id) }]
    weergave: { ingeklapt: [], macros: [] }, // per eetmoment: ingeklapt, en of de macro's getoond worden
    favorieten: [], // product-id's
  }
}

/** Instellingen van een oudere schemaversie omzetten. */
export function migreerInstellingen(s) {
  const d = standaardInstellingen()
  if (!s || typeof s !== 'object') return d
  const out = { ...d, ...s, doelen: { ...d.doelen, ...(s.doelen || {}) } }
  if (!PERSONEN.includes(out.persoon)) out.persoon = null
  if (!Array.isArray(out.vasteItems)) out.vasteItems = []
  if (!Array.isArray(out.favorieten)) out.favorieten = []
  out.momenten = schoonMomenten(s.momenten)
  const w = s.weergave && typeof s.weergave === 'object' ? s.weergave : {}
  out.weergave = { ingeklapt: Array.isArray(w.ingeklapt) ? w.ingeklapt.map(String) : [], macros: Array.isArray(w.macros) ? w.macros.map(String) : [] }
  // De eerste standaarddoelen kwamen samen boven 2000 kcal uit: nooit aangepast = de nieuwe standaard.
  const o = out.doelen
  if (o.kcal === 2000 && o.eiwit === 120 && [220, 230].includes(o.kh) && o.vet === 70) {
    out.doelen = { ...d.doelen }
    out.doelenPct = { ...d.doelenPct }
  }
  // Doelen van vóór de procenten: verdeling afleiden uit de grammen.
  if (!s.doelenPct || typeof s.doelenPct !== 'object') out.doelenPct = procentVanGram(out.doelen)
  // (schema 1 is de eerste versie; volgende versies krijgen hier hun eigen stap)
  out.schema = SCHEMA_VERSIE
  return out
}

export const leesInstellingen = () => migreerInstellingen(lsGet(LS.instellingen, null))
export const bewaarInstellingen = (s) => {
  lsSet(LS.instellingen, s)
  meld('instellingen')
}
export const leesSync = () => lsGet(LS.sync, null)
export const bewaarSync = (s) => lsSet(LS.sync, s)
export const doorsturenAan = (s) => (s.doorsturen === null ? s.persoon === 'oscar' : !!s.doorsturen)
