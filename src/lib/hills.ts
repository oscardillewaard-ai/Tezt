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
  /**
   * 'measured' hills come from a real GPS survey of one specific spot (exact
   * distances/gradients). 'generic' hills are indicative archetypes for a
   * type of terrain — useful as a stand-in when you don't have your own
   * pendelheuvel with GPS data, but the numbers are round/typical, not a
   * measurement of one real place.
   */
  kind: 'measured' | 'generic'
  flanks: Flank[]
}

export const LUHRS_HEUVEL: TrainingHill = {
  id: 'luhrs',
  name: 'Lührs Heuvel',
  location: 'Uitkijkpunt Lührs, Hoge Bergse Bos',
  source: 'Heuvelschema, GPS-log 29 juli 2026 · top 51,9765 / 4,5485',
  note: 'Pendelheuvel: geen ronde. Elke herhaling is top → voet → top over dezelfde flank; wisselen kan alleen boven. Klim en afdaling zitten 1:1 vast.',
  kind: 'measured',
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

/**
 * Generic regional archetypes: indicative flank profiles for a type of
 * terrain, not a GPS survey of one real hill. Useful if you don't have your
 * own pendelheuvel but want to build a session around gradients typical of
 * where you're racing.
 */
export const ARDENNEN_GENERIEK: TrainingHill = {
  id: 'ardennen-generiek',
  name: 'Ardennen / Voerstreek (generiek)',
  location: 'België — Voerstreek, Ardennen',
  source: 'Generiek profiel, geen GPS-meting van één specifieke plek',
  note: 'Indicatief profiel voor het glooiende Belgische heuvellandschap waar veel trailraces gehouden worden (o.a. Voerstreek, Ardennen): overwegend korte tot middellange hellingen, zelden echt lang of extreem steil.',
  kind: 'generic',
  flanks: [
    {
      id: 'ard-zacht',
      pendelType: 'Zacht',
      name: 'Zachte flank',
      aspect: '—',
      distanceM: 280,
      gradientPercent: 6,
      hmOneWay: 17,
      climbMode: 'jog',
      descendMode: 'jog',
      minutesPerRep: 4,
      role: 'climb',
    },
    {
      id: 'ard-midden',
      pendelType: 'Midden',
      name: 'Middelsteile flank',
      aspect: '—',
      distanceM: 220,
      gradientPercent: 11,
      hmOneWay: 24,
      climbMode: 'jog',
      descendMode: 'run',
      minutesPerRep: 4.5,
      role: 'climb',
    },
    {
      id: 'ard-steil',
      pendelType: 'Steil',
      name: 'Steile flank',
      aspect: '—',
      distanceM: 160,
      gradientPercent: 17,
      hmOneWay: 27,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 5,
      role: 'climb',
    },
  ],
}

export const MIDDELGEBERGTE_GENERIEK: TrainingHill = {
  id: 'middelgebergte-generiek',
  name: 'Middelgebergte (generiek)',
  location: 'bv. Eifel, Vogezen, hoger Ardennen-reliëf',
  source: 'Generiek profiel, geen GPS-meting van één specifieke plek',
  note: 'Indicatief profiel voor middelgebergte: langere en iets zwaardere hellingen dan een puur heuvelparcours, maar nog geen alpien terrein.',
  kind: 'generic',
  flanks: [
    {
      id: 'mg-zacht',
      pendelType: 'Zacht',
      name: 'Zachte flank',
      aspect: '—',
      distanceM: 450,
      gradientPercent: 7,
      hmOneWay: 32,
      climbMode: 'jog',
      descendMode: 'jog',
      minutesPerRep: 6,
      role: 'climb',
    },
    {
      id: 'mg-midden',
      pendelType: 'Midden',
      name: 'Middelsteile flank',
      aspect: '—',
      distanceM: 320,
      gradientPercent: 13,
      hmOneWay: 42,
      climbMode: 'jog',
      descendMode: 'run',
      minutesPerRep: 6.5,
      role: 'climb',
    },
    {
      id: 'mg-steil',
      pendelType: 'Steil',
      name: 'Steile flank',
      aspect: '—',
      distanceM: 220,
      gradientPercent: 19,
      hmOneWay: 42,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 7,
      role: 'climb',
    },
  ],
}

export const ALPIEN_GENERIEK: TrainingHill = {
  id: 'alpien-generiek',
  name: 'Alpien (generiek)',
  location: 'bv. Alpen, Pyreneeën — hooggebergte-ultra\'s',
  source: 'Generiek profiel, geen GPS-meting van één specifieke plek',
  note: 'Indicatief profiel voor lange, aanhoudende alpiene beklimmingen zoals bij hooggebergte-ultra\'s. Duidelijk langer en steiler dan een Belgisch heuvelparcours — gebruik dit als je richting een alpine race traint maar zelf geen berg met dat karakter kunt beklimmen.',
  kind: 'generic',
  flanks: [
    {
      id: 'alp-zacht',
      pendelType: 'Zacht',
      name: 'Zachte flank',
      aspect: '—',
      distanceM: 700,
      gradientPercent: 9,
      hmOneWay: 63,
      climbMode: 'jog',
      descendMode: 'jog',
      minutesPerRep: 9,
      role: 'climb',
    },
    {
      id: 'alp-midden',
      pendelType: 'Midden',
      name: 'Middelsteile flank',
      aspect: '—',
      distanceM: 500,
      gradientPercent: 16,
      hmOneWay: 80,
      climbMode: 'powerhike',
      descendMode: 'run',
      minutesPerRep: 10,
      role: 'climb',
    },
    {
      id: 'alp-steil',
      pendelType: 'Steil',
      name: 'Steile flank',
      aspect: '—',
      distanceM: 350,
      gradientPercent: 24,
      hmOneWay: 84,
      climbMode: 'powerhike',
      descendMode: 'hike',
      minutesPerRep: 11,
      role: 'climb',
    },
  ],
}

export const BUILTIN_HILLS: TrainingHill[] = [
  LUHRS_HEUVEL,
  ARDENNEN_GENERIEK,
  MIDDELGEBERGTE_GENERIEK,
  ALPIEN_GENERIEK,
]
