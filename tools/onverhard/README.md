# Onverhard: hardlooproutes over zo veel mogelijk onverhard

`onverhard.py` plant een hardlooproute in Nederland die zo veel mogelijk over
onverharde paden gaat, en controleert de ondergrond daarna tegen officiële
overheidsdata (de BGT) en de luchtfoto van PDOK. Er zijn geen API-sleutels
nodig.

```
python onverhard.py "lat,lon" ["lat,lon" ...] "lat,lon" -o route
```

Dat levert:

1. `route.gpx`: de route, met de opgegeven punten als waypoints.
2. `route.html`: een kaart (Leaflet) met de route per stuk gekleurd naar
   ondergrond. Je wisselt tussen OpenStreetMap en de PDOK-luchtfoto, kunt de
   BGT-vlakken erbij aanzetten (vanaf zoomniveau 17) en kiest of de kleur het
   eindoordeel, de BGT of OSM volgt. Ernaast staan balken en een tabel met km
   en % per klasse voor OSM, BGT en eindoordeel, de langste zachte stukken en
   de twijfelstukken met hun luchtfoto.
3. `route_luchtfoto/twijfel_NN.png`: per twijfelstuk een uitsnede van
   120 × 120 m met de route erop getekend.
4. Een samenvatting in de terminal: totale afstand, km en % per klasse volgens
   OSM, BGT en het eindoordeel naast elkaar, en de lijst twijfelstukken.

Met `--json` komt er ook een `route.json` met alle cijfers.

## Installatie

Python 3.10 of nieuwer.

```
cd tools/onverhard
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Voorbeelden

```
# Van A naar B
python onverhard.py "51.9921,4.3481" "51.9255,4.4679" -o delft-rotterdam

# Met tussenpunten (via): zo dwing je een mooi pad af dat anders een omweg is
python onverhard.py "51.9921,4.3481" "51.9715,4.3462" "51.9668,4.3550" "51.9255,4.4679" -o via-slinksloot

# Sterke voorkeur voor LAW-paden (landelijke wandelroutes)
python onverhard.py "51.9921,4.3481" "51.9255,4.4679" --law 0.3 -o law

# Een rondje van ongeveer 12 km vanaf één punt
python onverhard.py "51.9921,4.3481" --rondje 12 -o rondje

# Alleen OSM, zonder BGT en luchtfoto (snel)
python onverhard.py "51.9921,4.3481" "51.9255,4.4679" --geen-bgt --geen-luchtfoto
```

Coördinaten zijn `"breedte,lengte"` (lat,lon), zoals je ze uit Google Maps of
OpenStreetMap kopieert. Draai je ze per ongeluk om, dan zegt de tool dat.

`python onverhard.py --help` toont alle opties. De belangrijkste:

| Optie | Betekenis |
|---|---|
| `-o NAAM` | voorvoegsel van de uitvoer (mag een pad zijn, bv. `uit/route`) |
| `--rondje KM` | rondje van ±KM km vanaf het ene opgegeven punt |
| `--law F` | kostenfactor voor LAW-paden: `1.0` geen voorkeur, `0.3` sterke voorkeur |
| `--alternatieven N` | zoveel BRouter-alternatieven per deeltraject langs de BGT leggen (standaard 4, `1` = uit) |
| `--kandidaten N` | aantal richtingen dat voor een rondje geprobeerd wordt (standaard 8) |
| `--min-twijfel M` | twijfelstukken korter dan M meter niet apart noemen (standaard 30) |
| `--max-luchtfotos N` | hooguit N uitsnedes, langste twijfelstukken eerst (standaard 12) |
| `--snap M` | kaartverschuiving die we tolereren tussen de OSM-lijn en een BGT-wegdeel (standaard 3 m) |
| `--geen-bgt`, `--geen-luchtfoto` | sla een bron over |
| `--ververs`, `--geen-cache`, `--cache MAP` | cachegedrag |

Exitcodes: `0` alles gelukt, `1` geen route (BRouter-fout), `2` verkeerde
invoer, `3` route gemaakt maar een bron gaf (deels) een fout.

## Wat de klassen betekenen

| Klasse | Wat je onder je voeten hebt | BGT `fysiek_voorkomen` | OSM `surface` |
|---|---|---|---|
| **onverhard** | gras, zand, aarde, bospad | `onverhard`, `zand`, `groenvoorziening`, alle begroeide terreindelen (grasland, bos, heide, ...) | `ground`, `dirt`, `earth`, `grass`, `sand`, `mud`, `unpaved`, ... |
| **half verhard** | schelpen, grind, gravel | `half verhard` | `gravel`, `fine_gravel`, `compacted`, `pebblestone`, `shells` |
| **open verharding** | klinkers, tegels | `open verharding` | `paving_stones`, `sett`, `cobblestone`, `grass_paver`, ... |
| **gesloten verharding** | asfalt, beton | `gesloten verharding` | `asphalt`, `concrete`, `paved`, ... |
| **onbekend** | geen van de bronnen weet het | `transitie`, `erf`, geen vlak (bv. water) | geen `surface` op een voetpad |

"Zacht" in het rapport is onverhard + half verhard samen.

**Eindoordeel:** de BGT wint als die iets weet, anders geldt OSM.

**OSM-aanname:** heeft een weg geen `surface`-tag, dan gokt de tool op het
wegtype (een `path` of `track` is vermoedelijk onverhard, een fietspad of
woonstraat vermoedelijk verhard). Dat is dezelfde gok die het routeprofiel
doet. De samenvatting zegt hoeveel km zo'n aanname is.

**Twijfelstuk:** een stuk waar je zelf even naar moet kijken. Dat is zo als:

- OSM (met `surface`-tag) en de BGT elkaar tegenspreken tussen zacht en hard;
- de BGT hier geen pad kent en het terreinvlak iets anders zegt dan OSM
  vermoedt;
- geen van beide bronnen iets weet, of er alleen een OSM-aanname is.

Verschillen binnen dezelfde groep (asfalt tegenover klinkers) zijn geen
twijfelstuk. Stukjes korter dan 30 m worden alleen geteld, niet opgesomd.

## Hoe het werkt

### Bron 1: BRouter (routering op OpenStreetMap)

De tool uploadt een eigen profiel naar `brouter.de` en vraagt de route op als
GeoJSON. Uit `properties.messages` komen per stuk de OSM-tags. Het profiel is
het basisprofiel uit de opdracht met vier verfijningen:

- half verhard (`gravel`, `fine_gravel`, `compacted`) kost 1,1 in plaats van 1,
  zodat echt onverhard net iets aantrekkelijker is;
- `tracktype` telt mee voor een `track` zonder `surface` (grade1 = verhard);
- `access=private|no` blokkeert niet als `foot=yes|designated|permissive`;
- `processUnusedTags = true`, zodat BRouter alle tags teruggeeft (ook `bridge`
  en `tunnel`, die we voor de BGT-hoogteligging nodig hebben).

`--law 0.3` betekent: een LAW-pad kost 0,3 keer zoveel als hetzelfde pad
zonder LAW. Technisch worden niet de LAW-paden goedkoper gemaakt maar alle
andere wegen 1/0,3 keer duurder; de verhoudingen zijn dan gelijk en de
kostenfactor blijft overal 1 of hoger.

Valkuilen die in de code zijn afgevangen: BRouter wil lon vóór lat, weigert
onbekende `surface`-waarden in een profiel (`woodchips`, `pebblestone`, `mud`,
`shells`, `bricks`, ...), kent geen `min(...)`, geeft `403 Please, retry
later!` als je te snel vraagt (de tool wacht minstens 1 s tussen verzoeken en
probeert het opnieuw), en een profiel-id verloopt na een tijd (dan uploadt de
tool het profiel opnieuw).

### Bron 2: BGT via PDOK (officiële ondergrond)

Via de OGC API Features van PDOK haalt de tool de collecties `wegdeel`,
`ondersteunendwegdeel`, `onbegroeidterreindeel` en `begroeidterreindeel` op
in een corridor van ±15 m rond de route. Daarbij:

- staan `bbox-crs` en `crs` expliciet op RD New (EPSG:28992); de tool
  controleert de `Content-Crs`-header en gooit vlakken weg die niet echt in de
  bbox liggen;
- worden de `next`-links gevolgd (paginering);
- staat `datetime=<nu>` in het verzoek. Zonder die parameter levert de API ook
  alle historische versies van elk vlak (in het centrum van Rotterdam scheelt
  dat een factor 3 tot 4 in grootte);
- is de corridor opgeknipt in kleine bboxen (per rastercel van 500 m alleen de
  strakke bbox van het routedeel in die cel). Een hele tegel van 500 m in een
  stadscentrum is al gauw 7 MB; zo'n routedeel meestal minder dan 1 MB;
- worden bermen en terreindelen alleen opgehaald waar de route niet op een
  wegdeel ligt. Dat halveert het aantal verzoeken.

De route wordt in stukken van hooguit 50 m geknipt. Per stuk leggen we om de
5 m een meetpunt op de lijn (in RD-meters, via shapely) en kijken we in welk
BGT-vlak het ligt; de klasse met de grootste overlap wint voor dat stuk. Per
meetpunt:

1. ligt het op een **wegdeel**, dan geldt dat wegdeel;
2. ligt het binnen 3 m van een wegdeel (de OSM-lijn en de BGT liggen zelden
   exact op elkaar), dan geldt dat wegdeel. Heeft OSM een `surface`-tag, dan
   gebruikt de tool die om te kiezen tussen het wegdeel ernaast en het
   terreinvlak waar de lijn in ligt: een graspad langs een asfaltweg wordt zo
   niet per ongeluk asfalt;
3. anders geldt het terreinvlak of de berm ("geen pad geregistreerd"). Zo
   tellen graspaden mee die niet als pad in de BGT staan;
4. ligt er niets (water, buiten dekking), dan is de BGT onbekend.

Op een brug (`bridge=yes` in OSM) kiest de tool het BGT-vlak met een positieve
`relatieve_hoogteligging`, in een tunnel een negatieve, anders niveau 0.

### Ronde 2: de BGT stuurt de route bij

Na de eerste route vraagt de tool per deeltraject (van punt naar punt) de
BRouter-alternatieven `alternativeidx=0..3` op en legt ze allemaal langs de
BGT. Voor elk alternatief worden de routekosten opnieuw uitgerekend met de
kostenfactoren uit het profiel, maar met de ondergrond van het eindoordeel in
plaats van de OSM-tags. Het alternatief met de laagste kosten wint. Stukken
die volgens de BGT verhard zijn, worden zo ontmoedigd; de lengte en een
eventuele LAW-voorkeur blijven meetellen. De terminal en het HTML-rapport
tonen de vergelijking.

### Rondje

Voor `--rondje` legt de tool in acht windrichtingen een cirkel door het
startpunt, zet daar drie tussenpunten op en past de straal in hooguit vier
stappen aan tot de lengte klopt. Kandidaten binnen ±10% van de gevraagde
lengte worden gerangschikt op het aandeel zacht volgens OSM; de beste drie
gaan langs de BGT en de meest onverharde volgens het eindoordeel wint. Het
deel dat heen en terug over hetzelfde pad gaat telt half als minpunt.

### Bron 3: luchtfoto van PDOK

De tool leest GetCapabilities van de WMS en kiest de laag `Actueel_orthoHR`
(±8 cm). Voor elk twijfelstuk komt er een uitsnede in RD-coördinaten met de
route als twee randlijnen erop (roze = het twijfelstuk, wit = de rest), zodat
de ondergrond onder de lijn zichtbaar blijft, plus een schaalbalk en de
oordelen van OSM en BGT.

De **kleurindicatie** kijkt naar een strook van 2 m onder de lijn: groenig
wijst op begroeiing (onverhard), grijs op verharding. Het is nadrukkelijk een
indicatie en geen meting: de drempels zijn afgesteld op één gebied, het beeld
is vaak in winterlicht met lange schaduwen, en zand en klinkers hebben
dezelfde kleur. In de schaduw of onder bomen zegt de tool daarom "niet te
beoordelen".

## Keuzes die ik gemaakt heb

- **Eigen GPX-schrijver** in plaats van `format=gpx` bij BRouter. De
  eindroute is na ronde 2 samengesteld uit per deeltraject gekozen
  alternatieven; zo is de GPX gegarandeerd dezelfde lijn als in het rapport.
- **Ronde 2 kiest op kosten, niet op het hoogste percentage onverhard.** Met
  alleen het percentage koos de tool bij `--law 0.3` een korter alternatief
  dat de LAW grotendeels links liet liggen. Kosten met BGT-ondergrond
  ontmoedigen verharding en respecteren LAW en lengte.
- **Alleen conflicten tussen zacht en hard zijn twijfelstukken**, om de lijst
  kort en bruikbaar te houden.
- **De BGT wint ook als de luchtfoto iets anders suggereert.** De kleurmaat is
  te grof om een registratie te overrulen; het stuk komt wel in de twijfellijst
  met foto, zodat jij kunt beslissen.
- **Leaflet komt van unpkg** (met SRI-hash). Het HTML-bestand heeft dus
  internet nodig, net als de kaarttegels.
- **De cache staat naast het script** (`cache/`): routes 7 dagen, BGT 30
  dagen, luchtfoto's 90 dagen. `--ververs` haalt alles opnieuw op.
- **User-Agent** is `onverhard-planner/1.0`, zonder contactgegevens.

## Beperkingen

- **De BGT is zo actueel als de bronhouder haar bijhoudt.** Gemeenten,
  waterschappen en provincies werken hun deel elk in eigen tempo bij. Een
  nieuw of verlegd pad kan ontbreken of nog de oude ondergrond hebben. In de
  testroute staat een grasstrook langs een sloot in Rotterdam-Overschie als
  "voetpad, gesloten verharding"; de luchtfoto laat gras zien.
- **Smalle graspaden staan vaak niet als pad in de BGT.** De tool valt dan
  terug op het terreinvlak (grasland = onverhard). Dat klopt meestal, maar de
  BGT zegt daarmee niets over of er werkelijk een pad loopt.
- **Geen enkele bron zegt iets over modder**, begaanbaarheid, mul zand,
  hoogwater, hekken, vee of het maaibeheer. Een ruiterpad van los zand telt
  als prima onverhard, terwijl je benen daar anders over denken.
- **De lijn van OSM en de vlakken van de BGT liggen niet exact op elkaar.** De
  tolerantie van 3 m vangt het meeste op; bij een pad vlak naast een weg kan
  het toch misgaan.
- **De luchtfoto is een momentopname** (deels winter-, deels zomerbeeld).
  Onder bomen is een pad niet te zien.
- **Alternatieven zijn geen volledige zoektocht.** Ronde 2 kiest uit hooguit
  vier routes van BRouter per deeltraject. Mooie onverharde paden die een
  omweg zijn, vind je nog steeds het best door zelf tussenpunten op te geven.
- **Een rondje haalt de lengte niet in elke richting**; zo'n kandidaat valt
  af. Tussenpunten kunnen op een doodlopend pad landen, wat een stukje heen en
  terug geeft (het rapport noemt het percentage).
- **Alleen Nederland**: de BGT en de luchtfoto dekken alleen Nederland.
- De eerste run van een route van 18 km doet ongeveer 500 verzoeken aan PDOK
  en duurt een paar minuten; daarna komt bijna alles uit de cache (ca. 10 s).

## Testen

Offline tests van de rekenkern (geen netwerk nodig):

```
pip install pytest
python -m pytest test_onverhard.py -q
```

Acceptatietest met de echte bronnen (uitkomsten van 13 november 2026; ze
veranderen mee met OSM en de BGT):

| Test | Afstand | Zacht OSM | Zacht BGT | Zacht eind | LAW |
|---|---|---|---|---|---|
| Delft → Rotterdam via het Slinksloot-graspad | 17,97 km | 60,7% | 60,1% | 60,1% | 8% |
| Zelfde zonder tussenpunten | 18,21 km | 64,9% | 61,0% | 61,0% | 0% |
| Zelfde met `--law 0.3` | 23,32 km | 40,6% | 35,2% | 35,4% | 77% |
| `--rondje 12` vanaf de Pijperring | 11,64 km | 52,8% | 58,9% | 58,9% | 0% |

## Bronnen

- Routering: [BRouter](https://brouter.de) op data van © OpenStreetMap-bijdragers (ODbL).
- Ondergrond: Basisregistratie Grootschalige Topografie (BGT), Kadaster, via [PDOK](https://www.pdok.nl) (CC0).
- Luchtfoto: PDOK luchtfoto RGB, Het Waterschapshuis / Beeldmateriaal Nederland (CC BY 4.0).

De tool gebruikt de publieke servers van BRouter en PDOK. Wees er zuinig op:
laat de cache aan en draai geen grote aantallen routes achter elkaar.
