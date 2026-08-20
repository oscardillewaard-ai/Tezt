import type { RouteStats } from './gpx'

export interface SessionPlan {
  targetPercent: number
  reps: number
  totalDistanceKm: number
  totalGainM: number
  percentOfRace: number
}

export function computeSession(
  race: RouteStats,
  berg: RouteStats,
  targetPercent: number,
): SessionPlan {
  const targetGainM = (race.gainM * targetPercent) / 100
  const reps = berg.gainM > 0 ? Math.max(1, Math.ceil(targetGainM / berg.gainM)) : 0
  const totalDistanceKm = reps * berg.distanceKm
  const totalGainM = reps * berg.gainM
  const percentOfRace = race.gainM > 0 ? (totalGainM / race.gainM) * 100 : 0
  return { targetPercent, reps, totalDistanceKm, totalGainM, percentOfRace }
}

export interface WeekTarget {
  weekIndex: number
  weekStart: Date
  weekEnd: Date
  targetPercent: number
  isTaper: boolean
  isRaceWeek: boolean
}

export interface WeekPlan extends WeekTarget {
  repsPerSession: number[]
  sessionsPerWeek: number
  totalReps: number
  totalDistanceKm: number
  totalGainM: number
  percentOfRace: number
}

function startOfWeek(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay() === 0 ? 7 : date.getDay() // Monday = 1 .. Sunday = 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (day - 1))
  return date
}

/**
 * Shared progressive-load curve: ramps from a light starting percentage of
 * the race's elevation gain up to a peak that slightly overreaches it, then
 * tapers down in the final week(s) before race day. Used by both the plain
 * reps-based weekly plan and the flank-based weekly plan so they ramp the
 * same way.
 */
export function computeWeeklyTargets(
  raceDate: Date,
  today: Date,
  peakPercent = 110,
  startPercent = 40,
  taperPercent = 30,
): WeekTarget[] {
  const firstWeekStart = startOfWeek(today)
  const raceWeekStart = startOfWeek(raceDate)
  const msPerWeek = 7 * 24 * 60 * 60 * 1000
  const weeksTotal =
    Math.max(0, Math.round((raceWeekStart.getTime() - firstWeekStart.getTime()) / msPerWeek)) + 1

  if (weeksTotal <= 0) return []

  const taperWeeks = weeksTotal >= 5 ? 2 : weeksTotal >= 3 ? 1 : 0
  const buildWeeks = weeksTotal - taperWeeks
  const peakWeekIndex = Math.max(0, buildWeeks - 1)

  const weeks: WeekTarget[] = []
  for (let i = 0; i < weeksTotal; i++) {
    let targetPercent: number
    const isRaceWeek = i === weeksTotal - 1
    const isTaper = i >= buildWeeks

    if (isRaceWeek) {
      targetPercent = taperWeeks > 0 ? taperPercent : startPercent
    } else if (isTaper) {
      // Linearly step down from peak to taperPercent across the taper weeks.
      const stepsRemaining = weeksTotal - 1 - i // weeks left including race week counted above
      const taperSpan = taperWeeks
      const progress = taperSpan > 0 ? 1 - stepsRemaining / (taperSpan + 1) : 1
      targetPercent = peakPercent - (peakPercent - taperPercent) * Math.min(1, Math.max(0, progress))
    } else if (buildWeeks <= 1) {
      targetPercent = peakPercent
    } else {
      const progress = i / peakWeekIndex
      targetPercent = startPercent + (peakPercent - startPercent) * progress
    }

    targetPercent = Math.round(targetPercent)

    const weekStart = new Date(firstWeekStart.getTime() + i * msPerWeek)
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)

    weeks.push({ weekIndex: i, weekStart, weekEnd, targetPercent, isTaper, isRaceWeek })
  }

  return weeks
}

export function buildWeeklyPlan(
  race: RouteStats,
  berg: RouteStats,
  raceDate: Date,
  today: Date,
  sessionsPerWeek: number,
  peakPercent = 110,
  startPercent = 40,
  taperPercent = 30,
): WeekPlan[] {
  const weeks = computeWeeklyTargets(raceDate, today, peakPercent, startPercent, taperPercent)

  return weeks.map((w) => {
    const targetGainM = (race.gainM * w.targetPercent) / 100
    const totalReps =
      berg.gainM > 0 ? Math.max(sessionsPerWeek, Math.ceil(targetGainM / berg.gainM)) : 0

    const repsPerSession: number[] = new Array(sessionsPerWeek).fill(
      Math.floor(totalReps / sessionsPerWeek),
    )
    let remainder = totalReps - repsPerSession.reduce((a, b) => a + b, 0)
    for (let s = 0; s < repsPerSession.length && remainder > 0; s++, remainder--) {
      repsPerSession[s] += 1
    }

    const actualTotalReps = repsPerSession.reduce((a, b) => a + b, 0)

    return {
      ...w,
      repsPerSession,
      sessionsPerWeek,
      totalReps: actualTotalReps,
      totalDistanceKm: actualTotalReps * berg.distanceKm,
      totalGainM: actualTotalReps * berg.gainM,
      percentOfRace: race.gainM > 0 ? ((actualTotalReps * berg.gainM) / race.gainM) * 100 : 0,
    }
  })
}
