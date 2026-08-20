import { segmentClimbs, segmentDescents, type ProfilePoint, type RouteStats } from './gpx'

export interface RaceArchetype {
  id: string
  name: string
  location: string
  note: string
  defaultDistanceKm: number
  minDistanceKm: number
  maxDistanceKm: number
  /** Elevation gain per km at this archetype's characteristic steepness (m/km) — used to scale D+ when the user picks a different distance. */
  gainPerKm: number
  /** Range of MAJOR climb/descent leg lengths — the big mountains/valleys, not the small texture on top of them. */
  macroLegLengthRangeM: [number, number]
  /**
   * Range of major-leg gradients, in percent. Drawn with a low bias
   * (rand()^2), so E[grad] = min + (max - min) / 3 — tuned per archetype so
   * that average comes out close to gainPerKm / 10 without needing a heavy
   * rescale afterward (a heavy rescale flattens the steep end, which is
   * what made the first version of this generator look like uniform noise
   * instead of real mountains).
   */
  macroGradientRangePercent: [number, number]
  /** Micro-roller step length within a major leg, in meters. */
  microStepM: number
  /** Micro-roller amplitude per step, in meters — the small jaggedness riding on top of the big climbs/descents. */
  microAmplitudeM: number
}

export const ARDENNEN_RACE: RaceArchetype = {
  id: 'ardennen-generiek',
  name: 'Ardennen / Voerstreek (generiek)',
  location: 'België — Voerstreek, Ardennen',
  note: 'Indicatief profiel voor het glooiende Belgische heuvellandschap waar veel trailraces gehouden worden (o.a. Voerstreek, Ardennen): een reeks korte tot middellange cols en dalen, zelden echt lang of extreem steil.',
  defaultDistanceKm: 60,
  minDistanceKm: 15,
  maxDistanceKm: 100,
  gainPerKm: 37,
  macroLegLengthRangeM: [3000, 8000],
  macroGradientRangePercent: [1, 9],
  microStepM: 150,
  microAmplitudeM: 6,
}

export const MIDDELGEBERGTE_RACE: RaceArchetype = {
  id: 'middelgebergte-generiek',
  name: 'Middelgebergte (generiek)',
  location: 'bv. Eifel, Vogezen, hoger Ardennen-reliëf',
  note: 'Indicatief profiel voor middelgebergte: langere, iets zwaardere cols dan een puur heuvelparcours, maar nog geen alpien terrein.',
  defaultDistanceKm: 70,
  minDistanceKm: 20,
  maxDistanceKm: 120,
  gainPerKm: 54,
  macroLegLengthRangeM: [5000, 10000],
  macroGradientRangePercent: [2, 12],
  microStepM: 200,
  microAmplitudeM: 8,
}

export const ALPIEN_RACE: RaceArchetype = {
  id: 'alpien-generiek',
  name: 'Alpien (generiek)',
  location: "bv. Alpen, Pyreneeën — hooggebergte-ultra's",
  note: "Indicatief profiel voor lange, aanhoudende alpiene beklimmingen zoals bij hooggebergte-ultra's: enkele grote cols in plaats van veel korte heuvels.",
  defaultDistanceKm: 100,
  minDistanceKm: 30,
  maxDistanceKm: 170,
  gainPerKm: 60,
  macroLegLengthRangeM: [8000, 18000],
  macroGradientRangePercent: [2, 14],
  microStepM: 300,
  microAmplitudeM: 10,
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

// Deterministic seed derived from the archetype id (+ distance), so the same
// selection always regenerates the same profile instead of a fresh one on
// every render.
function seedFromId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return hash
}

interface MacroLeg {
  startDistanceKm: number
  endDistanceKm: number
  startEle: number
  endEle: number
}

function generateMacroLegs(a: RaceArchetype, distanceKm: number, rand: () => number): MacroLeg[] {
  const [lenMin, lenMax] = a.macroLegLengthRangeM
  const [gradMin, gradMax] = a.macroGradientRangePercent
  const targetDistM = distanceKm * 1000
  const targetGainM = distanceKm * a.gainPerKm

  const legs: MacroLeg[] = []
  let cumDistM = 0
  let cumEle = 800
  let rawGain = 0

  // Each iteration is one "mountain": a climb immediately paired with a
  // descent of nearly the same size (small random asymmetry), so elevation
  // oscillates around the baseline instead of independently-drawn climb and
  // descent legs randomly walking the whole profile deep below sea level.
  while (cumDistM < targetDistM) {
    const climbLen = Math.min(lenMin + rand() * (lenMax - lenMin), targetDistM - cumDistM)
    const climbGrad = gradMin + rand() ** 2 * (gradMax - gradMin)
    const climbGain = climbLen * (climbGrad / 100)

    const startEle = cumEle
    cumDistM += climbLen
    cumEle += climbGain
    rawGain += climbGain
    legs.push({
      startDistanceKm: (cumDistM - climbLen) / 1000,
      endDistanceKm: cumDistM / 1000,
      startEle,
      endEle: cumEle,
    })

    if (cumDistM >= targetDistM) break

    const descLen = Math.min(lenMin + rand() * (lenMax - lenMin), targetDistM - cumDistM)
    const asymmetry = 0.85 + rand() * 0.3 // 0.85..1.15, so descents nearly cancel their climb
    const descLoss = climbGain * asymmetry

    const descStartEle = cumEle
    cumDistM += descLen
    cumEle -= descLoss
    legs.push({
      startDistanceKm: (cumDistM - descLen) / 1000,
      endDistanceKm: cumDistM / 1000,
      startEle: descStartEle,
      endEle: cumEle,
    })
  }

  // Rescale each leg's vertical delta (not its length) so total climbing
  // hits the target exactly. Because macroGradientRangePercent is pre-tuned
  // to the archetype's gainPerKm, this factor stays close to 1 and doesn't
  // flatten the shape the way scaling an untuned range would.
  const scale = rawGain > 0 ? targetGainM / rawGain : 1
  let ele = 800
  return legs.map((leg) => {
    const delta = (leg.endEle - leg.startEle) * scale
    const startEle = ele
    ele += delta
    return { ...leg, startEle, endEle: ele }
  })
}

/** Zero-sum perturbations (a discrete Brownian bridge) so adding them never changes the leg's total elevation change. */
function microBridge(n: number, amplitude: number, rand: () => number): number[] {
  if (n <= 1) return new Array(Math.max(n, 0)).fill(0)
  const raw = Array.from({ length: n }, () => (rand() - 0.5) * 2 * amplitude)
  const mean = raw.reduce((s, v) => s + v, 0) / n
  return raw.map((v) => v - mean)
}

function generateRawProfile(a: RaceArchetype, distanceKm: number): ProfilePoint[] {
  const rand = mulberry32(seedFromId(`${a.id}:${distanceKm}`))
  const macroLegs = generateMacroLegs(a, distanceKm, rand)

  const points: ProfilePoint[] = [{ distanceKm: 0, ele: macroLegs[0]?.startEle ?? 800 }]

  for (const leg of macroLegs) {
    const legLenM = (leg.endDistanceKm - leg.startDistanceKm) * 1000
    const steps = Math.max(1, Math.round(legLenM / a.microStepM))
    const trendPerStep = (leg.endEle - leg.startEle) / steps
    const noise = microBridge(steps, a.microAmplitudeM, rand)

    let ele = leg.startEle
    for (let i = 0; i < steps; i++) {
      ele += trendPerStep + noise[i]
      const distanceKmAt = leg.startDistanceKm + ((i + 1) / steps) * (leg.endDistanceKm - leg.startDistanceKm)
      points.push({ distanceKm: distanceKmAt, ele })
    }
    // Snap the exact leg endpoint (the bridge's rounding can leave a tiny residual).
    points[points.length - 1] = { distanceKm: leg.endDistanceKm, ele: leg.endEle }
  }

  return points
}

const profileCache = new Map<string, RouteStats>()

export function generateSyntheticRace(a: RaceArchetype, distanceKm?: number): RouteStats {
  const targetDistanceKm = distanceKm ?? a.defaultDistanceKm
  const cacheKey = `${a.id}:${targetDistanceKm}`
  const cached = profileCache.get(cacheKey)
  if (cached) return cached

  const points = generateRawProfile(a, targetDistanceKm)
  const climbSegments = segmentClimbs(points, 8)
  const descentSegments = segmentDescents(points, 8)
  const gainM = climbSegments.reduce((s, c) => s + c.gainM, 0)
  const lossM = descentSegments.reduce((s, c) => s + c.gainM, 0)
  const finalDistanceKm = points[points.length - 1].distanceKm

  const result: RouteStats = {
    name: a.name,
    distanceKm: finalDistanceKm,
    gainM,
    lossM,
    profile: points,
    climbSegments,
    descentSegments,
  }
  profileCache.set(cacheKey, result)
  return result
}
