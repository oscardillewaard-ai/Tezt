// Voeding-instellingen: migratie van oudere versies.
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('weergave.resterend: standaard uit, alleen echt true telt', async () => {
  const { migreerInstellingen } = await import('../../public/sportagenda/voeding/opslag.js')
  assert.equal(migreerInstellingen(null).weergave.resterend, false)
  assert.equal(migreerInstellingen({ weergave: { resterend: 'ja' } }).weergave.resterend, false)
  assert.equal(migreerInstellingen({ weergave: { resterend: true } }).weergave.resterend, true)
})
