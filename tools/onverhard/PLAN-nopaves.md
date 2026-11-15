# Plan: Nopav.es — score, stationsmodus, groene omwegen, rustiger interface

## Context
Onverhard (live op oscardillewaard-ai.github.io/Tezt/onverhard/) krijgt de naam **Nopav.es**. De gebruiker rende van huis naar Rotterdam Centraal en wil:
1. een **unpaved score** die in één getal zegt hoe goed een route is;
2. een **stationsmodus**: vanaf een plek routes naar verschillende stations (en dan met de trein terug);
3. **groene omwegen**: na het plannen op de kaart omwegen aanklikken die meer km kosten maar meer onverhard opleveren;
4. een **gebruiksvriendelijkere interface**: geen tekst tijdens het laden, en water/winkels/enz. aan- en uitzetten op de kaart zelf in plaats van in het paneel.

**Timing:** pas op **woensdag 18-11** beginnen, in een nieuwe sessie op Fable met extra effort. Die sessie start de gebruiker zelf; het model kan ik niet kiezen. Vóór woensdag schrijf ik geen code. Na goedkeuring zet ik alleen dit plan in de repo als `tools/onverhard/PLAN-nopaves.md` op de branch (zonder deploy), zodat de sessie van woensdag het terugvindt. De container is tijdelijk, dus `/root/.claude/plans` is dan weg.

## Wat al gecontroleerd is (15-11)
- **z14-kaarttegels** (OpenFreeMap, laag `poi`) hebben `railway/station`, `railway/subway`, `railway/tram_stop` en `entrance/subway_entrance`.
  - Gezien: Rotterdam Centraal, Delft, Blijdorp, Beurs.
- **z12-tegels** hebben ook `railway/station`; z10 en z11 niet.
  - Gezien: Rotterdam Centraal, Rotterdam Noord, Schiedam Centrum, Schiedam Nieuwland, Melanchthonweg, Meijersplein.
  - Eén z12-tegel is ±6×6 km en ±77 kB (gzip). Een stationslijst binnen 20 km kost dus ±49 tegels, ±4 MB.
- **Beperking:** RandstadRail-haltes (Melanchthonweg, Meijersplein) staan in de tegels óók als `railway/station`. Trein en lightrail zijn niet uit elkaar te halen.
- **Herbruikbaar uit `public/onverhard/graaf.js`:**
  - `dijkstra(g, bron, {straf, doel, maxKosten})`, `pad`, `maakTraject`;
  - `versleep` (venster plus straf-array, splice van knopen/segs/vast);
  - `onverhardeSegmenten(g)`, `dichtsteKnoop`, `bouwGraaf`.
- **Herbruikbaar uit `bronnen.js`:**
  - `planRondjeEigen`: het patroon voor tegels ophalen, graaf bouwen, BGT-analyse, de tweede ronde zonder strand/kaartje en `waardering`;
  - `haalTegels`, `analyseerRoute`, `pasRouteAan`, `optieVan`.
- Opties uit de eigen router hebben al `knopen/segs/vast`. Slepen, weghalen en undo werken daar al op.
- **Nog niet gecontroleerd (aanname):**
  - of z12 álle kleine stations bevat; de rank-filtering van OpenMapTiles kan kleine haltes weglaten;
  - of `leesOsmTegel` met een andere zoom dan 14 overweg kan; vermoedelijk is er een zoomparameter nodig.

## Keuzes van de gebruiker (15-11)
- **Stationsmodus:** je kiest de km en de app kiest de stations. Een ander station kun je zelf aantikken.
- **Stations:** treinstations, dus `railway/station` en `railway/halt`. Geen metro en geen tram. RandstadRail komt via de data mee.
- **Score:** de mix, zie §1.
- **Grootste ergernissen in de UI:**
  - de instellingen zijn onduidelijk;
  - de kaart is klein op de telefoon;
  - het resultaatscherm is te vol.

## 1. Nopav.es-score (eerst, de basis voor de rest)
- **`kern.js`:** nieuwe pure functie `nopavesScore(an)`, die 0–100 geeft plus een label.
  - De mix (gekozen):
    `100 × (0,75·onverhard(eind) + 0,15·paadjes + 0,10·(1 − min(1, langsteVerhardeStuk/2 km))) − 100 × (dubbel + 2·strandaandeel)`, afgekapt op 0–100.
  - Het langste verharde stuk komt uit `an.stukken` (eindoordeel).
- **Labels:**
  - ≥ 90: "Puur onverhard"
  - 75–89: "Lekker ruig"
  - 55–74: "Gemengd"
  - < 55: "Veel asfalt"
- **Waar:**
  - in `maakPlan` per optie `o.score`; ook na `pasRouteAan` opnieuw berekend;
  - in `#kern` als eerste, grote tegel met een scorering;
  - op routekaarten in `tekenOpties` (app.js) als badge;
  - in bewaarde routes en de GPX-beschrijving.
- **Volgorde van opties:** in `maakPlan` op score, zodat "aanbevolen" de hoogste score heeft. De lengte-afwijking blijft tiebreaker of strafpunt, net als in `planRondjeEigen`.
- Ook bij "maakt niet uit (ook verhard)" tonen; het is dan informatief.

## 2. Rustiger interface (los van de rest, snel zichtbaar)
- **Laden:** de zichtbare `#status`-tekst gaat weg (index.html r.162, app.js `planNu` r.794).
  - Daarvoor in de plaats: voortgangsbalk, een kleine animatie (lopend poppetje of een lijntje dat over de balk loopt) en Stop.
  - De meldtekst blijft alleen als visueel verborgen `aria-live`, voor schermlezers.
- **Kaartlagen-knop:** nieuwe Leaflet-control rechtsboven op de kaart.
  - Iconen 💧 🛒 ☕ 🚻 ⛽ met aantallen; in stationsmodus ook 🚉.
  - Een tik zet een laag aan of uit (`waterAan` blijft de bron, standaard 💧 en 🛒).
  - Openingstijden worden opgehaald zodra een laag met winkels of horeca aangaat (`haalTijdenErbij`).
- **Paneel:**
  - De Water-tab, filterchips en waterlijst gaan weg (index.html r.183–203, `tekenWater` r.1168). Tabs worden **Hoogte | Ondergrond**.
  - Per punt blijft de popup op de kaart, met "Route via hier" en openingstijden.
  - "Langste stuk zonder water" wordt één regel onder het hoogteprofiel.
- **Resultaat minder vol:**
  - bovenaan alleen de score (groot) en km, onverhard-% en ↗;
  - routekaart: "A · 14,2 km · score 82", met paadjes, LAW en strand in één subregel;
  - GPX, Bewaar en Link worden één rij icoonknoppen;
  - afspelen wordt een ▶-knop bij het hoogteprofiel, in plaats van een eigen balk;
  - "Bronnen vergelijken" blijft ingeklapt onder Ondergrond.
- **Instellingen duidelijker** (stap 3, index.html r.~130–155):
  - elke optie krijgt een icoon, een korte naam en een hint van 3–5 woorden, geen lappen tekst. Bijvoorbeeld:
    - 🌲 Smalle paadjes · "liever singletrack";
    - 🏖️ Strand overslaan · "geen mul zand";
    - 🎫 Toegangskaart-gebieden · "ook betaalde natuur";
    - ⛰️ Meer hoogtemeters · "zoekt heuvels op";
  - "Ondergrond: alleen onverhard / maakt niet uit" wordt een duidelijke keuzeschakelaar;
  - wat zelden nodig is (LAW, grondig) blijft onder "Meer".
- **Kaart groter op de telefoon** (< 700 px):
  - het paneel wordt een **bottom sheet** met drie standen: piek (titel en hoofdknop), half en vol. Je wisselt door aan het handvat te slepen of te tikken;
  - de kaart is altijd schermvullend en roept `kaart.invalidateSize()` aan als de stand verandert;
  - na het plannen springt het sheet naar piek, met score, km en de knoppen. Zo zie je de route meteen groot;
  - op desktop blijft het zijpaneel.
- **Telefoon en desktop:** Playwright-screenshots vóór en na, om te vergelijken.

## 3. Stationsmodus
- **UX:**
  - Stap 1: nieuwe kaart "🚉 Naar station".
  - Stap 2: startpunt (zoeken, tikken of GPS).
  - Stap 3: "ongeveer X km", met de bestaande instellingen (trail, strand, kaartje).
  - Resultaat: tot 4 routes naar stations in verschillende richtingen, elk als "→ Rotterdam Centraal · 14,2 km · 82".
  - Alle kandidaat-stations staan als kleine 🚉 op de kaart. Een tik geeft "Route hierheen", op de al geladen graaf.
- **Data (`osmtegels.js`):**
  - aparte map `STATION_SOORT = {'railway/station', 'railway/halt'}`, níet in `POI_SOORT`, zodat stations niet in de waterlagen komen;
  - `leesOsmTegel` krijgt een zoomparameter (standaard 14);
  - nieuw `tegelsLangs(a, b, marge)`: de z14-tegels in een ellips om start en station.
- **Bronnen (`bronnen.js`), nieuwe functie `planStations(instel, bgt, aantal, meld, signal)`:**
  1. **Stations zoeken:** z12-tegels binnen ±0,85 × km van de start, alleen de laag `poi` lezen, alleen `railway/station` en `railway/halt`. Ontdubbelen op naam binnen 300 m.
  2. **Kandidaten:** hemelsbreed 0,5–0,85 × km (de eigen router is meestal 1,2–1,4× hemelsbreed). Per kompassector (8 stuks) het station het dichtst bij 0,7 × km, hooguit 6 in totaal.
  3. **Paden:** z14-tegels uit de vereniging van de ellipsen per kandidaat, met als grens: som van de afstanden ≤ 1,35·d + 1 km. Plafond ±220 tegels; zit je erboven, dan vallen de verste kandidaten af.
  4. **Graaf en routes:** `bouwGraaf` met dezelfde opbouw als `planRondjeEigen`.
     - Startknoop via `dichtsteKnoop`, daarna **één** `dijkstra(g, s)`: één boom geeft de routes naar álle stations.
     - Per station `pad`, `maakTraject(g, knopen, segs, [start, station])`, `analyseerRoute` en score.
  5. **Strand en kaartje:** tweede ronde zoals in `planRondjeEigen`. Daarvoor zet ik die rondelogica in een gedeelde helper.
  6. **Lengte:** routes boven 1,3 × km vallen af. Onder 0,8 × km komt de melding "korter dan gevraagd" met een wijzer naar groene omwegen.
  7. **Teruggave:** `{opties, waarschuwingen, doel, uitleg, eigen: true, graaf}`, en per optie `station: naam`, met `vast = [0, eind]` zodat de route versleepbaar is.
- **`maakPlan`:** nieuwe tak `opties.modus === 'station'`.
- **GPX-naam:** "Nopav.es → Rotterdam Centraal".

## 4. Groene omwegen
- **`graaf.js`:** nieuwe functie `groeneOmwegen(g, knopen, segs, vast, {minVerhard = 200, maxExtra = 3000, maxFactor = 4, aantal = 6})`:
  1. Met `onverhardeSegmenten(g)` de verharde stukken langs de route vinden. Stukken met < 50 m onverhard ertussen worden samengevoegd; een stuk moet ≥ `minVerhard` lang zijn. Daarna 100 m speling aan beide kanten. Te controleren: of `binnenSeg` buiten de gebiedsmodus overal 1 is.
  2. Per stuk `dijkstra` van begin- naar eindknoop, met een straf-array zoals in `versleep`:
     - verhard ×6;
     - al door de route gebruikt ×8, tegen dubbel lopen;
     - onverhard ×1;
     - met `maxKosten` als grens.
  3. **Accepteren als:**
     - de extra lengte ≤ `maxExtra` én ≤ `maxFactor` × het stuk;
     - de winst ≥ 150 m extra onverhard;
     - er minder verhard overblijft dan op het oude stuk.
  4. **Teruggave:** maximaal `aantal` omwegen die elkaar niet overlappen: `[{ia, ib, knopen, segs, extraM, winstOnverhardM}]`, gesorteerd op winst.
- **Toepassen:** `pasRouteAan(..., {omweg})` in `bronnen.js` splicet knopen/segs zoals `versleep` en hergebruikt de rest van de bestaande flow (traject, BGT-analyse, hoogte, water, score). In de app gaat dit via `onthoud()`, zodat ↶ de omweg ongedaan maakt.
- **UI:**
  - Een knop "🌿 Groene omwegen" bij het resultaat en in het kaartmenu (rechtermuisknop of lang drukken).
  - Staat die aan, dan verschijnen groene stippellijnen op de kaart, met een chip als "+1,2 km · +9 punten". De score-winst wordt vooraf geschat uit de segmentklassen.
  - Een tik past de omweg toe. Esc of de knop zet de modus uit.
  - Niets gevonden: de korte melding "Geen groene omweg gevonden".
- **Werkt bij:** rondje, gebied, tekenen en station, dus alles met een graaf. **Niet bij:** elke straat (daar is dubbel lopen de bedoeling) en BRouter-uitslagen.

## 5. Naam Nopav.es
- Aan te passen:
  - `<title>`, header en intro (index.html);
  - `name`/`short_name` in het manifest;
  - GPX-creator en GPX-naam;
  - README;
  - helpvoorbeelden, plus een introdia voor station en omwegen.
- **Blijft zoals het is:** het URL-pad `/onverhard/`, de localStorage-sleutels (`onverhard.*`; anders zijn bewaarde routes weg) en de namen in de code.
- Het domein nopav.es moet de gebruiker zelf registreren. Dat valt buiten dit plan.

## Volgorde
1. Score
2. Laden en kaartlagen
3. Instellingen en resultaat compacter
4. Bottom sheet voor de telefoon
5. Stationsmodus
6. Groene omwegen
7. Naam, intro en help
8. README

Per onderdeel:
- tests en lint;
- Playwright;
- commit op `claude/unpaved-routes-planner-ufzrl8`;
- deploy naar `claude/gpx-ultrarace-trainingen-zf6zci`, met `CACHE` in `sw.js` opgehoogd (v33, …);
- controle met `curl …/sw.js`.

## Verificatie
- **Unittests** (`tools/onverhard/test_web_kern.mjs`):
  - `nopavesScore`: grenzen en labels;
  - `groeneOmwegen` op een kleine kunstmatige graaf (recht verhard tegenover een onverharde boog): vindt de omweg, houdt zich aan `maxExtra` en mijdt al gebruikte segmenten;
  - stationskeuze: sectoren en afstandsband;
  - `leesOsmTegel` met zoom 12;
  - `tegelsLangs`: het aantal tegels in de ellips.
- **Echte data**, met een tijdelijk script in `tools/onverhard/` dat daarna weer weg moet:
  - Delft → stations op ±15 km, en een route naar Rotterdam Centraal;
  - meten: aantal tegels, rekentijd, score;
  - vergelijken met Komoot `plan_route` A→B (onverhard-%);
  - de z12-stationslijst vergelijken met z14 in hetzelfde gebied: mist z12 kleine haltes?
- **Groene omwegen** op bekende routes (Delft binnenstad, Broekpolder 10 km): gaan score en onverhard-% omhoog, en blijft het dubbel lopen laag? Met screenshot.
- **Playwright e2e:**
  - de stationsmodus van begin tot eind;
  - bottom sheet op 390 px: de drie standen, de kaart volgt mee (`invalidateSize`), en na het plannen staat het sheet op piek;
  - de kaartlagen-knop zet markers aan en uit;
  - geen zichtbare tekst tijdens het laden;
  - een omweg toepassen en daarna ↶;
  - telefoon (390 px) en desktop.
- `node --test tools/onverhard/test_web_kern.mjs`, `npx oxlint public/onverhard`, en na de deploy `curl …/sw.js | grep onverhard-vNN`.

## Open risico's (eerlijk)
- **z12 kan kleine stations missen.** Terugval: de z14-poi's uit de al opgehaalde corridortegels, of een vaste lijst van ±400 NS-stations (OSM, eenmalig gegenereerd).
- **De gewichten van de score zijn een keuze.** Ik ijk ze op de 6 benchmarkgebieden: onze routes moeten hoger scoren dan die van Komoot, en het getal moet kloppen met het gevoel.
- **De stationsmodus haalt ±3× meer tegels op dan een rondje van 15 km** (±150 tegels tegen ±45). Dat geeft een langere laadtijd op de telefoon; meten en zo nodig het aantal kandidaten verlagen.
