# Voeding: beslissingen

Keuzes die niet (helemaal) in `docs/voeding-prompt.md` stonden, met de reden. Steeds de simpelste redelijke optie.

## Navigatie en opbouw

1. **Voeding is een tab onderin, op de plek van Overzicht; Overzicht staat nu onder Meer.** Dit wijkt af van de
   opdracht ("tabs blijven hetzelfde"): Oscar vroeg er tijdens de bouw zelf om. Staat "Voeding tonen" (Meer) uit, dan
   is de tabbalk precies als vroeger (Agenda, Overzicht, Schema's, Meer) en wordt er niets van Voeding geladen.
2. **"Voeding tonen" staat standaard aan.** De schakelaar staat in `localStorage` onder `voeding.tonen`, zodat
   `app.js` hem kan lezen zonder de module te laden. Gegevens blijven bewaard als hij uit staat.
3. **Wie gebruikt deze telefoon?** wordt gevraagd bij de eerste keer openen (Oscar of Tara). "Doorsturen naar
   Healthbridge" volgt die keuze (Oscar aan, Tara uit) totdat je hem zelf omzet.
4. **"Alles wissen" in Tarapp (Meer, Je gegevens) wist Voeding niet.** Die bestaande functie is ongewijzigd gebleven
   (de tekst noemt alleen trainingen, schema's en activiteiten). Voeding heeft een eigen knop "Voedingsgegevens wissen".
   Die wist alleen deze telefoon, niet de kopie in de Worker.
5. **De service worker bewaart Voeding pas als je Voeding opent** (bericht `voeding-precache`), niet bij elke
   installatie. Zo laadt Tarapp niet ~1 MB scanner-wasm voor wie Voeding nooit gebruikt. `CACHE` is opgehoogd naar v37.

## Worker en sync

6. **Een nieuwe Worker (`tarapp-voeding`) naast de Parkenjacht-Worker, niet een uitbreiding ervan.** De
   Parkenjacht-Worker wordt met de hand via het Cloudflare-dashboard neergezet; uitbreiden zou betekenen dat Oscar
   code moet plakken en dat een fout Parkenjacht kan raken. De nieuwe Worker wordt automatisch neergezet door
   `.github/workflows/voeding-worker.yml` (wrangler), die ook zelf de KV-opslag aanmaakt. Oscar zet alleen één keer een
   Cloudflare-token als repo-secret.
7. **Adres `https://tarapp-voeding.oscar-dillewaard.workers.dev`** (aanname): de workers.dev-subdomein
   `oscar-dillewaard` komt uit het adres van de Parkenjacht-Worker. Het adres staat op twee plekken:
   `WORKER_URL` in `public/sportagenda/voeding/sync.js` en `Tarapp.HOST` in Healthbridge (`core/.../Tarapp.kt`).
   Geeft de deploy een ander adres, pas dan die twee aan (de workflow waarschuwt).
8. **Opslag per maand** (`days:<dagboek>:<YYYY-MM>`), zodat één KV-waarde niet eindeloos groeit. De app haalt bij elke
   sync deze en vorige maand op; oudere maanden gaan alleen mee als er iets in verandert.
9. **Tokens:** Tarapp maakt met `crypto.getRandomValues` een dagboek-id en schrijf-token (bewaard onder `voeding.sync`,
   buiten de back-up, net als `parken.sync`). Het lees-token voor Healthbridge wordt bij "Koppel met Healthbridge"
   gemaakt en **niet** in Tarapp bewaard; opnieuw koppelen maakt het vorige lees-token ongeldig. De Worker bewaart
   alleen SHA-256-hashes.
10. **Export alleen als "Doorsturen" aan staat.** Tara's dagboek wordt wel gesynchroniseerd, maar de Worker weigert de
    export (403) zolang doorsturen uit staat. Dubbele borging naast de instelling in de app.
11. **Een tweede apparaat van dezelfde persoon** koppel je met "Nog een apparaat" (link met `#voeding=…`), zoals de
    koppel-link van Parkenjacht. Daar is de merge-test voor (twee apparaten tegelijk, verwijderen na bewerken).
12. **Alleen het dagboek wordt gesynchroniseerd.** Eigen producten, recepten, doelen, favorieten en vaste items staan
    alleen op de telefoon en in de back-up. Een dagboekregel bevat zelf naam en waarden per 100 g, dus hij blijft
    kloppen op een ander apparaat.
13. **Bij gelijke `updatedAt` wint verwijderen**, en anders een vaste volgorde, zodat elk apparaat hetzelfde kiest.
14. **Export: elke dag van de periode staat erin, ook als hij leeg is** (lege lijst), zodat Healthbridge "leeg" van
    "onbekend" kan onderscheiden. Maximaal 31 dagen per verzoek; Healthbridge vraagt een backfill in stukken op.

## Productdata

15. **Basisproducten: USDA FoodData Central, dataset SR Legacy (2018), 221 producten** met Nederlandse naam, FDC-id en
    de exacte USDA-omschrijving. Gegenereerd door `scripts/gen-voeding-basis.mjs` uit de officiële CSV-download
    (reproduceerbaar). SR Legacy omdat die veel meer gewone producten dekt dan "Foundation Foods". Dranken staan per
    100 ml ≈ 100 g.
16. **`source: "usda"` voor USDA-basisproducten, `"nevo"` voor NEVO.** Het exportformaat noemde `off|nevo|eigen|recept`;
    `usda` is erbij gekomen zodat een USDA-product niet als NEVO wordt aangemerkt. Healthbridge neemt de Tarapp-bron
    niet over in de dagbestanden (daar is `source` altijd `"tarapp"`), dus de coach merkt hier niets van.
17. **Vijf bewuste uitzonderingen op de 4/4/9-test**: bier en wijn (alcohol, 7 kcal/g), cacaopoeder en citroen (veel
    vezels/zuren). Ze staan met reden in `tests/voeding/basis.test.mjs`.
18. **Open Food Facts via de Worker, alleen voor geregistreerde dagboeken** (schrijf-token), zodat niet iedereen de
    proxy kan gebruiken. User-Agent `Tarapp/<versie> (https://github.com/oscardillewaard-ai/Tezt)`: de publieke
    repo-pagina als contact, bewust geen persoonlijk e-mailadres. Cache: gevonden 7 dagen, niet gevonden 1 dag. Limiet
    90 product- en 8 zoekverzoeken per minuut (OFF vraagt max. 100 en 10).
19. **Zoeken in Open Food Facts op naam is een extraatje** (knop onder de zoekresultaten). Tijdens de bouw gaf de
    zoek-API van OFF "temporarily unavailable"; zoeken werkt dus vooral lokaal (basisproducten, eigen producten,
    recepten en eerder gescande producten), en een mislukte OFF-zoekopdracht geeft een nette melding.
20. **Gescande OFF-producten worden lokaal bewaard**, zodat dezelfde barcode daarna offline en zonder verzoek werkt.
    Een eigen product met dezelfde barcode gaat voor.
21. **Testvoorbeelden van OFF** zijn echte antwoorden (Nutella, Coca-Cola, Heinz, onbekend). Het voorbeeld "zonder kcal
    en vet" is afgeleid van het echte Heinz-antwoord (velden weggehaald, staat erin vermeld), omdat er bij het ophalen
    geen echt product zonder die velden te vinden was (zoek-API onbereikbaar).
22. **UPC-E** wordt uitgeklapt naar UPC-A als de scanner dat formaat meldt.
23. **Tijdstip:** een regel voor vandaag krijgt de huidige tijd (Europe/Amsterdam); een regel voor een andere dag een
    vaste tijd per maaltijd (08:00, 12:30, 18:30, snack 15:30).

## NEVO (RIVM)

31. **NEVO komt erin, op verzoek van Oscar** (de opdracht sloot het eerst uit). De voorwaarden zijn gelezen
    (pdf "Voorwaarden voor gebruik NEVO-online versie 2025/9.0" en de pagina Copyright en disclaimer):
    - gratis; er mogen geen kosten voor worden gerekend (de app is gratis);
    - "alleen toegestaan in ongewijzigde vorm en met vermelding van bron en versienummer", referentie
      **"NEVO-online versie 2025/9.0, RIVM, Bilthoven"**;
    - aanvullen mag als het direct duidelijk is dat het geen NEVO is; wijzigen niet;
    - bij een nieuwe versie de oude vervangen;
    - publiceren of herverspreiden (publieke repo, publieke app) wordt niet genoemd: niet verboden en niet expliciet
      toegestaan. Oscar heeft gekozen het te doen zonder RIVM eerst te mailen.
32. **Zo houden we ons eraan:** `scripts/gen-voeding-nevo.mjs` neemt naam en waarden ongewijzigd over (geen afronding;
    alleen een komma wordt een punt) en selecteert alleen de kolommen kcal, eiwit, koolhydraten en vet. De bron en de
    versie staan in `nevo.js`, onder elk NEVO-product in de app en onderaan Voeding ("Gebaseerd op gegevens van
    NEVO-online versie …, RIVM, Bilthoven en andere gegevens"). De USDA-producten blijven als aanvulling en heten in de app
    "Basisproduct (USDA, aanvulling op NEVO)". In zoekresultaten komt NEVO vóór USDA.
33. **Het akkoord op de voorwaarden is niet automatisch gegeven.** Het downloadformulier namens Oscar versturen werd
    door de beveiliging van de sessie geweigerd (een juridisch akkoord). Oscar downloadt het bestand dus zelf, één
    keer (zie de stappen). Tot die tijd is `nevo.js` een lege plaatshouder en werkt Voeding met USDA, zonder fouten.

## Healthbridge

24. **Naam met merk:** bij Tarapp-items wordt het merk tussen haakjes achter de naam gezet (`"Nutella (Ferrero)"`),
    zodat de coach het product herkent zonder een nieuw veld.
25. **Bron "Tarapp" negeert voeding uit Health Connect volledig**; "beide" telt ze op (met waarschuwing).
26. **Tarapp niet bereikbaar:** de voeding van die dagen wordt uit het bestaande dagbestand in de repo overgenomen
    (ook `sources.nutrition`), net als `daily.csv` en `nutrients.csv`. Bestaat het bestand nog niet, dan blijft de
    nieuw berekende voeding (bij alleen Tarapp: `null`).
27. **Handmatig invullen** bij Healthbridge, Instellingen accepteert alleen precies de Worker-host (https, geen pad).

## Tijdens de bouw

28. **Netwerk:** voor het maken van de basislijst en de OFF-testvoorbeelden zijn `fdc.nal.usda.gov` en
    `world.openfoodfacts.org` toegevoegd aan de cloud-omgeving "Tezt" (met akkoord). De app zelf heeft dat niet nodig.
29. **De Android-laag van Healthbridge is hier niet gecompileerd** (Google Maven is in deze omgeving geblokkeerd).
    De core-tests draaiden lokaal; compileren, Lint en de app-tests doet de CI van `healthbridge-data` bij de push.
30. **Tests in Tarapp** draaien met `node --test` (`npm run test:voeding`), zonder nieuwe dependencies, en in de nieuwe
    workflow `voeding-worker.yml`. De bestaande Pages-workflow is niet aangepast.
