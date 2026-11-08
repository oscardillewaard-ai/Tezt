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
| M0 lezen en plan | klaar, wacht op akkoord van Oscar | `ccr-dd7e09d5-7p41e5` |
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
- Vanuit de cloudsessie niet bereikbaar: `developers.cloudflare.com` en
  `operations.osmfoundation.org`. Voor M3 (KV-limieten) en M4 (regels van
  Nominatim) moeten die hosts in de netwerkinstellingen worden toegestaan, of
  Oscar plakt de tekst in de chat.

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

## Open vragen aan Oscar (M0)

- **V1, lint:** mag de `overrides`-regel in `.oxlintrc.json` (rules-of-hooks uit voor `public/**`)? Getest: lint wordt groen. Alternatieven: `useEmoji` hernoemen in Tarapp (dan raak ik Tarapp aan), of alleen de Prikbord-bestanden linten.
- **V2, cache-bug:** de cache-opruiming in Tarapp en Parkenjacht los repareren (aparte commit, met `CACHE` en `APP_VERSION` opgehoogd), of laten liggen? Valt buiten "raak ze niet aan".
- **V3, volgorde in M1:** eerst het skelet plus 3 stijlvoorstellen (statisch bord met voorbeeldbriefjes, screenshots op 390 px), dan kiest Oscar, en pas daarna het scheur-en-prik-moment bouwen in de gekozen stijl, allemaal in de M1-chat?

## Aannames die ik aanhoud (tenzij Oscar anders zegt)

- **Dubbeltik = hartje** (§5.5) betekent dat een enkele tik ongeveer 250 ms wacht voordat het briefje opent. Instagram doet dat ook. Uitproberen in M2.
- **Trillen:** voor zover ik weet heeft Safari op de iPhone geen Vibration API (niet getest). Optillen trilt dan alleen op Android.
- **KV is "uiteindelijk consistent":** uit mijn kennis van de Cloudflare-docs (niet nagelezen, de site is hier niet bereikbaar) kan een andere Cloudflare-locatie tot ongeveer een minuut achterlopen. Meestal zie je een wijziging binnen een paar tellen, soms pas na een minuut. Het opnieuw sturen uit §6.3 vangt verloren schrijfacties op. Een atomair alternatief is Durable Objects, maar dat lijkt voor v1 niet nodig.
- **Nominatim-User-Agent (M4):** `Prikbord/1.0 (+https://github.com/oscardillewaard-ai/Tezt)`, zonder e-mailadres.
- **Tests niet in de deploy-workflow:** een falende Prikbord-test zou dan ook de updates van Tarapp tegenhouden. Wel lokaal draaien vóór elke commit.
- **Handschriftletter:** zowel Caveat als Patrick Hand in de stijlvoorstellen, zodat Oscar kiest.

## Bevindingen buiten Prikbord (niet aangeraakt)

- Tarapp en Parkenjacht wissen bij updates elkaars caches (zie A1 en V2).
- De statuspagina van Parkenjacht schrijft bij elk bezoek naar KV (zie A2).
- `npm run lint` is rood door Tarapp (zie V1).

## Besluiten van Oscar

_(nog leeg: hier komen de antwoorden op V1 t/m V3 en het akkoord op M0)_

## Logboek

### M0 (8 nov 2026)

- Gelezen: alle bestanden uit §3 van de spec.
- `docs/prikbord-spec.md` opgeslagen (byte voor byte gelijk aan de opdracht).
- `docs/prikbord-afwijkingen.md` gestart (A1, A2).
- Getest: baseline lint en build, de lint-override, en of Cache Storage gedeeld wordt (Playwright, Chromium).
- Niet kunnen nalezen: de KV-documentatie van Cloudflare en het gebruiksbeleid van Nominatim (hosts geblokkeerd in deze sessie).
