# Nopav.es: verhuizing naar oscardillewaard-ai/nopaves

Voortgangsbestand van de verhuisopdracht. Vanaf stap B staat dit bestand in nopaves als
`docs/VERHUIZING.md`. Begint een sessie met "ga verder": lees dit bestand en ga verder bij de eerste stap
die niet `klaar` is.

## Status

| Stap | Status |
|---|---|
| A Integreren | klaar |
| B Verhuizen | open |
| C Automatiseren | open |
| D Live in nopaves | open |
| E Oude plek doorverwijzen | open |
| F Opruimen | open |
| G Documentatie | open |
| H Graafproef afmaken | niet nodig (graafproef was af) |
| I Plugins en skills | open |

## A. Integreren

Gestart 2026-11-20 07:00 UTC, nadat GRAAF-PROEF.md alle stappen `klaar` toonde.

**De drie lijnen**

| Lijn | Branch | SHA | Merge-base met live |
|---|---|---|---|
| 1 Live (Pages) | `claude/gpx-ultrarace-trainingen-zf6zci` | `7c885b55b65dc6eeac38ae063e4fb4de9a5e8943` | (is live) |
| 2 UX + snelheid | `terugzet/na-snelheid` | `7c885b55b65dc6eeac38ae063e4fb4de9a5e8943` | gelijk aan live |
| 2 idem, sessiebranch | `ccr-c02c1fc3-wix11n` | `92eabe6555f36051bbd6e04ead7737b0ccbb61e2` | `7c885b5` (+1 commit: VOORTGANG "live gezet") |
| 3 Graafproef | `graaf-proef` | `ea114babfded59acb329a68bff08c3e5b2d92209` | `7c885b5` (+4 commits) |

Live staat dus UX fase 1–3 + snelheid stap 0–6 (`7c885b5`). Alle lijnen splitsen af van precies die
commit; er waren geen conflicten.

**Keuzes**
- Integratiebranch is `claude/admiring-ritchie-23anos` (de omgeving staat alleen pushen naar deze
  sessiebranch toe). Merges: `graaf-proef`, daarna `ccr-c02c1fc3-wix11n`.
- "Alleen public/onverhard": de graafproef raakt ook `tools/graaf/`, `tools/onverhard/` (tests),
  `docs/graaf-proef/` en `.github/workflows/graaf.yml`. Die horen uitsluitend bij Nopav.es en gaan mee
  naar nopaves. Er zitten op deze lijnen geen commits van andere projecten.
- Graafcode blijft achter `?graaf=vooraf`: GRAAF-PROEF.md meldt dat beide beslisregels niet gehaald zijn.
- Hill repeat-modus: bestaat (nog) niet, op geen van de drie lijnen (VOORTGANG.md: "op de planning voor
  later"). Er is niets om te behouden; komt als open punt (issue) terug.

**Tests op de integratie**
- `node --test tools/onverhard/test_web_kern.mjs`: 50 van 50 groen.
- `npx oxlint public/onverhard`: schoon.
- Playwright mobiel: groen (inclusief de graafproef-blokken).
- Playwright desktop: eerste run een time-out op "Route hierheen" bij een station-marker
  (`test_web_nopaves.mjs:214`, klik met `force` op een marker die soms onder een andere ligt);
  tweede run groen. Wisselvallige test, geen app-fout: open punt.

**Meting stap 0 (rondje en station, 5× koud en 5× warm, mediaan totaal, seconden)**

| Geval | | Na snelheid (VOORTGANG) | Integratie |
|---|---|---|---|
| rondje-10 Delft Centraal | koud | 11,8 | 10,4 |
| rondje-10 Delft Centraal | warm | 5,3 | 5,4 |
| station-15 Delft Centraal | koud | 26,2 | 23,9 |
| station-15 Delft Centraal | warm | 9,3 | 9,5 |

Niet trager; de warme verschillen (+0,1 en +0,2 s) vallen binnen de ruis van de netwerkbronnen. Let op:
vergeleken met de cijfers in VOORTGANG, niet met een verse meting van live in dezelfde minuut.

**Integratie-SHA**: zie de commit die dit bestand toevoegt (eerstvolgende regel in de geschiedenis van
`claude/admiring-ritchie-23anos`); de code-SHA vóór dit bestand is `ca17ace`.

## Open punten

- Wisselvallige desktoptest bij "Route hierheen" op een station-marker.

## Voor Oscar

(nog niets)
