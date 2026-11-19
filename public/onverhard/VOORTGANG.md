# Voortgang UX en snelheid

Uitgangspunt: commit f58e0da (live, service worker onverhard-v36).
Werkbranch van fase 1: `ux-fase-1`, ook gepusht als `ccr-1c8830ae-uawyv2`.

**Let op voor wie verder werkt:** er is geen branch `main`. De live site komt uit
`claude/gpx-ultrarace-trainingen-zf6zci`: de GitHub Pages-workflow draait bij een push
naar die branch (`.github/workflows/deploy-pages.yml`). "Samenvoegen in main" betekent dus
in de praktijk: fast-forward van die deploy-branch. Fase 1 is daar NOG NIET in gezet.

| Fase | Status |
|---|---|
| UX fase 1 | klaar (op de branch, nog niet live, tag `na-ux-1` nog niet gezet) |
| UX fase 2 | todo |
| UX fase 3 | todo |
| Snelheid stap 0-6 | todo |

## UX fase 1

### Controles vooraf
- a. Score: telt onverhard + half verhard samen (`kern.js` `nopavesScore`: 0,75 x
  `zachtAandeel(eind)` = (onverhard + half) / lengte, + 0,15 x paadjes + 0,1 x (1 - langste
  verharde stuk / 2 km), min 100 x (heen en terug + 2 x strand / lengte)). Het "54% onverhard"
  in de piekbalk en de lijst was dus onverhard + half.
- b. PDOK: niet `suggest` maar het endpoint `free` (`bronnen.js` `zoekPlaats`, `LOCATIESERVER`
  regel 12), aangeroepen vanuit `app.js` `zoek()` na 300 ms typen.
- c. Manifest: `manifest.webmanifest` bestond al (display standalone, naam Nopav.es, theme
  #F1F3D4, achtergrond #4F6B2A, pictogrammen 192 en 512).
- d. prompt() en confirm(): 3x prompt (link kopiëren als het klembord faalt, naam bij Bewaar,
  GPX-naam/coördinaten in het kaartmenu) en 1x confirm (bewaarde route verwijderen). Nog niet
  vervangen; dat is fase 2 punt 6.
- e. OpenFreeMap-laag `park`: de naam staat bij Meijendel op het vlak én op een los punt met
  hetzelfde id (gemeten in tegels, niet alleen volgens het schema).

### Gebouwd (één commit per punt)
1. Lokale teller (`gebruik.js`): ringbuffer `nopaves.log`, max 500 `{t, ev, d}`. Gebeurtenissen:
   app_open, plan_start, plan_done, start_moved, pref_change, km_change, gpx, bewaar,
   details_open, sheet_state (alleen als de gebruiker zelf de sheet verschuift). Onder [?]
   "Mijn gebruik" met tellingen, Kopieer als JSON (klembord, anders een tekstvak) en Wis (twee
   tikken, geen confirm). `andere_route` bestaat nog niet: die knop komt in fase 2.
   `intro_skip` is met de intro verdwenen.
2. Eén betekenis van onverhard (`weergave.js`): overal "26% onverhard · 28% half", afgerond
   zodat de som gelijk is aan het afgeronde totaal dat de score gebruikt. Waarom-regel bij de
   score. Scoreformule niet aangeraakt.
3. Zoeken: lat/lon (start, anders kaartmidden, afgerond op 3 decimalen) naar PDOK.
4. Piekbalk in twee regels; piek 158 naar 180 px. Gemeten 390x844 licht en donker, ook met
   het label "Puur onverhard": niets afgekapt.
5. Opnieuw/Nieuwe route wist ook de kaartlagen-knoppen; toetsen 1-6 in schermvolgorde.
6. Intro weg; welkomstregel op de lege kaart met "Gebruik mijn locatie"; `?` opent de uitleg.
   Keuze: een nieuwe gebruiker begint bij Rondje (was A naar B), anders klopt die zin niet.
7. Afspeelsnelheid (was `#tempo`, nu `#afspeelsnelheid`).
8. Manifest: niets aan veranderd (bestond al). Service worker naar `onverhard-v37`.

### Zoektest (10 vaste termen, start Delft 52,0116 / 4,3571)
Plek van de juiste treffer in de top 7, zonder en met lat/lon:

| Term | Zonder | Met | Opmerking |
|---|---|---|---|
| Delft Centraal | 4 | 1 | Het station zelf zit niet in de Locatieserver; treffer is Gemeente Delft |
| Stationsplein | niet in top 7 | 1 | Delft |
| Kerkstraat | niet in top 7 | 1 | Delft |
| Markt | niet in top 7 | 1 | Delft |
| Molenweg | niet in top 7 | 1 | Nootdorp |
| Dorpsstraat | niet in top 7 | 1 | Nootdorp |
| Rotterdam Centraal | 4 | 4 | Station zit niet in de Locatieserver; Gemeente Rotterdam op 4 |
| Meijendel | 2 | 1 | Zonder: eerst de straat in Beverwijk |
| Schoorl | 1 | 1 | |
| Groningen | 1 | 1 | Gemeente Groningen |

Vervolgidee: stationsnamen uit de eigen stationsdata (OpenFreeMap `poi`) aan de treffers
toevoegen, want PDOK kent geen stations.

### Manifest en kaarthoogte (alleen headless Chromium gemeten)
- Chromium (DevTools `getInstallabilityErrors`): enige melding `in-incognito`, dus verder
  installeerbaar. De service worker registreert alleen via https.
- Echte Chrome op Android en Brave: niet getest (niet beschikbaar).
- Zichtbare kaart op 390x844 zonder browserbalken: 405 px (sheet half) en 664 px (piek).
  Met een aangenomen adresbalk van 56 px (Chrome): 381 en 604 px. Met twee balken van samen
  112 px (Brave, aanname): 351 en 551 px. Standalone kon niet worden nagebootst.

### Tests
- Unit: 47/47 (was 42; nieuw: teller x3, weergave, zoek-URL; piek-hoogte aangepast).
- Playwright telefoon en desktop: groen. Nieuw, via de knoppen: teller (plannen, Mijn
  gebruik, kopiëren, wissen, geen netwerkverkeer), één betekenis, piekbalk-indeling, opnieuw
  en de toetsen 1-6, welkomstregel en Gebruik mijn locatie, zoeken met de start erbij,
  afspeelsnelheid.

### Schermafbeeldingen
`docs/ux-voortgang/fase-1/`: `voor_*` (f58e0da) en `na_*` (deze branch), 390x844 licht en
donker plus desktop: 1 eerste keer, 2 resultaat (piek), 3 resultaat (vol), 4 na opnieuw,
5 uitleg. Plus `punt4_piek_*_puur.png` (langste label) en `nopaves_gebruik_mobiel.png`.
