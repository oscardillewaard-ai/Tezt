# Nopav.es: proef met een vooraf bewerkte routegraaf (regio Delft)

## Samenvatting

_Wordt aan het eind ingevuld._

## Hervatten

Begint een sessie met "ga verder": lees dit bestand en ga verder bij de eerste stap die niet `klaar`
is. Werkbranch `graaf-proef` (vanaf de live versie `7c885b5`); terugzetpunt: branch `terugzet/voor-graaf`.

## Status

| Stap | Status |
|---|---|
| 1 Regio en formaat | klaar |
| 2 Voorbewerkingsscript + Action | klaar (Action niet gedraaid: zie stap 2) |
| 3 Router leest de blokken (`?graaf=vooraf`) | klaar |
| 4 Meten en vergelijken | open |
| 5 Schatting heel Nederland | open |

## Vooraf vastgesteld

- **Hill repeat-modus bestaat (nog) niet** op de live branch (VOORTGANG.md: "op de planning voor
  later"). Er is dus niets om te breken; de controle "bestaande functies blijven werken" geldt voor
  `?ui=oud`, `?router=eigen` en `?stations=ringen` (zie de tests).
- **Geofabrik en Overpass zijn in deze omgeving geblokkeerd** (proxy: HTTP 403 "no rule allows this
  host"). PDOK (BGT, AHN), OpenFreeMap, PyPI en npm werken wel. Gevolg, volgens de opdracht: het
  script kan beide bronnen lezen; de GitHub Action gebruikt het Geofabrik-extract, de proef hier is
  gebouwd uit de OpenFreeMap-kaarttegels (dezelfde OpenStreetMap-afgeleide bron die de app nu leest).
- Tags pushen werkt niet (zie VOORTGANG.md); terugzetpunten zijn branches.

## Stap 1: regio en formaat

### Regio

Bepaald met de tegelfuncties van de app zelf (`tools/graaf/regio.mjs`): alle kaarttegels (zoom 14)
die de testset vraagt: rondje 10 km (cirkel 0,38 × L), station 15 km (ellipsen naar kandidaten op
0,5–0,85 × L in 24 richtingen), de 10 A-naar-B-paren (eerste ellips van de eigen router, 1,4 × + 600 m)
en Meijendel & Berkheide (rondjes van 15 km vanaf twee plekken in het gebied). Dat zijn 451 tegels in
38 blokken; de omhullende rechthoek is de regio (marge = de rest van de blokken).

| | |
|---|---|
| Blokindeling | tegels op **zoom 12** (≈ 6 × 6 km; elk blok = 4 × 4 kaarttegels op zoom 14, dus de router weet direct welk blok bij een tegel hoort) |
| Blokken | x 2095–2100, y 1348–1355: **6 × 8 = 48 blokken** |
| Bbox (lon/lat) | **4,1309 – 4,6582 O, 51,8358 – 52,2682 N** (≈ 36 × 48 km) |
| Vastgelegd in | `tools/graaf/regio.json` |

De twee grotere ellipsen van de eigen router (1,9 × en 2,6 ×, alleen als er geen route is) vallen
er niet altijd in: dan valt de router terug op de huidige werking.

### Formaat: NPG1 (binair, gzip)

Per blok één bestand `z12_<x>_<y>.npg.gz`. Kop in JSON (tags, oordelen, waterpunten), daarna typed
arrays (little-endian, elk op een veelvoud van 4 bytes); waarden die langs de graaf op elkaar lijken als
verschil (delta). Lezen = één keer de bytes in typed arrays kopiëren en optellen: geen protobuf-, MVT-
of GeoTIFF-ontleding meer in de browser. Volledige beschrijving in `tools/graaf/schrijf.mjs`; de lezer is
`public/onverhard/blokgraaf.js`.

| Deel | Inhoud |
|---|---|
| knopen | lat, lon (Int32, ×1e7, zelfde raster als de kaarttegels), hoogte (Int16, dm; AHN) |
| wegstukken | van, naar, tag (OSM-tags zoals de app ze kent), **ondergrondklasse** (eindoordeel, de vijf klassen van de app), vlaggen: **afgesloten** (toegang), **strand**, **paadje**, **in de natuur** (toegangskaart-gebied), twijfel; **hoogtemeters op en af** (dm); **OSM-way-id** |
| oordeel per meetpunt | per wegstuk het BGT/OSM-oordeel per meetpunt (om de 5 m, zoals de app) als runs: zo vindt de router voor elk stuk van 50 m hetzelfde oordeel als de app |
| tussenhoogtes | om de 10 m langs elk wegstuk (zoals het hoogteprofiel van de app) |
| rand | knopen die ook in een buurblok zitten, met een bitmasker van de buren (N … NW): daar worden blokken aan elkaar geknoopt |

Keuzes:
- Een "wegstuk" is één segment van de graaf (twee opeenvolgende punten van een weg), dus precies de
  segmenten die `bouwGraaf` nu maakt. Samenvoegen tot ketens tussen kruisingen zou kleiner zijn, maar
  de router en het verslepen werken op punten; dan zouden ze bij het lezen weer uitgepakt moeten worden.
- Byte-shuffling geprobeerd voor betere gzip: geen winst (−2%), dus niet gedaan.
- De router rekent met **dezelfde kostenfunctie** (`kostenfactor` op de tags); het vooraf bekende
  oordeel over strand en afgesloten stukken buiten de natuur zit meteen in de kosten. De app doet dat nu
  in een tweede zoekronde, nadat de officiële kaart het heeft aangewezen.

Groottes: zie stap 2 (per blok en totaal, ruw en gzip).

## Stap 2: voorbewerkingsscript

Alles in `tools/graaf/` (niet in de app-map):

| Bestand | Wat |
|---|---|
| `bouw.mjs` | de bouwer: elementen → graaf (`graaf.js bouwGraaf`, dezelfde code als de app) → oordeel per wegstuk → hoogtes → blokken + manifest |
| `bron_ofm.mjs` | bron "ofm": de OpenFreeMap-kaarttegels (zoom 14), gelezen met `osmtegels.js leesOsmTegel` |
| `bron_pbf.py` | bron "pbf": wegen, paden, stranden, waterpunten en stations uit het Geofabrik-extract (pyosmium), bijgesneden tot de bbox |
| `osmtags.mjs` | ruwe OSM-tags → precies de tags die de app uit de tegels krijgt (access alleen `no`, surface `paved`/`unpaved`, woonstraten `unclassified`; nagekeken op de tegels) |
| `haal.mjs` | zuinig ophalen: schijfcache (`~/.cache/nopaves-graaf`), 4 tegelijk, herhalen met wachttijd, BGT max 30 dagen oud, AHN 365 dagen |
| `voorhaal.mjs`, `nodig.mjs` | welke BGT-tegels en AHN-blokken nodig zijn, en die alvast in de cache zetten (hervatbaar) |
| `schrijf.mjs` | het NPG1-formaat schrijven |
| `regio.mjs`, `regio.json` | de regio (stap 1) |
| `vergelijk_oordeel.mjs`, `tabel_proef.mjs` | stap 4 |
| `.github/workflows/graaf.yml` | wekelijkse Action (maandag 03:17 UTC + met de hand) |

**Zelfde oordeel als de app**: het script rekent niets na maar roept de app-code aan: `BgtVlakken.zoek`
per meetpunt (om de 5 m, `kern.js`), de meerderheid per wegstuk zoals `analyseer`, `bepaalEindEnTwijfel`
voor eindoordeel en twijfel, `natuur() ≥ 0,6` voor de toegangskaart (zoals `markeerOngewenst`),
`leesTegel` voor de BGT-vectortegels en `leesAhnTiff`/`hoogteOp` met dezelfde WCS-blokken (500 m, 10 m
per pixel) voor de hoogte. Het oordeel per meetpunt gaat mee in het blok, zodat de router per stuk van
50 m opnieuw de meerderheid kan nemen, net als nu.

**Getest**: het Geofabrik-pad met een zelfgemaakt mini-extract (pyosmium schrijft ook PBF): echte
way-id's, `residential`→`unclassified`, `gravel`→`unpaved`, `private`→`access=no`, `construction`
eruit, BGT-oordeel en waterpunt erbij. Het echte Geofabrik-bestand kon hier niet (proxy).

**De Action**: haalt het extract, snijdt bij, bouwt, draait de unit-tests, vervangt de oude versiemap
en commit; daarna start hij de Pages-deploy (een push met `GITHUB_TOKEN` start die niet vanzelf). De
BGT/AHN-cache blijft tussen runs bewaard (`actions/cache`), dus PDOK krijgt per week alleen de tegels
die ouder zijn dan 30 dagen (~¼ van de 28.540). Een schema draait alleen vanaf de standaardbranch;
zolang het bestand alleen op `graaf-proef` staat, start je hem met de hand. Niet uitgevoerd in deze
omgeving (geen toegang tot Actions-runs vanaf hier).

**Ophalen voor de proef** (eenmalig, met cache): 768 kaarttegels (80 MB, 29 s), 5.673 AHN-blokken
(46 MB) en 28.540 BGT-tegels (2,56 GB); samen 2,6 GB in 28 minuten, 4 tegelijk, 0 fouten.

### De proefgraaf (versie `v20261120`, bron OpenFreeMap `20261115_080022_pt`)

| | |
|---|---|
| Bouwtijd (warme cache) | **302 s**: elementen 2 s, graaf 13 s, ondergrond 258 s, hoogte 5 s, blokken schrijven 22 s |
| Graaf | 1.175.173 knopen, 1.328.149 wegstukken (28.774 km), 926 tagcombinaties, 3.826 verschillende oordelen |
| Vlaggen | twijfel 96.008, afgesloten 112.915 (waarvan in de natuur 17.409), strand 919 wegstukken |
| Grootte | **54,2 MB ruw, 14,2 MB gzip** voor 48 blokken (mediaan 295 kB gzip, grootste 774 kB: Delft-centrum; 6 blokken leeg: zee) |
| Stations | 94 (uit de tegels op zoom 12, zoals de app) |

<details><summary>Grootte per blok</summary>

| Blok (x, y) | Knopen | Wegstukken | Rand | Ruw (kB) | gzip (kB) |
|---|---|---|---|---|---|
| 2097, 1351 | 62756 | 71127 | 607 | 2844 | 774 |
| 2097, 1352 | 54376 | 61909 | 551 | 2524 | 683 |
| 2099, 1354 | 49574 | 56935 | 597 | 2223 | 602 |
| 2096, 1351 | 42637 | 49425 | 516 | 2036 | 569 |
| 2098, 1354 | 41473 | 47769 | 495 | 1939 | 538 |
| 2097, 1354 | 43569 | 49717 | 289 | 2016 | 517 |
| 2099, 1355 | 43054 | 49184 | 356 | 1955 | 507 |
| 2098, 1349 | 42245 | 48220 | 386 | 1924 | 501 |
| 2098, 1350 | 38381 | 43716 | 314 | 1752 | 454 |
| 2096, 1352 | 34834 | 39751 | 488 | 1668 | 451 |
| 2099, 1351 | 37578 | 42987 | 323 | 1724 | 449 |
| 2099, 1353 | 38585 | 43505 | 436 | 1746 | 447 |
| 2098, 1351 | 37073 | 41440 | 427 | 1667 | 436 |
| 2099, 1349 | 36375 | 41256 | 390 | 1654 | 423 |
| 2099, 1348 | 36002 | 40663 | 190 | 1618 | 410 |
| 2097, 1355 | 33478 | 38221 | 251 | 1543 | 405 |
| 2100, 1355 | 32086 | 36119 | 121 | 1457 | 376 |
| 2100, 1354 | 32393 | 36627 | 260 | 1470 | 375 |
| 2098, 1352 | 30107 | 33883 | 465 | 1387 | 358 |
| 2099, 1350 | 28500 | 32191 | 349 | 1325 | 350 |
| 2096, 1354 | 27297 | 30920 | 213 | 1248 | 325 |
| 2097, 1353 | 24969 | 28039 | 355 | 1194 | 316 |
| 2100, 1353 | 25273 | 28152 | 208 | 1151 | 298 |
| 2098, 1353 | 23463 | 26077 | 413 | 1098 | 295 |
| 2098, 1355 | 23192 | 26002 | 290 | 1083 | 286 |
| 2099, 1352 | 22748 | 25526 | 415 | 1066 | 280 |
| 2100, 1352 | 23728 | 26693 | 128 | 1067 | 276 |
| 2098, 1348 | 23902 | 26775 | 170 | 1071 | 275 |
| 2097, 1350 | 23748 | 25740 | 258 | 1054 | 261 |
| 2100, 1350 | 19466 | 21765 | 106 | 915 | 237 |
| 2095, 1353 | 19092 | 21538 | 305 | 898 | 236 |
| 2095, 1352 | 18221 | 20623 | 255 | 875 | 229 |
| 2100, 1348 | 18918 | 20755 | 79 | 860 | 220 |
| 2100, 1351 | 15452 | 17017 | 152 | 726 | 181 |
| 2096, 1353 | 13699 | 15110 | 241 | 654 | 173 |
| 2096, 1355 | 13265 | 14702 | 210 | 633 | 167 |
| 2095, 1354 | 12676 | 14001 | 157 | 623 | 164 |
| 2100, 1349 | 11978 | 13074 | 76 | 572 | 151 |
| 2095, 1355 | 8874 | 9870 | 78 | 423 | 113 |
| 2097, 1349 | 5085 | 5547 | 122 | 250 | 64 |
| 2096, 1350 | 3898 | 4325 | 115 | 205 | 56 |
| 2095, 1351 | 1153 | 1253 | 59 | 72 | 19 |
| 2095, 1348 | 0 | 0 | 0 | 0 | 0 |
| 2095, 1349 | 0 | 0 | 0 | 0 | 0 |
| 2095, 1350 | 0 | 0 | 0 | 0 | 0 |
| 2096, 1348 | 0 | 0 | 0 | 0 | 0 |
| 2096, 1349 | 0 | 0 | 0 | 0 | 0 |
| 2097, 1348 | 0 | 0 | 0 | 0 | 0 |
| **totaal (48)** | 1175173 | 1328149 | | 54211 | 14246 |

</details>

Een rondje van 10 km vanaf Delft Centraal heeft 6 blokken nodig (2,3 MB gzip); de gemeten bytes per
testgeval staan in stap 4.

## Stap 3: de router leest de blokken

Achter **`?graaf=vooraf`** (in `app.js` staat `STANDAARD_GRAAF`; `?graaf=tegels` zet het uit).

- `blokgraaf.js`: blok lezen (typed arrays kopiëren en optellen), blokken samenvoegen tot dezelfde
  graaf als `bouwGraaf` (randknopen op coördinaat aan elkaar), met **dezelfde kostenfunctie**
  (`kostenfactor`, `ALLES_FACTOR`, × 1,3 afgesloten, × 40 strand); strand en afgesloten stukken buiten
  de natuur zitten meteen in de kosten (de app deed dat in een tweede ronde, nadat de BGT ze had
  aangewezen). Unit-test: zelfde segmenten, zelfde kosten, zelfde kortste pad als `bouwGraaf`, ook
  over een blokrand.
- Welke blokken: dezelfde kaarttegels als nu (rondje: cirkel 0,38 × L ≈ binnen L/2; station: de
  ellipsen naar de gekozen stations binnen L; A naar B: de ellips) → hun blok op zoom 12. Stations
  komen uit het manifest (geen tegels op zoom 12 meer).
- Ophalen en samenvoegen in de rekenwerker; blokken in de datacache (`nopaves-data-v1`, versie in het
  pad = onveranderlijk), gelezen blokken blijven in het geheugen van de worker. De service worker laat
  `/graaf/` met rust. Na het kiezen van de start haalt de app de blokken alvast op in plaats van tegels.
- Een route op de voorafgraaf onthoudt zijn knopen en segmenten (`traject.vooraf`, niet opsombaar, dus
  niet in JSON). Dan: `analyseerRoute` neemt het oordeel per meetpunt uit de graaf (geen BGT),
  `markeerOngewenst` de natuurtoets, het hoogteprofiel komt uit de knoop- en tussenhoogtes (zelfde
  stap, opvullen, gladstrijken en drempel als `hoogteprofiel`; geen AHN), water uit de POI's in de
  blokken. Twijfelstukken blijven zichtbaar: `bepaalEindEnTwijfel` draait zoals altijd.
- Verslepen, groene omwegen en "route hierheen" werken op dezelfde graaf, dus ook zonder BGT.
- **Terugval**: buiten de regio, een ontbrekend blok, een manifest of blok dat niet laadt → `null` →
  de planner haalt kaarttegels, BGT en AHN zoals altijd. Zonder officiële kaart (grondig = 0) wordt
  de voorafgraaf niet gebruikt (het oordeel ís BGT + OSM).
- A naar B: `?graaf=vooraf&router=eigen`. Met alleen `?graaf=vooraf` blijft A naar B BRouter.
- `uitslag.graafBron` = `vooraf` of `tegels` (de benchmark legt het vast, zodat een stille terugval
  opvalt).

**Tests** (op de code van deze stap): 50 unit-tests (2 nieuw: schrijven/lezen/samenvoegen tegen
`bouwGraaf`; oordeel, natuur, hoogte en water langs een route) en Playwright telefoon (39 stappen) en
desktop (37) groen, met een nieuw blok "graaf-proef" via de knoppen: rondje (start tikken haalt de blokken
alvast op, 0 BGT- en AHN-verzoeken, hoogteprofiel), station (segmentknop), terugval buiten de regio
(Utrecht: kaarttegels + BGT) en A naar B met `?graaf=vooraf&router=eigen` (geen BRouter, verslepen
zonder BGT). `?ui=oud`, `?router=eigen` en `?stations=ringen` zitten in dezelfde testrun.
