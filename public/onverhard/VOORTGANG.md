# Nopav.es: voortgang UX en snelheid

Uitgangspunt: commit `f58e0da`, service worker `onverhard-v36`. Terugzetpunt: tag `voor-ux`.

## Hervatten

Begint een sessie met "ga verder": lees dit bestand en ga verder bij de eerste stap die niet
`klaar` is. Doe klare stappen niet opnieuw.

## Belangrijke keuze over "main"

De opdracht zegt "main = live", maar in de repo bestaat **geen** branch `main`. GitHub Pages
bouwt (zie `.github/workflows/deploy-pages.yml`) vanaf `claude/gpx-ultrarace-trainingen-zf6zci`,
en dat is ook de standaardbranch (HEAD). Veiligste redelijke keuze:

- lokaal heet de integratielijn `main`; die push ik naar de sessiebranch `ccr-c02c1fc3-wix11n`,
  samen met de fasebranches (`ux-fase-1`, ...) en de tags (`na-ux-1`, ...);
- **tags kunnen niet gepusht worden**: de git-proxy van deze omgeving weigert `refs/tags/*` (HTTP 403),
  branches gaan wel. De tags (`voor-ux`, `na-ux-1`, ...) staan daarom lokaal én als branch
  `terugzet/<tag>` op GitHub (bv. `terugzet/voor-ux`, `terugzet/na-ux-1`);
- ik push **niet** zelf naar de livebranch, omdat de naam in de opdracht niet bestaat en een
  verkeerde gok de live site raakt. Live zetten is één commando (zie "Terugzetten en live zetten").

## Status

| Stap | Status |
|---|---|
| UX fase 1: controles a–e | klaar |
| UX fase 1: bouwen 1–8 | klaar (tag `na-ux-1`) |
| UX fase 2 | klaar (tag `na-ux-2`) |
| UX fase 3 | klaar (tag `na-ux-3`) |
| Snelheid stap 0 (meten) | klaar |
| Snelheid stap 1–5 | klaar |
| Snelheid stap 6 (eigen router) | bezig |
| Hermeting na stap 6 | todo |

## Testen

```
node --test tools/onverhard/test_web_kern.mjs
npx oxlint public/onverhard
(cd public && python3 -m http.server 8765) &
CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/test_web_nopaves.mjs <map> mobiel
CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/test_web_nopaves.mjs <map> desktop
CHROMIUM_PAD=/opt/pw-browsers/chromium node tools/onverhard/screens_ux.mjs <label> [query]
```

Baseline op `f58e0da`: 42 unit-tests groen, Playwright mobiel en desktop groen.

## UX fase 1

### Controles (vóór het bouwen)

**a. Score: onverhard, of onverhard + half verhard?** Onverhard + half verhard.
`kern.js` `nopavesScore`: `0,75 × zachtAandeel(eind) + 0,15 × paadjes + 0,10 × (1 − langste
verharde stuk / 2 km) − (heen en terug + 2 × strand)`, en `zachtAandeel` telt `groep() === 'zacht'`
= onverhard én half verhard. De tegel ("54% onverhard + half verhard") was dus juist; de
piekbalk en de routelijst ("54% onverhard") noemden hetzelfde getal ten onrechte alleen
"onverhard". De strook (26% / 28%) toonde de klassen apart. Score 50 bij 54%: 0,75 × 54 = 40,5,
plus paadjes en het verharde stuk, min dubbel.

**b. PDOK Locatieserver.** `bronnen.js` `zoekPlaats()`, aangeroepen vanuit `app.js` `zoek()`
(300 ms na typen, vanaf 3 tekens). Let op: de app gebruikt het **`/free`**-eindpunt, niet
`/suggest` (`api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=…&rows=7&fl=weergavenaam,type,centroide_ll`).
Er werd geen plek meegestuurd. `/free` kent net als `/suggest` de parameters `lat`/`lon`; die
geven treffers in de buurt voorrang. Ik ben bij `/free` gebleven (geeft meteen de coördinaat;
`/suggest` vraagt een tweede `lookup`-verzoek per keuze).

**c. Web app manifest.** Bestaat al: `manifest.webmanifest`, `display: standalone`, naam,
`theme_color` papier `#F1F3D4`, `background_color` mos `#4F6B2A`, pictogrammen 192 en 512.
Alleen `id` en `purpose: any` toegevoegd.

**d. prompt() en confirm()** (in `app.js` op `f58e0da`):
- `prompt('Kopieer deze link:')` als terugval bij Link kopiëren (r. 1965);
- `confirm('"…" verwijderen?')` bij een bewaarde route (r. 2102);
- `prompt('Naam van de route')` bij Bewaar (r. 2115);
- `prompt('Coördinaten:')` als terugval in het kaartmenu (r. 2305).
Vervangen in fase 2 (stap 6). De twee kopieer-terugvallen gaan via de nieuwe functie `kopieer()`.

**e. `name` in de OpenFreeMap-laag `park`.** Gecontroleerd door de tegels zelf te decoderen
(`tiles.openfreemap.org/planet/20261115_080022_pt`, z10, z12, z14) bij Meijendel, de Veluwezoom en
Schoorl. Uitkomst: **anders dan het OpenMapTiles-schema zegt staat `name` (en `name_en`,
`name_de`, `name_int`) wél op het vlak** (bv. vlak id 110158313 `name: Meijendel`,
`class: nature_reserve`). Het **labelpunt** met hetzelfde id heeft daarnaast `name:nl` en
`rank`. `class` is rommelig (soms `Natura 2000-gebied`, `Natuurnetwerk Nederland (NNN)`,
`Akte van redemptie`) en vlakken zonder naam komen voor (`{class: nature_reserve}`).
Voor fase 3: de naam kan van het vlak komen; `name:nl` via het labelpunt (zelfde id).

Daarnaast vooraf getest voor fase 3: **PDOK Natura 2000** (`api.pdok.nl/rvo/natura2000/ogc/v1`,
collectie `natura2000`) geeft `Access-Control-Allow-Origin: *`; een bbox rond Meijendel levert
één feature `naam_n2k: Meijendel & Berkheide` (MultiPolygon, ~90 kB).

### Zoektest (stap 3), vaste startplek Delft Centraal (52.0116, 4.3571)

Plek van de juiste treffer in de lijst van 7 (– = niet in de lijst).

| Zoekterm | Juiste treffer | Voor | Na |
|---|---|---|---|
| Delft Centraal | iets met "Station … Delft" | – | – |
| Schoorl | woonplaats Schoorl | 1 | 1 |
| Kerkstraat | Kerkstraat, Delft | – | 1 |
| Stationsplein | Stationsplein, Delft | – | 1 |
| Markt | Markt, Delft | – | 1 |
| Den Hoorn | Den Hoorn (Midden-Delfland) | 2 | 1 |
| Hoogstraat | in Delft/Rijswijk/Den Haag | – | 4 (eerst Schiedam, Vlaardingen, Maassluis: geen Hoogstraat in Delft) |
| Delftse Hout | iets in Delft | 1* | 1* |
| Noordeinde | Noordeinde, Delft | 7 | 1 |
| Molenlaan | in de buurt | – | 1 |

\* De test voor "Delftse Hout" was te ruim (hij telde "Delftse Poort, Rotterdam" mee); het park
staat niet in de Locatieserver. **"Delft Centraal" vindt de Locatieserver niet**, voor noch na:
treinstations staan er niet in. Open punt (zie onder).

Script: `/tmp`-script niet bewaard; de test is na te doen met de URL hierboven plus `&lat=&lon=`.
In de Playwright-test zit een vaste controle: "Kerkstraat" met start Delft geeft als eerste een
treffer in Delft.

### Gebouwd

1. **Lokale teller** (`teller.js`): ringbuffer `nopaves.log`, max 500 regels `{t, ev, d}`, alles in
   try/catch. Gebeurtenissen: `app_open` (weergave, geolocatie via `navigator.permissions.query`),
   `plan_start` (soort, km, start gps/tik/zoek/link, voorkeuren kort), `plan_done` (ms via
   `performance.now()`, ok/fout/gestopt, aantal routes), `start_moved` (meters), `pref_change`
   (sleutel, oud, nieuw: centraal in `bewaar()` door de voorkeuren te vergelijken), `km_change`,
   `gpx`, `bewaar`, `andere_route`, `details_open` (tabbladen en uitklapblokken),
   `sheet_state`. Onder [?] "Mijn gebruik": tellingen, "Kopieer als JSON", "Wis".
   Keuze: "voorkeuren kort" is een code van letters (t/o/a = ondergrond, s = strand overslaan,
   k = toegangskaart, h = heuvels, L0.3 = LAW, v = kronkel) om de regels klein te houden.
2. **Eén betekenis**: overal `26% onverhard · 28% half` (tegel, piekbalk, lijst, kaarttip van een
   andere route, kop van het ondergrondtabblad, Mijn routes, GPX-omschrijving). Mijn routes
   bewaart nu `onv` en `half`; oude bewaarde routes tonen "54% onverhard + half". Bij de score een
   regel **Waarom**: de drie delen van de formule met hun gewicht, plus de aftrek voor heen en
   terug of strand. De formule zelf is niet aangepast.
3. **PDOK met plek**: `lat`/`lon` = de start, anders het kaartmidden.
4. **Piekbalk**: regel 1 score + label, regel 2 km en percentages; geen afkapping (mag teruglopen).
5. **Fouten**: kaartlagen-knoppen (water, stations) worden leeggemaakt bij Opnieuw/Nieuwe route en
   bij ongedaan maken tot vóór de eerste route. Sneltoetsen 1–6 volgen nu de knoppen op het scherm
   (1 A naar B, 2 Rondje, 3 Naar station, 4 In gebied, 5 Elke straat, 6 Tekenen); uitleg aangepast.
6. **Introslides weg** (dialoog, code, css blijft ongebruikt tot opruimen). Lege kaart: "Hardlooprondjes
   over onverhard. Tik op de kaart waar je wilt starten, of:" + "Gebruik mijn locatie". Keuze: een
   tik of de knop vanuit deze lege toestand zet de soort op **Rondje** (de zin belooft rondjes).
   "Intro opnieuw bekijken" weg; `?` opent nu de uitleg.
7. "Tempo" van de afspelende loper heet **Afspeelsnelheid** (zichtbaar label; id `afspeelsnelheid`,
   zodat "tempo" vrij is voor het hardlooptempo in fase 2).
8. Manifest bestond al (zie c).

Service worker: `onverhard-v37` (teller.js erbij). Ongebruikte intro-css weggehaald.

Tests: 43 unit-tests (nieuw: teller-ringbuffer), Playwright mobiel en desktop groen, met een nieuw
blok "UX fase 1" dat alles via de knoppen doet: welkom en "Gebruik mijn locatie" (met
geolocatie-toestemming in de testbrowser), zoeken "Kerkstraat" → Delft, toetsen 3 en 2, plannen,
onverhard/half in tegel, lijst en piekbalk (zonder afkapping), Waarom, Afspeelsnelheid, kaartlagen weg
na Opnieuw, Mijn gebruik (tellingen, kopiëren, wissen) en geen enkel browservenster.

Schermafbeeldingen (390 × 844): `docs/ux-voortgang/voor-ux1_*` en `docs/ux-voortgang/na-ux1_*`
(leeg, resultaat piek/half/vol; licht en donker).

## UX fase 2: de plankaart

Gebouwd achter `?ui=nieuw`, en na groene tests de standaard gemaakt. De oude interface blijft
bereikbaar met **`?ui=oud`** (tot het einde van de opdracht; zie de samenvatting voor wat er daarna
weg kan).

1. **Plankaart in de piek** (`#plankaart`, code in `app.js` onder "Nieuwe interface"): segmentknop
   Rondje · Station · A naar B · Meer (laatste keuze in `nopaves.soort`); startregel met "Mijn
   locatie" als `navigator.permissions.query` al `granted` zegt (pin zichtbaar en versleepbaar, kaart
   op die plek, gecentreerd boven het paneel), anders "Tik op de kaart of gebruik je locatie": de
   toestemmingsvraag komt pas na een tik op de locatieknop; afstand [−] 10 km [+] in stappen van 1 km
   (vasthouden versnelt), snelkeuzes 5 · 10 · 15 · 20, tik op het getal om te typen (2–60), onthouden;
   niet bij A naar B; één tikbare voorkeurregel; hoofdknop "Plan rondje" / "Zoek routes naar
   stations" / "Plan route". Nooit automatisch plannen bij openen (getest: geen tegel- of
   BRouter-verzoeken). De piekhoogte wordt gemeten tot en met de hoofdknop (`sheet.js`
   `standHoogtes(…, piekPx)`, max 62% van het scherm; half blijft minstens 120 px hoger).
   Keuze: in de nieuwe interface verplaatst een tweede tik de start van een rondje (geen keerpunt
   meer; dat bestaat nog in `?ui=oud`). De zoekbalk zit achter het zoekpictogram in de startregel.
2. **Voorkeuren op één plek** (`#voorkeuren`): ondergrond, strand, toegangskaart, hoogtemeters, vorm,
   LAW, aantal routes, thema, tempo. Keuze: de bestaande bedieningselementen zijn naar het venster
   verhuisd (zelfde ids en handlers, dus dezelfde opslag in `onverhard.v1`/`onverhard.thema`).
3. **Geen stappenbalk** voor de drie frequente soorten. Onder Meer: Tekenen, In gebied, Elke straat
   (met hun eigen stappenplan) en GPX openen; Mijn routes heeft daar een eigen plek.
4. **Eén knop "Nieuw"** in plaats van ↺, "Nieuwe route" en "Aanpassen". Na het plannen staat de
   plankaart onder het resultaat met de kop "Aanpassen" (half-stand). ↶ alleen als er iets ongedaan
   te maken is.
5. **Resultaat**: piek = score + label, km, "x% onverhard · y% half", GPX. Half/vol: Waarom,
   compacte keuze A · B · C (stations 1–4; kiezen kan ook door op de route te tikken), "Andere
   route" (volgende route; verborgen bij één route), "Details" ingeklapt (ondergrond, hoogte, water,
   twijfelstukken, bronnen). Geen "op kaart"-vinkjes: alle routes staan op de kaart. Popup op de
   route: eerst één regel ("open verharding, voetgangersgebied, 376 m"), techniek uitklapbaar.
6. **Geen prompt/confirm meer** (ook niet in `?ui=oud`): Bewaar slaat direct op met de
   voorgestelde naam en toont "Naam wijzigen" in een melding; verwijderen geeft "Verwijderd ·
   Ongedaan maken"; Link en coördinaten kopiëren vallen terug op `execCommand('copy')` en anders een
   selecteerbaar tekstvak in de melding.
7. **Back op Android**: als het paneel omhoog gaat, komt er één `history.pushState` bij; Back zet het
   paneel eerst op piek (en sluit het voorkeurenvenster). Sluitknop (✕) in de vol-stand.
8. **Tempo**: voorkeur, standaard leeg; stepper [−] 5:45 /km [+] per 5 s, vasthouden versnelt
   (400 ms, daarna elke 80 ms); tik voor vrije invoer met masker m:ss (`inputmode="numeric"`), 2:30–15:00.
   Met tempo: "ca. 58 min (5:45/km, vlak)", bij stations "· aankomst ca. HH:MM bij vertrek nu".
   Geen correctie voor ondergrond of hoogte. **GPX zonder tijdstempels**: ook de `<time>` in
   `<metadata>` is weg (veiligste keuze).

Service worker `onverhard-v38`. Tests: 45 unit-tests (nieuw: GPX zonder tijd, piekhoogte), Playwright
mobiel (28 stappen) en desktop (26) groen; nieuw blok "UX fase 2" via de knoppen. De blokken die
het oude stappenplan testen, draaien nu met `?ui=oud`.

Schermafbeeldingen: `docs/ux-voortgang/na-ux1_*` (voor) en `docs/ux-voortgang/na-ux2_*` (na).

## UX fase 3: minuten en gebieden

1. **Km of minuten**: met een tempo is de eenheid achter het getal tikbaar (km ⇄ min). In minuten:
   stappen van 5 min, snelkeuzes 30 · 45 · 60 · 90, typen 10–360 min. De planner krijgt
   km = minuten ÷ tempo (op 0,1 km). Eronder staan beide ("60 min ≈ 10,4 km"; in km-stand
   "10 km ≈ 58 min"). Zonder tempo is de eenheid gewoon "km" (niet tikbaar); tempo wissen zet de
   eenheid terug op km. Opgeslagen in `onverhard.v1` (`tempo`, `eenheid`, `minuten`).
2. **Rondjes in dit gebied** (`gebieden.js`): lang drukken (of rechtsklik) zet bovenaan het
   kaartmenu meteen "Gebied zoeken…", dat wordt "Rondjes in <naam>" of verdwijnt. De tik is de
   start; in de plankaart staat de chip "Binnen: <naam> [x]". Plannen gaat via de bestaande
   In-gebied-planning (`planGebied`) met als vlak: het gebied **afgesneden met een cirkel met straal
   L/2** rond de start (Sutherland-Hodgman tegen een 64-hoek, in RD, vereenvoudigd op 10 m).
   - Bron: **PDOK Natura 2000** (OGC API Features, bbox ±0,001° rond de tik, punt-in-veelhoek zelf,
     gaten tellen niet). Werkt (CORS open). Terugval als die bron faalt: de laag `park` van
     OpenFreeMap op zoom 12 (alleen een benoemd vlak met een beschermde klasse, kleinste eerst; de
     naam komt van het vlak zelf, zie controle e). Keuze: bij een werkende Natura 2000-bron zonder
     treffer komt er **niets** (dus geen terugval), zoals de beslisregel "benoemd beschermd gebied,
     anders niets" vraagt.
   - Het gebied (de ring) wordt niet in localStorage bewaard (de Veluwe-ring is ~85.000 punten);
     na herladen is de chip weg. Een start buiten het gebied, een andere soort of Nieuw haalt de chip weg.
   - In gebied (zelf tekenen) blijft onder Meer.

**Test met 6 plekken** (`tools/onverhard/test_gebieden.mjs`, rechtsklik → menu-item → 10 km →
Plan rondje; desktop, koude cache; ruwe cijfers in `docs/ux-voortgang/gebieden-ux3.json`):

| Plek | Menu-item | Opzoeken | Plannen | Uitkomst | Gelukt |
|---|---|---|---|---|---|
| Meijendel & Berkheide | Meijendel & Berkheide | 611 ms | 16 s | 12.7 km, score 85 | ja |
| Veluwe (Veluwezoom) | Veluwe | 1704 ms | 45 s | 12.7 km, score 91 | ja |
| Schoorlse Duinen | Schoorlse Duinen | 568 ms | 16 s | 10.3 km, score 99 | ja |
| Kennemerland-Zuid | Kennemerland-Zuid | 739 ms | 29 s | 14.2 km, score 75 | ja |
| Loonse en Drunense Duinen | Loonse en Drunense Duinen & Leemkuilen | 696 ms | 26 s | 10.5 km, score 97 | ja |
| Delftse Hout (geen beschermd gebied) | geen menu-item (goed) | 647 ms | – | – | ja |

Kanttekeningen: de Veluwezoom heet in Natura 2000 "Veluwe" (het hele gebied); dat antwoord is
3,2 MB en kost ~1,7–3 s. De rondjes zijn vaak langer dan gevraagd (12,7 km bij 10): dat is het
gedrag van de bestaande In-gebied-planning (die rekent met rondes binnen het vlak), niet van deze
stap. Open punt: dat verdient een eigen blik.

Service worker `onverhard-v39` (gebieden.js erbij). Tests: 47 unit-tests (nieuw: punt-in-veelhoek,
afsnijden, Natura 2000 met nep-antwoord), Playwright mobiel (30) en desktop (28) groen, met een blok
"UX fase 3" (minuten via de knoppen; lang drukken in Meijendel, chip, plannen, ≥ 90% van de
routepunten binnen het gebied, [x]; Delftse Hout geen menu-item).

Schermafbeeldingen: `docs/ux-voortgang/na-ux3_*` (o.a. `gebiedmenu`, `gebied-minuten`); voor = `na-ux2_*`.

## Snelheid

### Stap 0: meten

Meetpunten in de app (`meting.js`): `performance.now()` om elke fase (tegels ophalen en lezen,
graaf bouwen, route rekenen, BGT, AHN, water/POI's, BRouter) en per bron het aantal verzoeken,
bytes en cachetreffers. `window.onverhard.meting.rapport()` geeft het overzicht van de laatste
planning. Vaste testset in `tools/onverhard/benchmark_snelheid.mjs`: rondje 10 km en station 15 km
vanaf Delft Centraal, 10 A-naar-B-paren rond Delft (5 van 2–5 km, 5 van 10–25 km), In gebied
(voorbeeld Delftse Hout, 8 km) en Tekenen (voorbeeld). Per geval **5× koud** (nieuwe browsercontext:
lege HTTP-cache en Cache Storage) en **5× warm** (zelfde context na één opwarmronde; pagina elke keer
opnieuw geladen). Mediaan per fase in seconden. Fasen kunnen overlappen; "Totaal" is de wandklok
van de hele planning. Desktop-Chromium (headless, SwiftShader) in de cloudomgeving, via de proxy,
dus absolute tijden zijn hoger dan op een goede telefoonverbinding; de verhoudingen tellen.
Ruwe cijfers: `docs/snelheid/nulmeting-rest.json` en `docs/snelheid/nulmeting-ab.json`.

**Nulmeting** (code `5e548ec` = na UX fase 3 + meetpunten):

| Geval | Cache | Totaal (s) | Eerste (s) | tegels | graaf | route | bgt | ahn | water | brouter | tegels n / kB / cache | ok |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| rondje-10 Delft Centraal | koud | 10,7 | – | 2,1 | 0,6 | 1,5 | 4,7 | 1,3 | 0,3 | – | 61 / 11620 / 0 | 5/5 |
| rondje-10 Delft Centraal | warm | 5,7 | – | 2,0 | 0,6 | 1,5 | 0,4 | 0,8 | 0,2 | – | 61 / 11620 / 0 | 5/5 |
| station-15 Delft Centraal | koud | 24,9 | – | 4,8 | 4,2 | 0,1 | 11,9 | 3,4 | 0,6 | – | 330 / 52215 / 12 | 5/5 |
| station-15 Delft Centraal | warm | 24,8 | – | 3,2 | 4,0 | 0,1 | 13,9 | 2,9 | 0,7 | – | 330 / 52215 / 33 | 5/5 |
| gebied Delftse Hout (voorbeeld, 8 km) | koud | 3,4 | – | 0,7 | 0,3 | 0,4 | 1,2 | 0,6 | 0,1 | – | 19 / 4396 / 0 | 5/5 |
| gebied Delftse Hout (voorbeeld, 8 km) | warm | 2,5 | – | 0,6 | 0,3 | 0,4 | 0,8 | 0,3 | 0,1 | – | 19 / 4396 / 0 | 5/5 |
| tekenen (voorbeeld) | koud | 2,1 | – | 0,6 | 0,0 | 0,0 | 0,7 | 0,6 | 0,2 | – | 12 / 2574 / 0 | 5/5 |
| tekenen (voorbeeld) | warm | 1,0 | – | 0,4 | 0,1 | 0,0 | 0,4 | 0,2 | 0,1 | – | 12 / 2574 / 0 | 5/5 |
| ab-kort-1 Delftse Hout | koud | 4,3 | – | 0,3 | – | – | 1,2 | 0,7 | 0,3 | 2,0 | 16 / 3474 / 1 | 5/5 |
| ab-kort-1 Delftse Hout | warm | 2,9 | – | 0,2 | – | – | 0,1 | 0,2 | 0,2 | 2,3 | 16 / 3474 / 1 | 5/5 |
| ab-kort-2 Den Hoorn | koud | 5,5 | – | 0,4 | – | – | 1,9 | 0,9 | 0,5 | 2,1 | 17 / 3799 / 1 | 5/5 |
| ab-kort-2 Den Hoorn | warm | 3,4 | – | 0,2 | – | – | 0,2 | 0,5 | 0,2 | 2,4 | 17 / 3799 / 1 | 5/5 |
| ab-kort-3 Delfgauw | koud | 6,4 | – | 0,3 | – | – | 2,2 | 1,1 | 0,5 | 2,2 | 20 / 3861 / 1 | 5/5 |
| ab-kort-3 Delfgauw | warm | 3,8 | – | 0,2 | – | – | 0,3 | 0,6 | 0,2 | 2,4 | 20 / 3861 / 1 | 5/5 |
| ab-kort-4 Nootdorp | koud | 6,5 | – | 0,4 | – | – | 2,7 | 1,3 | 0,4 | 2,1 | 26 / 5128 / 1 | 5/5 |
| ab-kort-4 Nootdorp | warm | 4,0 | – | 0,2 | – | – | 0,3 | 0,8 | 0,3 | 2,5 | 26 / 5128 / 1 | 5/5 |
| ab-kort-5 Schipluiden | koud | 6,3 | – | 0,4 | – | – | 2,5 | 1,1 | 0,4 | 2,1 | 24 / 3993 / 1 | 5/5 |
| ab-kort-5 Schipluiden | warm | 3,7 | – | 0,2 | – | – | 0,3 | 0,8 | 0,2 | 2,3 | 24 / 3993 / 1 | 5/5 |
| ab-lang-1 Rotterdam Centraal | koud | 11,3 | – | 0,6 | – | – | 4,9 | 2,1 | 0,7 | 3,2 | 44 / 9331 / 1 | 5/5 |
| ab-lang-1 Rotterdam Centraal | warm | 6,0 | – | 0,4 | – | – | 0,6 | 1,5 | 0,5 | 3,3 | 44 / 9331 / 1 | 5/5 |
| ab-lang-2 Scheveningen | koud | 16,5 | – | 0,8 | – | – | 7,5 | 1,9 | 0,9 | 5,7 | 48 / 13513 / 1 | 5/5 |
| ab-lang-2 Scheveningen | warm | 8,9 | – | 0,4 | – | – | 0,9 | 1,5 | 0,6 | 5,5 | 48 / 13513 / 1 | 5/5 |
| ab-lang-3 Zoetermeer | koud | 9,1 | – | 0,4 | – | – | 3,6 | 1,8 | 0,5 | 2,7 | 39 / 7448 / 1 | 5/5 |
| ab-lang-3 Zoetermeer | warm | 5,5 | – | 0,3 | – | – | 0,4 | 1,3 | 0,4 | 3,3 | 39 / 7448 / 1 | 5/5 |
| ab-lang-4 Maassluis | koud | 11,7 | – | 0,6 | – | – | 5,2 | 2,5 | 0,7 | 2,7 | 54 / 7734 / 1 | 5/5 |
| ab-lang-4 Maassluis | warm | 5,9 | – | 0,3 | – | – | 0,5 | 2,1 | 0,4 | 2,8 | 54 / 7734 / 1 | 5/5 |
| ab-lang-5 Leiden Centraal | koud | 18,4 | – | 1,0 | – | – | 9,1 | 3,6 | 1,1 | 4,2 | 72 / 12671 / 1 | 5/5 |
| ab-lang-5 Leiden Centraal | warm | 8,7 | – | 0,6 | – | – | 0,9 | 3,1 | 0,7 | 3,5 | 72 / 12671 / 1 | 5/5 |


Wat de meting zegt:
- **BGT is overal de grootste post** (koud 35–50% van het totaal; 21 MB voor één rondje, 52 MB voor
  Station 15 km). De HTTP-cache van de browser helpt er niet betrouwbaar bij (Station warm: 13,9 s).
- Bij Station kosten **tegels (4,8 s) en graaf (4,2 s)** veel; bij A naar B is **BRouter** 2–6 s.
- Met warme cache kost "tegels" bij een rondje nog 2 s: dat is het **lezen** van 11,6 MB tegels
  (CPU), niet het netwerk.
- **Graaf bouwen**: hoogstens 17% (Station), bij een rondje 6–11%. Dat is onder de 20%-grens, dus
  **geen gebouwde graaf in IndexedDB** (stap 1).

Volgorde van werken op grond hiervan: stap 1 (cache: BGT!) en 3 (eerder iets laten zien) eerst,
dan 2, 4, 5, 6.

### Stap 1: cache

`datacache.js`: kaarttegels (OpenFreeMap), BGT-tegels en AHN-blokken eerst uit Cache Storage
(`nopaves-data-v1`), met de opslagtijd in een eigen header. Ouder dan 7 dagen: wel gebruiken, op de
achtergrond verversen (lage prioriteit, niet bij saveData). Ouder dan 30 dagen: niet meer gebruiken.
Grens: 8000 items of 300 MB (via `navigator.storage.estimate`); daarboven gaat het oudste kwart weg
(Cache Storage geeft de sleutels in volgorde van opslaan). App-bestanden blijven eerst netwerk (de
service worker raakt cross-origin verzoeken niet aan); de service worker wist bij een update nu
alleen nog oude `onverhard-*`-caches, niet de datacache. In Node (tests, benchmarks) doet de cache
niets. Geen graaf in IndexedDB (zie stap 0). Daarnaast: BGT nu 10 tegels tegelijk (was 6).

### Stap 2: vooraf ophalen

Zodra de start van een rondje of stationsroute bekend is (tikken, locatie, zoeken, slepen, of de
afstand verstellen), haalt de app na 600 ms rust de kaarttegels alvast op: rondje binnen L/2,
station de stations (zoom 12) en de paden binnen L; dichtbij eerst, max 120 (rondje) of 160
(station) tegels, 3 tegelijk, `priority: 'low'`, niet bij saveData. Daarbij de BGT-tegels binnen
500 m van de start (max 25): daar komt elke route langs. Stopt als de start verandert of het
plannen begint. Getest: na het tikken van de start ~73 tegels in ~4,5 s in de cache.

### Stap 3: route A meteen

`maakPlan` kent nu `tussentijds(deel)`: (1) zodra de eigen planner zijn rondjes/routes heeft, gaat
de beste volgens OpenStreetMap als **voorlopige** route A naar het scherm (score en percentages met
het label "voorlopig"); (2) na de officiële kaart alle routes (A · B · C), nog zonder hoogte en
water; (3) het hele plan. Bovenaan staat een regel "Nog bezig: officiële kaart, andere routes,
hoogte, water" met een Stopknop; in de piek staat hetzelfde in de tweede regel. Stoppen na een
tussenresultaat laat dat resultaat staan, met de melding wat er ontbreekt. A naar B via BRouter
krijgt alleen stap (2) (BRouter levert geen route zonder de BGT-keuze tussen alternatieven).

### Stap 4: rekenwerker

`rekenen.js` + `rekenwerker.js`: kaarttegels lezen, graaf bouwen en zoeken (rondjes, Dijkstra,
in-gebied, elke straat, tekenen, A naar B) gebeuren in een module-Web Worker; de pagina krijgt een
kopie van de graaf (voor verslepen en omwegen) en alleen kleine zoekresultaten. Stop roept
`worker.terminate()` aan: getest, het plannen stopt binnen 3 s en de volgende planning start een
nieuwe worker. In Node (zonder Worker) loopt hetzelfde gewoon in hetzelfde proces. Tijdens het
wachten zoomt de kaart naar het gebied waar de route komt (rondje 0,3 × L rond de start, station
0,7 × L, A naar B de punten, tekenen de tekening). Ook gerepareerd: de piek toonde de Stopknop pas
na de eerste voortgangsmelding.

### Stap 5: Naar station in ringen

De tegels voor de paden naar de stations worden nu van dichtbij naar ver opgehaald (zelfde tegels,
zelfde uitkomst). De echte ringen-aanpak (eerst alleen de beste max(4, aantal) kandidaten in eigen
richtingen; is er een niet bereikbaar, dan de volgende erbij) staat achter **`?stations=ringen`**,
omdat de uitkomst **niet altijd gelijk** blijft (`tools/onverhard/vergelijk_stations.mjs`, Node,
echte bronnen, ruwe cijfers in `docs/snelheid/stap5-stations.json`):

| Start | Tegels gewoon → ringen | Tijd | Zelfde routes? |
|---|---|---|---|
| Delft Centraal (15 km) | 241 → 162 | 14,3 → 8,3 s | nee: Maassluis West 17.14 km s30, Rotterdam Centraal 15.44 km s23 |
| Utrecht Centraal (12 km) | 163 → 144 | 12,0 → 7,9 s | nee: Eiteren 13.88 km s31, Maarssen 8.69 km s14 |
| Amersfoort (15 km) | 206 → 206 | 11,5 → 9,6 s | ja |
| Haarlem (12 km) | 118 → 118 | 7,8 → 7,9 s | ja |
| Den Bosch (15 km) | 115 → 115 | 5,3 → 3,7 s | ja |
| Zwolle (20 km) | 252 → 488 | 11,3 → 13,1 s | nee: Wijhe 17.34 km s36 |

Waarom niet gelijk: de app rekent nu routes naar alle (max 6) kandidaten en kiest daarna de beste 4
op score en lengte. Stoppen na 4 bereikbare stations slaat kandidaten over die achteraf beter
scoorden (Delft: Maassluis West valt weg, Rotterdam Centraal komt erin). Een snelle én gelijke
variant vraagt een bovengrens op de score van een nog niet doorgerekende route, en die is er niet
(de score kan tot 100 gaan). Vervolgstap als je de winst toch wilt: de regel "resultaat gelijk"
loslaten voor Station en `?stations=ringen` standaard maken (scheelt in Delft 33% tegels, 6 s).

## Open punten

- In-gebied-rondjes worden vaak 20–40% langer dan gevraagd (bestaand gedrag van `planGebied`).
- **Op de planning voor later (verzoek gebruiker): hill repeat-modus.** Niet in deze opdracht.

- "Delft Centraal" zoeken: de Locatieserver kent geen stations. Mogelijke vervolgstap: bij een
  zoekterm met "station"/"centraal" de stations uit de OpenFreeMap-tegels (laag `poi`) erbij zoeken.

## Terugzetten en live zetten

- Alles terug: `git checkout voor-ux` (of een van de tags `na-ux-1`, `na-ux-2`, `na-ux-3`, `na-snelheid`).
  Op GitHub (zonder de lokale tags): `git checkout origin/terugzet/voor-ux` enzovoort.
- Live zetten van een tag: `git push origin origin/terugzet/<tag>:refs/heads/claude/gpx-ultrarace-trainingen-zf6zci`
  (GitHub Pages bouwt dan automatisch).
