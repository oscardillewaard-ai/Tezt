// De Nederlandse lijst uit Open Food Facts: het omzetscript en het meegeleverde bestand.
// De exportregels hieronder zijn verzonnen; ze bootsen alleen de vorm na.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { KOLOMMEN, leesExport, rijUitExport } from '../../scripts/gen-voeding-off-nl.mjs'

const KOP = ['code', 'product_name', 'brands', 'countries_tags', 'quantity', 'serving_size', 'energy-kcal_100g', 'energy_100g', 'proteins_100g', 'carbohydrates_100g', 'fat_100g', 'fiber_100g']
const ix = Object.fromEntries(KOP.map((h, i) => [h, i]))
const regel = (o) => KOP.map((k) => o[k] ?? '')

test('Nederlands product met alle waarden wordt een compacte rij', () => {
  const r = rijUitExport(regel({ code: '4056489547594', product_name: 'Vlugge  Japie', brands: 'Lidl,Tastino', countries_tags: 'en:germany,en:netherlands', serving_size: '25 g', 'energy-kcal_100g': '305.7', proteins_100g: '3.14', carbohydrates_100g: '69.29', fat_100g: '0.86', fiber_100g: '3' }), ix)
  assert.deepEqual(r, ['4056489547594', 'Vlugge Japie', 'Lidl', 305.7, 3.14, 69.29, 0.86, 3, 0, 25])
  assert.equal(r.length, KOLOMMEN.length)
})

test('alleen kJ: omgerekend; drank in ml; geen vezel = null', () => {
  const r = rijUitExport(regel({ code: '5449000000996', product_name: 'Cola', countries_tags: 'en:netherlands', quantity: '1,5 l', energy_100g: '180', proteins_100g: '0', carbohydrates_100g: '10.6', fat_100g: '0' }), ix)
  assert.deepEqual(r.slice(3), [43, 0, 10.6, 0, null, 1, 0])
})

test('weggelaten: niet Nederlands, geen naam, ontbrekende waarde, onmogelijke waarden, foute barcode', () => {
  const basis = { code: '87157277', product_name: 'Ketchup', countries_tags: 'en:netherlands', 'energy-kcal_100g': '102', proteins_100g: '1.2', carbohydrates_100g: '23.2', fat_100g: '0.1' }
  assert.ok(rijUitExport(regel(basis), ix))
  assert.equal(rijUitExport(regel({ ...basis, countries_tags: 'en:france' }), ix), null)
  assert.equal(rijUitExport(regel({ ...basis, product_name: ' ' }), ix), null)
  assert.equal(rijUitExport(regel({ ...basis, fat_100g: '' }), ix), null)
  assert.equal(rijUitExport(regel({ ...basis, 'energy-kcal_100g': '2252' }), ix), null) // kJ in het kcal-veld
  assert.equal(rijUitExport(regel({ ...basis, carbohydrates_100g: '120' }), ix), null)
  assert.equal(rijUitExport(regel({ ...basis, code: '87157278' }), ix), null) // controlecijfer klopt niet
})

test('leesExport: gzip-stroom, ontdubbeld op barcode, gesorteerd op naam', async () => {
  const p = (code, naam) => regel({ code, product_name: naam, countries_tags: 'en:netherlands', 'energy-kcal_100g': '100', proteins_100g: '1', carbohydrates_100g: '1', fat_100g: '1' }).join('\t')
  const tekst = [KOP.join('\t'), p('87157277', 'Zuurkool'), p('3017620422003', 'Appelstroop'), p('87157277', 'Zuurkool nieuw')].join('\n')
  const { rijen, totaal } = await leesExport(Readable.from(gzipSync(Buffer.from(tekst))))
  assert.equal(totaal, 3)
  assert.deepEqual(rijen.map((r) => r[1]), ['Appelstroop', 'Zuurkool nieuw'])
})

test('off-nl.json (als hij er is): bron, licentie, kolommen en geldige rijen', () => {
  const pad = new URL('../../public/sportagenda/voeding/off-nl.json', import.meta.url)
  if (!existsSync(pad)) return
  const d = JSON.parse(readFileSync(pad, 'utf8'))
  assert.match(d.bron, /Open Food Facts/)
  assert.match(d.licentie, /ODbL/)
  assert.deepEqual(d.kolommen, KOLOMMEN)
  assert.ok(d.producten.length > 10000, `${d.producten.length} producten`)
  const codes = new Set()
  for (const r of d.producten.slice(0, 5000)) {
    assert.equal(r.length, KOLOMMEN.length)
    assert.ok(/^\d{8,14}$/.test(r[0]) && !codes.has(r[0]))
    codes.add(r[0])
    assert.ok(r[1])
    for (const v of r.slice(3, 7)) assert.ok(Number.isFinite(v) && v >= 0)
    assert.ok(r[4] + r[5] + r[6] <= 102)
  }
})
