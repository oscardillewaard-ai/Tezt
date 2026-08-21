import type { LocalPoint } from './hillFromGpx'
import { LUHRS_TRACES } from './luhrsTraces'

export type DirectionMode = 'jog' | 'run' | 'powerhike' | 'hike'

export interface Flank {
  id: string
  /** Where this flank runs, in metres relative to the summit, when GPS data for it exists. */
  trace?: LocalPoint[]
  /** Pendel type label as used on the hill's schema, e.g. "D" or "K". */
  pendelType: string
  name: string
  aspect: string
  /** One-way length in meters (top to foot). */
  distanceM: number
  /** One-way average gradient in percent. */
  gradientPercent: number
  /** Elevation gain climbing this flank one-way, in meters. */
  hmOneWay: number
  climbMode: DirectionMode
  descendMode: DirectionMode
  /** Round-trip (top -> foot -> top) time in minutes. */
  minutesPerRep: number
  /**
   * 'climb' flanks take part in the race-gradient matching and can be
   * repeated any number of times. 'warmup' is for a flank that's only ever
   * walked once per session (e.g. a fixed in/out approach route) and is
   * excluded from the matched allocation.
   */
  role: 'climb' | 'warmup'
}

export interface TrainingHill {
  id: string
  name: string
  location: string
  source: string
  note: string
  flanks: Flank[]
}

export const LUHRS_HEUVEL: TrainingHill = {
  id: 'luhrs',
  name: 'Lührs Heuvel',
  location: 'Uitkijkpunt Lührs, Hoge Bergse Bos',
  source:
    'Gekalibreerd op GPS-log 5 augustus 2026 (63 min, 14 pendels) · top 51,9765 / 4,5485',
  note: 'Pendelheuvel: geen ronde. Elke herhaling is top → voet → top over dezelfde flank; wisselen kan alleen boven. Klim en afdaling zitten 1:1 vast. Reken op ~75 m vlak van/naar de parkeerplaats, buiten de flank zelf.',
  flanks: [
    // Lengte, hoogtewinst en rondtijd komen uit de GPS-log van 5 aug 2026:
    // klim/afdaling-paren automatisch uit het spoor gesegmenteerd en per
    // flanktype gemiddeld. Waar het heuvelschema afwijkt staat dat erbij.
    {
      id: 'D-NW',
      pendelType: 'Lang',
      name: 'Lange flank — NW',
      aspect: 'NW',
      // 3 pendels gemeten: 305/329/304 m, 22,8–25,7 hm. Vrijwel gelijk aan
      // het schema (317 m, 7,7%, 25 hm) — alleen de rondtijd valt sneller uit.
      distanceM: 312,
      gradientPercent: 7.9,
      hmOneWay: 25,
      climbMode: 'jog',
      descendMode: 'run',
      minutesPerRep: 4.6,
      role: 'climb',
    },
    {
      id: 'K-ZO',
      pendelType: 'Middel',
      name: 'Middelsteile flank — ZO',
      aspect: 'ZO',
      // Niet gelopen in de gekalibreerde sessie, dus lengte/helling/hm blijven
      // die van het heuvelschema. Alleen de rondtijd is bijgesteld: op de twee
      // wél gemeten flanken lag het tempo consistent op ~0,8× de schematijd.
      distanceM: 174,
      gradientPercent: 16,
      hmOneWay: 28,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 4.5,
      role: 'climb',
    },
    {
      id: 'K-O',
      pendelType: 'Steil',
      name: 'Steile flank — O',
      aspect: 'O',
      // 10 pendels gemeten: 126–129 m, voet ~-7 m tot top ~26 m. Steiler en
      // meer hoogtewinst dan het schema aangaf (132 m, 21%, 28 hm, 5').
      distanceM: 128,
      gradientPercent: 25.7,
      hmOneWay: 33,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 3.9,
      role: 'climb',
    },
    {
      id: 'ZZW',
      pendelType: 'In/uit',
      name: 'In/uit-flank — ZZW',
      aspect: 'ZZW',
      // Gemeten als inloop (omhoog) en uitloop (omlaag) van de sessie, met het
      // vlakke parkeerplaatsstuk (~75 m) eruit gefilterd: de flank begint waar
      // het terrein gaat stijgen. Het schema's 261–341 m / 9–11% telde dat
      // vlakke stuk mee, waardoor de flank flauwer leek dan hij is.
      distanceM: 264,
      gradientPercent: 13.8,
      hmOneWay: 35,
      climbMode: 'jog',
      descendMode: 'jog',
      minutesPerRep: 4.8,
      role: 'climb',
    },
  ],
}

// Attach the recorded traces so the built-in hill has a map and 3D view
// without the user having to upload anything.
for (const flank of LUHRS_HEUVEL.flanks) {
  flank.trace = LUHRS_TRACES[flank.id]
}

export const BUILTIN_HILLS: TrainingHill[] = [LUHRS_HEUVEL]
