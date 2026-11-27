// "Etiket scannen": tekst (zoals OCR hem oplevert) naar kcal en macro's per 100 g.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseEtiket } from '../../public/sportagenda/voeding/kern.js'

test('Nederlands etiket met kJ/kcal en waarvan-regels', () => {
  const t = `Voedingswaarde per 100 g
Energie 1674 kJ / 400 kcal
Vetten 18 g
waarvan verzadigde vetzuren 2,5 g
Koolhydraten 50 g
waarvan suikers 20 g
Voedingsvezel 3 g
Eiwitten 30 g
Zout 0,5 g`
  assert.deepEqual(parseEtiket(t), { kcal: 400, eiwit: 30, kh: 50, vet: 18, vezel: 3, eenheid: 'g', portie: null, controle: false })
})

test('controle klopt bij een realistisch etiket', () => {
  const r = parseEtiket('Per 100g\nEnergie 1569 kJ / 375 kcal\nVet 7,0 g\n- waarvan verzadigd 1,3 g\nKoolhydraten 58 g\n- waarvan suikers 1,1 g\nEiwitten 13 g')
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit, r.controle], [375, 7, 58, 13, true])
})

test('twee kolommen (per 100 g en per portie): de eerste kolom telt, portie wordt herkend', () => {
  const t = `Voedingswaarde | per 100 g | per portie (30 g)
Energie | 1580 kJ 375 kcal | 474 kJ 113 kcal
Vet | 8,0 g | 2,4 g
waarvan verzadigd | 1,5 g | 0,5 g
Koolhydraten | 60 g | 18 g
Eiwitten | 12 g | 3,6 g`
  const r = parseEtiket(t.replace(/\|/g, ' '))
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit, r.portie], [375, 8, 60, 12, 30])
})

test('OCR-fouten: O in plaats van 0, l in plaats van 1, spatie in getal, <', () => {
  const t = `ENERGIE 2O8 kJ / 49 kcal
VET O,5 g
KOOLHYDRATEN l0 g
EIWITTEN 1 ,2 g
ZOUT <0,0l g`
  const r = parseEtiket(t)
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit], [49, 0.5, 10, 1.2])
})

test('alleen kJ: omrekenen naar kcal', () => {
  assert.equal(parseEtiket('Energie 1000 kJ\nVet 1 g').kcal, 239)
})

test('per 100 ml (drank)', () => {
  const r = parseEtiket('Gemiddelde voedingswaarde per 100 ml\nEnergie 180 kJ / 42 kcal\nVet 0 g\nKoolhydraten 10,6 g\nEiwitten 0 g')
  assert.equal(r.eenheid, 'ml')
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit], [42, 0, 10.6, 0])
})

test('Engels etiket', () => {
  const r = parseEtiket('Nutrition per 100g\nEnergy 2252kJ 539kcal\nFat 30.9g\nof which saturates 10.6g\nCarbohydrate 57.5g\nof which sugars 56.3g\nProtein 6.3g\nSalt 0.107g')
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit, r.controle], [539, 30.9, 57.5, 6.3, true])
})

test('niets herkend: alles null (niets verzonnen)', () => {
  assert.deepEqual(parseEtiket('Ingrediënten: tarwebloem, water, zout.'), { kcal: null, eiwit: null, kh: null, vet: null, vezel: null, eenheid: 'g', portie: null, controle: null })
  assert.equal(parseEtiket('').kcal, null)
})

// Echte OCR-uitvoer (Tesseract.js in Tarapp) van een testetiket: de "g" wordt vaak als "9" gelezen
// en soms valt de komma weg. Het etiket zelf: 375 kcal, vet 7,0 g, koolhydraten 58 g, eiwitten 13 g, portie 40 g.
test('echte OCR-uitvoer, scherp: g als 9 wordt hersteld met de kcal als houvast', () => {
  const t = `Voedingswaarde
per 100g per portie (40 g)
Energie 1569 kJ/375 kcal 628 kJ / 150 kcal
Vet 7,09 289
waarvan verzadigd 139 0,5g
Koolhydraten 58g 239
waarvan suikers 119 0,4g
Vezels 94g 3,89
Eiwitten 139 529
Zout 0,029 0,01g`
  const r = parseEtiket(t)
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit, r.portie, r.controle], [375, 7, 58, 13, 40, true])
  assert.equal(r.vezel, 9.4) // OCR las "94g": samen met de macro's zou dat meer dan 100 g zijn
})

test('echte OCR-uitvoer, wazige foto: ook zonder komma ("709") en "(40 9)"', () => {
  const t = `Voedingswaarde

per100g _per portie (40 9)

Energie 1569 KJ / 375 kcal 628 KJ / 150 kcal
Vet 709 289
waarvan verzadigd 139 0,59
Koolhydraten 58g 239
waarvan suikers 119 049
Vezels 949 389
Eiwitten 139 5,29
Zout 0029 0019`
  const r = parseEtiket(t)
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit, r.portie, r.controle], [375, 7, 58, 13, 40, true])
})

test('een echte 9 (met g erachter) blijft gewoon staan', () => {
  const r = parseEtiket('Energie 1440 kJ / 344 kcal\nVet 9 g\nKoolhydraten 49 g\nEiwitten 19 g')
  assert.deepEqual([r.vet, r.kh, r.eiwit], [9, 49, 19])
})

test('echte OCR-uitvoer drank: "100 m!" is ml, "VetOg" en "Eiwitten Og" zijn 0 g', () => {
  const t = `Gemiddelde voedingswaarde per 100 m!
Energie 177 kJ / 42 kcal

VetOg

waarvan verzadigd 0 g

Koolhydraten 10,6 g

waarvan suikers 10,6 g

Eiwitten Og

ZoutOg`
  const r = parseEtiket(t)
  assert.deepEqual([r.eenheid, r.kcal, r.vet, r.kh, r.eiwit, r.controle], ['ml', 42, 0, 10.6, 0, true])
  // "hoog" in gewone tekst blijft heel
  assert.equal(parseEtiket('Eiwitgehalte hoog\nEiwitten 12 g').eiwit, 12)
})

// Echte foto van een echt etiket (Lidl volkoren tarwebollen, plastic zak), echte OCR-uitvoer van Tesseract.js
// in Tarapp (alleen het tabeldeel). Het etiket: 229 kcal, vet 1,5 g, koolhydraten 40,0 g, vezels 7,1 g, eiwitten 10,4 g.
test('echte foto (Lidl-bollen): rommel voor het label, "keal", "4%09", "1049"; vezel onleesbaar blijft leeg', () => {
  const t = `°Á ik k YW dg E \\di BE k GTE wi Ei VEZEL: ER | €
jh 4 1 EE PEC y tarVfffeel. water, ersgis}, tarwe gu Ie E WY 2 5
í A57 e=  meelverbetefgar: asch)jfnezuur adolie, Melkeiwitten, erite f EN
4 AH È=] Gemiddelde voedingswaarde ë #9 N '/
# Wi NE | : | 9/09] 9/50g XRT
4 d Gog sf Energie 9690/| 48597 6% [eN AN :
Nn DP 4 229keal| TS eat 4 ND
a WA Zi Vetten 15g 089 1 Nd /
AN JA (WI! hi VR À Waarvan verzadigde vetzuren 0,39 029 <% WE |
PEI Mn AGP Koolhydraten 4%09| 2009 8% lo; Ù A Vas
VEN N waarvan suikers 359 189 240 U,
4 Me PEN Vezels Zg 369 IN va A4
oM = j Eiwitten 1049 529 10% Ut Wh
Mo AN Zout 0%09| 049 84 N # #`
  const r = parseEtiket(t)
  assert.deepEqual([r.kcal, r.vet, r.kh, r.eiwit], [229, 1.5, 40, 10.4])
  assert.equal(r.vezel, null) // "Zg" is niet te lezen: leeg, niet verzonnen
  assert.equal(r.controle, true)
})

// Tweede echte foto (Choco-Caramel Crisp, drietalig etiket), echte OCR-uitvoer van Tesseract.js in Tarapp.
// Het etiket: 381 kcal, vet 3,7 g, koolhydraten 73,0 g, vezels 11,0 g, eiwitten 8,3 g.
test('echte foto (drietalig): "EiweiB 839", "73,09" en "11,09" worden goed gelezen', () => {
  const t = `Valeurs nutritionnelles moyennes / Gemiddelde :
voedingswaarde / Durchschnittliche Nährwerte 7
Pour/Per/ 1 portion /portie/ % >
Jel00g Porton (B09)** (309)*
Energie/Energie/Energie _ 1607KW/381kal 482W/14kal 6%
Matières grasses / Vetten / Fett 3,79 tlg 2%
- dont addes gras saturés / waarvan verzadigde
| vetzuren / davon gesättigte Fettsäuren 0,99 039 1%
# Glucides / Koolhydraten / Kohlenhydrate 73,09 2199 8% |
3 - dont sucres / waarvan suikers / |
davon Zucker 23,09 69g 8% %&
Fibres alimentaires / Vezels /Ballaststoffe 11,09 339 ë
Â Protéines / Eiwitten / EiweiB 839 250 0
l Sel /Zout / Salz 0,359 011g 2%`
  const r = parseEtiket(t)
  assert.deepEqual([r.kcal, r.vet, r.kh, r.vezel, r.eiwit, r.controle], [381, 3.7, 73, 11, 8.3, true])
})
