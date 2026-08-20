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
