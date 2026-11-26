// Koppelknop: Tarapp maakt zelf de tokens, registreert ze bij de Worker en bouwt
// een geldige deeplink voor Healthbridge.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { TOKEN_RE, leesKoppelLink } from '../../public/sportagenda/voeding/kern.js'
import { LS } from '../../public/sportagenda/voeding/opslag.js'
import { WORKER_URL, koppelHealthbridge, zorgVoorDagboek } from '../../public/sportagenda/voeding/sync.js'
import { call, nepLocalStorage, workerFetch } from './helpers.mjs'

const HOST = new URL(WORKER_URL).host
const oscar = { persoon: 'oscar', doorsturen: null }

beforeEach(() => nepLocalStorage())

test('eerste keer: dagboek-id en schrijf-token met crypto.getRandomValues, geregistreerd', async () => {
  const f = workerFetch()
  let calls = 0
  const rng = { getRandomValues: (a) => (calls++, globalThis.crypto.getRandomValues(a)) }
  const s = await zorgVoorDagboek(oscar, { fetchFn: f, rng })
  assert.ok(calls >= 2)
  assert.ok(TOKEN_RE.test(s.writeToken))
  assert.equal(s.registered, true)
  assert.equal(s.forward, true, 'Oscar stuurt standaard door')
  assert.ok(f.kv.data.has(`book:${s.book}`))
  // tweede keer: niets nieuws
  const again = await zorgVoorDagboek(oscar, { fetchFn: f })
  assert.equal(again.writeToken, s.writeToken)
})

test('koppelen geeft een geldige deeplink met een werkend lees-token', async () => {
  const f = workerFetch()
  const link = await koppelHealthbridge(oscar, { fetchFn: f })
  assert.match(link, /^healthbridge:\/\/koppel\?/)
  const parsed = leesKoppelLink(link, HOST)
  assert.ok(parsed, link)
  assert.equal(parsed.url, WORKER_URL)
  assert.equal(parsed.person, 'oscar')
  assert.ok(TOKEN_RE.test(parsed.token))
  // Het lees-token wordt niet in Tarapp bewaard
  assert.ok(!globalThis.localStorage.getItem(LS.sync).includes(parsed.token))
  const r = await call(f, `/voeding/export?person=oscar&from=2026-11-26&to=2026-11-26`, { token: parsed.token })
  assert.equal(r.status, 200)
})

test('koppelen kan niet als doorsturen uit staat', async () => {
  await assert.rejects(koppelHealthbridge({ persoon: 'tara', doorsturen: null }, { fetchFn: workerFetch() }), /Doorsturen/)
})

test('deeplink-controle (zoals Healthbridge): alleen https naar de verwachte host', () => {
  const tok = 'A'.repeat(43)
  const ok = `healthbridge://koppel?url=${encodeURIComponent(WORKER_URL)}&token=${tok}&person=oscar`
  assert.ok(leesKoppelLink(ok, HOST))
  for (const bad of [
    `healthbridge://koppel?url=${encodeURIComponent('http://' + HOST)}&token=${tok}&person=oscar`,
    `healthbridge://koppel?url=${encodeURIComponent('https://evil.example')}&token=${tok}&person=oscar`,
    `healthbridge://koppel?url=${encodeURIComponent('https://' + HOST + '.evil.example')}&token=${tok}&person=oscar`,
    `healthbridge://koppel?url=${encodeURIComponent('https://user@' + HOST)}&token=${tok}&person=oscar`,
    `healthbridge://koppel?url=${encodeURIComponent(WORKER_URL)}&token=kort&person=oscar`,
    `healthbridge://koppel?url=${encodeURIComponent(WORKER_URL)}&token=${tok}&person=mallory`,
    `https://koppel?url=${encodeURIComponent(WORKER_URL)}&token=${tok}&person=oscar`,
  ])
    assert.equal(leesKoppelLink(bad, HOST), null, bad)
})
