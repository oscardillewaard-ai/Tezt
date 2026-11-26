// Het exportformaat voor Healthbridge (schemaVersion 1) ligt vast in een snapshot.
// Verandert het formaat, dan faalt deze test: pas dan bewust ook Healthbridge aan
// (healthbridge-data/healthbridge/core/.../TarappExport.kt) en werk de snapshot bij met
//   UPDATE_SNAPSHOT=1 node --test tests/voeding/export.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { bouwExport } from '../../public/sportagenda/voeding/kern.js'

const SNAP = new URL('./__snapshots__/export.json', import.meta.url)

const regels = [
  { id: 'regel-ontbijt-1', date: '2026-11-25', time: '07:41', meal: 'breakfast', name: 'Havermout', grams: 60, unit: 'g', per100: { kcal: 379, eiwit: 13.15, kh: 67.7, vet: 6.52 }, source: 'usda', productId: 'basis:169705:havermout', updatedAt: 1 },
  { id: 'regel-ontbijt-2', date: '2026-11-25', time: '07:41', meal: 'breakfast', name: 'Halfvolle melk', grams: 200, unit: 'ml', per100: { kcal: 50, eiwit: 3.3, kh: 4.8, vet: 1.98 }, source: 'usda', updatedAt: 2 },
  { id: 'regel-lunch-1', date: '2026-11-25', time: '12:30', meal: 'lunch', name: 'Nutella', brand: 'Ferrero', grams: 15, unit: 'g', per100: { kcal: 539, eiwit: 6.3, kh: 57.5, vet: 30.9 }, source: 'off', barcode: '3017620422003', updatedAt: 3 },
  { id: 'regel-snack-1', date: '2026-11-25', time: '15:30', meal: 'snack', name: 'Eigen reep', grams: 40, unit: 'g', per100: { kcal: 400, eiwit: null, kh: 50, vet: 18 }, source: 'eigen', updatedAt: 4 },
  { id: 'regel-weg', date: '2026-11-25', updatedAt: 9, deleted: true },
  { id: 'regel-diner-1', date: '2026-11-26', time: '18:45', meal: 'dinner', name: 'Lasagne', grams: 350, unit: 'g', per100: { kcal: 160, eiwit: 9, kh: 14, vet: 7.5 }, source: 'recept', updatedAt: 5 },
  { id: 'buiten-periode', date: '2026-11-28', time: '10:00', meal: 'snack', name: 'Appel', grams: 180, unit: 'g', per100: { kcal: 52, eiwit: 0.26, kh: 13.81, vet: 0.17 }, source: 'usda', updatedAt: 6 },
]

test('export: snapshot (schemaVersion 1)', () => {
  const out = bouwExport({ person: 'oscar', from: '2026-11-24', to: '2026-11-26', regels, nu: new Date('2026-11-26T10:00:00Z') })
  const text = JSON.stringify(out, null, 2) + '\n'
  if (process.env.UPDATE_SNAPSHOT) writeFileSync(SNAP, text)
  assert.equal(text, readFileSync(SNAP, 'utf8'))
})

test('export: verwijderde regels en dagen buiten de periode komen er niet in; lege dag is een lege lijst', () => {
  const out = bouwExport({ person: 'oscar', from: '2026-11-24', to: '2026-11-26', regels })
  assert.deepEqual(Object.keys(out.days), ['2026-11-24', '2026-11-25', '2026-11-26'])
  assert.deepEqual(out.days['2026-11-24'], [])
  assert.ok(!JSON.stringify(out).includes('regel-weg'))
  assert.ok(!JSON.stringify(out).includes('buiten-periode'))
  const snack = out.days['2026-11-25'].find((r) => r.id === 'regel-snack-1')
  assert.equal(snack.protein_g, null) // onbekend blijft null
  assert.equal(snack.kcal, 160)
  assert.ok(!('brand' in snack) && !('barcode' in snack))
})
