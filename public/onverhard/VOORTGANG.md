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
| Snelheid stap 0–6 | todo |

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
