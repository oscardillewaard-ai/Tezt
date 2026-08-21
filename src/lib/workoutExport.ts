import type { FlankSessionPlan } from './flankPlan'

export interface WorkoutStep {
  name: string
  /** Repeat count for this step, if it's a repeated block. */
  repeat: number
  /** Target elevation gain per repeat, in metres. */
  hmPerRep: number
  /** Expected duration per repeat, in minutes. */
  minutesPerRep: number
  notes: string
}

export interface StructuredWorkout {
  name: string
  steps: WorkoutStep[]
  totalMinutes: number
  totalHmM: number
}

export function buildWorkout(session: FlankSessionPlan, hillName: string): StructuredWorkout {
  const steps: WorkoutStep[] = []
  for (const a of session.allocations) {
    if (a.reps <= 0) continue
    steps.push({
      name: a.flank.name,
      repeat: a.reps,
      hmPerRep: a.flank.hmOneWay,
      minutesPerRep: a.flank.minutesPerRep,
      notes: `${a.flank.climbMode} omhoog, ${a.flank.descendMode} omlaag · ${a.flank.distanceM} m @ ${a.flank.gradientPercent}%`,
    })
  }
  return {
    name: `Bergtraining ${hillName}`,
    steps,
    totalMinutes: session.totalMinutes,
    totalHmM: session.totalHmM,
  }
}

/**
 * Garmin/Amazfit-style structured workout as JSON. Written in a plain,
 * documented shape rather than a vendor's binary format: watch apps and
 * conversion tools can read this, and it stays legible if you just want to
 * copy the steps onto your wrist by hand.
 */
export function workoutToJson(w: StructuredWorkout): string {
  return JSON.stringify(
    {
      name: w.name,
      sport: 'trail_running',
      totalDurationMinutes: Math.round(w.totalMinutes),
      totalAscentMeters: Math.round(w.totalHmM),
      steps: w.steps.map((s) => ({
        type: 'repeat',
        repeatCount: s.repeat,
        step: {
          name: s.name,
          durationType: 'time',
          durationMinutes: s.minutesPerRep,
          targetType: 'ascent',
          targetAscentMeters: s.hmPerRep,
          notes: s.notes,
        },
      })),
    },
    null,
    2,
  )
}

/** Plain-text version for pasting into a watch app's notes or a training log. */
export function workoutToText(w: StructuredWorkout): string {
  const lines = [w.name, '']
  for (const s of w.steps) {
    lines.push(`${s.repeat}× ${s.name} — ${s.hmPerRep} hm, ~${s.minutesPerRep} min per pendel`)
    lines.push(`   ${s.notes}`)
  }
  lines.push('')
  lines.push(`Totaal: ${Math.round(w.totalHmM)} hm, ~${Math.round(w.totalMinutes)} min`)
  return lines.join('\n')
}
