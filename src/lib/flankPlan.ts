import type { ClimbSegment, RouteStats } from './gpx'
import type { Flank, TrainingHill } from './hills'
import { computeWeeklyTargets, DEFAULT_PLAN_SETTINGS, type PlanSettings, type WeekTarget } from './plan'

export interface FlankAllocation {
  flank: Flank
  /** Share (0..1) of the race's total climbing gain matched to this flank's gradient. */
  shareOfClimb: number
  reps: number
  hmM: number
  minutes: number
}

export interface FlankSessionPlan {
  targetPercent: number
  targetHmM: number
  allocations: FlankAllocation[]
  warmup: FlankAllocation | null
  totalHmM: number
  totalMinutes: number
  percentOfRace: number
}

/**
 * For each race climb AND descent, finds the flank whose one-way gradient is
 * closest and credits that flank with the segment's vertical magnitude. Both
 * directions count: a pendel flank is climbed and descended over the same
 * ground, so a steep race descent needs just as much of a match as a steep
 * race climb — matching only climbs would ignore how the way down actually
 * rides. The resulting shares describe how much of the race's vertical (up
 * and down combined) is "gentle" vs "steep" so the session mirrors that mix.
 */
export function matchClimbShares(
  climbSegments: ClimbSegment[],
  descentSegments: ClimbSegment[],
  climbFlanks: Flank[],
): Map<string, number> {
  const totals = new Map<string, number>(climbFlanks.map((f) => [f.id, 0]))
  let totalVertical = 0

  for (const seg of [...climbSegments, ...descentSegments]) {
    let best = climbFlanks[0]
    let bestDiff = Infinity
    for (const f of climbFlanks) {
      const diff = Math.abs(f.gradientPercent - seg.gradientPercent)
      if (diff < bestDiff) {
        bestDiff = diff
        best = f
      }
    }
    if (!best) continue
    totals.set(best.id, (totals.get(best.id) ?? 0) + seg.gainM)
    totalVertical += seg.gainM
  }

  const shares = new Map<string, number>()
  for (const f of climbFlanks) {
    shares.set(
      f.id,
      totalVertical > 0
        ? (totals.get(f.id) ?? 0) / totalVertical
        : 1 / Math.max(1, climbFlanks.length),
    )
  }
  return shares
}

export function computeFlankSession(
  race: RouteStats,
  hill: TrainingHill,
  targetPercent: number,
): FlankSessionPlan {
  const climbFlanks = hill.flanks.filter((f) => f.role === 'climb')
  const warmupFlank = hill.flanks.find((f) => f.role === 'warmup') ?? null

  const shares = matchClimbShares(race.climbSegments, race.descentSegments, climbFlanks)
  const targetHmM = (race.gainM * targetPercent) / 100

  const allocations: FlankAllocation[] = climbFlanks.map((flank) => {
    const shareOfClimb = shares.get(flank.id) ?? 0
    const hmTarget = targetHmM * shareOfClimb
    const reps = flank.hmOneWay > 0 ? Math.round(hmTarget / flank.hmOneWay) : 0
    return {
      flank,
      shareOfClimb,
      reps,
      hmM: reps * flank.hmOneWay,
      minutes: reps * flank.minutesPerRep,
    }
  })

  const warmup: FlankAllocation | null = warmupFlank
    ? {
        flank: warmupFlank,
        shareOfClimb: 0,
        reps: 1,
        hmM: warmupFlank.hmOneWay,
        minutes: warmupFlank.minutesPerRep,
      }
    : null

  const totalHmM = allocations.reduce((s, a) => s + a.hmM, 0) + (warmup?.hmM ?? 0)
  const totalMinutes = allocations.reduce((s, a) => s + a.minutes, 0) + (warmup?.minutes ?? 0)

  return {
    targetPercent,
    targetHmM,
    allocations,
    warmup,
    totalHmM,
    totalMinutes,
    percentOfRace: race.gainM > 0 ? (totalHmM / race.gainM) * 100 : 0,
  }
}

export interface FlankSessionSplit {
  flank: Flank
  repsPerSession: number[]
}

export interface FlankWeekPlan extends WeekTarget {
  /** Week totals — reps here are the full week's, not one session's. */
  session: FlankSessionPlan
  sessionsPerWeek: number
  splits: FlankSessionSplit[]
  warmupSplit: FlankSessionSplit | null
}

/** Distributes a weekly rep count evenly across sessions, remainder going to the first ones. */
function splitReps(total: number, sessions: number): number[] {
  const perSession = new Array(sessions).fill(Math.floor(total / sessions))
  let remainder = total - perSession.reduce((a, b) => a + b, 0)
  for (let i = 0; i < perSession.length && remainder > 0; i++, remainder--) {
    perSession[i] += 1
  }
  return perSession
}

export function buildFlankWeeklyPlan(
  race: RouteStats,
  hill: TrainingHill,
  raceDate: Date,
  today: Date,
  sessionsPerWeek = 1,
  settings: PlanSettings = DEFAULT_PLAN_SETTINGS,
): FlankWeekPlan[] {
  const weeks = computeWeeklyTargets(raceDate, today, settings)
  return weeks.map((w) => {
    const session = computeFlankSession(race, hill, w.targetPercent)
    const splits = session.allocations.map((a) => ({
      flank: a.flank,
      repsPerSession: splitReps(a.reps, sessionsPerWeek),
    }))
    const warmupSplit = session.warmup
      ? { flank: session.warmup.flank, repsPerSession: splitReps(session.warmup.reps, sessionsPerWeek) }
      : null
    return { ...w, session, sessionsPerWeek, splits, warmupSplit }
  })
}
