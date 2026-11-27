// Maakt public/sportagenda/voeding/off-nl.json: de producten uit Open Food Facts die in Nederland
// verkocht worden en een naam plus kcal, eiwit, koolhydraten en vet hebben. Zo kan Tarapp er direct
// (en offline) in zoeken en barcodes opzoeken, zonder de zoekdienst van Open Food Facts.
//
// Gebruik:
//   node scripts/gen-voeding-off-nl.mjs                 (downloadt de export, ±1,5 GB, streamend)
//   node scripts/gen-voeding-off-nl.mjs <pad-naar-csv.gz>   (of - voor standaardinvoer)
// Wordt elke maand gedraaid door .github/workflows/voeding-off-nl.yml.
//
// Licentie: de database van Open Food Facts valt onder de Open Database License (ODbL), de inhoud
// onder de Database Contents License (DbCL). Deze afgeleide lijst valt dus ook onder de ODbL; zie
// public/sportagenda/voeding/OFF-NL-LICENTIE.md. Bron: https://world.openfoodfacts.org

import { createReadStream, writeFileSync } from 'node:fs'
import { createGunzip } from 'node:zlib'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { normaliseerBarcode, parsePortie } from '../public/sportagenda/voeding/kern.js'

export const EXPORT_URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz'
export const KOLOMMEN = ['barcode', 'naam', 'merk', 'kcal', 'eiwit', 'kh', 'vet', 'vezel', 'ml', 'portie']

const num = (s) => {
  const t = String(s ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null
}

/**
 * Eén regel uit de OFF-export (tab-gescheiden) naar een rij voor off-nl.json, of null.
 * [ix] is { kolomnaam: index } uit de kopregel.
 */
export function rijUitExport(cells, ix) {
  const g = (k) => (ix[k] === undefined ? '' : cells[ix[k]] ?? '')
  if (!g('countries_tags').includes('en:netherlands')) return null
  const barcode = normaliseerBarcode(g('code'))
  const naam = g('product_name').trim().replace(/\s+/g, ' ').slice(0, 80)
  if (!barcode || !naam) return null
  let kcal = num(g('energy-kcal_100g'))
  if (kcal === null && num(g('energy_100g')) !== null) kcal = Math.round((num(g('energy_100g')) / 4.184) * 10) / 10
  const eiwit = num(g('proteins_100g'))
  const kh = num(g('carbohydrates_100g'))
  const vet = num(g('fat_100g'))
  if ([kcal, eiwit, kh, vet].some((v) => v === null)) return null
  // Onmogelijke waarden weglaten (fout ingevoerd): meer dan 950 kcal of meer dan 102 g macro's per 100 g.
  if (kcal > 950 || eiwit + kh + vet > 102) return null
  const portie = parsePortie(g('serving_size'))
  const inhoud = parsePortie(g('quantity'))
  const ml = (portie || inhoud)?.eenheid === 'ml' ? 1 : 0
  const merk = g('brands').split(',')[0].trim().slice(0, 40)
  return [barcode, naam, merk, kcal, eiwit, kh, vet, num(g('fiber_100g')), ml, portie ? portie.g : 0]
}

/** Leest de export (een stroom gzip-bytes) en geeft de rijen terug, ontdubbeld op barcode. */
export async function leesExport(gzStream) {
  const lines = createInterface({ input: gzStream.pipe(createGunzip()), crlfDelay: Infinity })
  let ix = null
  const rijen = new Map()
  let totaal = 0
  for await (const line of lines) {
    const cells = line.split('\t')
    if (!ix) {
      ix = Object.fromEntries(cells.map((h, i) => [h, i]))
      continue
    }
    totaal++
    const r = rijUitExport(cells, ix)
    if (r) rijen.set(r[0], r)
  }
  return { rijen: [...rijen.values()].sort((a, b) => a[1].localeCompare(b[1], 'nl')), totaal }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bron = process.argv[2]
  let stream
  if (bron === '-') stream = process.stdin // bijv. curl -sL <url> | node scripts/gen-voeding-off-nl.mjs -
  else if (bron) stream = createReadStream(bron)
  else {
    const res = await fetch(EXPORT_URL, { headers: { 'User-Agent': 'Tarapp (https://github.com/oscardillewaard-ai/Tezt)' } })
    if (!res.ok) throw new Error(`Export niet op te halen: ${res.status}`)
    stream = Readable.fromWeb(res.body)
  }
  const { rijen, totaal } = await leesExport(stream)
  if (rijen.length < 10000) throw new Error(`Maar ${rijen.length} producten gevonden; de export lijkt kapot. Niets geschreven.`)
  const data = {
    bron: 'Open Food Facts (https://world.openfoodfacts.org)',
    licentie: 'Open Database License (ODbL) 1.0; inhoud: Database Contents License (DbCL) 1.0. Zie OFF-NL-LICENTIE.md',
    gemaakt: new Date().toISOString().slice(0, 10),
    kolommen: KOLOMMEN,
    producten: rijen,
  }
  writeFileSync(new URL('../public/sportagenda/voeding/off-nl.json', import.meta.url), JSON.stringify(data))
  console.log(`${rijen.length} Nederlandse producten (van ${totaal}) geschreven naar public/sportagenda/voeding/off-nl.json`)
}
