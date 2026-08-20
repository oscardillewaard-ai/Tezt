import { segmentClimbs, segmentDescents, type ProfilePoint, type RouteStats } from './gpx'

export interface RaceArchetype {
  id: string
  name: string
  location: string
  note: string
  distanceKm: number
  gainM: number
  /**
   * Range of leg gradients, in percent. Drawn with a bias toward the low end
   * (rand()^2) so most legs are gentle rollers with occasional punchier
   * pitches — realistic, and it lets gradMax reach well past what the
   * average-gradient-vs-distance math alone would allow. With that bias,
   * E[grad] = gradMin + (gradMax - gradMin) / 3, which must come out close
   * to 200 * gainM / (distanceKm * 1000) or the final rescale step (needed
   * to hit gainM exactly) will have to compress the whole range to fit —
   * flattening out the steep end and defeating the point of a range.
   */
  gradientRangePercent: [number, number]
  /** Range of leg horizontal lengths, in meters. */
  legLengthRangeM: [number, number]
}

export const ARDENNEN_RACE: RaceArchetype = {
  id: 'ardennen-generiek',
  name: 'Ardennen / Voerstreek (generiek)',
  location: 'België — Voerstreek, Ardennen',
  note: 'Indicatief profiel voor het glooiende Belgische heuvellandschap waar veel trailraces gehouden worden (o.a. Voerstreek, Ardennen): overwegend korte tot middellange hellingen, zelden echt lang of extreem steil.',
  distanceKm: 60,
  gainM: 2200,
  gradientRangePercent: [3, 16],
  legLengthRangeM: [100, 500],
}

export const MIDDELGEBERGTE_RACE: RaceArchetype = {
  id: 'middelgebergte-generiek',
  name: 'Middelgebergte (generiek)',
  location: 'bv. Eifel, Vogezen, hoger Ardennen-reliëf',
  note: 'Indicatief profiel voor middelgebergte: langere en iets zwaardere hellingen dan een puur heuvelparcours, maar nog geen alpien terrein.',
  distanceKm: 70,
  gainM: 3800,
  gradientRangePercent: [4, 24],
  legLengthRangeM: [150, 700],
}

export const ALPIEN_RACE: RaceArchetype = {
  id: 'alpien-generiek',
  name: 'Alpien (generiek)',
  location: "bv. Alpen, Pyreneeën — hooggebergte-ultra's",
  note: "Indicatief profiel voor lange, aanhoudende alpiene beklimmingen zoals bij hooggebergte-ultra's. Duidelijk langer en steiler dan een Belgisch heuvelparcours.",
  distanceKm: 100,
  gainM: 6000,
  gradientRangePercent: [5, 26],
  legLengthRangeM: [300, 1200],
}

export const BUILTIN_RACE_ARCHETYPES: RaceArchetype[] = [
  ARDENNEN_RACE,
  MIDDELGEBERGTE_RACE,
  ALPIEN_RACE,
]

function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic seed derived from the archetype id, so the same preset
// always generates the same profile instead of a fresh one on every load.
function seedFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return hash
}

function generateRawProfile(a: RaceArchetype): ProfilePoint[] {
  const rand = mulberry32(seedFromId(a.id))
  const [gradMin, gradMax] = a.gradientRangePercent
  const [lenMin, lenMax] = a.legLengthRangeM
  const targetDistM = a.distanceKm * 1000

  const points: ProfilePoint[] = [{ distanceKm: 0, ele: 800 }]
  let cumDistM = 0
  let cumEle = 800

  while (cumDistM < targetDistM) {
    for (const sign of [1, -1]) {
      const legLen = lenMin + rand() * (lenMax - lenMin)
      const grad = gradMin + rand() ** 2 * (gradMax - gradMin)
      cumDistM += legLen
      cumEle += sign * legLen * (grad / 100)
      points.push({ distanceKm: cumDistM / 1000, ele: cumEle })
    }
  }

  return points
}

/** Rescales elevation deltas (keeping distances fixed) so total climbing hits the archetype's target D+ precisely. */
function rescaleToTargetGain(points: ProfilePoint[], targetGainM: number): ProfilePoint[] {
  let generatedGain = 0
  for (let i = 1; i < points.length; i++) {
    const delta = points[i].ele - points[i - 1].ele
    if (delta > 0) generatedGain += delta
  }
  const scale = generatedGain > 0 ? targetGainM / generatedGain : 1

  const scaled: ProfilePoint[] = [points[0]]
  let ele = points[0].ele
  for (let i = 1; i < points.length; i++) {
    const delta = (points[i].ele - points[i - 1].ele) * scale
    ele += delta
    scaled.push({ distanceKm: points[i].distanceKm, ele })
  }
  return scaled
}

const profileCache = new Map<string, RouteStats>()

export function generateSyntheticRace(a: RaceArchetype): RouteStats {
  const cached = profileCache.get(a.id)
  if (cached) return cached

  const points = rescaleToTargetGain(generateRawProfile(a), a.gainM)
  const climbSegments = segmentClimbs(points, 8)
  const descentSegments = segmentDescents(points, 8)
  const gainM = climbSegments.reduce((s, c) => s + c.gainM, 0)
  const lossM = descentSegments.reduce((s, c) => s + c.gainM, 0)
  const distanceKm = points[points.length - 1].distanceKm

  const result: RouteStats = {
    name: a.name,
    distanceKm,
    gainM,
    lossM,
    profile: points,
    climbSegments,
    descentSegments,
  }
  profileCache.set(a.id, result)
  return result
}
