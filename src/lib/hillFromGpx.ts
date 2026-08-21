import { parseTrack, type TrackPoint } from './gpx'
import type { DirectionMode, Flank, TrainingHill } from './hills'

export interface LocalPoint {
  /** Metres east of the summit. */
  x: number
  /** Metres north of the summit. */
  y: number
  /** Elevation in metres. */
  z: number
}

export interface DerivedFlank extends Flank {
  /** How many repeats of this flank were found in the track. */
  repCount: number
  /** One representative climb trace, in metres relative to the summit — for the map and 3D view. */
  trace: LocalPoint[]
}

export interface DerivedHill extends Omit<TrainingHill, 'flanks'> {
  flanks: DerivedFlank[]
  summit: { lat: number; lon: number; ele: number }
  /** Flat approach walked before the first flank starts rising, in metres. */
  approachM: number
  sessionMinutes: number
}

const EARTH_RADIUS_M = 6371000

function toLocal(p: TrackPoint, summit: { lat: number; lon: number }): { x: number; y: number } {
  const toRad = (d: number) => (d * Math.PI) / 180
  return {
    x: toRad(p.lon - summit.lon) * EARTH_RADIUS_M * Math.cos(toRad(summit.lat)),
    y: toRad(p.lat - summit.lat) * EARTH_RADIUS_M,
  }
}

function distMeters(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

interface Swing {
  a: number
  b: number
  delta: number
}

function swings(ele: number[], thresholdM: number): Swing[] {
  const out: Swing[] = []
  let ext = 0
  let dir: 1 | -1 | 0 = 0
  let run = 0
  for (let i = 1; i < ele.length; i++) {
    if (dir === 0) {
      if (Math.abs(ele[i] - ele[ext]) >= thresholdM) {
        dir = ele[i] > ele[ext] ? 1 : -1
        run = i
      }
      continue
    }
    if (dir === 1) {
      if (ele[i] >= ele[run]) run = i
      else if (ele[run] - ele[i] >= thresholdM) {
        out.push({ a: ext, b: run, delta: ele[run] - ele[ext] })
        ext = run
        dir = -1
        run = i
      }
    } else {
      if (ele[i] <= ele[run]) run = i
      else if (ele[i] - ele[run] >= thresholdM) {
        out.push({ a: ext, b: run, delta: ele[run] - ele[ext] })
        ext = run
        dir = 1
        run = i
      }
    }
  }
  out.push({ a: ext, b: run, delta: ele[run] - ele[ext] })
  return out
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function smoothElevation(points: TrackPoint[], window = 5): number[] {
  return points.map((_, i) => {
    const from = Math.max(0, i - window)
    const to = Math.min(points.length, i + window + 1)
    let sum = 0
    for (let j = from; j < to; j++) sum += points[j].ele
    return sum / (to - from)
  })
}

const COMPASS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW']

/** Compass direction of the flank's foot as seen from the summit, which is how these flanks are named. */
function aspectOf(foot: { x: number; y: number }): string {
  const angle = (Math.atan2(foot.x, foot.y) * 180) / Math.PI // 0 = north, clockwise
  const idx = Math.round(((angle + 360) % 360) / 45) % 8
  return COMPASS[idx]
}

function classifyModes(gradientPercent: number): { climb: DirectionMode; descend: DirectionMode } {
  if (gradientPercent >= 18) return { climb: 'powerhike', descend: 'hike' }
  if (gradientPercent >= 12) return { climb: 'powerhike', descend: 'run' }
  return { climb: 'jog', descend: 'run' }
}

function labelFor(gradientPercent: number): string {
  if (gradientPercent >= 18) return 'Steil'
  if (gradientPercent >= 12) return 'Middel'
  return 'Lang'
}

export interface DeriveOptions {
  /** Elevation reversal that counts as a real turnaround rather than noise. */
  reversalThresholdM?: number
  /** Two climbs belong to the same flank if their feet are within this distance. */
  footClusterRadiusM?: number
  /** A climb smaller than this is ignored as a bump rather than a flank. */
  minGainM?: number
}

/**
 * Derives a multi-flank pendel hill from a GPX of a session actually run on
 * it. Climbs are grouped by where their foot is, not by how steep they are:
 * flanks of a pendel hill share one summit but each has its own foot, so
 * proximity at the bottom separates them cleanly even when two flanks happen
 * to have a similar gradient.
 */
export function deriveHillFromGpx(
  xmlText: string,
  fallbackName: string,
  options: DeriveOptions = {},
): DerivedHill {
  const { reversalThresholdM = 5, footClusterRadiusM = 40, minGainM = 8 } = options
  const { name, points, times } = parseTrack(xmlText, fallbackName)
  const ele = smoothElevation(points)
  const all = swings(ele, reversalThresholdM)
  const rawClimbs = all.filter((s) => s.delta >= minGainM)

  // Trim any flat lead-in: a climb recorded from where the previous descent
  // bottomed out can start with a stretch of level ground (the walk in from
  // a car park, or a flat run-up between flanks). The flank itself starts
  // where the ground actually begins to rise, so move the foot forward to
  // the last point still sitting at the low point of that climb.
  const cumulativeM = points.map((p) => p.distanceKm * 1000)
  const flatGradientPercent = 3
  const lookaheadM = 20
  const climbs = rawClimbs.map((c) => {
    let foot = c.a
    while (foot < c.b) {
      // Look ahead a fixed distance rather than a fixed number of points, so
      // this doesn't depend on sample rate.
      let j = foot
      while (j < c.b && cumulativeM[j] - cumulativeM[foot] < lookaheadM) j++
      const run = cumulativeM[j] - cumulativeM[foot]
      if (run <= 0) break
      if (((ele[j] - ele[foot]) / run) * 100 >= flatGradientPercent) break
      foot = j
    }
    return { ...c, a: foot, delta: ele[c.b] - ele[foot] }
  })
  if (climbs.length === 0) {
    throw new Error(
      'Geen beklimmingen gevonden in dit bestand. Is dit een sessie op een heuvel met herhalingen?',
    )
  }

  // The summit is where the climbs end. Averaging the tops is more robust
  // than taking any single one, since the exact turnaround point up top
  // varies a few metres between reps.
  const summit = {
    lat: climbs.reduce((s, c) => s + points[c.b].lat, 0) / climbs.length,
    lon: climbs.reduce((s, c) => s + points[c.b].lon, 0) / climbs.length,
    ele: climbs.reduce((s, c) => s + ele[c.b], 0) / climbs.length,
  }

  const localPts: LocalPoint[] = points.map((p, i) => ({ ...toLocal(p, summit), z: ele[i] }))

  // Cluster climbs by foot position.
  const clusters: { feet: { x: number; y: number }[]; members: Swing[] }[] = []
  for (const c of climbs) {
    const foot = localPts[c.a]
    const hit = clusters.find(
      (cl) =>
        distMeters(
          {
            x: cl.feet.reduce((s, f) => s + f.x, 0) / cl.feet.length,
            y: cl.feet.reduce((s, f) => s + f.y, 0) / cl.feet.length,
          },
          foot,
        ) <= footClusterRadiusM,
    )
    if (hit) {
      hit.feet.push(foot)
      hit.members.push(c)
    } else {
      clusters.push({ feet: [foot], members: [c] })
    }
  }

  const minutesBetween = (i: number, j: number): number | null => {
    const ti = times[i]
    const tj = times[j]
    if (!ti || !tj) return null
    return (tj.getTime() - ti.getTime()) / 60000
  }

  const flanks: DerivedFlank[] = clusters.map((cluster, idx) => {
    const lens = cluster.members.map((c) => cumulativeM[c.b] - cumulativeM[c.a])
    const gains = cluster.members.map((c) => c.delta)
    const avgLen = median(lens)
    const avgGain = median(gains)
    const gradient = avgLen > 0 ? (avgGain / avgLen) * 100 : 0

    // Round-trip time: climb plus the descent that immediately follows it,
    // averaged over the reps that have one. A flank climbed once at the very
    // end of a session has no following descent, so fall back to doubling
    // the climb time.
    const roundTrips: number[] = []
    for (const c of cluster.members) {
      const next = all[all.indexOf(c) + 1]
      const upM = minutesBetween(c.a, c.b)
      if (upM === null) continue
      if (next && next.delta < 0) {
        const downM = minutesBetween(next.a, next.b)
        if (downM !== null) {
          roundTrips.push(upM + downM)
          continue
        }
      }
      roundTrips.push(upM * 1.7)
    }
    // Median, not mean: a session usually contains one rep where you stopped
    // to drink or talk, and a single such outlier drags a mean well past any
    // pace you actually hold.
    const minutesPerRep = roundTrips.length > 0 ? Math.round(median(roundTrips) * 10) / 10 : 0

    const footAvg = {
      x: cluster.feet.reduce((s, f) => s + f.x, 0) / cluster.feet.length,
      y: cluster.feet.reduce((s, f) => s + f.y, 0) / cluster.feet.length,
    }
    const aspect = aspectOf(footAvg)
    const modes = classifyModes(gradient)
    // Use the longest rep as the representative trace: it covers the most of
    // the flank, so the drawn line reaches furthest down towards the foot.
    const longest = cluster.members[lens.indexOf(Math.max(...lens))]

    return {
      id: `${aspect}-${idx}`,
      pendelType: labelFor(gradient),
      name: `${labelFor(gradient) === 'Lang' ? 'Lange' : labelFor(gradient) === 'Middel' ? 'Middelsteile' : 'Steile'} flank — ${aspect}`,
      aspect,
      distanceM: Math.round(avgLen),
      gradientPercent: Math.round(gradient * 10) / 10,
      hmOneWay: Math.round(avgGain),
      climbMode: modes.climb,
      descendMode: modes.descend,
      minutesPerRep,
      role: 'climb',
      repCount: cluster.members.length,
      trace: localPts.slice(longest.a, longest.b + 1),
    }
  })

  flanks.sort((a, b) => b.repCount - a.repCount)

  // Flat lead-in before the first climb actually starts rising.
  const approachM = Math.max(0, cumulativeM[climbs[0].a] - cumulativeM[rawClimbs[0].a])

  const sessionMinutes = minutesBetween(0, points.length - 1) ?? 0

  return {
    id: `derived-${Date.now()}`,
    name,
    location: `${summit.lat.toFixed(4)} / ${summit.lon.toFixed(4)}`,
    source: `Afgeleid uit GPX${sessionMinutes ? ` (${Math.round(sessionMinutes)} min` : ''}${
      sessionMinutes ? `, ${climbs.length} beklimmingen)` : ''
    }`,
    note: `Automatisch afgeleid uit een sessie op deze heuvel: ${flanks.length} flank(en) herkend aan de hand van waar de beklimmingen beginnen.${
      approachM > 20 ? ` De eerste ~${Math.round(approachM)} m is vlak en telt niet als flank mee.` : ''
    }`,
    flanks,
    summit,
    approachM,
    sessionMinutes,
  }
}
