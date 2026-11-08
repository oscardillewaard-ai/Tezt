# Prikbord: voortgang en overdracht

Elke mijlpaal krijgt een nieuwe chat (afspraak met Oscar, 8 nov 2026). Dit
bestand is het geheugen tussen die chats. Leidend blijft
`docs/prikbord-spec.md`. Afwijkingen staan in `docs/prikbord-afwijkingen.md`.

**Let op bij een nieuwe chat:** een nieuwe sessie start vanaf de standaardbranch
`claude/gpx-ultrarace-trainingen-zf6zci` (dat is ook de deploybranch). Werk dat
nog niet gedeployd is, staat op de werkbranch van de vorige mijlpaal (zie de
tabel hieronder). Merge die eerst in je eigen werkbranch.

## Status

| Mijlpaal | Status | Werkbranch |
| --- | --- | --- |
| M0 lezen en plan | klaar, akkoord van Oscar (8 nov); keuze losse repo open (V4) | `ccr-dd7e09d5-7p41e5` |
| M1 fundament en uiterlijk | nog niet begonnen | |
| M2 het bord | nog niet begonnen | |
| M3 samen | nog niet begonnen | |
| M4 link, foto en kaart | nog niet begonnen | |
| M5 afronden | nog niet begonnen | |

## Nulmeting (8 nov 2026, vóór de eerste Prikbord-commit)

- De deploybranch en de werkbranch stonden allebei op `0c82ec8`.
- `npm run build`: groen.
- `npm run lint`: **rood**, met 3 fouten `react/rules-of-hooks`. Oxlint ziet de
  gewone functie `useEmoji` in `public/sportagenda/app.js` aan voor een
  React-hook. Dat zit er sinds `9d838b1` (4 nov). De deploy-workflow draait
  geen lint, dus deploys werken gewoon. Getest: een `overrides`-regel in
  `.oxlintrc.json` die `react/rules-of-hooks` uitzet voor `public/**` maakt
  lint groen (exit 0). Zie vraag V1.
- Node 22 in de cloudsessie, Node 20 in de deploy-workflow.
- Netwerk: er is een persoonlijke cloudomgeving **"Tezt"** die
  `developers.cloudflare.com` en `operations.osmfoundation.org` toestaat
  (plus de package registries). Kies die omgeving bij het starten van een
  nieuwe chat. Lees die sites met `curl` in Bash: WebFetch gaat niet via de
  proxy van de sessie en blijft ze weigeren.

## Plan uit M0: wat ik overneem en waar ik afwijk

1. **Van Tarapp:** network-first `sw.js`, `updateViaCache: 'none'`, `reg.update()` bij terugkomen, herladen via `reloadWhenIdle`, `CHANGELOG` met `seenVersion`, `requestPersistence`, export via `navigator.share` met download als terugval, "Nu bijwerken", de iOS-meta-tags, fonts met OFL in `fonts/`, iconen via sharp.
2. **Van Parkenjacht:** groepscode (`getRandomValues`, base64url), de `#koppel=`-link (met bordnaam `n` erbij), sync-lus met "gewijzigd"-vlag en max. 3 keer opnieuw sturen, statusbolletje, worker met CORS-lijst, validatie (`clean`), `findKv` en de statuspagina met neerzet-stappen in gewone taal. Leaflet uit `vendor/`.
3. **Anders, zoals de spec vraagt:** per veld samenvoegen in plaats van per park, met een vaste keuze bij een gelijk tijdstip. Parkenjacht houdt dan de eigen waarde, en dat is niet commutatief. Verder: alleen gewijzigde briefjes versturen, `rev` als hash, `?sinds=`, 1,5 s bundelen, en een mislukte KV-`put` afvangen met een status waarop de app het opnieuw probeert.
4. **Afwijking A1:** caches alleen opruimen als ze met `prikbord-` beginnen. Tarapp en Parkenjacht wissen bij elke update alle caches van de origin, ook die van elkaar en van Bergtrainer (getest in Chromium).
5. **Afwijking A2:** de statuspagina van de worker schrijft niet bij elk bezoek naar KV. Parkenjacht doet dat wel, en de 1.000 writes per dag worden gedeeld.
6. **Puur en testbaar:** `merge`, `layout`, `seed`, `validate` en de koppel-link zonder DOM en zonder opslag, met `now` als argument. Tests in `tests/prikbord/` via `node --test`.
7. **Grote PUT's:** de eerste koppeling van een groot bord gaat in delen van onder de 256 KB.
8. **Overdracht:** dit bestand per mijlpaal bijwerken (status, besluiten, open punten, startprompt).
9. **Deploy:** alleen na akkoord van Oscar mergen naar `claude/gpx-ultrarace-trainingen-zf6zci`.

## Open vragen aan Oscar

- **V2, cache-bug:** de cache-opruiming in Tarapp en Parkenjacht los repareren (aparte commit in Tezt, met `CACHE` en `APP_VERSION` opgehoogd)? Oscars "klinkt allemaal goed" lees ik als ja, maar dat moet hij nog bevestigen, want het raakt Tarapp.
- **V4, losse repo:** Prikbord in een eigen repo (bijv. `oscardillewaard-ai/prikbord`) in plaats van in Tezt? Advies: ja (zie hieronder). Dat besluit valt vóór M1.

### V4: losse repo, de afweging

Wat een eigen repo oplost:

- **Een eigen deploy.** Een kapotte build of falende test van Prikbord houdt Tarapp niet meer tegen (het risico uit §4.3). De tests mogen de deploy dan wél tegenhouden.
- **Geen service worker van Bergtrainer erboven.** Die heeft scope `/Tezt/`. Een site op `/prikbord/` valt daarbuiten, dus de aanpassingen in `vite.config.ts` zijn niet nodig.
- **Geen build en geen Vite.** Pages kan de map gewoon serveren.
- **Geen rode lint door Tarapp** (V1 vervalt), en geen botsingen met andere chats die naar de deploybranch van Tezt pushen.
- **Een gewone `main`-branch.**

Wat hetzelfde blijft: het domein `oscardillewaard-ai.github.io` en dus de gedeelde `localStorage` en caches (A1 blijft nodig), de CORS-oorsprong van de worker, en het gedeelde KV-quotum van het Cloudflare-account (A2 blijft nodig).

Wat het kost:

- Oscar maakt de repo zelf aan (deze chat mag geen repo's aanmaken) en geeft de GitHub-app van Claude er toegang toe.
- Pages aanzetten. Uit mijn kennis, niet nagelezen: op het gratis GitHub-plan werkt Pages alleen voor publieke repo's.
- §1, §4.3 en de paden in §6.1 van de spec worden aangepast. Dat komt in de afwijkingen.
- De M1-chat moet Tezt erbij halen (alleen lezen) om de code van Tarapp en Parkenjacht te bekijken.

## Nagelezen in de documentatie (8 nov 2026, via curl)

- **Cloudflare KV-limieten** (developers.cloudflare.com/kv/platform/limits): gratis plan 100.000 reads per dag, 1.000 writes per dag, 1 write per seconde op dezelfde sleutel, 1 GB opslag per account, max. 25 MiB per waarde, sleutel max. 512 bytes. Komt overeen met §6.3.
- **KV is "uiteindelijk consistent"** (developers.cloudflare.com/kv/concepts/how-kv-works): "Changes are usually immediately visible in the Cloudflare global network location at which they are made. Changes may take up to 60 seconds or more to be visible in other global network locations". Ook op dezelfde locatie is dat "not guaranteed". Gevolg: meestal zie je een wijziging binnen een paar tellen, soms pas na een minuut. Het opnieuw sturen uit §6.3 vangt verloren schrijfacties op, en de convergentietest moet ook verouderde reads nabootsen.
- **Nominatim-beleid** (operations.osmfoundation.org/policies/nominatim): absoluut max. 1 verzoek per seconde voor alle gebruikers samen. De app identificeren met een Referer of User-Agent (een e-mailadres is niet verplicht). Duidelijke bronvermelding. Uit te zetten zonder app-update. Bij voorkeur via een proxy met cache. Autocomplete is verboden, net als systematische zoekopdrachten. Nieuw sinds de spec: een sectie "Usage in LLMs". Daarin staat dat het publieke API alleen gebruikt mag worden als "the application developer has made a deliberate, informed decision to use it and is directly responsible for complying with this policy". Dat is hier Oscar: hij koos Nominatim zelf in de spec.

## Aannames die ik aanhoud (tenzij Oscar anders zegt)

- **Dubbeltik = hartje** (§5.5) betekent dat een enkele tik ongeveer 250 ms wacht voordat het briefje opent. Instagram doet dat ook. Uitproberen in M2.
- **Trillen:** voor zover ik weet heeft Safari op de iPhone geen Vibration API (niet getest). Optillen trilt dan alleen op Android.
- **Nominatim-User-Agent (M4):** `Prikbord/1.0 (+<repo-URL>)`, zonder e-mailadres.
- **Tests niet in de deploy-workflow:** een falende Prikbord-test zou dan ook de updates van Tarapp tegenhouden. Wel lokaal draaien vóór elke commit.
- **Handschriftletter:** zowel Caveat als Patrick Hand in de stijlvoorstellen, zodat Oscar kiest.

## Bevindingen buiten Prikbord (niet aangeraakt)

- Tarapp en Parkenjacht wissen bij updates elkaars caches (zie A1 en V2).
- De statuspagina van Parkenjacht schrijft bij elk bezoek naar KV (zie A2).
- `npm run lint` is rood door Tarapp (zie V1).

## Besluiten van Oscar

8 nov 2026, Oscar: "Klinkt allemaal goed."

- **M0:** akkoord met het plan, de afwijkingen A1 en A2 en de aannames.
- **V1, lint:** akkoord met de `overrides`-regel (rules-of-hooks uit voor `public/**`). Vervalt als Prikbord een eigen repo krijgt (V4).
- **V3, volgorde in M1:** eerst het skelet plus 3 stijlvoorstellen (screenshots op 390 px), dan kiest Oscar, en pas daarna het scheur-en-prik-moment in de gekozen stijl, allemaal in de M1-chat.
- **Netwerk:** de cloudomgeving "Tezt" is aangemaakt (zie de nulmeting).

## Logboek

### M0 (8 nov 2026)

- Gelezen: alle bestanden uit §3 van de spec.
- `docs/prikbord-spec.md` opgeslagen (byte voor byte gelijk aan de opdracht).
- `docs/prikbord-afwijkingen.md` gestart (A1, A2).
- Getest: baseline lint en build, de lint-override, en of Cache Storage gedeeld wordt (Playwright, Chromium).
- Eerst niet kunnen nalezen: de KV-documentatie van Cloudflare en het gebruiksbeleid van Nominatim. Na het aanmaken van de omgeving "Tezt" wel (zie "Nagelezen in de documentatie").
- Oscar gaf akkoord op M0 en vroeg of een losse repo beter is (V4).
