// NEVO (RIVM): het omzetscript en de meegeleverde lijst.
// Het testbestand hieronder is verzonnen (geen echte NEVO-gegevens); het bootst alleen de vorm na.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leesNevo } from '../../scripts/gen-voeding-nevo.mjs'
import { NEVO, NEVO_BRON, NEVO_VERSIE } from '../../public/sportagenda/voeding/nevo.js'

const NEP = [
  'Voedingsmiddelgroep|Food group|NEVO-code|Voedingsmiddelnaam/Dutch food name|Engelse naam/Food name|Hoeveelheid/Quantity|ENERCJ (kJ)|ENERCC (kcal)|PROT (g)|FAT (g)|CHO (g)|FIBT (g)',
  'Testgroep|Test group|9001|Testproduct "A"|Test product A|per 100g|418|100|1,234|0,5|20|2,5',
  'Testgroep|Test group|9002|Testdrank B|Test drink B|per 100ml|84|20||0|5,05|',
  '|||kapotte regel zonder code||||||',
].join('\n')

test('leesNevo: kolommen op naam gevonden, waarden ongewijzigd (alleen komma → punt), leeg = null', () => {
  const rows = leesNevo(NEP)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { code: 9001, naam: 'Testproduct "A"', groep: 'Testgroep', eenheid: 'g', kcal: 100, eiwit: 1.234, kh: 20, vet: 0.5, vezel: 2.5 })
  assert.equal(rows[1].eenheid, 'ml')
  assert.equal(rows[1].eiwit, null)
  assert.equal(rows[1].vet, 0)
  assert.equal(rows[1].kh, 5.05)
})

test('leesNevo: ook met puntkomma en zonder Engelse kolommen', () => {
  const t = 'NEVO-code;Voedingsmiddelnaam;Hoeveelheid;kcal;Eiwit;Koolhydraten;Vet\n9003;Testkaas;per 100g;350;25;0;28'
  assert.deepEqual(leesNevo(t)[0], { code: 9003, naam: 'Testkaas', groep: null, eenheid: 'g', kcal: 350, eiwit: 25, kh: 0, vet: 28, vezel: null })
})

test('leesNevo: duidelijke fout als een kolom ontbreekt', () => {
  assert.throws(() => leesNevo('NEVO-code|Voedingsmiddelnaam\n1|x'), /Kolommen niet gevonden/)
})

test('nevo.js: leeg (plaatshouder) of compleet met bron en versie', () => {
  if (!NEVO.length) {
    assert.equal(NEVO_BRON, null)
    return
  }
  assert.match(NEVO_BRON, /^NEVO-online versie \d{4}\/\d+\.\d+, RIVM, Bilthoven$/)
  assert.ok(NEVO_BRON.includes(NEVO_VERSIE))
  const codes = new Set()
  for (const n of NEVO) {
    assert.ok(Number.isInteger(n.code) && !codes.has(n.code), `code ${n.code}`)
    codes.add(n.code)
    assert.ok(n.naam, `naam bij ${n.code}`)
    for (const k of ['kcal', 'eiwit', 'kh', 'vet', 'vezel']) assert.ok(n[k] === null || (Number.isFinite(n[k]) && n[k] >= 0), `${n.naam}: ${k}`)
  }
})
