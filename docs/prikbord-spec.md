# Prikbord: opdracht voor Claude Code

Je werkt in de repo `oscardillewaard-ai/Tezt`. Bouw daar een derde losse PWA: **Prikbord**, naast Tarapp (`public/sportagenda/`) en Parkenjacht (`public/parken/`). Sla deze opdracht in M0 op als `docs/prikbord-spec.md`; die tekst is leidend. Begin met M0 (§8).

## 1. Wat en voor wie

Bij Oscar thuis hangt een prikbord met afgescheurde papiertjes: to-do's, bucketlist, ideetjes voor vakantie, recepten om te proberen. Dit wordt de digitale versie, en die moet precies zo voelen: een idee = een papiertje afscheuren, erop schrijven en op het bord prikken. Meerdere mensen werken samen aan een bord.

- Komt in `public/prikbord/`, staat na deploy op `https://oscardillewaard-ai.github.io/Tezt/prikbord/`.
- Alle teksten in het Nederlands. Toon: vrolijk, warm en speels, emoji mag (zoals de changelogs van Tarapp en Parkenjacht). Niet aan één persoon gericht: op andere borden zitten ook vrienden.
- Mobiel eerst: ontwerp voor 390 px breed, met één hand te bedienen. Moet werken op iPhone (Safari, "Zet op beginscherm") en Android (Chrome).

## 2. Besluiten en aannames

**Besluiten van Oscar (8 nov 2026):**
- **Meerdere borden**: een bord voor thuis, plus aparte borden met anderen (bijv. vrienden voor een groepsreis).
- **Twee weergaven**: standaard "netjes rommelig" (de app prikt zelf neer), plus een vrij-modus om briefjes te slepen en te zoomen.
- **Op een briefje** kan naast tekst: een **link**, een **foto**, een **plek op de kaart** en **hartjes**.
- **Gedaan** = het briefje gaat naar de **Gedaan-doos**, met datum en eventueel een foto, om later terug te kijken.

**Aannames (Oscar kan ze nog omgooien):**
- Samenwerken zoals Parkenjacht: per bord een groepscode en een koppel-link, geen accounts.
- Je typt; de tekst staat in een handschriftletter. Geen tekenen met de vinger.
- Begin-categorieën per bord (§5.6), in de app aan te passen. "Uit eten" en "Restaurants" blijven apart tot Oscar ze samenvoegt.
- Een knop "Trek een briefje" 🎲 voor als je niet kunt kiezen.

## 3. Eerst lezen (vóór je iets bouwt)

Het Prikbord volgt dezelfde afspraken als Tarapp en mag code hergebruiken. Lees:
- `README.md`: de secties "Tarapp (losse app)" en "Parkenjacht (losse app)"
- `public/sportagenda/sw.js`: de network-first service worker
- `public/sportagenda/app.js`: de secties "Opslag", "Wat is er nieuw" en "Updates", plus `requestPersistence`, `exportData` en de acties `force-update` en `import`
- `public/sportagenda/index.html`: de `<head>` (iOS-meta-tags)
- `public/parken/app.js`: de sectie "Samen synchroniseren" en de koppel-link (`#koppel=`)
- `proxy/parken-sync-worker.js`: sync-worker met KV, samenvoegen, statuspagina
- `vite.config.ts`, `.oxlintrc.json`, `.github/workflows/deploy-pages.yml`, `scripts/gen-sportagenda-icons.mjs`, `scripts/audit.mjs`

## 4. Vaste regels

### 4.1 Overgenomen van Tarapp

Deze staan zo in de code van Tarapp (of Parkenjacht, waar vermeld). Wijk er niet van af zonder het eerst te vragen.

1. **Geen buildstap, geen frameworks, geen CDN's.** Gewone HTML/CSS/JS. Fonts en libraries zelf hosten (Tarapp: `fonts/` met OFL-licentiebestanden; Parkenjacht: Leaflet in `vendor/`).
2. **Gegevens in `localStorage` onder één vaste sleutel**, hier `prikbord.v1`. Die naam verandert nooit meer: Tarapp hield bewust `sportagenda.v1` aan, zodat bestaande installaties hun gegevens hielden. `load()` valideert en normaliseert, en valt bij kapotte opslag terug op de standaard in plaats van te crashen. `save()` staat in try/catch, met een melding om een back-up te maken als opslaan mislukt.
3. **Blijvende opslag aanvragen** bij het starten (`navigator.storage.persisted() || navigator.storage.persist()`) en de status tonen onder Meer.
4. **Network-first service worker**, naar het voorbeeld van `public/sportagenda/sw.js`: `fetch(req, { cache: 'no-cache' })`, want GitHub Pages laat de browser anders tot 10 minuten een oude kopie gebruiken. Offline terugvallen op de cache. `skipWaiting()` en `clients.claim()`, oude caches weg bij `activate`. Alleen GET-verzoeken naar de eigen origin onderscheppen: nooit de sync-worker, kaarttegels of andere sites.
5. **Updates komen vanzelf binnen.** Registreren met `updateViaCache: 'none'`. Bij `visibilitychange` naar zichtbaar `reg.update()`, omdat iOS de app vaak op de achtergrond open houdt. Bij `controllerchange` herladen (niet bij de allereerste installatie), maar **nooit terwijl er een venster openstaat**: wacht tot het schrijfvel, een open sheet, een sleepbeweging of een foto-upload klaar is, zoals `reloadWhenIdle` in Tarapp.
6. **Eén keer "Wat is er nieuw?"** na een update, via `CHANGELOG` (nieuwste bovenaan) en `settings.seenVersion`. Altijd terug te lezen onder Meer.
7. **Release-ritueel:** `APP_VERSION` in de app ophogen, `CACHE` in `sw.js` ophogen en bovenaan `CHANGELOG` een regel toevoegen.
8. **Back-up exporteren** als JSON via het deelmenu (`navigator.share` met een bestand; op de iPhone werkt dat beter dan downloaden), met een gewone download als terugval. Importeren onder Meer.
9. **Knop "Nu bijwerken":** alleen de app-cache wissen (nooit `localStorage` of IndexedDB), `reg.update()`, herladen.
10. **Geen trek-omlaag-om-te-verversen:** `overscroll-behavior-y: none` op `html, body`.
11. **Geheimen buiten de back-up:** groepscodes en het worker-adres onder een eigen sleutel `prikbord.sync`, zoals Parkenjacht (`parken.sync`) en de API-sleutel van Tarapp.
12. **Een onderbroken handeling gaat niet verloren.** Tarapp heropent een training die iOS halverwege afsloot. Hier: bewaar een half geschreven briefje als concept terwijl je typt, en open het bij de volgende start opnieuw.

### 4.2 Bewuste afwijkingen (met reden)

- **Importeren voegt samen** (per veld, §6.3) in plaats van te vervangen. Tarapp vervangt na bevestiging alles. Met sync zou een vervangen stand bij de volgende sync toch weer samengevoegd worden, dus samenvoegen is voorspelbaarder.
- **Foto's in IndexedDB, niet in `localStorage`.** Oscars apps op `https://oscardillewaard-ai.github.io` (o.a. Bergtrainer, Tarapp, Parkenjacht en ForeverChoser) delen één origin en dus één `localStorage`. Die is klein (in de meeste browsers rond de 5 MB, niet nagemeten), dus foto's daarin kunnen de andere apps laten vastlopen. De briefjes zelf (tekst) blijven in `prikbord.v1`.
- **ES-modules** (`<script type="module">`) in plaats van één groot `app.js`, zodat het rekenwerk in Node te testen is. Nog steeds zonder buildstap.

### 4.3 Specifiek voor Tezt

- `vite.config.ts`: voeg `'prikbord/**'` toe aan `globIgnores` en `/\/prikbord\//` aan `navigateFallbackDenylist`. Anders precachet of kaapt de service worker van Bergtrainer de Prikbord-pagina's (zie het commentaar daar).
- `.oxlintrc.json`: `public/prikbord/vendor/**` toevoegen aan `ignorePatterns`.
- Deploy: `.github/workflows/deploy-pages.yml` draait bij een push naar `claude/gpx-ultrarace-trainingen-zf6zci` of handmatig. Er is geen `main`. Push daar pas naartoe na akkoord van Oscar.
- De deploy bouwt alle apps in één keer. Faalt `npm run build`, dan krijgt geen enkele app een update, ook Tarapp niet. Draai daarom `npm run lint` en `npm run build` vóór elke commit.
- Iconen: `scripts/prikbord-icon.svg` en `scripts/gen-prikbord-icons.mjs`, zoals `gen-sportagenda-icons.mjs` (sharp staat al in de devDependencies).
- README: een sectie "Prikbord (losse app)" in de stijl van die van Tarapp en Parkenjacht.
- Raak Bergtrainer, Tarapp en Parkenjacht verder niet aan.

## 5. Wat de app doet

### 5.1 Borden en samenwerken
- Een telefoon kan op meerdere borden zitten. Bovenin staan naam en emoji van het actieve bord. Tikken opent de lijst met borden, "Nieuw bord" en "Ik heb een koppel-link".
- Nieuw bord: kies "Thuis" (de categorieën uit §5.6) of "Leeg".
- Elk bord is een eigen sync-groep met een lange, willekeurige groepscode (zoals Parkenjacht: `crypto.getRandomValues`, base64url). De groepscode is het enige wachtwoord; zeg dat in de app ("Iedereen met deze link kan meekijken en prikken").
- Koppel-link per bord: `…/prikbord/#koppel=<base64url van { u, r, n }>` (worker-adres, groepscode, bordnaam), te delen via `navigator.share`. Openen geeft "Bord 'Groepsreis Porto' toevoegen?" en voegt samen; er gaat niets verloren.
- **Wie ben jij?** Bij de eerste start kies je een naam. Per bord krijg je automatisch een kleur, die je kunt aanpassen. Kom je met een nieuw apparaat op een bord waar je al lid bent, dan kies je "Dit ben ik al", zodat je hartjes niet dubbel tellen.
- Bord verlaten haalt het alleen van dit apparaat weg; de anderen houden alles.
- Zonder sync-adres werkt alles lokaal. Het adres staat vast in `DEFAULT_SYNC_URL` zodra Oscar de worker heeft neergezet (zoals bij Parkenjacht).
- Melding in de app als een ander iets doet: "📌 Tara prikte 'Sushi in Den Haag'". Open je de app na een tijdje, dan zie je "3 nieuwe briefjes" en een klein **nieuw**-stickertje op briefjes die je nog niet zag (bijgehouden per apparaat).

### 5.2 Het bord: twee weergaven
De keuze geldt per apparaat en wordt per bord onthouden.
- **Netjes rommelig (standaard):** de app legt de briefjes in kolommen (2 op een telefoon, meer op bredere schermen), elk een paar graden scheef en aan de randen een beetje overlappend, met een punaise erin. Draaiing en verschuiving komen uit een seed op het briefje-id, zodat het bord op elke telefoon hetzelfde oogt. Filteren of sorteren laat de briefjes geanimeerd naar hun nieuwe plek schuiven: het bord "schudt". Gewoon scrollen met één duim. Op het bord toont een briefje max. ~6 regels; de rest staat in het geopende briefje.
- **Vrij:** de echte-prikbordmodus. Lang drukken (± 300 ms) tilt een briefje op (schaduw groeit, kort trillen waar de browser dat kan), slepen verplaatst het, loslaten prikt het opnieuw. Knijpen om te zoomen, met één vinger over het kurk schuiven. De vrije plek hoort bij het bord, dus iedereen ziet dezelfde indeling. Sla hem op in bordcoördinaten (bijv. 1000 eenheden breed), zodat telefoon en tablet hetzelfde tonen. Filters dimmen de andere briefjes in plaats van ze te verschuiven. Een briefje zonder vrije plek krijgt de eerste lege plek bovenaan.

### 5.3 Het scheur-en-prik-moment (hier zit de lol)
- Rechtsonder hangt een **scheurblokje** in plaats van een gewone plusknop.
- Tik erop en het bovenste vel scheurt eraf: gekartelde scheurrand, een paar snippers, een zacht "rrrits"-geluid (uit te zetten). Het vel groeit uit tot schrijfvel.
- Je typt; de tekst verschijnt meteen in de handschriftletter, op papier in de kleur van de gekozen categorie. De categorie kies je met gekleurde tabjes. Link (paperclip), foto (plakband) en plek (kaartje) voeg je toe vanaf het vel.
- **"Prikken! 📌"**: het vel krimpt, vliegt naar zijn plek op het bord en de punaise prikt erin met een veertje en een "tok". Buren wiebelen even mee.
- Tik op een bestaand briefje: het komt van het bord en opent groot, met alle details en wie het wanneer prikte. Daar kun je bewerken, een hartje geven, het op gedaan zetten of het verwijderen.
- Bij `prefers-reduced-motion`: alleen zachte overgangen, geen vliegen en wiebelen.

### 5.4 Uiterlijk
- **Kurk:** warme kurkstructuur uit een kleine SVG-ruis (`feTurbulence`) als achtergrond, geen grote foto. Een houten lijst mag.
- **Papier:** lichte papierkorrel en gekartelde randen via `clip-path: polygon(…)`, per briefje vast bepaald door het id. Zet de schaduw op een wrapper, want `clip-path` snijdt de schaduw van het element zelf weg.
- **Kleur:** de papierkleur hoort bij de categorie, de kleur van de punaise bij wie het prikte. Zo zie je in één oogopslag wat het is en van wie.
- **Handschriftletter:** zelf hosten in `fonts/` met OFL-licentiebestand, zoals Tarapp. Bijvoorbeeld Caveat of Patrick Hand; controleer dat é, ë en ï er goed in staan.
- Een foto op een briefje is een polaroidje met een stukje plakband. Hartjes staan klein onderaan het briefje, in de kleuren van wie ze gaf.
- Laat Oscar in M1 kiezen uit 2 à 3 uitwerkingen van kurk en papier (screenshots op 390 px) voordat je verder bouwt.

### 5.5 Wat er op een briefje kan
- **Tekst** (verplicht, max. ~500 tekens).
- **Categorie** (precies één; bepaalt de papierkleur).
- **Link**: recept, restaurant, Airbnb. Op het briefje een klein label met het domein ("🔗 ah.nl"). Alleen http(s).
- **Foto** (§6.4).
- **Plek** (§5.9).
- **Hartjes**: per persoon aan of uit. Dubbeltikken op een briefje geeft een hartje, net als op Instagram.

### 5.6 Filters en categorieën
- Filterbalk boven het bord: chips per categorie (meerdere tegelijk aan), "💞 Iedereen zin" (iedereen op het bord gaf een hartje) en "Alles".
- Sorteren in netjes-modus: nieuwste eerst (standaard) of meeste hartjes.
- Begin-categorieën voor een "Thuis"-bord (emoji en kleur zijn een voorstel): 🏝️ Lange vakantie · 🧳 Weekendje weg · 🎡 Dagje uit · 🍝 Uit eten · 🍽️ Restaurants · 🥘 Recepten · ✅ To do · ⭐ Bucketlist.
- Categorie-editor onder Meer, per bord (een reisbord wil andere categorieën): toevoegen, hernoemen, emoji, kleur, volgorde, verbergen. Een gebruikte categorie wordt alleen verborgen, niet gewist, zodat oude briefjes hun kleur houden (zoals Tarapp met trainingstypes doet).

### 5.7 Trek een briefje 🎲
Knop in de filterbalk. Kiest willekeurig uit de briefjes die nu zichtbaar zijn, dus binnen de filters. Het bord schudt, één briefje wiebelt los en vliegt groot naar het midden. Knoppen: "Nog eens" en "Sluiten".

### 5.8 Gedaan-doos
- "Gedaan! ✅" op een geopend briefje vraagt optioneel om een datum (standaard vandaag), "Hoe was het?" en een foto. Dan springt de punaise eruit en valt het briefje in de doos, met wat confetti.
- De Gedaan-doos is een eigen tab: een plakboek, nieuwste eerst, per maand gegroepeerd, met een teller ("37 dingen samen gedaan 🎉"). Filters werken hier ook.
- "Terughangen" zet een briefje terug op het bord.

### 5.9 Kaart
- Eigen tab met alle briefjes die een plek hebben, als punaises in de categoriekleur. Tik op een punaise en het briefje opent. Filters werken hier ook; gedane briefjes kun je grijs laten zien.
- Kopieer Leaflet uit `public/parken/vendor/` (BSD-2, licentiebestand mee) naar `public/prikbord/vendor/`. Tegels van OpenStreetMap zoals bij Parkenjacht, met zichtbare bronvermelding "© OpenStreetMap-bijdragers".
- Een plek kiezen kan op vier manieren. De eerste drie hebben geen zoekdienst nodig:
  1. tikken op de kaart en de punaise verslepen;
  2. "Mijn locatie";
  3. een link van Google Maps of OpenStreetMap plakken, waarna de app de coördinaten uit de URL haalt (bijv. `@52.01,4.36`);
  4. zoeken op naam of adres via Nominatim, alleen via de eigen worker (§6.5).

### 5.10 Tabs en Meer
Tabbalk onderaan: **Bord · Kaart · Gedaan-doos · Meer**.
Onder Meer: borden en koppelen · wie ben ik · categorieën · syncstatus · back-up exporteren en importeren · status van blijvende opslag · Wat is er nieuw · Nu bijwerken · geluid aan/uit · versie.

## 6. Techniek

### 6.1 Bestanden (voorstel)
```
public/prikbord/
  index.html  manifest.webmanifest  sw.js  styles.css
  js/app.js  js/store.js  js/sync.js  js/photos.js  js/map.js
  js/merge.js  js/layout.js  js/seed.js  js/validate.js   (puur)
  fonts/  icons/  vendor/
proxy/prikbord-sync-worker.js
tests/prikbord/*.test.mjs      (buiten public/, anders worden de tests mee gedeployd)
scripts/prikbord-icon.svg  scripts/gen-prikbord-icons.mjs
docs/prikbord-spec.md          (deze opdracht)
docs/prikbord-afwijkingen.md   (elke bewuste afwijking, met reden)
```
Pure modules hebben geen DOM en geen opslag, en krijgen de tijd (`now`) mee. Zo draaien ze in de browser én in `node --test`.

### 6.2 Datamodel (vanaf M1 klaar voor sync)
Sync komt pas in M3, maar het model moet er vanaf het begin op gebouwd zijn.
- Elk briefje heeft een vast id dat nooit wordt hergebruikt, `door` (lid-id), `gemaakt` (tijdstip) en **per veld een eigen tijdstempel**: tekst, categorie, link, foto, plek, vrije plek, stapelvolgorde en gedaan (datum, notitie, foto).
- Hartjes: per lid-id een waarde met eigen tijdstempel.
- Verwijderen zet een **grafsteen** (`weg: t`). Een grafsteen is definitief en wint van elke bewerking. Daarom eerst bevestigen, en dan 5 tellen "Ongedaan maken" voordat de grafsteen vertrekt.
- Bordinstellingen (naam, emoji, categorieën) en leden (naam, kleur) ook per veld met tijdstempel.
- Tijdstempel = `max(Date.now(), vorige t van dat veld + 1)`, zoals Parkenjacht.

### 6.3 Samenvoegen en synchroniseren
Bouw voort op `proxy/parken-sync-worker.js` en de sync-lus in `public/parken/app.js`. Wat daar al goed is (samenvoegen met tijdstempels, uitvinken als grafsteen, opnieuw sturen als de server iets kwijtraakte, de statuspagina in gewone taal), neem je over. De verschillen:
- **Per veld wint de jongste wijziging, niet per briefje.** Anders verliest iemand zijn tekstwijziging als een ander tegelijk een hartje geeft. Bij een gelijk tijdstip kies je vast (bijv. op de JSON van de waarde), zodat elk apparaat hetzelfde kiest.
- `merge` moet commutatief, associatief en idempotent zijn. Bewijs het met een test (§9).
- **Alleen gewijzigde briefjes versturen** (PUT met de gewijzigde items). De worker voegt samen, bewaart en geeft de volledige stand terug, plus `rev`.
- **`rev` is een hash van de opgeslagen stand, geen teller.** KV is niet atomair: twee gelijktijdige PUT's kunnen allebei "revisie 6" schrijven, waarbij de ene de andere overschrijft. Met een teller merkt het apparaat waarvan de wijziging is overschreven dat nooit. Met een hash wel, want de opgeslagen stand verschilt dan van de stand die het terugkreeg.
- **Peilen** met `GET /bord/<code>?sinds=<rev>`: de worker antwoordt kort `{ rev, ongewijzigd: true }` als er niets veranderd is, en anders de volledige stand. Vergelijk na elk antwoord: heeft dit apparaat iets nieuwers dan de server, stuur het dan opnieuw (max. 3 keer per ronde, zoals Parkenjacht).
- Peilen elke 10 s zolang het bord zichtbaar is en er de laatste 5 minuten iets gebeurde, daarna elke 30 s. Bij terugkomen in de app en bij `online` meteen, en bij het openen van de app één keer de volledige stand. Alleen het actieve bord peilen; de andere borden bij het openen van de app, voor het "nieuw"-tellertje.
- Wijzigingen 1,5 s bundelen voor ze vertrekken, zodat een sleepbeweging of een reeks hartjes één schrijfactie wordt.
- KV staat maximaal 1 schrijfactie per seconde op dezelfde sleutel toe. Vang een mislukte `put` in de worker af en geef een status terug waarop de app het na een willekeurige korte wachttijd opnieuw probeert. Niets kwijtraken: wat niet aankwam, blijft gemarkeerd als gewijzigd.
- De worker valideert alles: ids met een regex, alleen bekende velden, maximale lengtes, links alleen http(s), coördinaten binnen bereik. Max. 256 KB per PUT. CORS alleen voor `https://oscardillewaard-ai.github.io` en localhost.
- **Eigen worker en eigen KV-namespace** (binding `PRIKBORD`), los van Parkenjacht: gaat de een stuk, dan werkt de ander gewoon door. Zet bovenin het worker-bestand de stappen voor Oscar in gewone taal, in dezelfde stijl als bij Parkenjacht, inclusief de statuspagina op `/`.
- Statusbolletje zoals Parkenjacht: gesynchroniseerd om …, bezig, offline ("wijzigingen gaan mee zodra het weer lukt").

**Limieten van Cloudflare Workers KV op het gratis plan** (nagekeken op developers.cloudflare.com/kv/platform/limits op 8 nov 2026): 100.000 reads per dag, 1.000 writes per dag, 1 write per seconde op dezelfde sleutel, 1 GB opslag, max. 25 MiB per waarde. Deze limieten gelden per account, dus samen met Parkenjacht. Voor een paar borden met een handvol mensen is dat ruim, mits je bundelt zoals hierboven. Reken in een test uit hoeveel KV-writes een drukke dag kost en meld dat getal.

### 6.4 Foto's
- Verklein in de app vóór het opslaan: langste zijde max. 1600 px, JPEG met kwaliteit ~0,8, doel onder 400 KB. Test met een staande iPhone-foto (oriëntatie) en met een HEIC-foto.
- Lokaal als Blob in IndexedDB (database `prikbord`, store `fotos`). Uploads in een wachtrij in IndexedDB, zodat een foto die offline is toegevoegd later alsnog vertrekt.
- Worker: `PUT /bord/<code>/foto/<id>` (max. 1,5 MB, alleen image/jpeg, png of webp) en `GET /bord/<code>/foto/<id>` met `Cache-Control: public, max-age=31536000, immutable`, want een foto-id wordt nooit hergebruikt. Eén KV-sleutel per foto, niet in de bordstand.
- De service worker cachet geen andere origins (regel 4 in §4.1). Daarom bewaart de app een gedownloade foto zelf in IndexedDB, zodat hij offline zichtbaar blijft.
- Is een foto er nog niet (404 of offline), toon dan een vriendelijk leeg polaroidje en probeer het later opnieuw.
- Back-up: kies "met foto's" (base64 in de JSON, met een waarschuwing over de grootte) of "zonder".

### 6.5 Plekken zoeken via Nominatim
Nominatim, de zoekdienst van OpenStreetMap, heeft strikte gebruiksregels: https://operations.osmfoundation.org/policies/nominatim/ . Lees die en houd je eraan:
- **Nooit zoeken terwijl je typt.** Autocomplete is expliciet verboden; zoek alleen na een tik op de zoekknop.
- Max. 1 verzoek per seconde, en dat geldt **voor alle gebruikers samen**. Zoeken gebeurt alleen op een knop en dus zelden; zet daarnaast in de app en in de worker minstens 1 s tussen twee zoekopdrachten.
- Zoeken loopt via de eigen worker: `GET /zoek?q=…`. De worker vraagt Nominatim met een eigen User-Agent (appnaam en contact), cachet het antwoord met de Cache API van de worker (niet in KV, want writes zijn schaars) en is met één variabele (`ZOEKEN=uit`) uit te zetten zonder app-update.
- Toon de bronvermelding.
- Valt zoeken uit, dan blijven de andere drie manieren uit §5.9 gewoon werken.

## 7. Niet in v1 (wel noteren, niet bouwen)
Zoeken op tekst · linkvoorbeelden (titel en afbeelding) · iets vanuit een andere app naar het Prikbord delen (Web Share Target; werkt waarschijnlijk niet op de iPhone, eerst uitzoeken) · pushmeldingen buiten de app · donker thema · tekenen met de vinger.

## 8. Mijlpalen

Werk ze op volgorde af. Na elke mijlpaal: tests groen, `npm run lint` en `npm run build` groen, committen met een duidelijke boodschap, en kort melden wat klaar is, wat je getest hebt (en hoe), wat je niet kon testen en wat Oscar op zijn telefoon moet controleren.

- **M0, lezen en plan.** Lees de bestanden uit §3, sla deze opdracht op als `docs/prikbord-spec.md`, schrijf in max. 10 regels wat je overneemt en waar je afwijkt, en stel je vragen. ⏸ Wacht op akkoord.
- **M1, fundament en uiterlijk.** App-skelet met alle regels uit §4 (inclusief de aanpassingen in `vite.config.ts` en `.oxlintrc.json`), één lokaal bord, briefjes met tekst en categorie, netjes rommelig, het scheur-en-prik-moment, 2 à 3 stijlvoorstellen als screenshots. ⏸ Wacht op akkoord. Daarna deployen, zodat Oscar het op zijn telefoon kan voelen.
- **M2, het bord.** Filters, sorteren, categorie-editor, hartjes (met één lokaal lid), Gedaan-doos, Trek een briefje, vrij-modus met slepen en zoomen, back-up.
- **M3, samen.** Worker, meerdere borden, koppel-link, leden, samenvoegen per veld, peilen, statusbolletje, de convergentietest. Schrijf voor Oscar de stappen om de worker neer te zetten. ⏸ Wacht op akkoord nadat Oscar het met twee telefoons heeft getest.
- **M4, link, foto en kaart.** Foto-endpoints, IndexedDB, de kaart-tab en plekken kiezen (§5.9, §6.5).
- **M5, afronden.** README-sectie, changelog, prestaties (met 300 briefjes blijft scrollen vloeiend op een gewone telefoon; foto's pas laden als ze in beeld komen), toegankelijkheid (labels, focus, leesbare inkt op elke papierkleur) en een testlijst voor Oscar. ⏸ Wacht op akkoord.

## 9. Tests
- `node --test tests/prikbord/*.test.mjs` zonder dependencies, als npm-script `test:prikbord`.
- **Puur:** merge, layout (zelfde invoer geeft dezelfde posities en draaiing), validatie, de koppel-link coderen en decoderen.
- **Convergentie:** 3 gesimuleerde apparaten doen willekeurige bewerkingen (tekst, categorie, hartjes, slepen, gedaan, verwijderen) en synchroniseren in willekeurige volgorde, via een nep-KV die soms een gelijktijdige schrijfactie laat overschrijven. Na afloop moeten alle apparaten exact dezelfde stand hebben. Geseede PRNG, min. 1000 rondes.
- **Worker:** importeer `proxy/prikbord-sync-worker.js` in Node met een nep-KV (Map) en roep `fetch` aan met echte `Request`-objecten. Test validatie, samenvoegen, `sinds`/`ongewijzigd`, de fotolimieten, CORS en een mislukte KV-`put`.
- **Service worker:** een test die faalt als `CACHE` niet bij `APP_VERSION` past of als een app-bestand in de `SHELL`-lijst ontbreekt.
- **Rooktest in de browser** met Playwright, zoals `scripts/audit.mjs` (die zoekt Chromium via `CHROMIUM_PATH` of `/opt/pw-browsers/chromium`): twee browsercontexten op hetzelfde bord via een lokale nep-worker. Een briefje in de ene verschijnt in de andere; een briefje dat offline gemaakt is, gaat mee zodra je weer online bent.
- Pas nooit een test aan om hem groen te krijgen.

## 10. Werkwijze met Oscar
- Praat Nederlands met Oscar en schrijf code-commentaar in het Nederlands (zoals Tarapp).
- Wees kritisch en evidence-based, maar constructief: geef bij elk bezwaar ook een alternatief of vervolgstap, en noem ook wat al goed werkt.
- Maak onderscheid tussen wat je gecontroleerd hebt (getest, nagelezen in code of documentatie) en wat een aanname is. Weet je iets niet, zeg dat dan.
- Bij twijfel of tegenstrijdigheid in deze opdracht: vraag het, gok niet. Leg elke bewuste afwijking met reden vast in `docs/prikbord-afwijkingen.md`.
