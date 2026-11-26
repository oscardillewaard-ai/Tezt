// Samenvoegen tussen twee apparaten van dezelfde persoon, via de echte Worker-code.
// Elk apparaat is hier een eenvoudige verzameling regels; de stappen zijn dezelfde
// als in sync.js: dirty regels sturen (PUT), stand ophalen, pasToe() toepassen.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pasToe, randomToken, volgendeTijd } from '../../public/sportagenda/voeding/kern.js'
import { call, workerFetch } from './helpers.mjs'

async function opzet() {
  const f = workerFetch()
  const book = randomToken(18)
  const writeToken = randomToken(32)
  await call(f, '/voeding/register', { method: 'POST', body: { book, writeToken, person: 'oscar', forward: true } })
  return { f, book, writeToken }
}

function apparaat() {
  return { regels: {} }
}

async function sync(dev, { f, book, writeToken }) {
  const dirty = Object.values(dev.regels).filter((r) => r.dirty).map(({ dirty: _dirty, ...r }) => r)
  const remote = []
  if (dirty.length) {
    const r = await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: dirty } })
    for (const l of Object.values(r.body.months)) remote.push(...l)
  }
  const g = await call(f, `/voeding/book/${book}?months=2026-11`, { token: writeToken })
  remote.push(...g.body.months['2026-11'])
  for (const r of pasToe(dev.regels, remote)) dev.regels[r.id] = r
}

const basis = { date: '2026-11-26', time: '08:00', meal: 'breakfast', name: 'Havermout', unit: 'g', per100: { kcal: 379, eiwit: 13, kh: 68, vet: 6.5 }, source: 'usda' }

function bewerk(dev, id, velden, nu) {
  const vorige = dev.regels[id]
  dev.regels[id] = { ...basis, ...vorige, ...velden, id, updatedAt: volgendeTijd(vorige?.updatedAt, nu), dirty: 1 }
}

function verwijder(dev, id, nu) {
  const vorige = dev.regels[id]
  dev.regels[id] = { id, date: vorige.date, updatedAt: volgendeTijd(vorige.updatedAt, nu), deleted: true, dirty: 1 }
}

test('gelijktijdig bewerken op twee apparaten: de laatste wijziging wint, overal hetzelfde', async () => {
  const srv = await opzet()
  const a = apparaat()
  const b = apparaat()
  bewerk(a, 'regel0001', { grams: 50 }, 1000)
  await sync(a, srv)
  await sync(b, srv)
  assert.equal(b.regels.regel0001.grams, 50)
  // Beide offline aan dezelfde regel gewerkt; B iets later.
  bewerk(a, 'regel0001', { grams: 60 }, 2000)
  bewerk(b, 'regel0001', { grams: 80 }, 2001)
  await sync(a, srv)
  await sync(b, srv)
  await sync(a, srv)
  assert.equal(a.regels.regel0001.grams, 80)
  assert.equal(b.regels.regel0001.grams, 80)
  assert.ok(!a.regels.regel0001.dirty && !b.regels.regel0001.dirty, 'alles is aangekomen')
})

test('gelijktijdig: verschillende regels gaan allebei mee', async () => {
  const srv = await opzet()
  const a = apparaat()
  const b = apparaat()
  bewerk(a, 'regelA001', { grams: 40, name: 'Appel' }, 1000)
  bewerk(b, 'regelB001', { grams: 30, name: 'Banaan' }, 1000)
  await Promise.all([sync(a, srv), sync(b, srv)])
  await sync(a, srv)
  await sync(b, srv)
  assert.deepEqual(Object.keys(a.regels).sort(), ['regelA001', 'regelB001'])
  assert.deepEqual(Object.keys(b.regels).sort(), ['regelA001', 'regelB001'])
})

test('verwijderen na bewerken: de verwijdering wint als hij later is', async () => {
  const srv = await opzet()
  const a = apparaat()
  const b = apparaat()
  bewerk(a, 'regel0002', { grams: 100 }, 1000)
  await sync(a, srv)
  await sync(b, srv)
  bewerk(a, 'regel0002', { grams: 120 }, 2000) // A past aan
  verwijder(b, 'regel0002', 3000) // B verwijdert daarna
  await sync(a, srv)
  await sync(b, srv)
  await sync(a, srv)
  assert.equal(a.regels.regel0002.deleted, true)
  assert.equal(b.regels.regel0002.deleted, true)
  const exp = await call(srv.f, '/voeding/book/' + srv.book + '?months=2026-11', { token: srv.writeToken })
  assert.equal(exp.body.months['2026-11'][0].deleted, true)
})

test('bewerken na verwijderen (op een ander apparaat, later): de bewerking wint', async () => {
  const srv = await opzet()
  const a = apparaat()
  const b = apparaat()
  bewerk(a, 'regel0003', { grams: 100 }, 1000)
  await sync(a, srv)
  await sync(b, srv)
  verwijder(a, 'regel0003', 2000)
  bewerk(b, 'regel0003', { grams: 150 }, 2500)
  await sync(a, srv)
  await sync(b, srv)
  await sync(a, srv)
  assert.equal(a.regels.regel0003.grams, 150)
  assert.ok(!a.regels.regel0003.deleted)
})

test('gelijk tijdstip: verwijderen wint (zelfde keuze op elk apparaat)', async () => {
  const srv = await opzet()
  const a = apparaat()
  const b = apparaat()
  bewerk(a, 'regel0004', { grams: 100 }, 1000)
  await sync(a, srv)
  await sync(b, srv)
  const t = a.regels.regel0004.updatedAt + 10
  a.regels.regel0004 = { ...a.regels.regel0004, grams: 111, updatedAt: t, dirty: 1 }
  b.regels.regel0004 = { id: 'regel0004', date: '2026-11-26', updatedAt: t, deleted: true, dirty: 1 }
  await sync(a, srv)
  await sync(b, srv)
  await sync(a, srv)
  assert.equal(a.regels.regel0004.deleted, true)
  assert.equal(b.regels.regel0004.deleted, true)
})

test('een lokale wijziging tijdens het synchroniseren blijft staan (en dirty)', async () => {
  const srv = await opzet()
  const a = apparaat()
  bewerk(a, 'regel0005', { grams: 10 }, 1000)
  await sync(a, srv)
  // Antwoord van de Worker komt binnen met de oude versie, terwijl de gebruiker net 20 typte.
  bewerk(a, 'regel0005', { grams: 20 }, 5000)
  const g = await call(srv.f, `/voeding/book/${srv.book}?months=2026-11`, { token: srv.writeToken })
  const opslaan = pasToe(a.regels, g.body.months['2026-11'])
  assert.deepEqual(opslaan, [])
  assert.equal(a.regels.regel0005.grams, 20)
  assert.equal(a.regels.regel0005.dirty, 1)
})
