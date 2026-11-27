// De Worker (proxy/voeding/worker.js): registreren, schrijven, exporteren met een
// apart lees-token, en de Open Food Facts-proxy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomToken } from '../../public/sportagenda/voeding/kern.js'
import { _test } from '../../proxy/voeding/worker.js'
import { call, workerFetch } from './helpers.mjs'

const regel = (id, extra = {}) => ({ id, date: '2026-11-26', time: '08:00', meal: 'breakfast', name: 'Banaan', grams: 120, unit: 'g', per100: { kcal: 89, eiwit: 1.09, kh: 22.84, vet: 0.33 }, source: 'usda', updatedAt: 10, ...extra })

async function nieuwDagboek(f, { person = 'oscar', forward = true, read = true } = {}) {
  const book = randomToken(18)
  const writeToken = randomToken(32)
  const readToken = read ? randomToken(32) : undefined
  const r = await call(f, '/voeding/register', { method: 'POST', body: { book, writeToken, readToken, person, forward } })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  return { book, writeToken, readToken }
}

test('tokens staan alleen als hash in KV', async () => {
  const f = workerFetch()
  const { book, writeToken, readToken } = await nieuwDagboek(f)
  const all = [...f.kv.data.entries()].map(([k, v]) => k + v).join('\n')
  assert.ok(!all.includes(writeToken))
  assert.ok(!all.includes(readToken))
  assert.ok(f.kv.data.has(`book:${book}`))
})

test('schrijven vraagt het schrijf-token; een ander kan het dagboek niet overnemen', async () => {
  const f = workerFetch()
  const { book, writeToken } = await nieuwDagboek(f)
  assert.equal((await call(f, `/voeding/book/${book}`, { method: 'PUT', token: randomToken(), body: { entries: [regel('aaaaaa01')] } })).status, 401)
  const over = await call(f, '/voeding/register', { method: 'POST', body: { book, writeToken: randomToken(), person: 'oscar', forward: true } })
  assert.equal(over.status, 403)
  const ok = await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [regel('aaaaaa01')] } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.months['2026-11'].length, 1)
  const get = await call(f, `/voeding/book/${book}?months=2026-11,2026-10`, { token: writeToken })
  assert.equal(get.body.months['2026-11'][0].name, 'Banaan')
  assert.deepEqual(get.body.months['2026-10'], [])
})

test('export: alleen met het lees-token, alleen voor de juiste persoon, zonder verwijderde regels', async () => {
  const f = workerFetch()
  const { book, writeToken, readToken } = await nieuwDagboek(f)
  await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [regel('aaaaaa01'), regel('aaaaaa02', { name: 'Weg' })] } })
  await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [{ id: 'aaaaaa02', date: '2026-11-26', updatedAt: 11, deleted: true }] } })
  const q = '/voeding/export?person=oscar&from=2026-11-23&to=2026-11-26'
  assert.equal((await call(f, q, { token: writeToken })).status, 401, 'schrijf-token is geen lees-token')
  assert.equal((await call(f, q)).status, 401)
  assert.equal((await call(f, q.replace('oscar', 'tara'), { token: readToken })).status, 403)
  const r = await call(f, q, { token: readToken })
  assert.equal(r.status, 200)
  assert.equal(r.body.schemaVersion, 1)
  assert.deepEqual(Object.keys(r.body.days), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'])
  assert.deepEqual(r.body.days['2026-11-26'].map((x) => x.name), ['Banaan'])
  assert.equal(r.body.days['2026-11-26'][0].kcal, 106.8)
  assert.equal((await call(f, '/voeding/export?person=oscar&from=2026-10-01&to=2026-11-26', { token: readToken })).status, 400, 'max 31 dagen')
})

test('export: geweigerd als "Doorsturen naar Healthbridge" uit staat (Tara)', async () => {
  const f = workerFetch()
  const { book, writeToken, readToken } = await nieuwDagboek(f, { person: 'tara', forward: false })
  await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [regel('aaaaaa01')], forward: false } })
  const r = await call(f, '/voeding/export?person=tara&from=2026-11-26&to=2026-11-26', { token: readToken })
  assert.equal(r.status, 403)
  // Aanzetten via een PUT werkt meteen
  await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [], forward: true } })
  assert.equal((await call(f, '/voeding/export?person=tara&from=2026-11-26&to=2026-11-26', { token: readToken })).status, 200)
})

test('opnieuw koppelen maakt het oude lees-token ongeldig', async () => {
  const f = workerFetch()
  const { book, writeToken, readToken } = await nieuwDagboek(f)
  const nieuw = randomToken(32)
  await call(f, '/voeding/register', { method: 'POST', body: { book, writeToken, readToken: nieuw, person: 'oscar', forward: true } })
  const q = '/voeding/export?person=oscar&from=2026-11-26&to=2026-11-26'
  assert.equal((await call(f, q, { token: readToken })).status, 401)
  assert.equal((await call(f, q, { token: nieuw })).status, 200)
})

test('ongeldige invoer wordt geweigerd of opgeschoond', async () => {
  const f = workerFetch()
  assert.equal((await call(f, '/voeding/register', { method: 'POST', body: { book: 'kort', writeToken: 'x', person: 'oscar' } })).status, 400)
  assert.equal((await call(f, '/voeding/register', { method: 'POST', body: { book: randomToken(18), writeToken: randomToken(), person: 'mallory' } })).status, 400)
  const { book, writeToken } = await nieuwDagboek(f)
  const r = await call(f, `/voeding/book/${book}`, { method: 'PUT', token: writeToken, body: { entries: [regel('aaaaaa01', { evil: '<script>' }), { id: '../x', date: 'nope' }] } })
  assert.equal(r.body.months['2026-11'].length, 1)
  assert.equal(r.body.months['2026-11'][0].evil, undefined)
})

test('OFF-proxy: zet User-Agent, geeft ons formaat met bronvermelding, alleen voor geregistreerde dagboeken', async () => {
  const f = workerFetch(undefined, { APP_VERSION: '37', OFF_CONTACT: 'https://example.org/contact' })
  const { book, writeToken } = await nieuwDagboek(f)
  const echt = globalThis.fetch
  const gezien = []
  globalThis.fetch = async (url, init) => {
    gezien.push({ url: String(url), ua: init?.headers?.['User-Agent'] })
    return new Response(readFileSync(new URL('./fixtures/off-nutella.json', import.meta.url)), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    assert.equal((await call(f, '/voeding/off/3017620422003')).status, 401)
    const r = await call(f, '/voeding/off/3017620422003', { token: writeToken, book })
    assert.equal(r.status, 200)
    assert.equal(r.body.product.naam, 'Nutella')
    assert.match(r.body.attribution, /Open Food Facts/)
    assert.equal(gezien.length, 1)
    assert.match(gezien[0].url, /^https:\/\/world\.openfoodfacts\.org\/api\/v2\/product\/3017620422003\?fields=/)
    assert.equal(gezien[0].ua, 'Tarapp/37 (https://example.org/contact)')
    assert.equal((await call(f, '/voeding/off/3017620422004', { token: writeToken, book })).status, 400, 'fout controlecijfer')
  } finally {
    globalThis.fetch = echt
  }
})

test('OFF-proxy: respecteert de limiet per minuut', async () => {
  const f = workerFetch()
  const { book, writeToken } = await nieuwDagboek(f)
  const echt = globalThis.fetch
  globalThis.fetch = async () => new Response('{"status":0}', { status: 404 })
  _test.buckets.set('off', Array(90).fill(Date.now()))
  try {
    const r = await call(f, '/voeding/off/3017620422003', { token: writeToken, book })
    assert.equal(r.status, 429)
  } finally {
    _test.buckets.clear()
    globalThis.fetch = echt
  }
})

test('OFF-zoeken: alleen Nederlandse producten, en dezelfde zoekterm komt uit de cache', async () => {
  const f = workerFetch()
  const { book, writeToken } = await nieuwDagboek(f)
  const echtFetch = globalThis.fetch
  const echtCaches = globalThis.caches
  const opslag = new Map()
  globalThis.caches = { default: { match: async (r) => opslag.get(r.url)?.clone(), put: async (r, res) => opslag.set(r.url, res) } }
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    return new Response(JSON.stringify({ products: [{ code: '4056489547594', product_name: 'Vlugge Japie', brands: 'Lidl', nutriments: { 'energy-kcal_100g': 306, proteins_100g: 3.1, carbohydrates_100g: 69.3, fat_100g: 0.9, fiber_100g: 3 } }] }), { status: 200 })
  }
  try {
    const a = await call(f, '/voeding/off-zoek?q=Vlugge%20%20Japie', { token: writeToken, book })
    assert.equal(a.status, 200)
    assert.equal(a.body.products[0].naam, 'Vlugge Japie')
    assert.equal(a.body.products[0].per100.vezel, 3)
    const u = new URL(urls[0])
    assert.equal(u.searchParams.get('tag_0'), 'en:netherlands')
    assert.equal(u.searchParams.get('search_terms'), 'vlugge japie')
    const b = await call(f, '/voeding/off-zoek?q=vlugge japie', { token: writeToken, book })
    assert.equal(b.status, 200)
    assert.equal(urls.length, 1, 'tweede keer uit de cache')
  } finally {
    globalThis.fetch = echtFetch
    globalThis.caches = echtCaches
  }
})
