// Account-sync: records, wijzigingen, samenvoegen op de server en toepassen op twee apparaten.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heeftGegevens, naarRecords, pasRemoteToe, sinds, uitRecords, voegSamenOpServer, wijzigingen } from '../../public/sportagenda/account/kern.js'

const state = () => ({
  version: 1,
  types: [{ id: 'gym', name: 'Gym', emoji: '🏋️' }],
  templates: [{ id: 't1', name: 'Push', exercises: [] }],
  sessions: [
    { id: 'a', date: '2026-11-26', typeId: 'gym', done: false },
    { id: 'b', date: '2026-11-27', typeId: 'gym', done: true },
  ],
  series: [],
  plans: [{ id: 'p1', start: '2026-11-01' }, { id: 'p2', start: '2026-11-20' }],
  blocks: [],
  body: { weights: { '2026-11-26': 62.4 }, period: ['2026-11-20', '2026-11-19'] },
  settings: { theme: 'bos', welcomed: true },
  extra: { iets: 1 },
})

test('state ↔ records: alles komt terug, ook de volgorde van lijsten', () => {
  const v = { producten: [{ id: 'eigen:1', naam: 'Reep' }], instellingen: { persoon: 'oscar' }, boek: { book: 'b'.repeat(24) } }
  const r = naarRecords(state(), v)
  assert.equal(r['s:a'].date, '2026-11-26')
  assert.equal(r['w:2026-11-26'], 62.4)
  assert.equal(r['per:2026-11-19'], true)
  assert.deepEqual(r['volgorde:plans'], ['p1', 'p2'])
  const terug = uitRecords(r)
  const verwacht = state()
  verwacht.body.period.sort()
  assert.deepEqual(terug.state, verwacht)
  assert.deepEqual(terug.voeding, { producten: v.producten, instellingen: v.instellingen, boek: v.boek })
})

test('wijzigingen: nieuw, gewijzigd en verwijderd', () => {
  const oud = naarRecords(state())
  const s = state()
  s.sessions[0].done = true
  s.sessions.pop()
  s.sessions.push({ id: 'c', date: '2026-11-28' })
  const w = wijzigingen(naarRecords(s), oud, 500)
  assert.deepEqual(Object.keys(w).sort(), ['s:a', 's:b', 's:c', 'volgorde:sessions'])
  assert.equal(w['s:b'].del, true)
  assert.equal(w['s:a'].t, 500)
})

test('server: per record wint het hoogste tijdstip; rev telt op; sinds geeft alleen nieuwe', () => {
  let o = voegSamenOpServer(null, { 's:a': { v: 1, t: 10 }, 's:b': { v: 2, t: 10 } })
  assert.equal(o.rev, 2)
  o = voegSamenOpServer(o, { 's:a': { v: 'oud', t: 5 }, 's:b': { v: 3, t: 20 } })
  assert.equal(o.records['s:a'].v, 1, 'ouder tijdstip verliest')
  assert.equal(o.records['s:b'].v, 3)
  assert.deepEqual(Object.keys(sinds(o, 2)), ['s:b'])
  o = voegSamenOpServer(o, { 's:a': { del: true, t: 30 } })
  assert.equal(o.records['s:a'].del, true)
})

test('twee apparaten: elk eigen training toegevoegd, en daarna overal hetzelfde', () => {
  let server = { rev: 0, records: {} }
  const apparaat = (s) => ({ records: naarRecords(s), schaduw: {}, rev: 0 })
  const sync = (a, t) => {
    const verstuurd = wijzigingen(a.records, a.schaduw, t)
    server = voegSamenOpServer(server, verstuurd)
    const r = pasRemoteToe(a.records, a.schaduw, sinds(server, a.rev), verstuurd)
    Object.assign(a, r, { rev: server.rev })
  }
  const A = apparaat(state())
  sync(A, 100)
  const B = apparaat({ sessions: [] })
  sync(B, 1) // nieuw apparaat zonder eigen gegevens: krijgt alles
  assert.equal(uitRecords(B.records).state.sessions.length, 2)
  // Beide offline iets toevoegen
  const sa = uitRecords(A.records).state
  sa.sessions.push({ id: 'x', date: '2026-12-01' })
  A.records = naarRecords(sa)
  const sb = uitRecords(B.records).state
  sb.sessions.push({ id: 'y', date: '2026-12-02' })
  B.records = naarRecords(sb)
  sync(A, 200)
  sync(B, 210)
  sync(A, 220)
  const ids = (x) => uitRecords(x.records).state.sessions.map((s) => s.id).sort()
  assert.deepEqual(ids(A), ['a', 'b', 'x', 'y'])
  assert.deepEqual(ids(B), ['a', 'b', 'x', 'y'])
})

test('samenvoegen bij inloggen (t = 1): wat al in het account staat, wint bij dubbele items', () => {
  let server = voegSamenOpServer(null, naarRecordsChanges({ 's:a': { id: 'a', date: 'ACCOUNT' } }, 50))
  const lokaal = naarRecords({ sessions: [{ id: 'a', date: 'TELEFOON' }, { id: 'z', date: 'NIEUW' }] })
  server = voegSamenOpServer(server, wijzigingen(lokaal, {}, 1))
  assert.equal(server.records['s:a'].v.date, 'ACCOUNT')
  assert.equal(server.records['s:z'].v.date, 'NIEUW')
})

test('een lokale wijziging tijdens het synchroniseren blijft staan', () => {
  const schaduw = { 's:a': { id: 'a', v: 1 } }
  const huidig = { 's:a': { id: 'a', v: 3 } } // gebruiker typte na het versturen nog iets
  const verstuurd = { 's:a': { v: { id: 'a', v: 2 }, t: 10 } }
  const { records } = pasRemoteToe(huidig, schaduw, { 's:a': { v: { id: 'a', v: 2 }, t: 10, r: 5 } }, verstuurd)
  assert.equal(records['s:a'].v, 3)
})

test('heeftGegevens', () => {
  assert.equal(heeftGegevens({ sessions: [], body: { weights: {} } }), false)
  assert.equal(heeftGegevens(state()), true)
  assert.equal(heeftGegevens({}, { producten: [{ id: 1 }] }), true)
})

function naarRecordsChanges(obj, t) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { v, t }]))
}
