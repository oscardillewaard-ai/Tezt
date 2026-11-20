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
| 2 Voorbewerkingsscript + Action | bezig |
| 3 Router leest de blokken (`?graaf=vooraf`) | bezig (code staat, wacht op de blokken) |
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
