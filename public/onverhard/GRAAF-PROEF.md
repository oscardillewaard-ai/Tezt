# Nopav.es: proef met een vooraf bewerkte routegraaf (regio Delft)

## Samenvatting

**Gebouwd**: een voorbewerking (`tools/graaf/`) die de routegraaf van de regio Delft (48 blokken op
zoom 12, 36 × 48 km) één keer vooraf maakt, met per wegstuk het ondergrondoordeel van de app zelf (BGT +
OSM, per meetpunt), toegang, strand, toegangskaart-gebied, paadje, hoogtemeters en OSM-way-id, als
compacte binaire blokken (NPG1, gzip) met een manifest: **14,2 MB gzip voor 1,33 mln wegstukken**, gebouwd
in 5 minuten (met cache). Bron: het Geofabrik-extract (in de GitHub Action) of de OpenFreeMap-tegels
(hier, want Geofabrik is in deze omgeving geblokkeerd). De router laadt de blokken achter
**`?graaf=vooraf`** (A naar B: `?graaf=vooraf&router=eigen`), met terugval op de huidige werking buiten de
regio of als een blok niet laadt. Wekelijkse Action: `.github/workflows/graaf.yml` (nog niet gedraaid).

**Meting** (mediaan van 5, koud, seconden; details in stap 4):

| Geval | Route A huidig → vooraf | Totaal huidig → vooraf | Verzoeken / MB huidig → vooraf | Score |
|---|---|---|---|---|
| Rondje 10 km Delft | 4,3 → **2,9** (−31%) | 11,1 → **3,1** | 214 / 32 → **7 / 2,2** | 50 → 50 |
| Station 15 km Delft | 8,1 → **1,9** (−76%) | 23,3 → **2,3** | 828 / 105 → **21 / 7,9** | 58 → 57 |
| A naar B, 10 paren (eigen router) | 1,6–7,6 → **0,4–1,8** | 4,0–20,7 → **0,5–2,1** | tot 689 / 87 → **≤ 22 / 7,6** | 11 van 12 gelijk of hoger* |
| A naar B tegen BRouter | | 5,1–17,0 → **0,5–2,1** | | 3 van 10 gelijk of hoger |

\* rondje, station en de 10 paren samen. **Ondergrondoordeel vooraf tegen de app: 99,66% van 331 km gelijk.**

**Beslisregels**
- `?graaf=vooraf` standaard: **niet gehaald**. Oordeel, score en tests halen de eis, maar route A bij
  het rondje is 31% sneller in plaats van ≥ 40%: wat overblijft is het rekenen zelf, niet de data.
- Eigen router standaard voor A naar B: **niet gehaald**. 10 van 10 sneller, geen verboden stukken, maar
  de score is maar bij 3 van 10 paren gelijk of hoger. BRouter blijft.

**Live**: niets veranderd; de Pages-branch is niet aangeraakt. Alles staat op branch `graaf-proef`.

**Terugzetten**: de live branch is ongewijzigd. Wie `graaf-proef` toch samenvoegt en terug wil:
`git push origin origin/terugzet/voor-graaf:refs/heads/claude/gpx-ultrarace-trainingen-zf6zci` (gewone
push, geen force nodig zolang er niets anders op staat; GitHub Pages bouwt dan opnieuw).

**Advies voor heel Nederland**: technisch kan het (schatting 130–170 MB gzip, past binnen GitHub Pages;
~15 min bouwen met 4 threads, ~400–500 Actions-minuten per maand), maar niet op deze manier: (1) de graaf
niet in git committen maar direct in het Pages-artefact zetten (anders ~7–8 GB per jaar aan geschiedenis),
(2) de BGT als landelijk extract plus wekelijkse mutaties ophalen in plaats van ~300.000 losse tegels
(25–30 GB, past niet in de 10 GB Actions-cache en belast PDOK), (3) blokken in de stad kleiner maken
(quadtree) en het formaat compacter (ketens tussen kruisingen, gedeelde tabellen). Doe eerst de twee
vervolgstappen uit stap 4 (rondje sneller vinden, eigen router op het eindoordeel laten kiezen): dan
haalt de proef waarschijnlijk beide beslisregels, en is opschalen de moeite waard.

## Hervatten

Begint een sessie met "ga verder": lees dit bestand en ga verder bij de eerste stap die niet `klaar`
is. Werkbranch `graaf-proef` (vanaf de live versie `7c885b5`); terugzetpunt: branch `terugzet/voor-graaf`.

## Status

| Stap | Status |
|---|---|
| 1 Regio en formaat | klaar |
| 2 Voorbewerkingsscript + Action | klaar (Action niet gedraaid: zie stap 2) |
| 3 Router leest de blokken (`?graaf=vooraf`) | klaar |
| 4 Meten en vergelijken | klaar: beslisregels niet gehaald, niets live |
| 5 Schatting heel Nederland | klaar |

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

## Stap 4: meten en vergelijken

**Methode** zoals stap 0 (`tools/onverhard/benchmark_snelheid.mjs`): per geval 5× koud (nieuwe
browsercontext, lege caches) en 5× warm (na één opwarmronde, pagina telkens opnieuw geladen), mediaan;
desktop-Chromium headless in deze cloudomgeving via de proxy, niet tegelijk met de testsuite of andere
downloads. De huidige werking is **opnieuw gemeten** in dezelfde sessie (niet de oude cijfers). Series:
huidig en `?graaf=vooraf` voor rondje 10 km en station 15 km vanaf Delft Centraal; voor de 10
A-naar-B-paren BRouter (huidig), `?router=eigen` (kaarttegels) en `?graaf=vooraf&router=eigen`. Ruwe
cijfers: `docs/graaf-proef/*.json`; tabellen: `node tools/graaf/tabel_proef.mjs docs/graaf-proef`.

Het oordeel is vergeleken met `tools/graaf/vergelijk_oordeel.mjs`: alle routes van de testset (plus een
rondje in Meijendel) gepland op de voorafgraaf, en elke route twee keer geanalyseerd: met het vooraf
berekende oordeel en zoals de app het nu doet (BGT-tegels rond de route, `K.analyseer`).

**Eerste meting (hele blokken)**: de router kreeg alle segmenten van de geladen blokken. Rondje: route A
4,3 → 3,9 s (−8%), want het zoeken op die grotere graaf duurde langer (2,8 s i.p.v. 1,9 s). Daarom snijdt
de router de graaf nu bij tot dezelfde kaarttegels die de app ook leest (zelfde dekking als nu). Die
eerste cijfers staan in `docs/graaf-proef/vooraf-heleblokken-*.json`; alles hieronder is na het bijsnijden.

#### Tijd, verzoeken en bytes (mediaan van 5, seconden)

| Geval | Modus | Cache | Route A | Totaal | tegels | blokken | graaf | route | bgt | ahn | water | brouter | verzoeken | MB | graaf uit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rondje-10 Delft Centraal | huidig | koud | 4,3 | 11,1 | 1,6 | – | 0,8 | 1,9 | 4,6 | 1,4 | 0,3 | – | 214 | 32,2 | tegels |
| rondje-10 Delft Centraal | huidig | warm | 3,9 | 5,8 | 1,2 | – | 0,8 | 1,9 | 1,3 | 0,1 | 0,2 | – | 214 | 32,2 | tegels |
| rondje-10 Delft Centraal | vooraf | koud | 2,9 | 3,1 | – | 0,2 | 0,2 | 2,1 | – | 0,0 | 0,0 | – | 7 | 2,2 | vooraf |
| rondje-10 Delft Centraal | vooraf | warm | 3,2 | 3,4 | – | 0,2 | 0,3 | 2,0 | – | 0,0 | 0,1 | – | 7 | 2,2 | vooraf |
| station-15 Delft Centraal | huidig | koud | 8,1 | 23,3 | 3,7 | – | 4,2 | 0,1 | 10,8 | 3,5 | 0,5 | – | 828 | 105,4 | tegels |
| station-15 Delft Centraal | huidig | warm | 6,2 | 9,1 | 2,3 | – | 4,1 | 0,1 | 1,9 | 0,2 | 0,5 | – | 828 | 105,4 | tegels |
| station-15 Delft Centraal | vooraf | koud | 1,9 | 2,3 | – | 0,5 | 0,8 | 0,1 | – | 0,0 | 0,2 | – | 21 | 7,9 | vooraf |
| station-15 Delft Centraal | vooraf | warm | 1,7 | 2,1 | – | 0,4 | 0,7 | 0,1 | – | 0,0 | 0,2 | – | 21 | 7,9 | vooraf |
| ab-kort-1 Delftse Hout | BRouter (huidig) | koud | 3,3 | 5,1 | 0,2 | – | – | – | 1,1 | 1,3 | 0,3 | 2,2 | 41 | 6,9 | – |
| ab-kort-1 Delftse Hout | BRouter (huidig) | warm | 2,5 | 4,3 | 0,2 | – | – | – | 0,1 | 1,6 | 0,2 | 2,4 | 41 | 6,9 | – |
| ab-kort-1 Delftse Hout | eigen, tegels | koud | 1,6 | 4,0 | 0,9 | – | 0,5 | 0,2 | 1,4 | 0,7 | 0,2 | – | 50 | 9,4 | tegels |
| ab-kort-1 Delftse Hout | eigen, tegels | warm | 1,3 | 2,7 | 0,8 | – | 0,4 | 0,2 | 1,0 | 0,0 | 0,2 | – | 50 | 9,4 | tegels |
| ab-kort-1 Delftse Hout | eigen, vooraf | koud | 0,4 | 0,5 | – | 0,1 | 0,1 | 0,0 | – | 0,0 | 0,0 | – | 2 | 0,7 | vooraf |
| ab-kort-1 Delftse Hout | eigen, vooraf | warm | 0,6 | 0,7 | – | 0,1 | 0,1 | 0,0 | – | 0,0 | 0,0 | – | 2 | 0,7 | vooraf |
| ab-kort-2 Den Hoorn | BRouter (huidig) | koud | 3,8 | 5,3 | 0,3 | – | – | – | 1,7 | 1,2 | 0,4 | 2,0 | 78 | 14,2 | – |
| ab-kort-2 Den Hoorn | BRouter (huidig) | warm | 2,5 | 3,6 | 0,1 | – | – | – | 0,2 | 0,9 | 0,2 | 2,3 | 78 | 14,2 | – |
| ab-kort-2 Den Hoorn | eigen, tegels | koud | 1,9 | 5,0 | 1,4 | – | 0,5 | 0,0 | 1,9 | 0,9 | 0,2 | – | 88 | 17,2 | tegels |
| ab-kort-2 Den Hoorn | eigen, tegels | warm | 1,4 | 2,6 | 0,9 | – | 0,4 | 0,0 | 0,9 | 0,0 | 0,2 | – | 88 | 17,2 | tegels |
| ab-kort-2 Den Hoorn | eigen, vooraf | koud | 0,5 | 0,6 | – | 0,1 | 0,1 | 0,0 | – | 0,0 | 0,0 | – | 3 | 1,0 | vooraf |
| ab-kort-2 Den Hoorn | eigen, vooraf | warm | 1,1 | 1,2 | – | 0,1 | 0,2 | 0,2 | – | 0,0 | 0,0 | – | 3 | 1,0 | vooraf |
| ab-kort-3 Delfgauw | BRouter (huidig) | koud | 4,2 | 6,1 | 0,3 | – | – | – | 2,1 | 1,4 | 0,4 | 2,1 | 94 | 16,6 | – |
| ab-kort-3 Delfgauw | BRouter (huidig) | warm | 2,5 | 3,6 | 0,1 | – | – | – | 0,2 | 0,9 | 0,2 | 2,2 | 94 | 16,6 | – |
| ab-kort-3 Delfgauw | eigen, tegels | koud | 1,7 | 5,7 | 1,4 | – | 0,4 | 0,0 | 2,3 | 1,1 | 0,3 | – | 106 | 20,1 | tegels |
| ab-kort-3 Delfgauw | eigen, tegels | warm | 1,4 | 2,4 | 1,0 | – | 0,4 | 0,0 | 0,7 | 0,0 | 0,2 | – | 106 | 20,1 | tegels |
| ab-kort-3 Delfgauw | eigen, vooraf | koud | 0,6 | 0,7 | – | 0,1 | 0,1 | 0,0 | – | 0,0 | 0,0 | – | 5 | 1,6 | vooraf |
| ab-kort-3 Delfgauw | eigen, vooraf | warm | 1,1 | 1,2 | – | 0,1 | 0,2 | 0,2 | – | 0,0 | 0,0 | – | 5 | 1,6 | vooraf |
| ab-kort-4 Nootdorp | BRouter (huidig) | koud | 4,8 | 7,0 | 0,5 | – | – | – | 2,6 | 1,6 | 0,5 | 2,1 | 129 | 18,2 | – |
| ab-kort-4 Nootdorp | BRouter (huidig) | warm | 2,7 | 3,9 | 0,2 | – | – | – | 0,2 | 0,9 | 0,3 | 2,4 | 129 | 18,2 | – |
| ab-kort-4 Nootdorp | eigen, tegels | koud | 1,9 | 6,0 | 1,4 | – | 0,5 | 0,0 | 2,6 | 1,1 | 0,3 | – | 129 | 19,9 | tegels |
| ab-kort-4 Nootdorp | eigen, tegels | warm | 1,5 | 2,9 | 0,9 | – | 0,6 | 0,2 | 1,0 | 0,1 | 0,3 | – | 129 | 19,9 | tegels |
| ab-kort-4 Nootdorp | eigen, vooraf | koud | 0,6 | 0,8 | – | 0,2 | 0,1 | 0,1 | – | 0,0 | 0,1 | – | 5 | 2,2 | vooraf |
| ab-kort-4 Nootdorp | eigen, vooraf | warm | 1,4 | 1,5 | – | 0,2 | 0,2 | 0,2 | – | 0,0 | 0,1 | – | 5 | 2,2 | vooraf |
| ab-kort-5 Schipluiden | BRouter (huidig) | koud | 4,4 | 6,5 | 0,4 | – | – | – | 2,3 | 1,6 | 0,4 | 2,0 | 121 | 16,6 | – |
| ab-kort-5 Schipluiden | BRouter (huidig) | warm | 2,5 | 3,7 | 0,2 | – | – | – | 0,2 | 0,9 | 0,2 | 2,3 | 121 | 16,6 | – |
| ab-kort-5 Schipluiden | eigen, tegels | koud | 1,7 | 6,0 | 1,3 | – | 0,5 | 0,0 | 2,6 | 1,2 | 0,2 | – | 140 | 20,0 | tegels |
| ab-kort-5 Schipluiden | eigen, tegels | warm | 1,6 | 3,0 | 1,1 | – | 0,5 | 0,0 | 1,1 | 0,1 | 0,2 | – | 140 | 20,0 | tegels |
| ab-kort-5 Schipluiden | eigen, vooraf | koud | 0,7 | 0,8 | – | 0,1 | 0,1 | 0,1 | – | 0,0 | 0,0 | – | 5 | 1,6 | vooraf |
| ab-kort-5 Schipluiden | eigen, vooraf | warm | 1,2 | 1,2 | – | 0,1 | 0,2 | 0,1 | – | 0,0 | 0,0 | – | 5 | 1,6 | vooraf |
| ab-lang-1 Rotterdam Centraal | BRouter (huidig) | koud | 7,5 | 10,5 | 0,6 | – | – | – | 4,3 | 2,2 | 0,7 | 3,0 | 265 | 30,3 | – |
| ab-lang-1 Rotterdam Centraal | BRouter (huidig) | warm | 3,3 | 3,9 | 0,4 | – | – | – | 0,4 | 0,1 | 0,5 | 2,7 | 265 | 30,3 | – |
| ab-lang-1 Rotterdam Centraal | eigen, tegels | koud | 3,9 | 12,1 | 2,1 | – | 2,0 | 0,1 | 5,1 | 2,5 | 0,4 | – | 393 | 50,4 | tegels |
| ab-lang-1 Rotterdam Centraal | eigen, tegels | warm | 3,4 | 5,6 | 1,6 | – | 2,0 | 0,1 | 1,4 | 0,1 | 0,4 | – | 393 | 50,4 | tegels |
| ab-lang-1 Rotterdam Centraal | eigen, vooraf | koud | 1,5 | 1,7 | – | 0,3 | 0,5 | 0,2 | – | 0,0 | 0,1 | – | 12 | 4,6 | vooraf |
| ab-lang-1 Rotterdam Centraal | eigen, vooraf | warm | 1,3 | 1,5 | – | 0,3 | 0,4 | 0,1 | – | 0,0 | 0,1 | – | 12 | 4,6 | vooraf |
| ab-lang-2 Scheveningen | BRouter (huidig) | koud | 13,4 | 16,4 | 0,8 | – | – | – | 7,3 | 2,2 | 1,0 | 5,6 | 359 | 58,7 | – |
| ab-lang-2 Scheveningen | BRouter (huidig) | warm | 6,4 | 7,9 | 0,4 | – | – | – | 0,7 | 0,8 | 0,6 | 5,4 | 359 | 58,7 | – |
| ab-lang-2 Scheveningen | eigen, tegels | koud | 4,1 | 12,8 | 2,2 | – | 2,1 | 0,1 | 5,5 | 2,3 | 0,6 | – | 383 | 69,9 | tegels |
| ab-lang-2 Scheveningen | eigen, tegels | warm | 3,4 | 5,5 | 1,7 | – | 2,0 | 0,1 | 1,2 | 0,1 | 0,6 | – | 383 | 69,9 | tegels |
| ab-lang-2 Scheveningen | eigen, vooraf | koud | 1,5 | 1,8 | – | 0,2 | 0,5 | 0,2 | – | 0,0 | 0,1 | – | 12 | 4,0 | vooraf |
| ab-lang-2 Scheveningen | eigen, vooraf | warm | 1,3 | 1,6 | – | 0,3 | 0,4 | 0,1 | – | 0,0 | 0,1 | – | 12 | 4,0 | vooraf |
| ab-lang-3 Zoetermeer | BRouter (huidig) | koud | 6,0 | 9,0 | 0,5 | – | – | – | 3,5 | 2,2 | 0,6 | 2,3 | 219 | 21,7 | – |
| ab-lang-3 Zoetermeer | BRouter (huidig) | warm | 2,9 | 4,2 | 0,3 | – | – | – | 0,3 | 1,0 | 0,4 | 2,4 | 219 | 21,7 | – |
| ab-lang-3 Zoetermeer | eigen, tegels | koud | 3,2 | 9,5 | 1,8 | – | 1,5 | 0,1 | 3,9 | 1,9 | 0,3 | – | 293 | 34,9 | tegels |
| ab-lang-3 Zoetermeer | eigen, tegels | warm | 2,8 | 4,6 | 1,3 | – | 1,5 | 0,1 | 1,2 | 0,1 | 0,3 | – | 293 | 34,9 | tegels |
| ab-lang-3 Zoetermeer | eigen, vooraf | koud | 1,6 | 1,8 | – | 0,3 | 0,5 | 0,2 | – | 0,0 | 0,1 | – | 10 | 4,0 | vooraf |
| ab-lang-3 Zoetermeer | eigen, vooraf | warm | 1,4 | 1,5 | – | 0,3 | 0,4 | 0,1 | – | 0,0 | 0,1 | – | 10 | 4,0 | vooraf |
| ab-lang-4 Maassluis | BRouter (huidig) | koud | 7,9 | 11,7 | 0,7 | – | – | – | 5,0 | 2,9 | 0,7 | 2,6 | 318 | 28,6 | – |
| ab-lang-4 Maassluis | BRouter (huidig) | warm | 3,1 | 4,6 | 0,3 | – | – | – | 0,3 | 1,1 | 0,4 | 2,6 | 318 | 28,6 | – |
| ab-lang-4 Maassluis | eigen, tegels | koud | 3,2 | 11,1 | 1,8 | – | 1,4 | 0,1 | 5,0 | 2,4 | 0,3 | – | 387 | 39,7 | tegels |
| ab-lang-4 Maassluis | eigen, tegels | warm | 2,7 | 4,5 | 1,2 | – | 1,5 | 0,1 | 1,1 | 0,1 | 0,3 | – | 387 | 39,7 | tegels |
| ab-lang-4 Maassluis | eigen, vooraf | koud | 1,5 | 1,6 | – | 0,2 | 0,4 | 0,2 | – | 0,0 | 0,1 | – | 11 | 3,5 | vooraf |
| ab-lang-4 Maassluis | eigen, vooraf | warm | 1,2 | 1,4 | – | 0,2 | 0,3 | 0,1 | – | 0,0 | 0,1 | – | 11 | 3,5 | vooraf |
| ab-lang-5 Leiden Centraal | BRouter (huidig) | koud | 11,7 | 17,0 | 0,8 | – | – | – | 7,7 | 4,6 | 0,9 | 3,5 | 461 | 50,9 | – |
| ab-lang-5 Leiden Centraal | BRouter (huidig) | warm | 4,1 | 5,9 | 1,3 | – | – | – | 0,6 | 0,2 | 1,4 | 3,2 | 461 | 50,9 | – |
| ab-lang-5 Leiden Centraal | eigen, tegels | koud | 7,6 | 20,7 | 3,3 | – | 4,3 | 0,2 | 8,4 | 3,7 | 0,5 | – | 689 | 86,9 | tegels |
| ab-lang-5 Leiden Centraal | eigen, tegels | warm | 5,7 | 8,2 | 2,0 | – | 3,8 | 0,2 | 1,5 | 0,2 | 0,5 | – | 689 | 86,9 | tegels |
| ab-lang-5 Leiden Centraal | eigen, vooraf | koud | 1,8 | 2,1 | – | 0,4 | 0,7 | 0,2 | – | 0,0 | 0,1 | – | 22 | 7,6 | vooraf |
| ab-lang-5 Leiden Centraal | eigen, vooraf | warm | 1,9 | 2,2 | – | 0,5 | 0,7 | 0,2 | – | 0,0 | 0,1 | – | 22 | 7,6 | vooraf |

#### Uitkomst per testgeval (mediaan van de koude runs)

| Geval | Modus | Score | Lengte (km) | Onverhard + half | Verboden (m) |
|---|---|---|---|---|---|
| rondje-10 Delft Centraal | huidig | 50 | 10,11 | 54,3% | 0 |
| rondje-10 Delft Centraal | vooraf | 50 | 10,11 | 54,3% | 0 |
| station-15 Delft Centraal | huidig | 58 | 11,78 | 61% | 0 |
| station-15 Delft Centraal | vooraf | 57 | 11,78 | 60,2% | 0 |
| ab-kort-1 Delftse Hout | BRouter (huidig) | 57 | 2,28 | 56,4% | 0 |
| ab-kort-1 Delftse Hout | eigen, tegels | 43 | 2,32 | 42,2% | 0 |
| ab-kort-1 Delftse Hout | eigen, vooraf | 43 | 2,32 | 42,2% | 0 |
| ab-kort-2 Den Hoorn | BRouter (huidig) | 22 | 3,74 | 25,1% | 0 |
| ab-kort-2 Den Hoorn | eigen, tegels | 22 | 3,73 | 24,9% | 0 |
| ab-kort-2 Den Hoorn | eigen, vooraf | 22 | 3,73 | 24,9% | 0 |
| ab-kort-3 Delfgauw | BRouter (huidig) | 48 | 5,19 | 46,8% | 0 |
| ab-kort-3 Delfgauw | eigen, tegels | 44 | 5,24 | 43,3% | 0 |
| ab-kort-3 Delfgauw | eigen, vooraf | 47 | 5,47 | 46,7% | 0 |
| ab-kort-4 Nootdorp | BRouter (huidig) | 55 | 6,6 | 59,6% | 0 |
| ab-kort-4 Nootdorp | eigen, tegels | 51 | 6,41 | 53,9% | 0 |
| ab-kort-4 Nootdorp | eigen, vooraf | 51 | 6,41 | 53,9% | 0 |
| ab-kort-5 Schipluiden | BRouter (huidig) | 22 | 6,07 | 24,8% | 0 |
| ab-kort-5 Schipluiden | eigen, tegels | 21 | 6,08 | 24,4% | 0 |
| ab-kort-5 Schipluiden | eigen, vooraf | 21 | 6,08 | 24,4% | 0 |
| ab-lang-1 Rotterdam Centraal | BRouter (huidig) | 23 | 15,54 | 26,5% | 0 |
| ab-lang-1 Rotterdam Centraal | eigen, tegels | 23 | 15,42 | 26,7% | 0 |
| ab-lang-1 Rotterdam Centraal | eigen, vooraf | 23 | 15,41 | 26,8% | 0 |
| ab-lang-2 Scheveningen | BRouter (huidig) | 16 | 15,31 | 21,1% | 0 |
| ab-lang-2 Scheveningen | eigen, tegels | 13 | 14,93 | 14,7% | 0 |
| ab-lang-2 Scheveningen | eigen, vooraf | 13 | 15,13 | 14,5% | 0 |
| ab-lang-3 Zoetermeer | BRouter (huidig) | 49 | 12,94 | 59,4% | 0 |
| ab-lang-3 Zoetermeer | eigen, tegels | 47 | 13,53 | 54,7% | 0 |
| ab-lang-3 Zoetermeer | eigen, vooraf | 47 | 13,53 | 54,4% | 0 |
| ab-lang-4 Maassluis | BRouter (huidig) | 32 | 15,69 | 36,4% | 0 |
| ab-lang-4 Maassluis | eigen, tegels | 32 | 15,88 | 36,3% | 0 |
| ab-lang-4 Maassluis | eigen, vooraf | 32 | 15,88 | 36,3% | 0 |
| ab-lang-5 Leiden Centraal | BRouter (huidig) | 49 | 26,44 | 54,6% | 0 |
| ab-lang-5 Leiden Centraal | eigen, tegels | 41 | 25,91 | 46,7% | 0 |
| ab-lang-5 Leiden Centraal | eigen, vooraf | 41 | 25,91 | 46,7% | 0 |

#### Beslisregel 1: `?graaf=vooraf` standaard binnen de regio

| Geval | Route A koud huidig → vooraf (s) | Winst | Score huidig → vooraf | Score ≥ |
|---|---|---|---|---|
| rondje-10 Delft Centraal | 4,3 → 2,9 | 31% | 50 → 50 | ja |
| station-15 Delft Centraal | 8,1 → 1,9 | 76% | 58 → 57 | nee |
| ab-kort-1 Delftse Hout | 1,6 → 0,4 | 73% | 43 → 43 | ja |
| ab-kort-2 Den Hoorn | 1,9 → 0,5 | 72% | 22 → 22 | ja |
| ab-kort-3 Delfgauw | 1,7 → 0,6 | 65% | 44 → 47 | ja |
| ab-kort-4 Nootdorp | 1,9 → 0,6 | 66% | 51 → 51 | ja |
| ab-kort-5 Schipluiden | 1,7 → 0,7 | 59% | 21 → 21 | ja |
| ab-lang-1 Rotterdam Centraal | 3,9 → 1,5 | 61% | 23 → 23 | ja |
| ab-lang-2 Scheveningen | 4,1 → 1,5 | 62% | 13 → 13 | ja |
| ab-lang-3 Zoetermeer | 3,2 → 1,6 | 50% | 47 → 47 | ja |
| ab-lang-4 Maassluis | 3,2 → 1,5 | 54% | 32 → 32 | ja |
| ab-lang-5 Leiden Centraal | 7,6 → 1,8 | 76% | 41 → 41 | ja |

Route A koud ≥ 40% sneller: 11 van 12 gevallen; bij rondje en station (waar vooraf de standaard zou worden): nee.
Score gelijk of hoger: 11 van 12 (eis: ≥ 90%, dus ≥ 11).
Ondergrondoordeel gelijk: 99.66% van 331.3 km (eis ≥ 98%).
**Beslisregel 1: niet gehaald.**

#### Beslisregel 2: A naar B, eigen router met de vooraf bewerkte graaf tegen BRouter

| Paar | Wachttijd koud BRouter → eigen (s) | warm (s) | Lengte (km) | Onverhard+half | Score | Verboden (m) | Sneller | Score ≥ |
|---|---|---|---|---|---|---|---|---|
| ab-kort-1 Delftse Hout | 5,1 → 0,5 | 4,3 → 0,7 | 2,28 → 2,32 | 56,4% → 42,2% | 57 → 43 | 0 | ja | nee |
| ab-kort-2 Den Hoorn | 5,3 → 0,6 | 3,6 → 1,2 | 3,74 → 3,73 | 25,1% → 24,9% | 22 → 22 | 0 | ja | ja |
| ab-kort-3 Delfgauw | 6,1 → 0,7 | 3,6 → 1,2 | 5,19 → 5,47 | 46,8% → 46,7% | 48 → 47 | 0 | ja | nee |
| ab-kort-4 Nootdorp | 7,0 → 0,8 | 3,9 → 1,5 | 6,6 → 6,41 | 59,6% → 53,9% | 55 → 51 | 0 | ja | nee |
| ab-kort-5 Schipluiden | 6,5 → 0,8 | 3,7 → 1,2 | 6,07 → 6,08 | 24,8% → 24,4% | 22 → 21 | 0 | ja | nee |
| ab-lang-1 Rotterdam Centraal | 10,5 → 1,7 | 3,9 → 1,5 | 15,54 → 15,41 | 26,5% → 26,8% | 23 → 23 | 0 | ja | ja |
| ab-lang-2 Scheveningen | 16,4 → 1,8 | 7,9 → 1,6 | 15,31 → 15,13 | 21,1% → 14,5% | 16 → 13 | 0 | ja | nee |
| ab-lang-3 Zoetermeer | 9,0 → 1,8 | 4,2 → 1,5 | 12,94 → 13,53 | 59,4% → 54,4% | 49 → 47 | 0 | ja | nee |
| ab-lang-4 Maassluis | 11,7 → 1,6 | 4,6 → 1,4 | 15,69 → 15,88 | 36,4% → 36,3% | 32 → 32 | 0 | ja | ja |
| ab-lang-5 Leiden Centraal | 17,0 → 2,1 | 5,9 → 2,2 | 26,44 → 25,91 | 54,6% → 46,7% | 49 → 41 | 0 | ja | nee |

Sneller op 10 van 10; score gelijk of hoger op 3 van 10; paren met een verboden stuk: 0.
**Beslisregel 2: niet gehaald.**

#### Ondergrondoordeel: vooraf tegen de app (per route)

| Geval | Route | km | Gelijk | Score vooraf / app | Onverhard+half vooraf / app |
|---|---|---|---|---|---|
| rondje-10 Delft Centraal | A | 10,11 | 100% | 50 / 50 | 54,3% / 54,3% |
| rondje-10 Delft Centraal | B | 10,66 | 100% | 49 / 49 | 53,3% / 53,3% |
| station-15 Delft Centraal | A | 11,78 | 99,24% | 57 / 58 | 60,2% / 61% |
| station-15 Delft Centraal | B | 13,26 | 99,64% | 46 / 47 | 53,7% / 54,1% |
| station-15 Delft Centraal | C | 14,15 | 99,65% | 40 / 40 | 49,7% / 49,7% |
| station-15 Delft Centraal | D | 17,14 | 99,47% | 30 / 30 | 34,4% / 34,4% |
| rondje-10 Meijendel | A | 10,23 | 99,54% | 89 / 89 | 96,6% / 96,2% |
| rondje-10 Meijendel | B | 10,83 | 99,57% | 87 / 87 | 96,7% / 96,2% |
| ab-kort-1 Delftse Hout | A | 2,32 | 100% | 43 / 43 | 42,2% / 42,2% |
| ab-kort-1 Delftse Hout | B | 3,05 | 100% | 57 / 57 | 57,5% / 57,5% |
| ab-kort-2 Den Hoorn | A | 3,73 | 100% | 22 / 22 | 24,9% / 24,9% |
| ab-kort-2 Den Hoorn | B | 4,42 | 99,11% | 37 / 36 | 36,5% / 35,7% |
| ab-kort-3 Delfgauw | A | 5,47 | 100% | 47 / 47 | 46,7% / 46,7% |
| ab-kort-3 Delfgauw | B | 5,07 | 100% | 28 / 28 | 29,9% / 29,9% |
| ab-kort-4 Nootdorp | A | 6,41 | 100% | 51 / 51 | 53,9% / 53,9% |
| ab-kort-4 Nootdorp | B | 6,6 | 99,52% | 45 / 45 | 47,2% / 47,2% |
| ab-kort-5 Schipluiden | A | 6,08 | 100% | 21 / 21 | 24,4% / 24,4% |
| ab-kort-5 Schipluiden | B | 7,17 | 99,45% | 31 / 31 | 32,1% / 31,6% |
| ab-lang-1 Rotterdam Centraal | A | 15,41 | 100% | 23 / 23 | 26,8% / 26,8% |
| ab-lang-1 Rotterdam Centraal | B | 18,29 | 99,74% | 23 / 24 | 28,6% / 28,8% |
| ab-lang-2 Scheveningen | A | 15,13 | 99,6% | 13 / 13 | 14,5% / 14,5% |
| ab-lang-2 Scheveningen | B | 16,53 | 99,75% | 16 / 16 | 17,9% / 17,7% |
| ab-lang-3 Zoetermeer | A | 13,53 | 99,65% | 47 / 47 | 54,4% / 54,7% |
| ab-lang-3 Zoetermeer | B | 14,43 | 99,64% | 48 / 48 | 54,9% / 55,2% |
| ab-lang-4 Maassluis | A | 15,88 | 99,43% | 32 / 32 | 36,3% / 36,3% |
| ab-lang-4 Maassluis | B | 17,27 | 99,52% | 35 / 35 | 41,1% / 40,8% |
| ab-lang-5 Leiden Centraal | A | 25,91 | 99,68% | 41 / 41 | 46,7% / 46,7% |
| ab-lang-5 Leiden Centraal | B | 30,44 | 99,56% | 51 / 51 | 58,2% / 58,1% |

**Grootste verschillen**

| Geval | m | Vooraf | App | Tags | Plek | Uitleg vooraf → app |
|---|---|---|---|---|---|---|
| station-15 Delft Centraal C | 50 | onverhard | half verhard | `highway=bridleway surface=unpaved` | 51.95805, 4.36668 | geen pad geregistreerd; lijn ligt in begroeid terreindeel: grasland agrarisch → geen pad geregistreerd; lijn ligt in onbegroeid terreindeel: half verhard |
| ab-lang-5 Leiden Centraal B | 50 | onverhard | open verharding | `highway=path surface=unpaved` | 52.15414, 4.48636 | de officiële kaart heeft hier niets → wegdeel, voetpad: open verharding (tegels) |
| ab-lang-1 Rotterdam Centraal B | 48 | open verharding | onverhard | `highway=path surface=unpaved foot=yes` | 51.934, 4.42135 | wegdeel, rijbaan lokale weg: open verharding → geen pad geregistreerd; lijn ligt in begroeid terreindeel: groenvoorziening (gras- en kruidachtigen) |
| ab-lang-5 Leiden Centraal A | 48 | open verharding | gesloten verharding | `highway=cycleway surface=paved` | 52.13329, 4.46165 | wegdeel, fietspad: open verharding (tegels) → wegdeel, fietspad: gesloten verharding (asfalt) |
| station-15 Delft Centraal A | 47 | gesloten verharding | onverhard | `highway=footway surface=unpaved` | 52.04545, 4.45044 | wegdeel, voetpad: gesloten verharding (asfalt) → geen pad geregistreerd; lijn ligt in begroeid terreindeel: houtwal |
| station-15 Delft Centraal B | 47 | gesloten verharding | onverhard | `highway=footway surface=unpaved` | 52.04545, 4.45044 | wegdeel, voetpad: gesloten verharding (asfalt) → geen pad geregistreerd; lijn ligt in begroeid terreindeel: houtwal |
| rondje-10 Meijendel A | 47 | onverhard | open verharding | `highway=footway surface=unpaved` | 52.13105, 4.35316 | wegdeel, voetpad: onverhard (zand) → wegdeel, parkeervlak: open verharding |
| rondje-10 Meijendel B | 47 | onverhard | open verharding | `highway=footway surface=unpaved` | 52.13105, 4.35316 | wegdeel, voetpad: onverhard (zand) → wegdeel, parkeervlak: open verharding |
| ab-lang-3 Zoetermeer A | 47 | gesloten verharding | onverhard | `highway=footway surface=unpaved` | 52.04545, 4.45044 | wegdeel, voetpad: gesloten verharding (asfalt) → geen pad geregistreerd; lijn ligt in begroeid terreindeel: houtwal |
| station-15 Delft Centraal D | 46 | open verharding | onverhard | `highway=footway surface=unpaved` | 51.92382, 4.26344 | wegdeel, voetpad: open verharding → geen pad geregistreerd; lijn ligt in begroeid terreindeel: groenvoorziening (gras- en kruidachtigen) |
| ab-lang-4 Maassluis A | 46 | open verharding | onverhard | `highway=footway surface=unpaved` | 51.92382, 4.26344 | wegdeel, voetpad: open verharding → geen pad geregistreerd; lijn ligt in begroeid terreindeel: groenvoorziening (gras- en kruidachtigen) |
| station-15 Delft Centraal D | 45 | onverhard | gesloten verharding | `highway=footway surface=unpaved` | 51.92553, 4.26756 | geen pad geregistreerd; lijn ligt in onbegroeid terreindeel: onverhard → wegdeel, voetpad: gesloten verharding (asfalt) |
| ab-lang-2 Scheveningen A | 45 | open verharding | gesloten verharding | `highway=unclassified surface=paved` | 52.07459, 4.31506 | wegdeel, rijbaan lokale weg: open verharding (gebakken klinkers) → wegdeel, rijbaan lokale weg: gesloten verharding (asfalt) |
| ab-lang-4 Maassluis A | 45 | onverhard | gesloten verharding | `highway=footway surface=unpaved` | 51.92553, 4.26756 | geen pad geregistreerd; lijn ligt in onbegroeid terreindeel: onverhard → wegdeel, voetpad: gesloten verharding (asfalt) |
| ab-lang-5 Leiden Centraal B | 45 | gesloten verharding | onverhard | `highway=path surface=unpaved` | 52.15334, 4.49273 | wegdeel, rijbaan lokale weg: gesloten verharding (asfalt) op 2,9 m van de lijn → de officiële kaart heeft hier niets |


**Wat de cijfers zeggen**
- Het wachten op data is weg: rondje **214 verzoeken / 32 MB → 7 / 2,2 MB**, station **828 / 105 MB →
  21 / 7,9 MB**, A naar B Leiden 689 / 87 MB → 22 / 7,6 MB. Geen BGT- en AHN-verzoeken meer.
- Het **totaal** daalt overal fors: rondje koud 11,1 → 3,1 s, station koud 23,3 → 2,3 s, A naar B koud
  0,5–2,1 s (BRouter: 5–17 s). Ook warm is vooraf sneller (station 9,1 → 2,1 s).
- **Route A bij het rondje** daalt maar 31% (4,3 → 2,9 s): wat overblijft is het rekenen zelf
  (`zoekRondjes` ≈ 2,1 s), en dat haalt voorbewerking niet weg. Daar strandt beslisregel 1.
- Score: 11 van 12 gelijk of hoger; station 58 → 57 door één stuk van 50 m met een ander oordeel
  (61,0% → 60,2% onverhard + half). Delfgauw (eigen router) 44 → 47.
- Oordeel: **99,66% van 331 km gelijk**. De grootste verschillen zijn stukken van ~50 m waar de BGT
  rond de route anders geladen is dan in de voorbewerking (de app laadt alleen tegels rond de route; de
  voorbewerking alle tegels van de groep, waardoor er soms een ander vlak "het dichtstbij" ligt), en
  twee plekken op de rand van een wegdeel.

### Besluit

- **Beslisregel 1 (`?graaf=vooraf` standaard binnen de regio): niet gehaald.** Oordeel (99,66% ≥ 98%),
  score (11/12 ≥ 90%) en tests zijn in orde, maar de koude mediaan tot route A is bij het rondje 31%
  lager, niet ≥ 40% (station: 76%). Dus blijft het achter de vlag. Vervolgstap die dit wel kan halen: het
  rondje zelf sneller vinden (minder pogingen tot het eerste goede rondje, of eerst de beste sector tonen);
  de data is niet meer de bottleneck.
- **Beslisregel 2 (eigen router standaard voor A naar B): niet gehaald.** Sneller op 10 van 10 (koud
  0,5–2,3 s tegen 5–17 s), geen verboden stukken, maar de score is maar op 3 van 10 paren gelijk of hoger
  (zelfde patroon als stap 6: de eigen router kiest op OSM-kosten, BRouter kiest tussen vier alternatieven
  met de BGT). BRouter blijft. Vervolgstap: met de voorafgraaf is het oordeel gratis, dus de eigen router
  kan nu goedkoop 4–6 alternatieven op het eindoordeel scoren en de beste kiezen; daarna opnieuw meten.
- **Niets live gezet**: geen beslisregel maakt iets standaard. De Pages-branch is niet aangeraakt.

## Stap 5: schatting voor heel Nederland (niet gebouwd)

**Uitgangspunten** (gemeten in de proef, de rest is een aanname en staat erbij):
- Proefregio: 42 niet-lege blokken van ~36 km² (≈ 1.500 km² land), 28.774 km weg/pad, 1,33 mln wegstukken,
  14,2 MB gzip (0,49 MB per 1.000 km weg), 28.540 BGT-tegels (2,56 GB), 5.673 AHN-blokken (46 MB).
- Nederland: 33.700 km² land (+ binnenwater). Dat is ~1.150 blokken op zoom 12 met land.
- **Aanname**: de regio (Den Haag, Delft, Rotterdam-West, Zoetermeer, Leiden-Zuid) is ongeveer twee keer
  zo dicht als het Nederlandse gemiddelde. Dus ~19 km weg per km² hier, ~8–10 km/km² landelijk →
  **270.000–340.000 km** weg en pad in OpenStreetMap. Dat getal heb ik niet kunnen controleren (geen
  toegang tot een NL-extract hier); de eerste Action-run met het NL-extract geeft het echte getal.

| | Proef (gemeten) | Heel NL (schatting) |
|---|---|---|
| Blokken (niet leeg) | 42 | ~1.100–1.200 |
| Wegstukken | 1,33 mln | 12–16 mln |
| Grootte gzip | 14,2 MB | **130–170 MB** (ruw 500–650 MB) |
| BGT-tegels / bytes | 28.540 / 2,56 GB | ~270.000–330.000 / **24–30 GB** |
| AHN-blokken | 5.673 / 46 MB | ~120.000 / ~1 GB |
| Bouwtijd, warme cache | 302 s (1 kern) | ~50–60 min op 1 kern; **~15 min** met 4 worker-threads |
| BGT koud ophalen | 28 min (4 tegelijk) | ~4,5–5 uur (4 tegelijk) |

**GitHub Actions per week** (publieke repo: gratis; privé: 2.000 min/maand inbegrepen):
- NL-extract (1,3 GB) ophalen en bijsnijden: ~5 min; graaf bouwen met 4 threads: ~15 min;
- BGT: met een cache die een kwart per week ververst (max 30 dagen oud) ~70.000 tegels ≈ 75 min;
- samen **~1,5–2 uur per week ≈ 400–500 min per maand**. Past in de gratis 2.000 minuten, maar de
  **Actions-cache (max 10 GB per repo) is te klein** voor 25–30 GB BGT-tegels.

**Past het binnen GitHub Pages en de repo?**
- Pages: site max 1 GB, bestanden < 100 MB, ~100 GB verkeer per maand (zachte grens). 130–170 MB aan blokken
  past. Verkeer: een station-planning haalt ~7 MB (stap 4), een rondje ~2 MB; bij 100 GB/maand is dat
  ruim 15.000 koude planningen per maand (warme cache kost niets).
- **De repo niet**: elke week 150 MB nieuwe binaire bestanden committen = ~7–8 GB per jaar aan
  git-geschiedenis (GitHub raadt < 1 GB aan, en waarschuwt boven 5 GB). Voor de proef (14 MB, één versie)
  is committen prima; voor heel NL niet.

**Wat er beter moet voor heel NL**
1. **Niet in git**: de Action bouwt de graaf en zet hem direct in het Pages-artefact (of als
   release-bijlage die de deploy ophaalt). De repo houdt alleen code en het manifest-formaat.
2. **BGT anders ophalen**: niet 300.000 losse vectortegels per keer, maar de BGT-download van PDOK
   (volledig extract één keer, daarna de wekelijkse mutaties) en zelf de vlakken indexeren. Dat ontziet
   PDOK en past niet in de 10 GB-cache als losse tegels. Alternatief: alleen tegels verversen waar de
   BGT-mutaties of de OSM-wijzigingen van die week liggen.
3. **Kleinere blokken in de stad, grotere op het land**: de grootste proefblokken (Delft-centrum 774 kB)
   zijn 2–3× de mediaan. Een quadtree (blok splitsen op zoom 13 boven ~400 kB) houdt elke download klein;
   landelijke blokken kunnen samen op zoom 11.
4. **Compacter formaat**: ketens tussen kruisingen in plaats van losse segmenten (de tussenpunten als
   kleine verschillen, ~30–40% kleiner), coördinaten op 1e-6° (10 cm), één tabel met tags en
   oordeel-uitleg in het manifest in plaats van per blok, en de tussenhoogtes afleiden waar het
   hoogteverschil < 0,5 m is. Byte-shuffling hielp niet (gemeten).
5. **Manifest opdelen** (per provincie of een binaire index): 1.150 blokken met hash ≈ 170 kB JSON.
6. **Bouwen in parallel**: de ondergrondfase is per groep onafhankelijk; met worker-threads schaalt
   hij lineair met het aantal kernen.
7. **Bron**: het Geofabrik-pad levert echte OSM-way-id's en scherpere geometrie; dat moet eerst één keer
   tegen de proef (OpenFreeMap-bron) worden vergeleken met `vergelijk_oordeel.mjs` en de benchmark.
