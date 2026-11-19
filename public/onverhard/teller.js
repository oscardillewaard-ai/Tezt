// Lokale teller: wat je in de app doet, alleen in je eigen browser (localStorage), nooit verstuurd.
// Een ringbuffer van hooguit MAX regels {t, ev, d}. Onder [?] "Mijn gebruik" zie je de tellingen,
// kun je alles als JSON kopiëren of wissen. Alles in try/catch: zonder opslag werkt de app gewoon.
export const SLEUTEL = 'nopaves.log'
export const MAX = 500

/** Alle regels (oudste eerst); [] als er niets is of de opslag niet werkt. */
export function lees(opslag = globalThis.localStorage) {
  try {
    const r = JSON.parse(opslag.getItem(SLEUTEL) || '[]')
    return Array.isArray(r) ? r : []
  } catch {
    return []
  }
}

/** Eén gebeurtenis erbij; de oudste valt eraf boven MAX. */
export function log(ev, d = {}, opslag = globalThis.localStorage, nu = Date.now()) {
  try {
    const regels = lees(opslag)
    regels.push({ t: nu, ev, d })
    while (regels.length > MAX) regels.shift()
    opslag.setItem(SLEUTEL, JSON.stringify(regels))
  } catch {
    // opslag vol of uitgezet: dan tellen we niet
  }
}

/** Aantal per gebeurtenis, meeste eerst: [[ev, n], ...]. */
export function tellingen(regels) {
  const n = {}
  for (const r of regels) n[r.ev] = (n[r.ev] || 0) + 1
  return Object.entries(n).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

export function wis(opslag = globalThis.localStorage) {
  try {
    opslag.removeItem(SLEUTEL)
  } catch {
    // niets te wissen
  }
}

/** Hoe de app nu draait: als app op het beginscherm (standalone) of in de browser. */
export function weergave() {
  try {
    if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) return 'standalone'
    if (matchMedia('(display-mode: minimal-ui)').matches) return 'minimal-ui'
  } catch {
    // geen matchMedia
  }
  return 'browser'
}

/** De geolocatie-toestemming ('granted', 'prompt', 'denied' of 'onbekend'), zonder er om te vragen. */
export async function geoToestemming() {
  try {
    if (!navigator.permissions) return 'onbekend'
    return (await navigator.permissions.query({ name: 'geolocation' })).state
  } catch {
    return 'onbekend'
  }
}
