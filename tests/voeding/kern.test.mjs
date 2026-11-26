// Rekenregels van Voeding: gram -> macro's, recept -> per portie, kJ -> kcal,
// de Open Food Facts-parser (met echte voorbeeld-JSON) en barcodes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  geldigeBarcode,
  kjNaarKcal,
  macrosVoor,
  normaliseerBarcode,
  num,
  parseOff,
  parsePortie,
  receptWaarden,
  schoonRegel,
  somMacros,
  zoek,
} from '../../public/sportagenda/voeding/kern.js'

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url)))
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`)

test('gram naar macro\'s: evenredig met het gewicht', () => {
  const banaan = { kcal: 89, eiwit: 1.09, kh: 22.84, vet: 0.33 }
  const m = macrosVoor(banaan, 120)
  close(m.kcal, 106.8)
  close(m.eiwit, 1.308)
  close(m.kh, 27.408)
  close(m.vet, 0.396)
  assert.deepEqual(macrosVoor(banaan, 0), { kcal: 0, eiwit: 0, kh: 0, vet: 0 })
})

test('onbekende waarde blijft null, nooit 0', () => {
  const m = macrosVoor({ kcal: 100, eiwit: null, kh: 10, vet: undefined }, 50)
  assert.equal(m.kcal, 50)
  assert.equal(m.eiwit, null)
  assert.equal(m.vet, null)
  // som: null als geen enkele regel de waarde had
  const s = somMacros([m, macrosVoor({ kcal: 10 }, 100)])
  assert.equal(s.kcal, 60)
  assert.equal(s.eiwit, null)
})

test('num leest komma als decimaalteken en weigert onzin', () => {
  assert.equal(num('12,5'), 12.5)
  assert.equal(num(' 7 '), 7)
  assert.equal(num(''), null)
  assert.equal(num('abc'), null)
  assert.equal(num(-3), null)
})

test('recept: waarden per portie en per 100 g', () => {
  const r = receptWaarden({
    porties: 4,
    ingredienten: [
      { naam: 'Pasta', gram: 400, per100: { kcal: 371, eiwit: 13, kh: 75, vet: 1.5 } },
      { naam: 'Saus', gram: 600, per100: { kcal: 50, eiwit: 1.5, kh: 8, vet: 1.5 } },
    ],
  })
  assert.equal(r.totaalGram, 1000)
  assert.equal(r.portieGram, 250)
  close(r.totaal.kcal, 1484 + 300)
  close(r.perPortie.kcal, 446)
  close(r.perPortie.eiwit, (52 + 9) / 4)
  close(r.per100.kcal, 178.4)
  // Een portie loggen (250 g) geeft hetzelfde als perPortie
  close(macrosVoor(r.per100, r.portieGram).kcal, r.perPortie.kcal)
})

test('recept: één ingrediënt zonder vet maakt vet onbekend (niet te laag)', () => {
  const r = receptWaarden({ porties: 1, ingredienten: [{ gram: 100, per100: { kcal: 100, eiwit: 1, kh: 1, vet: null } }, { gram: 100, per100: { kcal: 100, eiwit: 1, kh: 1, vet: 5 } }] })
  assert.equal(r.perPortie.vet, null)
  assert.equal(r.perPortie.kcal, 200)
})

test('kJ naar kcal', () => {
  close(kjNaarKcal(4.184), 1)
  close(kjNaarKcal(2252), 538.24091778, 1e-6)
  assert.equal(kjNaarKcal(null), null)
})

test('OFF-parser: Nutella (echte respons)', () => {
  const p = parseOff(fixture('off-nutella'), '3017620422003')
  assert.deepEqual(p.per100, { kcal: 539, eiwit: 6.3, kh: 57.5, vet: 30.9 })
  assert.equal(p.naam, 'Nutella')
  assert.equal(p.merk, 'Ferrero')
  assert.equal(p.bron, 'off')
  assert.equal(p.barcode, '3017620422003')
  assert.equal(p.portie, null)
})

test('OFF-parser: Coca-Cola is in ml en heeft een portie van 330 ml', () => {
  const p = parseOff(fixture('off-cola'), '5449000000996')
  assert.equal(p.eenheid, 'ml')
  assert.deepEqual(p.portie, { g: 330, naam: '1 portie (330 ml)' })
  assert.equal(p.per100.vet, 0) // echt 0 op het etiket blijft 0
})

test('OFF-parser: ontbrekende kcal uit kJ, ontbrekend vet blijft null', () => {
  const p = parseOff(fixture('off-heinz-zonder-kcal-en-vet'), '87157277')
  assert.equal(p.per100.kcal, 104) // 435 kJ / 4,184
  assert.equal(p.per100.vet, null)
  assert.equal(p.per100.eiwit, 1.2)
})

test('OFF-parser: onbekend product geeft null', () => {
  assert.equal(parseOff(fixture('off-onbekend'), '8710400000000'), null)
  assert.equal(parseOff(null), null)
})

test('portie uit tekst', () => {
  assert.deepEqual(parsePortie('20g'), { g: 20, eenheid: 'g' })
  assert.deepEqual(parsePortie('1 portion (330 ml)'), { g: 330, eenheid: 'ml' })
  assert.deepEqual(parsePortie('25 cl'), { g: 250, eenheid: 'ml' })
  assert.equal(parsePortie('1 stuk'), null)
})

test('barcodes: controlecijfer, EAN-8 en UPC-E', () => {
  assert.ok(geldigeBarcode('3017620422003'))
  assert.ok(geldigeBarcode('87157277'))
  assert.ok(!geldigeBarcode('3017620422004'))
  assert.equal(normaliseerBarcode(' 3017 6204 22003 '), '3017620422003')
  assert.equal(normaliseerBarcode('01234565', 'upc_e'), '012345000065')
  assert.equal(normaliseerBarcode('123'), null)
})

test('regel opschonen: onbekende velden weg, tombstone blijft klein', () => {
  const r = schoonRegel({ id: 'abcdef12', date: '2026-11-26', time: '25:99', meal: 'brunch', name: 'x', grams: '50', unit: 'kg', per100: { kcal: 10 }, source: 'xx', updatedAt: 5, hack: 1 })
  assert.equal(r.time, '12:00')
  assert.equal(r.meal, 'snack')
  assert.equal(r.unit, 'g')
  assert.equal(r.source, 'eigen')
  assert.equal(r.hack, undefined)
  assert.deepEqual(r.per100, { kcal: 10, eiwit: null, kh: null, vet: null })
  assert.deepEqual(schoonRegel({ id: 'abcdef12', date: '2026-11-26', updatedAt: 9, deleted: true, name: 'weg' }), { id: 'abcdef12', date: '2026-11-26', updatedAt: 9, deleted: true })
  assert.equal(schoonRegel({ id: 'abcdef12', date: '2026-11-26', updatedAt: 1, grams: 0 }), null)
})

test('zoeken: alle woorden, zonder accenten, begint-met eerst', () => {
  const list = [{ naam: 'Banaan' }, { naam: 'Bananenbrood' }, { naam: 'Crème fraîche' }, { naam: 'Gedroogde banaan' }]
  assert.deepEqual(zoek(list, 'banaan').map((p) => p.naam), ['Banaan', 'Gedroogde banaan'])
  assert.deepEqual(zoek(list, 'creme').map((p) => p.naam), ['Crème fraîche'])
  assert.deepEqual(zoek(list, ''), [])
})

test('back-up: oudere/rommelige gegevens worden netjes omgezet, nieuwere geweigerd', async () => {
  const { migreerBackup } = await import('../../public/sportagenda/voeding/backup.js')
  const m = migreerBackup({ schema: 1, instellingen: { persoon: 'x', doelen: { kcal: 1800 } }, producten: [{ id: 'eigen:1', naam: 'A' }, { naam: 'zonder id' }], dagboek: [{ id: 'abcdef12', date: '2026-11-26', grams: 10, updatedAt: 1, name: 'A', dirty: 1 }, { id: 'x' }] })
  assert.equal(m.instellingen.persoon, null)
  assert.equal(m.instellingen.doelen.kcal, 1800)
  assert.equal(m.instellingen.doelen.eiwit, 125)
  assert.equal(m.producten.length, 1)
  assert.equal(m.dagboek.length, 1)
  assert.equal(m.dagboek[0].dirty, undefined)
  assert.throws(() => migreerBackup({ schema: 99 }), /nieuwere/)
})

test('doelen in procenten: grammen, 100%-controle, en nooit boven het kcal-doel', async () => {
  const { gramVanProcent, procentVanGram, controleerProcenten, controleerDoelen, macroKcal } = await import('../../public/sportagenda/voeding/kern.js')
  assert.deepEqual(gramVanProcent(2000, { eiwit: 25, kh: 45, vet: 30 }), { kcal: 2000, eiwit: 125, kh: 225, vet: 66 })
  assert.deepEqual(gramVanProcent('1800', { eiwit: '30', kh: '40', vet: '30' }), { kcal: 1800, eiwit: 135, kh: 180, vet: 60 })
  assert.equal(controleerProcenten({ eiwit: 25, kh: 45, vet: 30 }), null)
  assert.equal(controleerProcenten({ eiwit: '33,4', kh: 33.3, vet: 33.3 }), null)
  assert.match(controleerProcenten({ eiwit: 30, kh: 50, vet: 30 }), /110%.*10% te veel/)
  assert.match(controleerProcenten({ eiwit: 20, kh: 40, vet: 30 }), /nog 10%/)
  assert.match(controleerProcenten({ eiwit: 20, kh: null, vet: 30 }), /Vul/)
  // Elke geldige verdeling blijft (op afronding na) binnen het kcal-doel
  for (const kcal of [1200, 1650, 2000, 2750, 3333])
    for (const [e, k, v] of [[25, 45, 30], [40, 30, 30], [10, 60, 30], [33.4, 33.3, 33.3], [20, 20, 60]]) {
      const g = gramVanProcent(kcal, { eiwit: e, kh: k, vet: v })
      assert.ok(macroKcal(g) <= kcal, `${kcal} ${e}/${k}/${v}: ${macroKcal(g)}`)
      assert.equal(controleerDoelen(g), null)
    }
  // Te veel macro's voor het kcal-doel wordt herkend (oude grammen-doelen)
  assert.match(controleerDoelen({ kcal: 2000, eiwit: 120, kh: 230, vet: 70 }), /2\.030 kcal/)
  assert.deepEqual(procentVanGram({ kcal: 2000, eiwit: 125, kh: 225, vet: 66 }), { eiwit: 25, kh: 45, vet: 30 })
})

test('instellingen: de oude standaarddoelen (boven 2000 kcal) worden bijgewerkt, eigen doelen niet', async () => {
  const { migreerInstellingen } = await import('../../public/sportagenda/voeding/opslag.js')
  const oud = migreerInstellingen({ persoon: 'oscar', doelen: { kcal: 2000, eiwit: 120, kh: 230, vet: 70 } })
  assert.deepEqual(oud.doelen, { kcal: 2000, eiwit: 125, kh: 225, vet: 66 })
  assert.deepEqual(oud.doelenPct, { eiwit: 25, kh: 45, vet: 30 })
  const eigen = migreerInstellingen({ persoon: 'oscar', doelen: { kcal: 2500, eiwit: 180, kh: 250, vet: 80 } })
  assert.deepEqual(eigen.doelen, { kcal: 2500, eiwit: 180, kh: 250, vet: 80 })
  assert.deepEqual(eigen.doelenPct, { eiwit: 29, kh: 40, vet: 29 })
})
