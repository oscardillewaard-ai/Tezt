// Account op de Worker: Google-token controleren, toegangslijst, sessies, versleuteling en sync.
// Google wordt nagebootst met een zelfgemaakt RSA-sleutelpaar (zelfde algoritme als Google: RS256).
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { _test, controleerGoogleToken, ontsleutel, toegestaan, versleutel } from '../../proxy/voeding/account.js'
import worker from '../../proxy/voeding/worker.js'
import { nepKv } from './helpers.mjs'

const CLIENT = '1234-test.apps.googleusercontent.com'
const DATA_KEY = Buffer.alloc(32, 7).toString('base64')
const b64url = (b) => Buffer.from(b).toString('base64url')

const paar = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
const jwk = { ...(await crypto.subtle.exportKey('jwk', paar.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const ander = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign'])

async function token(inhoud, { sleutel = paar.privateKey, kid = 'k1' } = {}) {
  const kop = b64url(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }))
  const body = b64url(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, sub: '111', email: 'oscar@example.org', email_verified: true, exp: Math.floor(Date.now() / 1000) + 600, given_name: 'Oscar', ...inhoud }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', sleutel, new TextEncoder().encode(`${kop}.${body}`))
  return `${kop}.${body}.${b64url(new Uint8Array(sig))}`
}

const nepGoogle = async () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'Cache-Control': 'max-age=3600' } })
const env = (kv, extra = {}) => ({ VOEDING: kv, GOOGLE_CLIENT_ID: CLIENT, ADMIN_EMAILS: 'oscar@example.org', DATA_KEY, ...extra })
const W = 'https://tarapp-voeding.oscar-dillewaard.workers.dev'
async function call(e, path, { method = 'GET', body, sessie } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (sessie) headers.Authorization = `Bearer ${sessie}`
  const res = await worker.fetch(new Request(W + path, { method, headers, body: body ? JSON.stringify(body) : undefined }), e, {})
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  _test.reset()
  globalThis.fetch = nepGoogle
})

test('geldig Google-token wordt geaccepteerd', async () => {
  const wie = await controleerGoogleToken(await token({}), CLIENT, { fetchFn: nepGoogle })
  assert.deepEqual(wie, { sub: '111', email: 'oscar@example.org', naam: 'Oscar' })
})

test('foute tokens worden geweigerd: andere sleutel, andere app, verlopen, niet van Google, onbevestigd', async () => {
  const fout = async (t, re) => assert.rejects(controleerGoogleToken(t, CLIENT, { fetchFn: nepGoogle }), re)
  await fout(await token({}, { sleutel: ander.privateKey }), /Handtekening/)
  await fout(await token({ aud: 'andere-app' }), /niet voor Tarapp/)
  await fout(await token({ exp: Math.floor(Date.now() / 1000) - 3600 }), /verlopen/)
  await fout(await token({ iss: 'https://evil.example' }), /Niet van Google/)
  await fout(await token({ email_verified: false }), /bevestigd/)
  await fout(await token({}, { kid: 'onbekend' }), /Onbekende sleutel/)
  await fout('geen.token', /Ongeldig/)
})

test('beheerderslijst: alleen opgegeven adressen, hoofdletters maken niet uit', () => {
  assert.ok(toegestaan('Tara@Example.org', 'oscar@example.org, tara@example.org'))
  assert.ok(!toegestaan('vreemde@example.org', 'oscar@example.org tara@example.org'))
  assert.ok(!toegestaan('oscar@example.org', ''))
})

test('versleuteling: niet leesbaar in KV, en alleen te openen met hetzelfde account', async () => {
  const e = { DATA_KEY }
  const geheim = await versleutel(e, '111', { gewicht: 62.4 })
  assert.ok(!geheim.includes('62.4'))
  assert.deepEqual(await ontsleutel(e, '111', geheim), { gewicht: 62.4 })
  await assert.rejects(ontsleutel(e, '222', geheim))
  await assert.rejects(ontsleutel({ DATA_KEY: Buffer.alloc(32, 9).toString('base64') }, '111', geheim))
})

test('inloggen, synchroniseren en uitloggen via de Worker', async () => {
  const kv = nepKv()
  const e = env(kv)
  assert.equal((await call(e, '/account/config')).body.actief, true)
  const login = await call(e, '/account/login', { method: 'POST', body: { idToken: await token({}) } })
  assert.equal(login.status, 200, JSON.stringify(login.body))
  const { sessie } = login.body
  assert.ok(![...kv.data.keys()].some((k) => k.includes(sessie)), 'sessiecode alleen als hash')
  const s1 = await call(e, '/account/sync', { method: 'POST', sessie, body: { base: 0, changes: { 'w:2026-11-27': { v: 62.1, t: 10 } } } })
  assert.equal(s1.status, 200)
  assert.equal(s1.body.records['w:2026-11-27'].v, 62.1)
  const opgeslagen = [...kv.data.entries()].find(([k]) => k.startsWith('acct:'))[1]
  assert.ok(!opgeslagen.includes('62.1'), 'versleuteld opgeslagen')
  const s2 = await call(e, '/account/sync', { method: 'POST', sessie, body: { base: s1.body.rev, changes: {} } })
  assert.deepEqual(s2.body.records, {})
  assert.equal((await call(e, '/account/logout', { method: 'POST', sessie })).status, 200)
  assert.ok(![...kv.data.keys()].some((k) => k.startsWith('sess:')), 'sessie weg na uitloggen')
  assert.equal((await call(e, '/account/sync', { method: 'POST', sessie, body: {} })).status, 401)
})

test('alleen na goedkeuring: aanvraag, goedkeuren door de beheerder, intrekken', async () => {
  const kv = nepKv()
  const e = env(kv)
  const tara = async () => call(e, '/account/login', { method: 'POST', body: { idToken: await token({ sub: '222', email: 'tara@example.org', given_name: 'Tara' }) } })
  const eerst = await tara()
  assert.equal(eerst.status, 403)
  assert.equal(eerst.body.aangevraagd, true)
  const o = (await call(e, '/account/login', { method: 'POST', body: { idToken: await token({}) } })).body
  assert.equal(o.beheerder, true)
  const lijst = await call(e, '/account/toegang', { sessie: o.sessie })
  assert.deepEqual(lijst.body.lijst.map((x) => [x.email, x.status, x.naam]), [['tara@example.org', 'wacht', 'Tara']])
  assert.equal((await call(e, '/account/sync', { method: 'POST', sessie: o.sessie, body: {} })).body.wachtend, 1)
  await call(e, '/account/toegang', { method: 'POST', sessie: o.sessie, body: { email: 'tara@example.org', besluit: 'ja' } })
  const t = (await tara()).body.sessie
  assert.ok(t)
  // Tara is geen beheerder
  assert.equal((await call(e, '/account/toegang', { sessie: t })).status, 403)
  assert.equal((await call(e, '/account/toegang', { method: 'POST', sessie: t, body: { email: 'x@y.nl', besluit: 'ja' } })).status, 403)
  // Intrekken: lopende sessie stopt meteen
  await call(e, '/account/toegang', { method: 'POST', sessie: o.sessie, body: { email: 'tara@example.org', besluit: 'nee' } })
  assert.equal((await call(e, '/account/sync', { method: 'POST', sessie: t, body: {} })).status, 401)
})

test('elk account ziet alleen de eigen gegevens', async () => {
  const kv = nepKv()
  const e = env(kv)
  const o = (await call(e, '/account/login', { method: 'POST', body: { idToken: await token({}) } })).body.sessie
  await call(e, '/account/toegang', { method: 'POST', sessie: o, body: { email: 'tara@example.org', besluit: 'ja' } })
  const t = (await call(e, '/account/login', { method: 'POST', body: { idToken: await token({ sub: '222', email: 'tara@example.org' }) } })).body.sessie
  await call(e, '/account/sync', { method: 'POST', sessie: o, body: { changes: { 's:a': { v: { id: 'a', van: 'oscar' }, t: 1 } } } })
  const tara = await call(e, '/account/sync', { method: 'POST', sessie: t, body: { base: 0, changes: {} } })
  assert.deepEqual(tara.body.records, {})
})

test('zonder instellingen geen inloggen', async () => {
  const kv = nepKv()
  const r = await call(env(kv, { ADMIN_EMAILS: '' }), '/account/login', { method: 'POST', body: { idToken: await token({}) } })
  assert.equal(r.status, 503)
  assert.equal((await call(env(kv, { DATA_KEY: '' }), '/account/config')).body.actief, false)
})

test('te veel openstaande aanvragen: geweigerd zonder op te slaan', async () => {
  const kv = nepKv()
  const e = env(kv)
  for (let i = 0; i < 25; i++) await call(e, '/account/login', { method: 'POST', body: { idToken: await token({ sub: `s${i}`, email: `p${i}@example.org` }) } })
  const r = await call(e, '/account/login', { method: 'POST', body: { idToken: await token({ sub: 'x', email: 'nummer26@example.org' }) } })
  assert.equal(r.body.aangevraagd, false)
  assert.ok(!kv.data.get('toegang').includes('nummer26'))
})
