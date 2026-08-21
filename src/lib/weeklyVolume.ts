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
   * The same gap done on a treadmill/stairmaster instead. On a pendel hill
   * every climbed metre must also be descended, so the gym is the only way
   * to add climbing without paying the descent cost — useful once the
   * week's descent budget is spent.
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

/**
 * Descent load a pendel session forces on you, and whether it exceeds what
 * you're willing to absorb. On this hill climb and descent are locked 1:1,
 * so the descent is not a choice — the only lever is which flank you use.
 */
export interface DescentBudget {
  runningHmM: number
  steepHmM: number
  totalHmM: number
  limitHmM: number
  overBudget: boolean
}

export function checkDescentBudget(
  runningHmM: number,
  steepHmM: number,
  limitHmM: number,
): DescentBudget {
  const totalHmM = runningHmM + steepHmM
  return {
    runningHmM,
    steepHmM,
    totalHmM,
    limitHmM,
    overBudget: totalHmM > limitHmM,
  }
}
