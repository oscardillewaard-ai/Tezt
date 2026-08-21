import type { RouteStats } from './gpx'

/** Elevation gain per kilometre — the "hoe bergachtig is dit" number a route or race can be compared on. */
export function densityHmPerKm(route: Pick<RouteStats, 'gainM' | 'distanceKm'>): number {
  return route.distanceKm > 0 ? route.gainM / route.distanceKm : 0
}

export interface WeekVolume {
  /** What the hill session(s) deliver this week. */
  hillHmM: number
  /** What the whole week should add up to, hill plus everything else. */
  weekGoalHmM: number
  /** Still to be found outside the hill. Never negative. */
  gapHmM: number
  /**
   * Kilometres of long run needed to cover the gap at the chosen route
   * density. This is the schema's point: the gap is closed by picking
   * hillier long-run routes, not by adding more pendels.
   */
  longRunKm: number
  /**
   * The same gap done on a treadmill/stairmaster instead — a way to add
   * climbing when the hill or a long run isn't an option that week.
   */
  gymHmM: number
}

export function computeWeekVolume(
  hillHmM: number,
  weekGoalMultiplier: number,
  densityHmPerKm: number,
): WeekVolume {
  const weekGoalHmM = hillHmM * weekGoalMultiplier
  const gapHmM = Math.max(0, weekGoalHmM - hillHmM)
  return {
    hillHmM,
    weekGoalHmM,
    gapHmM,
    longRunKm: densityHmPerKm > 0 ? gapHmM / densityHmPerKm : 0,
    gymHmM: gapHmM,
  }
}
