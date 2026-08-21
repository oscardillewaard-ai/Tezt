import { parseGpx, type RouteStats } from './gpx'

export interface SessionReview {
  actual: RouteStats
  targetHmM: number
  achievedHmM: number
  percentOfTarget: number
  differenceHmM: number
  verdict: 'gehaald' | 'net niet' | 'onder doel' | 'ruim over'
  actualMinutes: number | null
}

/**
 * Compares a session you actually ran against what the plan asked for.
 * Deliberately judged on elevation gain rather than distance or time: on a
 * pendel hill the climbing is the point, and reps get cut short or added
 * depending on how the legs feel.
 */
export function reviewSession(
  gpxText: string,
  fallbackName: string,
  targetHmM: number,
): SessionReview {
  const actual = parseGpx(gpxText, fallbackName)
  const achievedHmM = actual.gainM
  const percentOfTarget = targetHmM > 0 ? (achievedHmM / targetHmM) * 100 : 0
  const verdict: SessionReview['verdict'] =
    percentOfTarget >= 115
      ? 'ruim over'
      : percentOfTarget >= 95
        ? 'gehaald'
        : percentOfTarget >= 85
          ? 'net niet'
          : 'onder doel'
  return {
    actual,
    targetHmM,
    achievedHmM,
    percentOfTarget,
    differenceHmM: achievedHmM - targetHmM,
    verdict,
    actualMinutes: null,
  }
}
