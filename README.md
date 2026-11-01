# Bergtrainer

Upload de GPX van een ultrarace en de GPX van je lokale trainingsberg (bijv. je
skiberg), en Bergtrainer rekent uit hoeveel keer je die berg op moet om
dezelfde hoeveelheid hoogtemeters te trainen. Daarnaast genereert het een
wekelijks opbouwschema (met piek en taper) richting je wedstrijddatum.

Er zijn twee manieren om de wedstrijd te kiezen:

- **Eigen GPX**: upload de GPX-track van de wedstrijd waar je je op
  voorbereidt.
- **Voorbeeldwedstrijd**: drie **generieke** profielen (indicatief, geen
  echte race-GPX) voor als je nog geen GPX hebt: **Ardennen/Voerstreek**
  (het Belgische heuvelterrein waar veel trailraces op draaien),
  **Middelgebergte** en **Alpien** — elk met een realistische spreiding van
  zachte tot steile klimmen passend bij dat type terrein.

Er zijn ook twee manieren om de trainingsberg te kiezen:

- **Vaste heuvel (met flanken)**: een heuvel met meerdere flanken die alleen
  op de top samenkomen (een "pendelheuvel" — top → voet → top, geen ronde).
  Ingebouwd staat de **Lührs Heuvel** (Hoge Bergse Bos, GPS-gemeten) met de
  vier flanken uit het heuvelschema: de lange flank (NW, 7,7%), de
  middelsteile flank (ZO, 16%), de steile flank (O, 21%) en de in/uit-flank
  (ZZW, ~10%).
- **Eigen GPX**: upload de GPX van één beklimming/ronde van een andere berg.

## Hoe het werkt

1. **Ultrarace**: kies een voorbeeldwedstrijd of upload een GPX-track. De app
   berekent afstand, totale hoogtewinst (D+) en splitst het profiel op in
   losse klimmen én afdalingen (elk met hun eigen lengte en helling).
2. **Trainingsberg**: kies de vaste heuvel of upload je eigen GPX.
3. Bij een vaste heuvel matcht de app elke klim én afdaling uit de wedstrijd
   op de flank met de dichtstbijzijnde helling — een pendel ga je op én af
   over dezelfde flank, dus een steile wedstrijdafdaling stuurt evenveel
   herhalingen naar de steile flank als een steile wedstrijdklim. Bij een
   eigen GPX (één beklimming) wordt simpelweg uitgerekend hoeveel
   herhalingen nodig zijn.
4. De app rekent uit hoeveel herhalingen nodig zijn om een gekozen percentage
   van de hoogtemeters van de wedstrijd te evenaren, inclusief tijdsduur en
   (bij een vaste heuvel) de verdeling rennende versus stijl lopende afdaling.
5. Vul optioneel een wedstrijddatum in voor een wekelijks schema dat opbouwt
   naar een piek (~110% van de wedstrijd-D+) en afbouwt in de laatste
   week(en) voor de wedstrijd, met dezelfde flankverdeling per week.
6. Exporteer het schema als agenda-bestand (.ics, één sessie per geplande
   trainingsdag) of print het als afvinkbare A4-checklist.

Rechtsboven kun je schakelen tussen **Eenvoudig** (standaard) en
**Uitgebreid** — uitgebreid toont extra knoppen zoals startpercentage en
trainingen per week — en tussen **licht en donker thema**.

Alles draait client-side; er wordt niets naar een server verstuurd. Opgeslagen
routes staan lokaal in de browser (`localStorage`).

## Installeren als app (Android/iOS/desktop)

Bergtrainer is een PWA (progressive web app): open de gehoste site in Chrome
op Android en kies "App installeren" / "Toevoegen aan startscherm" (Safari op
iOS: deel-icoon → "Zet op beginscherm"). De app werkt dan met een eigen icoon
vanaf het startscherm, in een eigen venster zonder browserbalk, en blijft de
laatst geladen versie tonen als je offline bent.

## Ontwikkelen

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

De PWA-service-worker wordt alleen in de productiebuild gegenereerd; test hem
lokaal met `npm run build && npx vite preview`.

## Tarapp (losse app)

In `public/sportagenda/` staat Tarapp, een tweede, losstaande PWA zonder
build-stap (plain HTML/CSS/JS): een sportagenda om trainingen te plannen
(gym, klimmen, boulderen, wandelen, … en eigen activiteiten), af te vinken,
week- en maandoverzichten te bekijken en gymtrainingen per set te loggen
(supersets, rusttimer, aftelklok voor oefeningen op tijd). Bij hardlopen
houdt hij een scheenpijnscore bij, en looptrainingen kunnen intervallen hebben
met een intervaltimer (piepjes en gesproken aanwijzingen). Het herstelplan
"Terug naar 5 km" staat als data in `public/sportagenda/plan5k.js` en kan vanaf
een gekozen planweek in de agenda worden gezet. Gegevens staan in `localStorage` (sleutel
`sportagenda.v1`); via "Meer" kun je een JSON-back-up exporteren/importeren.

Na deploy staat hij op `https://<user>.github.io/Tezt/sportagenda/`. Open dat
in Safari op de iPhone → deel-icoon → "Zet op beginscherm". De map en de
opslagsleutel heten nog `sportagenda`, zodat bestaande installaties en
gegevens blijven werken. Bij een release `APP_VERSION` in `app.js` en `CACHE`
in `sw.js` ophogen en bovenaan `CHANGELOG` in `app.js` een regel toevoegen;
geïnstalleerde apps halen de update dan zelf op en tonen eenmalig wat er nieuw is.

Horloge (Zepp/Amazfit): Tarapp koppelt via de API van Intervals.icu (Zepp OS 5
koppelt zelf met Intervals.icu). De gebruiker plakt een persoonlijke API-sleutel
onder Meer; die blijft alleen in de browser (`localStorage`, buiten de back-up).
Looptrainingen met intervallen voor de komende 3 weken gaan als geplande
trainingen naar Intervals.icu, gelopen trainingen van de afgelopen 2 weken
komen terug en worden afgevinkt. Staat intervals.icu geen browserverbindingen
toe (CORS), dan kan `proxy/intervals-cors-worker.js` als Cloudflare Worker
worden neergezet en als tussenstation worden ingevuld.

Iconen opnieuw genereren: `node scripts/gen-sportagenda-icons.mjs`.
