# Prikbord: bewuste afwijkingen

Elke bewuste afwijking van `docs/prikbord-spec.md`, of van hoe Tarapp en
Parkenjacht het doen, met de reden erbij. Status: **voorgesteld** (wacht op
Oscar), **akkoord** of **afgewezen**.

De drie afwijkingen uit §4.2 van de spec (importeren voegt samen, foto's in
IndexedDB, ES-modules) staan al in de spec zelf en zijn daarmee akkoord. Ze
worden hier niet herhaald.

## A1. Caches alleen opruimen als ze met `prikbord-` beginnen

- **Waar:** `sw.js` bij `activate`, en de knop "Nu bijwerken".
- **Hoe Tarapp en Parkenjacht het doen:** `sw.js` wist bij `activate` elke
  cache die niet de eigen `CACHE` is (`k !== CACHE`), en "Nu bijwerken" wist
  alles uit `caches.keys()`.
- **Waarom anders:** Cache Storage hoort bij de origin, niet bij de map. Alle
  apps op `https://oscardillewaard-ai.github.io` zien dus elkaars caches.
  Getest in Chromium (8 nov 2026, Playwright): een cache die onder `/a/` is
  aangemaakt, is zichtbaar onder `/b/`, en de opruimregel van Tarapp onder
  `/b/` wist hem. Een update van Tarapp wist zo ook de offline-kopie van
  Parkenjacht en de precache van Bergtrainer, en andersom. Prikbord filtert
  daarom op het eigen voorvoegsel. Het doel van regels 4 en 9 (oude versies
  weg, alleen de app-cache wissen) blijft hetzelfde.
- **Status:** akkoord (Oscar, 8 nov 2026).

## A2. De statuspagina van de worker schrijft niet bij elk bezoek naar KV

- **Waar:** `proxy/prikbord-sync-worker.js`, `GET /`.
- **Hoe Parkenjacht het doet:** bij elk bezoek aan de statuspagina een
  `kv.put('health', …)` als controle.
- **Waarom anders:** het gratis plan heeft 1.000 KV-writes per dag, gedeeld
  met Parkenjacht (§6.3). De statuspagina controleert de koppeling daarom met
  een leesactie. Een echte schrijftest gebeurt alleen op `/?schrijftest=1`.
- **Status:** akkoord (Oscar, 8 nov 2026).
