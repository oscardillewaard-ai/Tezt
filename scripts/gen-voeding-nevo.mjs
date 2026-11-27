// Maakt public/sportagenda/voeding/nevo.js uit het NEVO-online databestand (RIVM).
//
// Gebruik:
//   1. Download het databestand (CSV) via https://www.rivm.nl/form/nevo-online-gegevensbestand-2
//      (daar ga je akkoord met de voorwaarden van RIVM).
//   2. node scripts/gen-voeding-nevo.mjs <pad-naar-NEVO-csv> [versie, bijv. 2025/9.0]
//
// Voorwaarden van RIVM (NEVO-online 2025/9.0) waar dit script zich aan houdt:
// - Alleen in ongewijzigde vorm: naam en waarden worden overgenomen zoals ze in het bestand
//   staan (geen afronding, geen eigen correcties). Er wordt alleen een selectie van kolommen
//   gemaakt: kcal, eiwit, koolhydraten, vet en vezel (FIBT).
// - Altijd met bron en versienummer: "NEVO-online versie <versie>, RIVM, Bilthoven" (staat in het
//   bestand en in de app).
// - Aanvullingen (onze USDA-basisproducten) staan apart en zijn in de app als zodanig herkenbaar.
// - Bij een nieuwe NEVO-versie: dit script opnieuw draaien en de oude versie vervangen.

import { readFileSync, writeFileSync } from 'node:fs'

export function leesNevo(text) {
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('Leeg bestand')
  // Scheidingsteken: het teken dat in de kopregel het vaakst voorkomt.
  const head = lines[0]
  const sep = ['|', ';', '\t', ','].map((s) => [s, head.split(s).length]).sort((a, b) => b[1] - a[1])[0][0]
  const split = (line) => {
    const out = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) {
        if (c === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (c === '"' && (i + 1 === line.length || line[i + 1] === sep)) q = false
        else cur += c
      } else if (c === '"' && cur === '') q = true
      else if (c === sep) {
        out.push(cur)
        cur = ''
      } else cur += c
    }
    out.push(cur)
    // Niet trimmen: namen gaan letterlijk mee (ook een spatie aan het eind); getallen en codes worden hieronder apart gelezen.
    return out
  }
  const cols = split(head).map((h) => h.trim().toLowerCase())
  const find = (...names) => {
    for (const n of names) {
      const i = cols.findIndex((c) => c === n.toLowerCase())
      if (i >= 0) return i
    }
    // NEVO-componentcode vóór de eenheid, bijv. "PROT (g)" -> "prot" (niet "PROTPL (g)").
    for (const n of names) {
      const i = cols.findIndex((c) => c.split(/\s+/)[0] === n.toLowerCase())
      if (i >= 0) return i
    }
    for (const n of names) {
      const i = cols.findIndex((c) => c.includes(n.toLowerCase()))
      if (i >= 0) return i
    }
    return -1
  }
  const idx = {
    code: find('nevo-code', 'nevo_code', 'nevocode'),
    naam: find('voedingsmiddelnaam/dutch food name', 'voedingsmiddelnaam'),
    groep: find('voedingsmiddelgroep'),
    hoeveelheid: find('hoeveelheid/quantity', 'hoeveelheid'),
    kcal: find('enercc', 'energie (kcal)', 'kcal'),
    eiwit: find('prot', 'eiwit'),
    kh: find('cho', 'koolhydraten'),
    vet: find('fat', 'vet'),
    vezel: find('fibt', 'voedingsvezel', 'vezel'),
  }
  const missing = Object.entries(idx).filter(([k, v]) => v < 0 && !['groep', 'hoeveelheid', 'vezel'].includes(k)).map(([k]) => k)
  if (missing.length) throw new Error(`Kolommen niet gevonden: ${missing.join(', ')}. Kopregel: ${head.slice(0, 300)}`)
  // Waarden ongewijzigd overnemen; alleen de schrijfwijze (komma als decimaalteken) wordt een getal.
  const getal = (s) => {
    const t = String(s ?? '').trim()
    if (!t) return null
    const n = Number(t.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  const out = []
  for (const line of lines.slice(1)) {
    const c = split(line)
    const raw = String(c[idx.code] ?? '').trim()
    const code = /^\d+$/.test(raw) ? Number(raw) : NaN
    const naam = c[idx.naam]
    if (!(code > 0) || !naam || !naam.trim()) continue
    const h = idx.hoeveelheid >= 0 ? String(c[idx.hoeveelheid]).toLowerCase() : ''
    out.push({
      code,
      naam,
      groep: idx.groep >= 0 ? c[idx.groep].trim() || null : null,
      eenheid: h.includes('ml') ? 'ml' : 'g',
      kcal: getal(c[idx.kcal]),
      eiwit: getal(c[idx.eiwit]),
      kh: getal(c[idx.kh]),
      vet: getal(c[idx.vet]),
      vezel: idx.vezel >= 0 ? getal(c[idx.vezel]) : null,
    })
  }
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [file, versie = '2025/9.0'] = process.argv.slice(2)
  if (!file) {
    console.error('Gebruik: node scripts/gen-voeding-nevo.mjs <NEVO-csv> [versie]')
    process.exit(1)
  }
  // NEVO-bestanden zijn soms in Windows-1252; probeer eerst UTF-8.
  const buf = readFileSync(file)
  let text = buf.toString('utf8')
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf)
  const rows = leesNevo(text)
  const bron = `NEVO-online versie ${versie}, RIVM, Bilthoven`
  const body = `// Gegenereerd door scripts/gen-voeding-nevo.mjs, niet met de hand aanpassen.
// ${bron}.
// Ongewijzigd overgenomen uit het NEVO-online databestand (alleen de kolommen kcal, eiwit,
// koolhydraten, vet en vezel). Waarden per 100 g (of 100 ml, zie eenheid).
export const NEVO_VERSIE = ${JSON.stringify(versie)}
export const NEVO_BRON = ${JSON.stringify(bron)}
export const NEVO = [
${rows.map((r) => '  ' + JSON.stringify(r)).join(',\n')},
]
`
  writeFileSync(new URL('../public/sportagenda/voeding/nevo.js', import.meta.url), body)
  console.log(`${rows.length} NEVO-producten geschreven naar public/sportagenda/voeding/nevo.js (${bron})`)
}
