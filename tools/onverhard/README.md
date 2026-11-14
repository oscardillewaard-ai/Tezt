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

Er is ook een **webversie** die op je telefoon werkt, zonder installatie:
zie [Webversie](#webversie) hieronder.

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

## Webversie

In `public/onverhard/` van deze repo staat de planner als webapp, gemaakt voor
**trailrunnen**: `https://oscardillewaard-ai.github.io/Tezt/onverhard/`. Alles
draait in je browser; er is geen eigen server.

**Opbouw**: vier stappen met een stappenbalk bovenaan: 1 soort route (vijf
kaarten, of een GPX openen), 2 waar (zoeken, tikken of tekenen), 3 opties
(lengte, vorm, instellingen, plannen), 4 route (resultaat met tabbladen
Hoogte, Water en Ondergrond; Aanpassen en Nieuwe route). De kaart blijft
steeds in beeld.

**Wat je ermee doet**

- **Van A naar B**: zoek een plek (adres, straat, postcode, plaats; via de
  PDOK Locatieserver) of tik op de kaart. Elk volgend punt wordt het nieuwe
  eindpunt; de punten ertussen zijn tussenpunten.
- **Rondje**: kies een startpunt en een lengte. Standaard ("Grote lus") maakt
  de app rondjes zoals mensen ze zelf tekenen: heen over het ene pad, terug
  over een ander (zie hieronder). "Kronkelen in de buurt" zigzagt door een
  compact gebied. Je krijgt er minstens twee die echt van elkaar verschillen.
- **Rondje via een keerpunt**: tik in de modus Rondje een tweede punt. Heen en
  terug gaan dan via verschillende paden. De app probeert terugwegen opzij en
  voorbij het keerpunt (zodat je doorloopt in plaats van omkeert) en biedt
  alleen echte lussen aan: hooguit 15% van de terugweg over de heenweg.
- **In gebied**: teken een gebied op de kaart (met je vinger rondom, of een
  rechthoek), bijvoorbeeld een bos, en tik eventueel een startpunt. De app
  maakt rondjes die binnen het gebied blijven: paden erbuiten kosten 30 keer
  zo veel, en de hoekpunten van een rondje moeten erbinnen liggen. Rondjes
  worden gezocht in een paar groottes (tot zo'n 3,5 keer de verste afstand
  die je in het gebied kunt halen). Is één rondje korter dan de gevraagde
  lengte, dan worden het meerdere rondjes achter elkaar, afwisselend twee
  verschillende. Elsenburgerbos, 8 km: vier rondjes van 2 tot 2,5 km, 99%
  onverhard, 0% buiten het bos.
- **Elke straat**: teken een gebied en kies straten, paden of beide. De app
  maakt één rondje dat elke straat (of elk pad) in het gebied minstens één
  keer loopt, zo kort mogelijk: losse stukken verbinden via de kortste weg,
  knopen met een oneven aantal wegen twee aan twee koppelen (dichtstbijzijnde
  eerst) en die verbinding dubbel lopen, en dan een Euler-rondje (Hierholzer).
  Stukken achter een hek of afgesloten pad die vanaf de start niet te bereiken
  zijn, noemt de app apart. "Doodlopende straten overslaan" (standaard aan)
  pelt het netwerk af vanaf de losse eindjes; een straat die als voetpad
  doorloopt is voor een hardloper niet doodlopend. Na het gretig koppelen
  ruilt de app paren als dat korter is. Een startpunt buiten het gebied telt
  niet mee. Delft binnenstad, straten: 48 km straat, route 62,4 km (23% extra;
  lange paren krijgen een tweede ronde ruilen met verder weg gelegen knopen). Elsenburgerbos, alle paden: 9,2 km paden, route
  12,1 km (24% dubbel of verbinding).
- **Tekenen**: trek met je vinger de route die je wilt lopen. De app zoekt de
  paden die de lijn volgen: een pad binnen 20 m van de lijn is bijna gratis,
  op 60 m tien keer zo duur. Eindig bij het begin voor een rondje.
- **Hoogtemeters**: bij elke route het aantal meters stijgen en dalen, een
  hoogteprofiel (wijs het aan en een stip op de kaart laat zien waar je bent)
  en de hoogte in de GPX. Bron: het AHN (maaiveld) via de WCS-dienst van PDOK,
  in blokken van 500 × 500 m met 10 m per pixel (zo'n 9 kB per blok), alleen
  de blokken waar de route doorheen gaat. De app leest het GeoTIFF zelf
  (32-bits kommagetallen, zlib, floating point predictor). Langs de route om
  de 10 m een hoogte, licht gladgestreken; stijgingen onder 2 m tellen niet
  (ruis van sloten en wallen). Komoot noemt duidelijk minder (Veluwezoom 131
  m, Schoorl 116 m, Loonse Duinen 17 m) dan het AHN langs dezelfde routes (264,
  254 en 45 m): Komoot gebruikt een grove hoogtekaart die duinen afvlakt. Bij
  heel lange routes (meer dan 160 blokken) gebruikt de app de hoogtes van
  BRouter (SRTM) en zegt dat erbij.
- **Route verslepen**: pak de route en sleep. Bij Rondje, In gebied en
  Tekenen rekent de app alleen het stuk rond de greep opnieuw (tot het
  dichtstbijzijnde vaste punt, hooguit 12% van de route of 1,5 km naar elke
  kant) op het netwerk van de planning, dus meteen. Het punt wordt een
  handvat: nog eens slepen, of tikken om weg te halen. Bij A naar B komt er
  een tussenpunt bij en wordt de route opnieuw gepland.
- **Water onderweg**: drinkwaterpunten, horeca, supermarkten, toiletten en
  tankstations binnen 300 m van de route (uit de laag 'poi' van de
  OpenFreeMap-tegels), met de km waar je ze tegenkomt en het langste stuk
  zonder. "Via hier" laat de route erlangs lopen (zoals verslepen).
- **Route afspelen**: ▶ laat een loper over de route gaan (hele route in 40 s,
  of 2× / 4× zo snel); de kaart volgt en het hoogteprofiel wijst mee.
  Spatie = afspelen/pauze.
- **Meer hoogtemeters** (instelling): meer kandidaat-rondjes, voor elk het AHN
  gemeten, en een bonus voor meters stijgen per km (vol bij 15 m/km). N70,
  15 km: route A van ↗ 159 naar ↗ 228 m (90 in plaats van 96% onverhard).
- **Soort paden "Maakt niet uit (ook verhard)"**: geen voorkeur voor
  onverhard, alleen drukke wegen zijn wat duurder.
- In gebied met onverhard als voorkeur maakt de app ook een route over élk
  onverhard pad in het gebied (zo nodig een paar keer rond); in een stadspark
  wint die vaak (Wilhelminapark Rijswijk: 25% in plaats van 11% onverhard).
- **Stukje weghalen**: tik op de route, dan "✂ Haal dit stukje weg". Het
  kleinste uitstapje rond die plek dat bij dezelfde knoop terugkomt (een
  lusje, heen en terug naar een doodlopend eind) verdwijnt; is er geen, dan
  loopt dat stuk een andere weg. Ook bij Elke straat.
- **GPX openen**: een bestaande route (knop of slepen op de pagina) bekijken
  met de paden eronder (dichtstbijzijnde pad binnen 15 m), de officiële kaart,
  hoogte en water.
- **Bewaren**: "★ Bewaar" zet de route (met de punten of tekening) in de
  browser; "Mijn routes" in stap 1 opent of verwijdert ze.
- **Rechtermuisknop of lang drukken op de kaart**: start, eindpunt of
  tussenpunt hier, rondje vanaf hier, route via hier, inzoomen, coördinaten.
- **Lusjes**: komt een rondje na een omweg van hooguit 800 m weer binnen 40 m
  van een eerder punt, en is er een korte verbinding, dan valt de omweg weg.
- **Ongedaan maken**: ↶ (of Ctrl+Z, Ctrl+Y om opnieuw te doen) draait punten,
  tekeningen, modus en lengte terug, en brengt ook de vorige route terug (na
  "Opnieuw" of na een nieuwe planning).
- **Sneltoetsen**: 1–5 soort route, P plan, T teken, R rechthoek, Esc stop,
  Backspace laatste punt weg, G GPX, L locatie, N opnieuw beginnen, ? uitleg.
- **Routes vergelijken**: je krijgt routes A, B, … (A is de aanbevolen). Tik
  een route om hem te kiezen. Met "op kaart" zet je routes gestippeld naast
  elkaar; tik op zo'n stippellijn om die route te kiezen.
- **Kleur de route naar** het eindoordeel, de officiële kaart (BGT) of
  OpenStreetMap, met tabel, twijfelstukken met luchtfoto en een GPX-download.
- Licht, donker of automatisch thema (knop rechtsboven).

**Instellingen**

- *Soort paden*: "Smalle paadjes eerst (trail)" is de standaard. Dan kost een
  `path` 1, een onverhard `footway` 1, een brede zandweg (`track`) of
  ruiterpad 1,3, een voetpad zonder ondergrond (vaak een stoep) 2,5 en
  verharding 3 tot 8. Paadjes zonder `surface`-tag (in duinen en bossen vaak
  zo) tellen dus ook als fijn. "Alles wat onverhard is" gebruikt het profiel
  van het Python-script.
- *Strand overslaan* (standaard aan): aan de tags van OpenStreetMap zie je
  niet of een zandpad op het strand ligt. De officiële kaart weet het wel: het
  strand is een zandvlak zonder pad, vlak bij een watervlak van het type
  "zee". Zandverstuivingen in de duinen tellen dus niet als strand. Loopt een
  route over het strand, dan vraagt de app hem opnieuw op met no-go-zones
  (BRouter-parameter `nogos`) op die stukken. Die nieuwe route telt alleen
  als hij niet veel langer wordt en niet meer heen en terug gaat; anders
  meldt de app hoeveel strand er nog in zit.
- *Hoeveel routes vergelijken*: 2 (standaard), 4, 1, of 1 zonder officiële
  kaart. Gaat een rondje via BRouter, dan is "1 route" ook een snelle
  zoektocht (6 richtingen en 5 in plaats van 7 routes per lus): ongeveer half
  zo lang wachten, maar duidelijk minder mooie rondjes (in de vergelijking met
  Komoot bijvoorbeeld Meijendel 56% in plaats van 75% onverhard). Voor de
  eigen planner maakt het voor de kwaliteit niet uit.
- *Luchtfoto's bij twijfelstukken* (standaard uit): een uitsnede van de
  luchtfoto bij elk twijfelstuk, met een kleurindicatie. In de praktijk voegde
  het weinig toe, daarom staat het uit.
- *Ik heb een toegangskaart* (standaard uit): in duinen van waterbedrijven
  (Kijfhoek en de Bierlap van Dunea, de Amsterdamse Waterleidingduinen, PWN)
  staan veel paden of de toegangen ernaartoe in OpenStreetMap als afgesloten
  (`access=no`, `foot=no`), terwijl je er met een dagkaart wel mag lopen. Het
  paden-netwerk binnenin is dan voor elke planner een "eilandje". Met het vinkje
  mogen afgesloten paden meedoen, 30% duurder dan open paden, zodat open paden
  voorgaan. Alleen midden in de natuur (de officiële kaart rondom: duin, bos,
  heide); een afgesloten stuk bij bebouwing of op een erf wordt alsnog met
  no-go-zones vermeden. De app meldt hoeveel km een kaartje nodig heeft.
  Militair terrein en tijdelijk afgesloten natuur zien er op de kaart net zo
  uit: de borden ter plekke gaan voor.
- *Vorm van het rondje*: "Grote lus" of "Kronkelen in de buurt". Kronkelen
  legt vijf tussenpunten in een ster om een middelpunt, afwisselend ver en
  dichtbij, zodat de route door een compact gebied zigzagt. Een rondje dat
  meer dan 25% heen en terug gaat, biedt de app alleen aan als er niets anders
  is.

**Rondjes rekent de app zelf uit** (sinds november 2026). Een rondje vanaf
één punt gaat niet meer via de BRouter-server, maar zo:

1. De app haalt alle wegen en paden rond de start op (straal ongeveer
   0,38 × de lengte) uit de **kaarttegels van
   [OpenFreeMap](https://openfreemap.org)**: OpenStreetMap-data in de
   OpenMapTiles-indeling, zoomniveau 14 (in Nederland zo'n 1,5 km per tegel),
   op een groot CDN zonder limiet of sleutel. De browser bewaart de tegels
   (het adres verandert met elke kaartversie), dus een tweede rondje in
   dezelfde buurt kost geen download. Een rondje van 13 km: 50 tot 80 tegels,
   een paar MB. Tegels zijn gemaakt om te tekenen: soms valt het punt weg waar
   een pad op een weg aansluit, en aan de tegelrand worden lijnen afgeknipt.
   Daarom knoopt de app losse eindjes binnen 1,5 m aan het dichtstbijzijnde
   segment. Lukken de tegels niet, dan haalt hij de paden bij de
   [Overpass API](https://overpass-api.de) (meer detail, maar de gratis
   servers zijn vaak overbelast).
2. Van die paden maakt hij een netwerk (`graaf.js`) met dezelfde kosten als
   het BRouter-profiel: smalle onverharde paadjes het goedkoopst, asfalt het
   duurst. Strand (in OpenStreetMap `natural=beach`) is bijna verboden; een
   afgesloten pad doet alleen mee met het vinkje voor de toegangskaart.
3. Per windrichting (24) en afstand (4 ringen) zoekt hij de plek met de
   mooiste weg ernaartoe. Uit die plekken probeert hij een paar honderd
   driehoeken start → A → B → start ("Kronkelen": vier hoeken dicht bij de
   start); wat al gelopen is krijgt straf, zodat het een echte lus wordt, en
   doodlopende uitstapjes vallen weg. Dat kost minder dan een seconde.
4. De beste vijf legt hij langs de officiële kaart. Vindt die strand of
   afgesloten stukken buiten de natuur die OpenStreetMap niet zo kent, dan
   zoekt hij nog één keer met die plekken verboden.

Een rondje duurt zo een paar seconden in plaats van een paar minuten. Lukken
tegels én Overpass niet, dan rekent de app het rondje via BRouter zoals
hieronder en zegt dat erbij.

Tegels of Overpass maakt voor de rondjes weinig uit (route A, onverhard
volgens de officiële kaart, zelfde start): Rockanje 95% / 95%, N70 93% / 94%,
Schoorl 95% / 95%, Loonse Duinen 97% / 97%, Veluwezoom 98% / 99%. De tegels
kennen de ondergrond alleen als verhard of onverhard (geen tracktype); de
officiële kaart vult dat bij de controle aan. Een voorkeur
voor LAW-routes gaat ook via BRouter: alleen BRouter kent de wandelroutes.

**Via BRouter** (rondje via een keerpunt, van A naar B, of als Overpass niet
antwoordt). Per windrichting (8) legt de
app een keerpunt op ongeveer een kwart van de lengte; Komoot-rondjes zijn
3,4 tot 5,3 keer zo lang als hun verste punt. Het keerpunt wordt naar de
natuur getrokken (de officiële kaart, 100 m rondom: duin, bos, heide tellen,
bebouwing, verharding en zee niet), van een "eilandje" af gehaald (paden die
alleen via afgesloten wegen bereikbaar zijn: BRouter meldt dan "target
island") en van een doodlopend pad. Dan zoekt hij een brede lus: de heenweg
direct of via een punt links of rechts van de rechte lijn, de terugweg direct,
via links of rechts of schuin voorbij het keerpunt. Van al die combinaties
wint het paar dat echt een lus is (hooguit 15% van de terugweg over de
heenweg), het meeste onverhard en smalle paadjes heeft en het dichtst bij de
gevraagde lengte komt. Zit de lengte er meer dan 20% naast, dan schuift het
keerpunt en volgt nog één poging. De verhouding lengte / afstand tot het
keerpunt leert de app van de vorige richtingen.

Bij de eindkeuze gaan rondjes met hooguit 15% heen en terug voor. Daarbinnen
telt het aandeel onverhard, smalle paadjes (bij trail), aftrek voor heen en
terug en strand, en een lengte buiten ±10% kost veel punten.

"Kronkelen in de buurt" legt vijf tussenpunten in een ster om een middelpunt
(afwisselend ver en dichtbij), met dezelfde correcties voor zee, eilandjes en
doodlopende paden.

De publieke BRouter-server antwoordt bij te veel verzoeken tegelijk met
"probeer later". Daarom stuurt de app één verzoek tegelijk (minstens een
seconde ertussen). Een rondje kost daardoor al gauw een paar minuten.

**Vergelijking met Komoot, eigen planner** (`benchmark_eigen.mjs`): zes
trailgebieden, elk met een Komoot-hardlooproute als referentie, zelfde start
en lengte, onverhard gemeten langs de officiële kaart:

| Gebied | Komoot | Eigen planner, route A | Heen en terug (A) | Via BRouter (A) |
|---|---|---|---|---|
| Meijendel (15 km) | 63% | 99% (15,7 km) | 3% | 75% |
| Voornes Duin, Rockanje (13 km) | 96% | 95% (13,8 km), 0 m strand | 1% | 54% zonder strand |
| N70, Berg en Dal (15 km) | 79% | 95% (14,9 km) | 1% | 86% |
| Schoorlse Duinen (14 km) | 88% | 95% (14,4 km) | 1% | 94% |
| Loonse en Drunense Duinen (11 km) | 97% | 99% (11,4 km) | 0% | 92% |
| Veluwezoom (15 km) | 89% | 99% (15,5 km) | 1% | 96% |

Rekentijd 0,4 tot 1,8 seconde per gebied, plus 2 tot 5 seconden voor de
officiële kaart. De paden voor deze meting zijn opgehaald met een vierkant in
plaats van een cirkel en mét opritten en stoepen (een iets ruimere download
dan de app nu doet). Komoot staat hier hoger dan in de eerdere tabel omdat de
fout in het lezen van de officiële kaart (zie onder) eruit is.

**Eerdere vergelijking, via BRouter** (`benchmark_rondjes.mjs`): zes trailgebieden, elk
met een Komoot-hardlooproute als referentie, zelfde start en lengte. Onverhard
gemeten langs de officiële kaart (voor Komoot hebben we geen OpenStreetMap-tags):

| Gebied | Komoot | Onze route A | Heen en terug (A) |
|---|---|---|---|
| Meijendel (15 km) | 63% | 75% | 3% |
| Voornes Duin, Rockanje (13 km) | 92% | 67% (92% smalle paadjes) | 0% |
| N70, Berg en Dal (15 km) | 79% | 89% | 24% (zie onder) |
| Schoorlse Duinen (14 km) | 88% | 94% (11,6 km) | 0% |
| Loonse en Drunense Duinen (11 km) | 97% | 94% | 2% |
| Veluwezoom (15 km) | 89% | 96% | 9% |

Na deze meting is de grens voor heen en terug van 25% naar 15% gegaan. De 67%
bij Rockanje bleek een fout in het lezen van de officiële kaart: een object
dat uit losse delen bestaat (het strand van Voornes Duin) kwam alleen met de
delen uit de eerste tegel binnen. Na de reparatie is die route 97% onverhard,
maar met 1,9 km strand; zonder strand haalde BRouter daar maar 54%.

**Verschillen met de Python-tool**

| | Python-tool | Webversie |
|---|---|---|
| Profiel | onverhard (klassiek) | standaard trail; klassiek kan ook |
| Officiële kaart ophalen | OGC API Features (GeoJSON per bbox) | **vectortegels** van PDOK (zoomniveau 12, 215 × 215 m) |
| Strand | niet apart | herkend en standaard vermeden |
| Rondje via keerpunt, zoeken, routes vergelijken | nee | ja |
| Omrekenen naar RD | pyproj | benaderingsformules (binnen 0,3 m van pyproj) |
| Kleurindicatie luchtfoto | kleur + textuur | alleen kleur |
| Cache | map `cache/` op schijf | de browser bewaart kaarttegels een uur |

De vectortegels bevatten dezelfde vlakken als de OGC API (gecontroleerd:
dezelfde `lokaal_id`'s in drie tegels, randen binnen 5 cm), maar compact
gecodeerd. Een route van 18 km kost daardoor 5 tot 15 MB in plaats van 27 tot
109 MB, en het geheugen van de browser blijft rond de 30 MB in plaats van tot
400 MB. Met het klassieke profiel geeft de webversie op de testroutes dezelfde
uitkomst als de Python-tool: hooguit 29 m verschil per ondergrondklasse op
18 km. Elk verzoek heeft een tijdslimiet van 90 seconden, zodat een server
die niet reageert de app niet laat vastlopen.

**Testen van de webversie**

```
node --test tools/onverhard/test_web_kern.mjs          # offline: rekenkern, tegellezer, strand, doodlopend
NODE_USE_ENV_PROXY=1 node tools/onverhard/vergelijk_web.mjs uit/test.json "51.9921,4.3481" ...   # naast Python leggen
(cd public && python3 -m http.server 8765) &
node tools/onverhard/test_web_e2e.mjs <map> uit/test.json 'p=51.9921,4.3481;51.9255,4.4679&trail=0&strand=0'
NODE_USE_ENV_PROXY=1 node tools/onverhard/benchmark_rondjes.mjs <map met komoot-gpx> [uit.json] [gebied ...]   # BRouter-rondjes naast Komoot
NODE_USE_ENV_PROXY=1 node tools/onverhard/benchmark_eigen.mjs <map met komoot-gpx> [uit.json] [gebied ...]     # eigen rondjes naast Komoot
```

`NODE_USE_ENV_PROXY=1` is alleen nodig achter een proxy. De end-to-end-test
gebruikt Playwright uit de `node_modules` van de repo; zet `CHROMIUM_PAD` als
die geen eigen browser heeft, en `ONVERHARD_URL` om de live site te testen.
Met `ONVERHARD_OVERPASS=<bestand>` beantwoordt de test de Overpass-vraag met
een eerder opgehaald antwoord (handig als Overpass druk is).

## Bronnen

- Routering: [BRouter](https://brouter.de) op data van © OpenStreetMap-bijdragers (ODbL); in de webversie rondjes zelf berekend op OpenStreetMap-data uit de kaarttegels van [OpenFreeMap](https://openfreemap.org) (OpenMapTiles-indeling) of via de [Overpass API](https://overpass-api.de).
- Ondergrond: Basisregistratie Grootschalige Topografie (BGT), Kadaster, via [PDOK](https://www.pdok.nl) (CC0): OGC API Features in de Python-tool, vectortegels in de webversie.
- Luchtfoto: PDOK luchtfoto RGB, Het Waterschapshuis / Beeldmateriaal Nederland (CC BY 4.0).
- Hoogte: Actueel Hoogtebestand Nederland (AHN, maaiveld 0,5 m), Rijkswaterstaat / Het Waterschapshuis, via [PDOK](https://www.pdok.nl) (CC0).
- Kaartstijl en lettertypes van de webversie: overgenomen van de Tarapp in deze repo (Barlow Condensed en IBM Plex Mono, SIL Open Font License).

De tool gebruikt de publieke servers van BRouter en PDOK. Wees er zuinig op:
laat de cache aan en draai geen grote aantallen routes achter elkaar.
