# Drie routes: overdracht voor Claude Code

Bijgewerkt op 2 oktober 2026, versie 2 · voor @Oscar

Dit document geeft Claude Code de context van de piano-oefentool Drie routes: wat Oscar wil, waar de methode op rust, hoe de code werkt en hoe je hem test. Het staat in de map `drie-routes/` en niet in de hoofdmap, omdat de rest van deze repository een ander project is (Bergtrainer). Claude Code leest een `CLAUDE.md` in een submap zodra het bestanden in die map leest ([documentatie](https://docs.claude.com/en/docs/claude-code/memory)).

## Werkwijze voor Claude Code

Oscar wil kritische, onderbouwde feedback die constructief blijft.

- Wees kritisch en evidence-based, maar constructief en positief.
- Geef bij elk bezwaar een alternatief of een vervolgstap.
- Benoem wat sterk is of al goed geregeld, als deel van een eerlijke beoordeling en niet als compliment.
- Maak onderscheid tussen wat je hebt gecontroleerd en wat een aanname is. Weet je iets niet, zeg dat dan, in plaats van het als risico te formuleren.
- Schrijf in het Nederlands.
- Draai na elke wijziging `npm test` in deze map. De tests horen bij de code; pas ze mee aan.

## Doel en uitgangspunten

| Onderwerp | Wat Oscar aangaf |
| --- | --- |
| Niveau | Nooit piano gespeeld |
| Doelen | Alle drie: liedjes met akkoorden, bladmuziek en klassiek, improviseren en eigen muziek |
| Instrument | Digitale piano of keyboard; of er USB-MIDI op zit, is nog niet bekend |
| Apparaten | Browser, zodat het werkt op telefoon, tablet en laptop |
| Oefentijd | Wisselt sterk per dag |
| Wat hij ontwikkelt | Een oefenaanpak voor zichzelf én een tool om mee te oefenen |
| Verder werken | Met Claude Code op zijn telefoon, via cloudsessies met een GitHub-repository |

## Onderzoek: gecontroleerd, niet nagezocht, aannames

Gecontroleerd betekent hier: gezien in zoekresultaten en samenvattingen, niet in de volledige artikelen. PubMed en arXiv waren vanuit de testomgeving niet bereikbaar.

| Bron | Bevinding | Beperking |
| --- | --- | --- |
| [Duke, Simmons en Cash (2009)](https://www.researchgate.net/publication/249808857_It's_Not_How_Much_It's_How_Characteristics_of_Practice_Behavior_and_Retention_of_Performance_Skills), JRME 56, 310–321 | 17 gevorderde pianostudenten oefenden een passage van drie maten uit Sjostakovitsj. Oefentijd en herhalingen voorspelden de prestatie de dag erna niet; de manier van oefenen wel. | Samenhang, geen bewezen oorzaak; één korte passage |
| [Abushanab en Bishara (2013)](https://link.springer.com/article/10.3758/s13421-013-0311-z), Memory & Cognition 41, 928–937 | 25 deelnemers met pianotraining. Vaste volgorde ging eerst sneller; twee dagen later waren de gemengd geoefende melodieën sneller. Zelf verwachtten ze het omgekeerde. | Getrainde spelers; uitkomst is speeltempo |
| [McPherson, Bailey en Sinclair (1997)](https://eric.ed.gov/?id=EJ549911), JRME 45, 103–129 | Padmodel bij 101 middelbare scholieren met een blaasinstrument: improviseren hing het sterkst samen met spelen op gehoor, en van blad spelen ook met spelen op gehoor. | Model op samenhang, één meetmoment; geen volwassen beginners |
| [Hsieh en anderen (CHI 2026)](https://arxiv.org/abs/2603.06253), ook in de [ACM-bibliotheek](https://dl.acm.org/doi/10.1145/3772318.3791437) | VR-piano, 30 deelnemers: een spookhand die vervaagt naarmate je beter speelt gaf betere toonhoogte en vingerzetting dan een vaste spookhand, bij gelijke timing. | Gemeten direct en na 10 minuten, niet na dagen; VR |

Correcties ten opzichte van versie 1:

- McPherson: versie 1 noemde een "driejarige studie" en linkte naar PsychArchives-handle 20.500.12034/2956. Volgens de zoekresultaten hoort die handle bij een ongerelateerd archiefverslag uit 1995 (Popplestone en M. W. McPherson). Het padmodel komt uit het artikel van 1997 hierboven. De pagina zelf kon ik niet openen.
- VR-studie: geen losse preprint maar een CHI 2026-artikel, en de "retentie" is na tien minuten gemeten. De Uitleg in de app zegt dat nu.

Uit versie 1 overgenomen, niet opnieuw nagezocht:

- [Web MIDI](https://caniuse.com/midi) werkt in Chrome, Edge, Firefox en Chrome op Android, niet in Safari en niet op iPhone en iPad.
- Phiano en SitzProbe plannen stukken al met spaced repetition. Mogelijk nieuw is de combinatie van drie routes, afbouwende hulp en een uitgestelde toets.

Niet nagezocht, uit eigen kennis: spreiden werkt robuust maar lijkt kleiner bij complexe motoriek; afwisselen werkt in labstudies sterker dan in de praktijk; voortdurende begeleiding kan afhankelijk maken.

Aannames, als eigen ontwerpkeuzes:

- Dat dit voor een volwassen absolute beginner net zo werkt.
- De intervallen van 2, 4, 7, 14, 30 en 60 dagen, en oefenblokken van 3 tot 4 minuten.
- De toetsmaatstaf, toetsen met één hulpniveau minder, en meer hulp na twee keer achter elkaar mis.
- Toetsen nemen hooguit 60 procent van de sessietijd (nieuw in versie 2).
- De grenzen die de piano gebruikt: hooguit één fout voor gehaald; gestopt is een pauze van meer dan 2 seconden én meer dan 2,5 keer de notenwaarde in het eigen tempo; een octaaf ernaast telt als goed; bij improviseren telt een maat zonder klinkende noot als gestopt.
- De improvisatie-opdrachten, de naspeel-opdrachten en het moment waarop een nieuw liedje wordt voorgesteld.

## De methode

Elk liedje wordt via drie routes geleerd. Elke sessie begint met koude toetsen en gaat verder met afwisselende oefenblokken.

- **Noten**: de melodie lezen van bladmuziek, met de rechterhand.
- **Akkoorden**: melodie rechts, en links de grondtoon van het akkoord vanuit de akkoordsymbolen.
- **Improviseren**: vrij spelen over dezelfde akkoorden, met begeleiding uit de tool. Twee van de acht opdrachten zijn naspelen op gehoor: de app speelt twee maten voor, jij speelt ze na.

Een sessie: Oscar kiest 5, 10, 15, 20, 30 of 45 minuten (met een verbonden piano ook door C, D, E, F, G of A te spelen).

1. Toetsen die aan de beurt zijn, 2 minuten elk, hooguit 60 procent van de tijd. Blijft er tijd over en is er niets te oefenen, dan komen er alsnog toetsen bij.
2. Oefenblokken van 3 minuten (sessies tot 10 minuten) of 4 minuten, in hooguit drie rondes.
3. Onderhoud van onderdelen die al zonder hulp gaan, als er tijd over is.

Volgorde: wat het meest achterloopt eerst (mislukt, nog nooit geoefend, langst geleden), zo veel mogelijk afwisselend van route. Welke route vooraan staat, schuift elke dag op. Versie 1 begon altijd met Noten en zette nooit geoefende onderdelen achteraan; bij sessies van 5 minuten kwam Improviseren daardoor pas op dag 4 aan bod.

Elk oefenblok volgt hetzelfde protocol, afgeleid van Duke en collega's: één keer doorspelen, de lastige maat aanwijzen, alleen die maat langzaam oefenen, dan weer het geheel.

Een toets is gehaald als Oscar van begin tot eind speelt zonder te stoppen of opnieuw te beginnen, met hooguit één verkeerde noot. Bij improviseren: de begeleiding speelt de reeks één keer, Oscar speelt mee zonder te stoppen en eindigt op de grondtoon van het liedje. Met een verbonden piano doet de app een voorstel; Oscar beslist.

| Oefenhulp | Toets met | Gehaald | Niet gehaald |
| --- | --- | --- | --- |
| Veel | Weinig hulp | Oefenhulp wordt weinig; volgende toets morgen | Volgende toets morgen |
| Weinig | Geen hulp | Oefenhulp wordt geen; reeks wordt 1; volgende toets over 2 dagen | Volgende toets morgen |
| Geen | Geen hulp | Reeks +1; volgende toets na 4, 7, 14, 30 en daarna steeds 60 dagen | Reeks naar 0; volgende toets morgen |

Gaat een toets twee keer achter elkaar mis, dan komt er één hulpniveau bij, tot maximaal veel hulp. Een gehaalde toets maakt de lastige maten leeg (met piano: alleen de maten met fouten blijven staan).

| Route | Veel hulp | Weinig hulp | Geen hulp |
| --- | --- | --- | --- |
| Noten | Notennamen, toetsenbord, luisteren; met piano een cursor die meeloopt | Notennamen; met piano de cursor | Alleen de notenbalk |
| Akkoorden | Notennamen, toetsenbord met linkerhand, luisteren, uitleg handpositie | Uitleg handpositie | Alleen de akkoordsymbolen |
| Improviseren | Toetsenbord met veilige noten per akkoord | Lijst met veilige noten | Alleen de akkoorden |

De acht ingebouwde liedjes, in volgorde. Alle melodieën zijn publiek domein; de akkoorden zijn eenvoudige keuzes.

| Liedje | Wat nieuw is | Akkoorden | Maat, toonsoort |
| --- | --- | --- | --- |
| Au clair de la lune | Drie noten, C D E | C, G | 4/4, C |
| Ode an die Freude | Vijf noten, C tot G | C, G | 4/4, C |
| Altijd is Kortjakje ziek | Pink reikt naar A | C, F, G | 4/4, C |
| Vader Jacob | Achtste noten; duim naar de G eronder | C | 4/4, C |
| Jingle Bells (refrein) | Gepunteerde kwart met achtste | C, F, G | 4/4, C |
| Canon van Pachelbel | Halve noten, hand verplaatsen, mineur | C, G, Am, Em, F | 4/4, C |
| Happy Birthday | Driekwartsmaat, lang-kort, octaaf bereik | C, G7, C7, F | 3/4, C |
| Menuet in G (Petzold) | G-groot met F♯, achtsten in 3/4 | G, C, Am, D | 3/4, G |

De tool stelt een nieuw ingebouwd liedje voor zodra alle drie de routes van het laatste op weinig of geen hulp staan. Eigen liedjes (onder Liedjes) krijgen dezelfde routes en planning. De voortgangsmaat is het aandeel toetsen zonder hulp dat Oscar haalt, over de laatste 30 dagen.

## Technische opzet van drie-routes.html

Eén zelfstandig HTML-bestand van ongeveer 2.200 regels, gewoon JavaScript zonder buildstap. Hetzelfde bestand draait als Claude-artifact en als los bestand in de browser.

- **Bladmuziek**: abcjs 6.7.1 (MIT), van cdn.jsdelivr.net met unpkg.com als terugval. Tijdens het laden staat er "Bladmuziek laden…", lukt het niet, dan de noten als tekst.
- **Liedjes**: in `SONG_SRC` als ABC-notatie, standaard `L:1/4` (een kwartnoot is één tel), akkoorden als `"Am"` vóór de noot waar ze beginnen. `parseAbc` leest een deelverzameling: noten met kruizen en mollen (toonsoort plus de regel dat een voorteken de maat uit geldt), octaven, duur, rusten, overbindingen, `>` en `<`, triolen `(3`, herhalingen `|: :|` (uitgeschreven), akkoordsymbolen, tekst en versieringen. Het weigert met een Nederlandse foutmelding: meerdere noten tegelijk, eerste en tweede eind, velden midden in de muziek, meerdere stemmen. Elke maat moet vol zijn; alleen de eerste (opmaat) en laatste mogen korter.
- **Model**: per maat `items` met `kind`, `dur` (in kwartnoten), `midi`, `name`, `chord`, `tie`, `beat`, `bar`, `idx`. `timeline()` geeft de noten en akkoorden met begintijd en duur. `abcFor()` schrijft de ABC opnieuw uit met of zonder notennamen en akkoorden, met dezelfde maatindeling, zodat de abcjs-klassen `abcjs-mm<maat>` en `abcjs-n<index>` op het model passen.
- **Geluid**: Web Audio-synth (driehoek plus sinus). De planner werkt in kwartnoten en plant gebeurtenissen op elk moment, dus ook achtsten en triolen; de beperking uit versie 1 (alleen hele tellen) is weg. Aftellen is één maat; de metronoom geeft de maatstart een accent.
- **Toetsenbord**: zelfgetekende SVG, minstens een octaaf, start op C of F. Zwarte toetsen kunnen gemarkeerd worden; op brede toetsenborden schalen de letters mee.
- **MIDI**: Web MIDI zonder sysex. Verbinden na een tik; daarna automatisch als de toestemming al gegeven is. Een losgelaten toets klinkt door zolang het sustainpedaal (CC 64) ingedrukt is. Meespelen bij oefenen loopt per stap door de melodie (bij Akkoorden: grondtoon links onder de middelste C, plus melodie), telt fouten per maat en zet die bij de lastige maten. Bij een toets neemt de app op en vergelijkt met bewerkingsafstand (`alignSeq`), telt stops (`countStops`) en doet een voorstel (`judgePlay`, `judgeImpro`).
- **Toestand**: zelfde formaat als versie 1 (`v: 1`), dus bestaande voortgang blijft werken; dat is getest. Nieuw: een toets in de history kan `auto: { sug, err, stops }` hebben.

```json
{
  "v": 1, "epoch": "…", "epochAt": 0, "updatedAt": 0,
  "started": ["clair"],
  "items": {
    "clair:noten": { "id": "clair:noten", "song": "clair", "route": "noten",
      "level": 2, "streak": 0, "fails": 0,
      "nextCheck": "2026-10-03", "lastPractice": "2026-10-02", "lastCheck": null,
      "hard": [3], "bpm": 60, "t": 0 }
  },
  "history": [ { "id": "…", "ts": 0, "d": "2026-10-02", "k": "check", "item": "clair:noten", "lvl": 1, "ok": true, "auto": { "sug": true, "err": 0, "stops": 0 } } ]
}
```

Opslag:

- localStorage: `drieroutes.v1` (voortgang), `drieroutes.songs.v1` (eigen liedjes), `drieroutes.device.v1` (alleen dit apparaat: MIDI automatisch verbinden, kaart verborgen).
- In de artifact ook via `window.claude.use('db')` en `use('user')`: `data/users/<uid>/state` en `data/users/<uid>/songs`. Samenvoegen: per onderdeel wint de nieuwste `t`, de history is de vereniging op `id`, een reset wint via een nieuwere `epochAt`. Eigen liedjes: per liedje de nieuwste `t`; verwijderen is een grafsteen `{ deleted: true }`. Een reset wist eigen liedjes niet.
- Opslagfouten (zoals `quota_exceeded`) staan onder Voortgang; de app valt terug op het apparaat.
- Meenemen: Voortgang → Kopieer voortgang of Bewaar als bestand geeft `{ app: 'drie-routes', v: 1, exported, state, songs }`. Samenvoegen gebruikt dezelfde regels als de accountopslag.
- Buiten Claude bestaat `window.claude` niet; dan alleen localStorage.

Artifact: [Drie routes](https://claude.ai/artifact/ULwy5f2NdfqVe9XTosjwHh). Publiceren met capabilities `{ db: {}, user: {}, downloads: true }`. De pagina registreert `window.claude.hot.snapshot` en start via `hot.ready`, zodat een lopende sessie een nieuwe versie overleeft. De vorm van die hot-API is niet gedocumenteerd in de typebestanden; alleen met een nagebootste versie getest.

Met `#test` achter de URL zet de pagina `window.__dr` klaar met de pure functies, voor de tests.

## Testen

```bash
cd drie-routes
npm install
npm test            # alle acht testbestanden, ongeveer twee minuten
node tests/t-midi.mjs   # één bestand
```

De tests draaien in headless Chromium (Playwright 1.56.1, past bij de Chromium die in de Claude Code-cloudomgeving klaarstaat). Ze laden abcjs uit `node_modules`, bootsen de accountopslag en een MIDI-piano na, en zetten de klok vooruit om dagen te simuleren. Schermafbeeldingen komen in `tests/out/` (niet in git).

| Bestand | Wat het controleert |
| --- | --- |
| `t-engine` | Alle liedjes: maten vol, noten en toonhoogtes, abcjs tekent zonder waarschuwing; randgevallen van de ABC-lezer |
| `t-plan` | 10 en 14 gesimuleerde dagen: elke route vroeg aan bod, toetsen hooguit 60 procent, intervallen groeien, hulp komt terug na twee keer mis, lastige maten |
| `t-session` | Stoppen, samenvatting, nog 5 minuten, waarschuwing bij vrij oefenen, extra blok na een mislukte toets, bladmuziek die niet laadt, akkoordkaart |
| `t-midi` | Verbinden, meespelen met fouten per maat, voorstel bij toetsen in alle drie de routes, naspelen, pedaal, geblokkeerd en niet ondersteund, de beoordelingsfuncties los |
| `t-songs` | Eigen liedje toevoegen, fouten, voorbeeld, opslaan, oefenen, bewerken, verwijderen, volledige ABC plakken |
| `t-sync` | Twee apparaten op één account, eigen liedjes, reset, opslagfout, kopiëren en samenvoegen, bestand |
| `t-compat` | Voortgang uit versie 1 (in `tests/fixtures/`) blijft intact, lokaal en via het account; sessie overleeft hot reload |
| `t-layout` | Alle schermen op 360, 390 en 1280 pixels, licht en donker: geen horizontaal scrollen, geen consolefouten |

Niet getest:

- Een echte MIDI-piano. Alleen een nagebootste; timing en apparaatnamen van echte instrumenten kunnen anders zijn.
- Of MIDI in de Claude-app werkt. Volgens de platformdocumentatie weigert de artifactomgeving apparaat-API's; de app vangt dat op met de melding "MIDI is hier geblokkeerd".
- De echte accountopslag en de hot-API van claude.ai; alleen nagebootst volgens de typebestanden.
- Geluid op echte telefoons, het Google-lettertype, Firefox en Safari.

## Volgende stappen en open vragen

- [ ] Een week oefenen en dan onder Voortgang kijken hoeveel toetsen zonder hulp gehaald worden.
- [ ] Opzoeken of de digitale piano een USB-MIDI-aansluiting heeft; zo ja, de losse versie in Chrome of Edge proberen en onder Voortgang kijken hoe vaak Oscar het voorstel van de piano volgt.
- [ ] Hosting buiten Claude kiezen. Voorstel: een eigen repository `drie-routes` met GitHub Pages, met dit bestand als `index.html`. In de Bergtrainer-site meeliften kan ook, maar de service worker van Bergtrainer kan dan pagina's onderscheppen; niet getest.
- [ ] Meer liedjes met linkerhandpatronen (gebroken akkoorden) en in F-groot.

Open vragen:

- Welke telefoon gebruikt Oscar? Op een iPhone werkt MIDI in geen enkele browser, op Android in Chrome wel.
- Welke versie wordt leidend? Voorstel: dit bestand in de repository is de bron, de artifact wordt hieruit gepubliceerd, en de voortgang gaat tussen beide via Voortgang meenemen.
