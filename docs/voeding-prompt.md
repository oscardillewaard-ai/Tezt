# Claude Code-opdracht: Voedingsdagboek in Tarapp → Healthbridge → coach

> Open een Claude Code-sessie met **beide** repo's: `oscardillewaard-ai/Tezt` (Tarapp) en
> `oscardillewaard-ai/healthbridge-data` (Healthbridge-app + data). Zet dit bestand in Tezt als
> `docs/voeding-prompt.md` en zeg: "Lees docs/voeding-prompt.md en voer alles in één keer uit."

## 0. Werkwijze: in één keer door

- **Werk alle fases achter elkaar af zonder te stoppen voor akkoord.** Commit per fase met een duidelijke boodschap.
- Kom je een keuze tegen die niet in deze opdracht staat: kies de simpelste redelijke optie, schrijf hem op in
  `docs/voeding-beslissingen.md` (in Tezt) en ga door.
- Stop **alleen** als doorgaan bestaande data van Tarapp of Healthbridge zou kunnen beschadigen.
- Dingen die alleen Oscar kan doen (Worker deployen met zijn Cloudflare-login, tokens aanmaken, APK installeren):
  bereid alles voor en zet ze aan het eind in `docs/voeding-stappen-voor-oscar.md` als genummerde checklist.
- Eindig met een korte samenvatting: wat gebouwd is, wat getest is, wat Oscar nog moet doen.

## 0b. Oscar wil zelf zo min mogelijk doen

Ontwerp alles zo dat Oscar's handwerk minimaal is. Doel: Oscar doet hooguit dit:
1. (alleen als het niet automatisch kan) één deploy-commando voor de Worker,
2. de nieuwe Healthbridge-APK installeren (de bestaande CI bouwt hem),
3. in Tarapp op **"Koppel met Healthbridge"** tikken.

Dus:
- **Worker automatisch deployen**: kijk hoe de Parkenjacht-Worker nu gedeployed wordt en gebruik dezelfde route. Is er
  nog geen automatische deploy, voeg dan een GitHub Action toe die bij een push deployt, zodat Oscar hooguit één keer
  een Cloudflare-token als repo-secret hoeft te zetten (leg die stap uit in de checklist, met de exacte rechten).
- **Geen tokens laten aanmaken of intypen**: Tarapp genereert zelf (crypto.getRandomValues) een schrijf-token en een
  lees-token en registreert die bij de Worker, net als bij de Parkenjacht-groepen.
- **Koppelknop**: Healthbridge krijgt een Android-deeplink (intent-filter, bijv. `healthbridge://koppel?url=...&token=...`).
  De knop in Tarapp opent die link; Healthbridge vraagt "Tarapp koppelen?", slaat Worker-URL en lees-token versleuteld op
  en zet de voedingsbron op Tarapp. Geen typwerk. Valideer de URL in de deeplink tegen de verwachte Worker-host.
- **Geen handmatige data-imports** (zie sectie 4: geen NEVO-download).
- Alles wat toch handwerk blijft komt in `docs/voeding-stappen-voor-oscar.md`, zo kort mogelijk, met per stap waar hij moet tikken.

## 1. Wat we bouwen (lekker simpel)

Een module **Voeding** in Tarapp, MyFitnessPal-stijl, met alleen **kcal, eiwit, koolhydraten en vet**. Geen
vitaminen of mineralen.

- **Dagboek** per dag met maaltijden (ontbijt, lunch, diner, snack), per persoon (Oscar en Tara, elk op hun eigen telefoon).
- **Toevoegen** via zoeken, **barcode scannen**, recent, favorieten, eigen producten en recepten, altijd met **gram** (of ml).
- **Doelen**: dagdoel voor kcal, eiwit, koolhydraten en vet per persoon, met een eenvoudige voortgangsweergave.
- **Doorgeven aan Healthbridge**: elke regel met productnaam, gram en macro's, zodat Healthbridge het in de privé-repo
  zet en Oscars Claude-coach het in de dagelijkse briefing ziet.

## 2. Harde eis: een functie ín Tarapp, niet een nieuwe Tarapp

- **Eén ingang** in de bestaande navigatie, in de bestaande stijl. Startscherm, tabs en volgorde blijven hetzelfde.
- **Eigen map** (bijv. `public/sportagenda/voeding/`). In de bestaande `app.js` alleen een minimale koppeling
  (ingang, back-up, changelog).
- **Lazy laden** (dynamic `import()`) van Voeding, scanner en `.wasm`, pas als je Voeding opent. De rest van Tarapp start even snel.
- **Eigen opslag**: IndexedDB-database `tarapp-voeding` voor producten en dagboek; localStorage alleen met prefix
  `voeding.`. Bestaande sleutels nooit hernoemen of migreren.
- **Uitzetbaar** via een instelling "Voeding tonen". Uit = geen ingang en niets geladen, data blijft bewaard.
- **Faalt netjes**: geen camera, Worker onbereikbaar mag de rest van Tarapp niet raken.
- **Regressiecheck** na elke fase: bestaande functies werken nog zoals voorheen (bestaande tests plus een korte
  handmatige checklist in de eindsamenvatting).

## 3. Tarapp-conventies volgen

Lees eerst de bestaande code en volg dezelfde regels (controleer dit zelf): vaste localStorage-sleutel met
`navigator.storage.persist()`, network-first service worker met gecontroleerde updates en een updateknop, changelog
per versie (`APP_VERSION` ophogen), bestaande back-up export/import (Voeding moet daarin mee). Sync via een Cloudflare
Worker zoals Parkenjacht (`public/parken/` + `proxy/parken-sync-worker.js`). Geef de Voeding-data een eigen
schemaversie met migratiecode.

## 4. Productdata

- **Open Food Facts** voor merkproducten en barcodes: `GET https://world.openfoodfacts.org/api/v2/product/{barcode}?fields=product_name,brands,nutriments,serving_size`.
  Lezen kan zonder login, maar vereist een eigen User-Agent. Een browser kan die niet zetten, dus loop via de Worker
  (zet `User-Agent: Tarapp/<versie> (contact)`, cache per barcode, respecteer de rate-limits). Velden per 100 g:
  `energy-kcal_100g`, `proteins_100g`, `carbohydrates_100g`, `fat_100g`. Ontbreekt een waarde: `null`, niet 0.
  Bronvermelding "Productgegevens: Open Food Facts" (ODbL).
- **Basisproducten zonder barcode** (banaan, aardappel, havermout los): maak een meegeleverde lijst van ~200 veelgegeten
  basisproducten met Nederlandse namen en kcal/eiwit/koolhydraten/vet per 100 g uit **USDA FoodData Central**
  (publiek domein, dus mag in de publieke repo). Neem per product de FDC-id op voor herleidbaarheid en vermeld de bron.
  Geen NEVO: dat vraagt een handmatige download met akkoord op de voorwaarden en mag niet zomaar publiek in de repo.
- **Eigen producten** (naam, macro's per 100 g, optioneel barcode en portiegrootte) en **recepten** (ingrediënten met
  gram, aantal porties). Onbekende barcode → formulier om het etiket over te nemen, opgeslagen als eigen product.
- **Vaste items**: een sjabloon van dagelijkse producten dat met één tik aan de dag wordt toegevoegd, plus "dag kopiëren".

## 5. Scannen

- Native **Barcode Detection API** waar die bestaat (Chrome op Android). Safari op iOS heeft hem niet, dus daar de
  polyfill `barcode-detector` (ZXing-WebAssembly; patcht alleen als de native API ontbreekt).
- **Host het `.wasm`-bestand zelf** en zet het in de service-worker-cache (niet de standaard-CDN).
- Formaten EAN-13, EAN-8, UPC-A, UPC-E. Altijd een terugvaloptie "barcode intypen". Nette melding bij geweigerde camera.

## 6. De keten naar de coach

Zo werkt Healthbridge nu (gelezen in `healthbridge-data`, controleer zelf): een Android-app (Kotlin) leest dagelijks
voedingsrecords uit **Health Connect** (standaard alleen van MyFitnessPal), zet ze om in `NutritionEntry`, en schrijft
`days/YYYY-MM-DD.json`, `daily.csv` en `nutrients.csv` naar de privé-repo via de GitHub API. Elke run herschrijft
vandaag en de 3 dagen ervoor. Health Connect heeft **geen veld voor gram**, en een PWA kan niet in Health Connect
schrijven. Daarom loopt Tarapp níet via Health Connect, maar zo:

```
Tarapp (telefoon)  --push-->  Cloudflare Worker (KV)  <--pull--  Healthbridge-app  --commit-->  healthbridge-data  -->  coach
```

### 6a. Tarapp → Worker
- Elke wijziging in het dagboek gaat (zodra er netwerk is) naar de Worker, per persoon, met een schrijf-token.
  Volg het Parkenjacht-patroon: per regel een id en `updatedAt`, verwijderen met tombstones.
- Alleen dagboeken waarvoor in de instellingen "Doorsturen naar Healthbridge" aan staat (standaard alleen Oscar).
  Tara's dagboek wordt gesynct maar niet aan Healthbridge doorgegeven.

### 6b. Worker
- Uitbreiding van de bestaande Worker, of een nieuwe naast `proxy/` volgens hetzelfde patroon (kies wat het
  minste handwerk voor Oscar oplevert en noteer waarom).
- Endpoints: dagboek schrijven (schrijf-token), OFF-proxy, en `GET /voeding/export?person=oscar&from=YYYY-MM-DD&to=YYYY-MM-DD`
  met een **apart lees-token** voor Healthbridge.
- Exportformaat (`schemaVersion: 1`), per dag de regels:
  `{ id, date, time (HH:mm, Europe/Amsterdam), meal (breakfast|lunch|dinner|snack), name, brand?, grams, unit (g|ml), kcal, protein_g, carbs_g, fat_g, source (off|nevo|eigen|recept), barcode? }`.
  Verwijderde regels komen niet in de export.

### 6c. Healthbridge-app (`healthbridge-data/healthbridge/`)
- Nieuwe voedingsbron **Tarapp**: haalt bij elke run de export op voor dezelfde dagen die de app al opnieuw
  synchroniseert (vandaag + 3 dagen terug) en zet elke regel om in een `NutritionEntry` met `origin = "tarapp"`.
- Breid `NutritionEntry` en `ItemOut` uit met **`grams`** (Double?) en **`unit`**, en zet in de JSON ook `source`
  (`"tarapp"` of `"myfitnesspal"`). Bestaande MFP-items krijgen `grams: null`. Velden die Tarapp niet bijhoudt
  (vezels, suiker, verzadigd vet, natrium, micros) blijven **`null`**, nooit 0.
- Instelling **Voedingsbron**: MyFitnessPal, Tarapp, of beide. Standaard: Tarapp als er een lees-token is ingevuld.
  Bij "beide" waarschuwen voor dubbeltellingen.
- Worker-URL en lees-token komen binnen via de koppel-deeplink (sectie 0b) en worden versleuteld opgeslagen zoals de GitHub-token (EncryptedSharedPreferences). Handmatig invullen in Instellingen blijft mogelijk als terugvaloptie.
- **Beveiliging**: de app praat nu alleen met `api.github.com`. Voeg alleen de Worker-host toe, expliciet (geen
  wildcard), alleen HTTPS, geen redirects naar andere hosts, en nooit token of voedingsdata in logs (`SafeLog`).
  Pas de README-sectie Beveiliging hierop aan.
- Is de Worker onbereikbaar: de rest van de run gaat gewoon door, voeding van die dag blijft zoals hij was
  (niet leegmaken), en het sync-log vermeldt het.
- Tests (in de stijl van de bestaande 103): omzetten van exportregels naar items, `grams` in de JSON, null-velden
  blijven null, bronkeuze, Worker onbereikbaar, oude JSON zonder `grams` blijft leesbaar.
- Werk de versie bij zodat de bestaande CI een nieuwe APK bouwt; de ondertekening blijft hetzelfde.

### 6d. README voor de coach (root van `healthbridge-data`)
- Documenteer `grams`, `unit` en `source` bij `items`.
- Pas de sectie "Vitaminen en mineralen schatten" aan: bij items met `source: "tarapp"` is het gewicht **bekend**,
  dus de coach gebruikt `grams` direct en hoeft geen portie uit kcal af te leiden. Dat maakt schattingen een stuk
  nauwkeuriger. De regels voor items zonder gram (MFP) blijven staan.
- Werk de zin "Voeding komt alleen van MyFitnessPal" bij.

## 7. Tests in Tarapp (minimaal)
- Gram → macro's, recept → per portie, kJ → kcal.
- OFF-parser met echte voorbeeld-JSON, inclusief ontbrekende velden.
- Basisproductenlijst: elke regel heeft naam, FDC-id en vier waarden; kcal klopt grofweg met 4/4/9 × macro's.
- Koppelknop: genereert tokens, registreert bij Worker, bouwt een geldige deeplink.
- Sync-merge: gelijktijdige bewerking op twee apparaten, verwijderen na bewerken.
- Exportformaat: snapshot-test, zodat een wijziging bewust moet gebeuren.

## 8. Wat je níet doet
- Geen NEVO-data in de publieke repo, en geen stappen die Oscar handmatig data laten importeren.
- Geen OFF-aanroepen direct uit de browser zonder de Worker.
- Geen GitHub-token in Tarapp; alleen Healthbridge schrijft naar de privé-repo.
- Geen wijzigingen aan bestaande Tarapp-functies, navigatie of opslag, of aan de bestaande Healthbridge-velden,
  behalve wat hierboven staat. De bestaande dagbestanden in `days/` niet met de hand aanpassen.

Aanbevolen in Claude Code: Opus met effort *high* (het is één lange run over twee repo's).
