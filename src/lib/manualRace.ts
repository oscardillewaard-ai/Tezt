import type { ClimbSegment, ProfilePoint, RouteStats } from './gpx'

/**
 * One band of terrain in a hand-entered race: "zoveel procent van de
 * hoogtemeters zit in klimmen van ongeveer deze steilte, verdeeld over
 * zoveel klimmen". Steepness is what the flank matching actually keys on,
 * so this is the minimum a manual race has to say beyond its totals.
 */
export interface ManualTerrainBand {
  id: string
  label: string
  gradientPercent: number
  /** Share of the race's D+ (and D-) that sits in this band. Normalized against the other bands. */
  sharePercent: number
  /** How many separate climbs/descents this band's vertical is split into. */
  count: number
}

export interface ManualRaceInput {
  name: string
  distanceKm: number
  gainM: number
  lossM: number
  bands: ManualTerrainBand[]
}

export const DEFAULT_MANUAL_BANDS: ManualTerrainBand[] = [
  { id: 'flauw', label: 'Flauw', gradientPercent: 8, sharePercent: 40, count: 4 },
  { id: 'middel', label: 'Middelsteil', gradientPercent: 15, sharePercent: 40, count: 3 },
  { id: 'steil', label: 'Steil', gradientPercent: 25, sharePercent: 20, count: 2 },
]

export const DEFAULT_MANUAL_RACE: ManualRaceInput = {
  name: 'Eigen wedstrijd',
  distanceKm: 60,
  gainM: 2000,
  lossM: 2000,
  bands: DEFAULT_MANUAL_BANDS,
}

function normalizedShares(bands: ManualTerrainBand[]): number[] {
  const total = bands.reduce((s, b) => s + Math.max(0, b.sharePercent), 0)
  if (total <= 0) return bands.map(() => 1 / Math.max(1, bands.length))
  return bands.map((b) => Math.max(0, b.sharePercent) / total)
}

/** Splits a vertical total over the bands and turns each slice into individual segments. */
function bandSegments(bands: ManualTerrainBand[], totalVerticalM: number): ClimbSegment[] {
  const shares = normalizedShares(bands)
  const segments: ClimbSegment[] = []
  bands.forEach((band, i) => {
    const count = Math.max(1, Math.round(band.count))
    const gradient = Math.max(0.5, band.gradientPercent)
    const gainPerSegment = (totalVerticalM * shares[i]) / count
    if (gainPerSegment <= 0) return
    for (let n = 0; n < count; n++) {
      segments.push({
        startDistanceKm: 0,
        endDistanceKm: 0,
        gainM: gainPerSegment,
        lengthM: (gainPerSegment / gradient) * 100,
        gradientPercent: gradient,
      })
    }
  })
  return segments
}

/** Round-robins two lists so climbs and descents alternate instead of clumping. */
function interleave<T>(a: T[], b: T[]): { leg: T; up: boolean }[] {
  const out: { leg: T; up: boolean }[] = []
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push({ leg: a[i], up: true })
    if (i < b.length) out.push({ leg: b[i], up: false })
  }
  return out
}

/**
 * Builds a race out of typed-in numbers instead of a GPX track. The totals
 * are taken exactly as entered; the profile is a plausible arrangement of
 * the terrain bands that adds up to them, so the chart and the flank
 * matching both have something to work with.
 */
export function buildManualRace(input: ManualRaceInput): RouteStats {
  const distanceKm = Math.max(0.1, input.distanceKm)
  const gainM = Math.max(0, input.gainM)
  const lossM = Math.max(0, input.lossM)

  const climbSegments = bandSegments(input.bands, gainM)
  const descentSegments = bandSegments(input.bands, lossM)

  const legs = interleave(climbSegments, descentSegments)
  const rawLengthM = legs.reduce((s, l) => s + l.leg.lengthM, 0)
  const distanceM = distanceKm * 1000
  // When the bands need more ground than the stated distance, the profile is
  // squeezed to fit rather than running past the end of the race. The
  // segments themselves keep their true gradients — they're what the flank
  // matching reads — and the panel warns about the mismatch.
  const scale = rawLengthM > distanceM && rawLengthM > 0 ? distanceM / rawLengthM : 1
  const flatM = Math.max(0, distanceM - rawLengthM * scale)
  const flatPerGap = legs.length > 0 ? flatM / (legs.length + 1) : flatM

  const profile: ProfilePoint[] = []
  let cursorM = 0
  let ele = 0
  let minEle = 0
  profile.push({ distanceKm: 0, ele: 0 })

  for (const { leg, up } of legs) {
    cursorM += flatPerGap
    profile.push({ distanceKm: cursorM / 1000, ele })
    cursorM += leg.lengthM * scale
    ele += up ? leg.gainM : -leg.gainM
    minEle = Math.min(minEle, ele)
    profile.push({ distanceKm: cursorM / 1000, ele })
  }
  profile.push({ distanceKm: distanceKm, ele })

  const shifted = profile.map((p) => ({ distanceKm: Math.min(p.distanceKm, distanceKm), ele: p.ele - minEle }))

  // Distances on the segments are only used for display, so lay them out
  // along the same profile the chart shows.
  let segCursorM = flatPerGap
  for (const { leg } of legs) {
    leg.startDistanceKm = segCursorM / 1000
    segCursorM += leg.lengthM * scale
    leg.endDistanceKm = segCursorM / 1000
    segCursorM += flatPerGap
  }

  return {
    name: input.name.trim() || 'Eigen wedstrijd',
    distanceKm,
    gainM,
    lossM,
    profile: shifted,
    climbSegments,
    descentSegments,
  }
}

/** Ground the entered bands need at their gradients — compare against the stated distance. */
export function manualTerrainLengthKm(input: ManualRaceInput): number {
  const climbs = bandSegments(input.bands, Math.max(0, input.gainM))
  const descents = bandSegments(input.bands, Math.max(0, input.lossM))
  return [...climbs, ...descents].reduce((s, l) => s + l.lengthM, 0) / 1000
}
