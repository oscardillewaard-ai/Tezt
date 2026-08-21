# Trail race GPX source manifest

Research notes for a possible future "real race library" feature in
Bergtrainer (today `RacePresetPanel`/`syntheticRaces.ts` only ship three
**generic, non-real** indicative profiles — Ardennen/Voerstreek,
Middelgebergte, Alpien — explicitly not real race GPX).

This folder maps 100 famous trail/ultra races to their best GPX-download
source, favouring the organiser's own site, plus 6 "overflow" races
documented for completeness. It exists so that a future feature can point
users at the right source instead of guessing, without yet committing to
redistributing anyone's course file.

## Files

- `races.json` — the full 100-row core table, split into the same four
  distance categories as the source research (`1_short_20k`, `2_50k`,
  `3_100k`, `4_100m_multistage`), plus `overflow` for the 6 additional
  races kept out of the core to preserve its distance-category balance
  (~20 short / ~25 50K / ~30 100K / ~25 100M+multi-stage).

## TL;DR

- UTMB World Series events follow two consistent, machine-friendly URL
  patterns (`[event].utmb.world/race/tracks` or
  `[event].utmb.world/races/[CODE]`); most independent classics either
  host a direct GPX or rely on tracedetrail.fr / Wikiloc.
- The single most reliable bulk/programmatic route is **tracedetrail.fr**
  (stable numeric trace IDs, per-trace GPX, a published point-density
  "quality index"), but its GPX download requires a free account and it's
  a community mirror, not always the official line.
- Organiser-stated distance/D+ and GPX-computed values routinely diverge by
  1–5% (and up to ~500 m of D+) because of track-point density, altimeter
  vs. GPS vs. DEM elevation sources, and each platform's smoothing
  threshold — so a comparable 100-course database must recompute all D+
  from raw GPX with one consistent DEM and smoothing rule.

## Key findings

- **UTMB World Series is the most programmatically tractable.** Every
  event sits on its own subdomain and exposes GPX either at `/race/tracks`
  (older template — mallorca, tenerife, valdaran, istria, kullamannen,
  chianti) or on each distance page under `/races/[CODE]` (montblanc,
  lavaredo, uta, snowdonia, zugspitz, eiger, verbier, julianalps, nice,
  andorra). GPX is free (no login); a MyUTMB account is only needed to
  register. Standard UTMB terms warn courses cross private property with
  seasonal passage limits.
- **tracedetrail.fr is the backbone community source.** It carries
  official ITRA-certified traces for a large share of European and world
  races, with stable IDs (e.g. Sierre-Zinal 25180, Hardrock 224550,
  Transgrancanaria 149184, Diagonale des Fous 308026). Viewing is open;
  downloading the GPX requires a free account. It also displays a track
  "quality index" (points per metre) and lets you pick the elevation
  calculation method (raw vs. DEM).
- **Several marquee US races self-host clean GPX with no login:** Western
  States (wser.org/gps-info), Hardrock (hardrock100.com course page,
  "Download GPX"). Barkley Marathons and Marathon des Sables deliberately
  publish no GPX.
- **A few classics have no confirmed official GPX button** and are best
  served by community mirrors: Comrades (official dynamic map only),
  Transvulcania, Ultra Pirineu, Grand Raid des Pyrénées (emailed),
  Ultra-Trail Harricana, Ultra-Trail Cape Town.
- **Benelux races** (Bear Trail/Grizzly 100, UTHA, Trail des Fantômes) post
  GPX only a few days before the event and route it through community
  platforms (tracedetrail.fr, betrail.run) or the organiser download page.

## Data quality: distance/D+ discrepancies

Organiser-stated figures and GPX-computed figures routinely disagree —
sometimes by a lot. Worked examples:

- **UTMB**: organiser states 174 km / ~9,900 m D+. Community-computed GPX
  values commonly land near 171 km / ~10,000 m. A gap of ~3 km and several
  hundred metres of D+ is typical (the 2026 Chamonix–Les Houches section was
  also reworked after rockfalls, adding year-to-year variation).
- **Transgrancanaria Classic**: marketed ~126–128 km / ~7,000 m; the
  tracedetrail trace (ID 149184) computes 129.1 km / 6,580 m D+ at 1
  point/15 m density. Distance reads long, D+ reads short vs. marketing.
- **UTA100**: branded "100 km"; traces compute 99.4 km / 4,213 m (2021, 1
  pt/10 m) and 98.6 km / 4,328 m (2023, 1 pt/14 m) — a >100 m D+ swing
  between years from track sampling alone on the same physical race.
- **Diagonale des Fous**: organiser figures ranged 160 km/9,500 m (2021),
  165 km/10,000 m (2022), up to ~180 km/10,200 m (2025) — reflecting both
  real re-routes (e.g. post-cyclone Garance in 2025) and measurement changes.

General disclaimer echoed by aggregators such as goandrace: GPX-derived
length can exceed the official race length, typically by 1–2%.

### Technical causes

- **Track-point density/sampling interval.** Denser tracks (1 pt/5–10 m)
  capture more micro-undulation and switchbacks, inflating both distance and
  D+; sparse tracks (1 pt/15–30 m) cut corners and flatten climbs.
  tracedetrail exposes this as a "quality index" (points per metre).
- **Elevation source.** Barometric altimeter (generally most accurate for
  gain, but drifts with weather/pressure), raw GPS altitude (noisy, tends to
  over-count), and DEM-interpolated altitude (smooth, only as good as the
  DEM resolution) each give a different D+ for the same course.
- **Smoothing threshold.** Each platform ignores elevation deltas below a
  minimum before counting them as "gain." Strava, Garmin Connect, Komoot,
  TrainingPeaks and tracedetrail each use different thresholds, so the same
  GPX yields materially different D+ (a documented case: 3,400 ft vs.
  4,190 ft from one identical file, Gaia vs. TrainingPeaks). UTMB itself
  notes that discrepancies in listed distance/elevation don't affect the
  UTMB Index Score, since that index is finish-time statistics, not
  GPX-derived.

### Platforms that expose a density/quality metric

- **tracedetrail.fr** — shows a quality index (points per metre), longest
  ascent/descent, and lets you switch the D+ calculation method (raw vs.
  DEM). Most transparent for auditing.
- **TrailMath** (trailmath.run) — recomputes distance/D+/effort from an
  uploaded GPX, typically within a percent or two of official figures.
- Strava/Garmin/Komoot expose smoothed totals but no raw point-density
  figure.

### Recommended normalisation if this ever backs a real feature

Don't mix organiser-published D+ with GPX-derived D+ in the same field.

1. Ingest the rawest available GPX per race (prefer the organiser file;
   else the highest-density tracedetrail trace).
2. Discard embedded elevation and re-derive altitude from one consistent DEM
   (e.g. a global 30 m DEM such as SRTM/Copernicus, or higher-res where
   available) so every course shares a vertical reference.
3. Apply one fixed smoothing threshold uniformly (a 3–5 m minimum-gain
   filter is common).
4. Store both the normalised value and the organiser-stated value, plus the
   source track's point-density, so downstream users can see the delta.
5. Compute distance as the planar/great-circle sum at a fixed resample
   interval (e.g. one point per 10 m) to neutralise density effects.

Escalation threshold: if normalised D+ diverges from the organiser figure by
more than ~8% on a well-sampled track, re-inspect the DEM resolution for
that region before trusting the number.

## Bulk/programmatic sources

- **UTMB World Series** — predictable subdomains (`[event].utmb.world`)
  with GPX at `/race/tracks` or per-distance `/races/[CODE]` pages;
  scriptable, but no documented public JSON endpoint.
- **tracedetrail.fr** — stable numeric trace IDs, per-trace GPX/GeoJSON
  exports; downloads require an authenticated (free) account, and it's a
  community mirror, not an official source. It advertises a Trail Connect
  app/API surface for professional users.
- **OpenStreetMap / Waymarked Trails / Overpass** — named long-distance
  route relations (GR20, Pennine Way, Camí de Cavalls GR-223, Penguin Cradle
  Trail relation 3110347, etc.) exportable to GPX; ODbL-licensed and
  redistributable, but represent the underlying trail, not the exact race
  line.
- **Hardrock 100** publishes course material on a GitHub Pages repo
  (`hardrock100.github.io`) and a files directory on hardrock100.com —
  unusually open for a major race.
- No single comprehensive open dataset of race GPX exists; community
  aggregators (goandrace.com, betrail.run, Wikiloc, hellodrifter.com,
  trailsplits.com) each hold many, under their own terms.

## Licensing — do not redistribute organiser GPX without checking this

Default assumption: **all rights reserved**. Organiser GPX is typically
published for personal race-prep use, not redistribution.

- Western States marks its material trademark/copyright explicitly
  ("Western States is a registered trademark © Western States Endurance
  Run Foundation").
- Rennsteiglauf-associated hosts state tracks are "for personal use only,
  further distribution not permitted."
- UTMB, Transgrancanaria and others attach passage/private-property
  conditions.

Redistributing these files inside a third-party app (including Bergtrainer,
if this ever becomes a shipped feature) requires permission.

Open-licensed sources safe to redistribute: OpenStreetMap-derived routes
(Waymarked Trails, Overpass exports) under ODbL (attribution + share-alike).
goandrace's images are CC-licensed, but that does not extend to organiser
race tracks.

**Practical guidance for a shippable feature**: prefer (a) OSM/ODbL route
relations with attribution, or (b) explicit written permission / an API
agreement from each organiser (notably UTMB Group). Treat
tracedetrail/Wikiloc/Komoot files as pointers for the user to fetch
themselves, not redistributable assets bundled with the app, unless the
uploader's licence permits it.

## If this gets built into the app

1. Start with the two UTMB URL patterns — they'd cover ~35–40 of the full
   100-row set deterministically and need no login. If a UTMB event has no
   GPX link, fall back to its tracedetrail event page.
2. Use tracedetrail.fr as the secondary resolver for European/independent
   races, keyed by trace ID; record the quality index per file.
3. For US majors, prefer official self-hosted sources first (Western States
   `wser.org/gps-info`, Hardrock `hardrock100.com`) — clean, login-free.
4. Flag deliberate no-GPX races (Barkley, Marathon des Sables) and
   participant-gated races (Dragon's Back, Spine, Legends Trail, MIUT-type
   "Legend" races) so the UI degrades gracefully instead of showing a
   broken link.
5. Never display an organiser-stated and a GPX-computed figure
   interchangeably in the same UI slot — label which is which.
6. Resolve licensing before bundling any GPX with the app itself; default to
   OSM/ODbL geometry with attribution, or a real agreement with UTMB Group.
7. Re-verify any URL marked `verify` in `races.json` by fetching the live
   race page before shipping it — a wrong URL is worse than an empty field.

## Caveats

- Rows marked `verify` (UTCT, Ultra Pirineu, Transvulcania, GRP, Harricana,
  and several UTMB subdomains) follow a confirmed URL pattern but the exact
  per-year GPX page was not individually loaded — treat as high-probability,
  not confirmed.
- Distances/D+ are organiser-marketed figures where available; several are
  explicitly approximate or year-variable (UTMB, Diagonale des Fous, Ultra
  Pirineu, GRP, Cocodona, Moab, Barkley) and will not match a GPX-derived
  value. Hardrock's gain figure differs between clockwise and
  counter-clockwise years (33,441 ft main course page vs. 33,197 ft in the
  2025 CCW manual).
- Dutch/German heathland events (Trail Almere, Amerongse Berg, Sallandse
  Heuvelrug, Ultra Trail Veluwe/Drenthe) often lack a stable official GPX
  page; community betrail.run/tracedetrail traces are the realistic source
  and are marked "not found" for official.
- Two named races needed disambiguation: "Legends Trail (Belgium)" is
  organised by Legends Trails from **Bernardfagne (Ferrières)**, not
  Bouillon — the Bouillon winter trails are the separate Trail Godefroy
  Bouillon / Castle Trail Bouillon (trailrun.be), and there is a further,
  unrelated "Legends Ardennes Trail" near Durbuy. UTS/Eryri by UTMB is held
  in **May**, not July.
- The core table is 100 rows; a handful of user-named races (Comrades,
  Lakeland, Swiss Peaks, Wicklow Round, Art O'Neill) are documented in the
  `overflow` array rather than as core rows to keep the balance across
  distance categories (~20 short / ~25 50K / ~30 100K / ~25 100M+multi-stage).
- Community mirrors (Wikiloc, Komoot, tracedetrail, betrail) frequently gate
  GPX behind a free login, and their traces are user-uploaded — always
  cross-check against the organiser line before relying on one for actual
  race navigation.
- `robots.txt`/automated-blocking status could not be confirmed for most
  domains. Western States and Hardrock are not known to block; UTMB pages
  render GPX links via dynamic JS and may need a headless browser to scrape.
