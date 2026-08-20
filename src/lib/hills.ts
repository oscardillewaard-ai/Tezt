export type DirectionMode = 'jog' | 'run' | 'powerhike' | 'hike'

export interface Flank {
  id: string
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
  source: 'Heuvelschema, GPS-log 29 juli 2026 · top 51,9765 / 4,5485',
  note: 'Pendelheuvel: geen ronde. Elke herhaling is top → voet → top over dezelfde flank; wisselen kan alleen boven. Klim en afdaling zitten 1:1 vast.',
  flanks: [
    {
      id: 'D-NW',
      pendelType: 'D',
      name: 'D-pendel — NW-flank',
      aspect: 'NW',
      distanceM: 317,
      gradientPercent: 7.7,
      hmOneWay: 25,
      climbMode: 'jog',
      descendMode: 'run',
      minutesPerRep: 5.5,
      role: 'climb',
    },
    {
      id: 'K-ZO',
      pendelType: 'K−',
      name: 'K−-pendel — ZO-flank',
      aspect: 'ZO',
      distanceM: 174,
      gradientPercent: 16,
      hmOneWay: 28,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 5.5,
      role: 'climb',
    },
    {
      id: 'K-O',
      pendelType: 'K',
      name: 'K-pendel — O-flank',
      aspect: 'O',
      distanceM: 132,
      gradientPercent: 21,
      hmOneWay: 28,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 5,
      role: 'climb',
    },
    {
      id: 'ZZW',
      pendelType: 'in/uit',
      name: 'in/uit-pendel — ZZW-flank',
      aspect: 'ZZW',
      distanceM: 301,
      gradientPercent: 10,
      hmOneWay: 30,
      climbMode: 'jog',
      descendMode: 'jog',
      minutesPerRep: 15,
      role: 'climb',
    },
  ],
}

export const BUILTIN_HILLS: TrainingHill[] = [LUHRS_HEUVEL]
