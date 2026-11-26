// De meegeleverde lijst basisproducten (USDA FoodData Central, publiek domein).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BASIS, BASIS_BRON } from '../../public/sportagenda/voeding/basis.js'

// Waar de 4/4/9-vuistregel bewust niet opgaat (met reden):
const UITZONDERINGEN = {
  Bier: 'alcohol levert 7 kcal/g en zit niet in de macro\'s',
  'Rode wijn': 'alcohol',
  'Witte wijn': 'alcohol',
  Cacaopoeder: 'veel vezels (tellen mee in koolhydraten maar leveren weinig kcal)',
  Citroen: 'koolhydraten zijn voor een groot deel vezels en zuren',
}

test('ongeveer 200 producten, elk met naam, FDC-id en vier waarden', () => {
  assert.ok(BASIS.length >= 180 && BASIS.length <= 260, `aantal ${BASIS.length}`)
  assert.match(BASIS_BRON, /USDA/)
  const namen = new Set()
  for (const b of BASIS) {
    assert.ok(typeof b.naam === 'string' && b.naam.length > 1, JSON.stringify(b))
    assert.ok(!namen.has(b.naam), `dubbele naam ${b.naam}`)
    namen.add(b.naam)
    assert.ok(Number.isInteger(b.fdc) && b.fdc > 100000, `${b.naam}: FDC-id ${b.fdc}`)
    assert.ok(b.usda, `${b.naam}: USDA-omschrijving ontbreekt`)
    for (const k of ['kcal', 'eiwit', 'kh', 'vet']) assert.ok(Number.isFinite(b[k]) && b[k] >= 0, `${b.naam}: ${k}`)
    if (b.portie) assert.ok(b.portie.g > 0 && b.portie.naam, `${b.naam}: portie`)
  }
})

test('kcal klopt grofweg met 4/4/9 × eiwit/koolhydraten/vet', () => {
  for (const b of BASIS) {
    if (UITZONDERINGEN[b.naam]) continue
    const schatting = 4 * b.eiwit + 4 * b.kh + 9 * b.vet
    const marge = Math.max(15, 0.2 * b.kcal)
    assert.ok(Math.abs(schatting - b.kcal) <= marge, `${b.naam}: ${b.kcal} kcal, 4/4/9 geeft ${schatting.toFixed(0)}`)
  }
})

test('uitzonderingen bestaan echt (anders is de lijst verouderd)', () => {
  for (const naam of Object.keys(UITZONDERINGEN)) assert.ok(BASIS.some((b) => b.naam === naam), naam)
})

test('herkenbare ijkpunten', () => {
  const banaan = BASIS.find((b) => b.naam === 'Banaan')
  assert.equal(banaan.fdc, 173944)
  assert.equal(banaan.kcal, 89)
  const olie = BASIS.find((b) => b.naam === 'Olijfolie')
  assert.equal(olie.vet, 100)
})
