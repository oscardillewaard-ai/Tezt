import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import type { TrainingHill } from '../lib/hills'
import { buildFlankWeeklyPlan, computeFlankSession, type FlankSessionPlan } from '../lib/flankPlan'
import {
  buildIcsCalendar,
  downloadTextFile,
  sessionDate,
  weekdayName,
  weekdaysForSessionsPerWeek,
  type ScheduleEntry,
} from '../lib/schedule'
import { PrintChecklist } from './PrintChecklist'
import { NumberField } from './NumberField'
import { WeekdayPicker } from './WeekdayPicker'
import { WeekAgendaRow, type DayCell } from './WeekAgenda'
import { WeeklyVolumePanel, type VolumeWeekRow } from './WeeklyVolumePanel'
import { checkDescentBudget, densityHmPerKm } from '../lib/weeklyVolume'
import { SessionReviewPanel } from './SessionReviewPanel'
import { buildWorkout, workoutToJson, workoutToText } from '../lib/workoutExport'

interface FlankTrainingPlanProps {
  race: RouteStats
  hill: TrainingHill
  advanced: boolean
}

function formatWeekLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

function SessionBreakdown({ session }: { session: FlankSessionPlan }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-[var(--muted)]">
            <th className="py-2 pr-4 font-medium">Flank</th>
            <th className="py-2 pr-4 font-medium">Aandeel wedstrijdterrein</th>
            <th className="py-2 pr-4 font-medium">Herhalingen</th>
            <th className="py-2 pr-4 font-medium">HM</th>
            <th className="py-2 pr-4 font-medium">Tijd</th>
          </tr>
        </thead>
        <tbody>
          {session.allocations.map((a) => (
            <tr key={a.flank.id} className="border-b border-[var(--border-soft)] text-[var(--text-2)]">
              <td className="py-2 pr-4">{a.flank.name}</td>
              <td className="py-2 pr-4">{(a.shareOfClimb * 100).toFixed(0)}%</td>
              <td className="py-2 pr-4">{a.reps}×</td>
              <td className="py-2 pr-4">{a.hmM.toFixed(0)} m</td>
              <td className="py-2 pr-4">{a.minutes.toFixed(0)}'</td>
            </tr>
          ))}
          {session.warmup && (
            <tr className="text-[var(--muted)]">
              <td className="py-2 pr-4">{session.warmup.flank.name}</td>
              <td className="py-2 pr-4">—</td>
              <td className="py-2 pr-4">{session.warmup.reps}×</td>
              <td className="py-2 pr-4">{session.warmup.hmM.toFixed(0)} m</td>
              <td className="py-2 pr-4">{session.warmup.minutes.toFixed(0)}'</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const DEFAULT_START_PERCENT = 40
const DEFAULT_SESSIONS_PER_WEEK = 1

export function FlankTrainingPlan({ race, hill, advanced }: FlankTrainingPlanProps) {
  const [targetPercent, setTargetPercent] = useState(100)
  const [raceDate, setRaceDate] = useState('')
  const [startPercentInput, setStartPercentInput] = useState(DEFAULT_START_PERCENT)
  const [sessionsPerWeekInput, setSessionsPerWeekInput] = useState(DEFAULT_SESSIONS_PER_WEEK)
  const [weekGoalMultiplier, setWeekGoalMultiplier] = useState(2.5)
  const raceDensity = densityHmPerKm(race)
  const [longRunDensity, setLongRunDensity] = useState(Math.round(raceDensity) || 26)
  const [descentLimit, setDescentLimit] = useState(225)
  const startPercent = advanced ? startPercentInput : DEFAULT_START_PERCENT
  const sessionsPerWeek = advanced ? sessionsPerWeekInput : DEFAULT_SESSIONS_PER_WEEK

  const session = useMemo(
    () => computeFlankSession(race, hill, targetPercent),
    [race, hill, targetPercent],
  )

  const weeklyPlan = useMemo(() => {
    if (!raceDate) return []
    const parsed = new Date(raceDate)
    if (Number.isNaN(parsed.getTime())) return []
    return buildFlankWeeklyPlan(race, hill, parsed, new Date(), sessionsPerWeek, 110, startPercent)
  }, [race, hill, raceDate, sessionsPerWeek, startPercent])

  const [customWeekdays, setCustomWeekdays] = useState<number[] | null>(null)
  // A custom day selection only applies while it still matches how many
  // sessions the week has; otherwise fall back to the evenly-spread default.
  // Deriving this beats resetting it in an effect, which would render one
  // frame with a stale mismatched selection first.
  const weekdays =
    customWeekdays && customWeekdays.length === sessionsPerWeek
      ? customWeekdays
      : weekdaysForSessionsPerWeek(sessionsPerWeek)

  function sessionParts(w: (typeof weeklyPlan)[number], i: number): string[] {
    const parts = w.splits
      .filter((s) => s.repsPerSession[i] > 0)
      .map((s) => `${s.flank.name} ${s.repsPerSession[i]}×`)
    if (w.warmupSplit && w.warmupSplit.repsPerSession[i] > 0) {
      parts.push(`${w.warmupSplit.flank.name} ${w.warmupSplit.repsPerSession[i]}×`)
    }
    return parts
  }

  const scheduleEntries: ScheduleEntry[] = useMemo(
    () =>
      weeklyPlan.flatMap((w) =>
        Array.from({ length: sessionsPerWeek }, (_, i) => {
          const parts = sessionParts(w, i)
          if (parts.length === 0) return null
          return {
            date: sessionDate(w.weekStart, weekdays[i] ?? weekdays[0]),
            title: `Bergtraining: ${parts.join(', ')}`,
            description: `Weekdoel: ${w.isRaceWeek ? 'wedstrijdweek' : `${w.targetPercent}% van D+`}. Deze sessie: ${parts.join(', ')}. Hele week: ${w.session.totalHmM.toFixed(0)} m D+, ${w.session.totalMinutes.toFixed(0)} min.`,
          }
        }).filter((e): e is ScheduleEntry => e !== null),
      ),
    [weeklyPlan, weekdays, sessionsPerWeek],
  )

  const printWeeks = weeklyPlan.map((w) => ({
    label: formatWeekLabel(w.weekStart, w.weekEnd),
    goal: w.isRaceWeek ? 'Wedstrijdweek' : `${w.targetPercent}% van D+`,
    sessions: Array.from({ length: sessionsPerWeek }, (_, i) => {
      const parts = sessionParts(w, i)
      const day = weekdayName(weekdays[i] ?? weekdays[0])
      return parts.length > 0 ? `${day}: ${parts.join(', ')}` : `${day}: rust`
    }),
  }))

  const weeklyAgenda = weeklyPlan.map((w) => {
    const days: DayCell[] = Array.from({ length: 7 }, (_, i) => {
      const iso = i + 1
      const sessionIdx = weekdays.indexOf(iso)
      if (sessionIdx === -1) {
        return { iso, label: '', detail: 'Rustdag', isTrainingDay: false }
      }
      const parts = sessionParts(w, sessionIdx)
      const totalReps = parts.reduce((sum, p) => {
        const match = p.match(/(\d+)×$/)
        return sum + (match ? Number(match[1]) : 0)
      }, 0)
      return {
        iso,
        label: totalReps > 0 ? `${totalReps}×` : '–',
        detail: parts.length > 0 ? parts.join(', ') : 'Geen herhalingen deze sessie',
        isTrainingDay: true,
      }
    })
    return {
      weekIndex: w.weekIndex,
      weekLabel: formatWeekLabel(w.weekStart, w.weekEnd),
      goalLabel: w.isRaceWeek ? 'Wedstrijdweek' : `${w.targetPercent}% van D+`,
      emphasisClass: w.isRaceWeek
        ? 'text-[var(--status-warn)]'
        : w.isTaper
          ? 'text-[var(--status-info)]'
          : 'text-[var(--text-2)]',
      days,
    }
  })

  const volumeWeeks: VolumeWeekRow[] = weeklyPlan.map((w) => ({
    key: w.weekIndex,
    label: formatWeekLabel(w.weekStart, w.weekEnd),
    hillHmM: w.session.totalHmM,
    emphasisClass: w.isRaceWeek
      ? 'text-[var(--status-warn)]'
      : w.isTaper
        ? 'text-[var(--status-info)]'
        : 'text-[var(--text-2)]',
  }))

  const budget = checkDescentBudget(
    session.runningDescentHmM,
    session.steepDescentHmM,
    descentLimit,
  )

  if (race.climbSegments.length === 0 && race.descentSegments.length === 0) {
    return (
      <p className="text-sm text-[var(--status-warn)]">
        Er zijn geen losse klimmen of afdalingen te herkennen in deze wedstrijd-GPX, dus kan de mix
        niet over de flanken verdeeld worden.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div className="no-print">
        <h3 className="text-base font-semibold text-[var(--text)]">Eén training</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Elke klim én afdaling uit de wedstrijd-GPX is gematcht op de flank met de
          dichtstbijzijnde helling — een pendel ga je op én af over dezelfde flank, dus een steile
          afdaling in de wedstrijd telt net zo zwaar mee als een steile klim. De herhalingen per
          flank volgen die verdeling.
        </p>

        <div className="mt-4 flex items-center gap-3">
          <input
            type="range"
            min={20}
            max={150}
            step={1}
            value={targetPercent}
            onChange={(e) => setTargetPercent(Number(e.target.value))}
            className="min-w-0 flex-1 accent-emerald-400"
          />
          <div className="flex shrink-0 items-center gap-1">
            <NumberField
              min={1}
              max={500}
              value={targetPercent}
              onChange={setTargetPercent}
              className="w-16 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 text-right text-sm text-[var(--text)]"
            />
            <span className="text-sm text-[var(--muted)]">%</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Totale D+</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.totalHmM.toFixed(0)} m
            </p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">% van wedstrijd</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.percentOfRace.toFixed(0)}%
            </p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Duur</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.totalMinutes.toFixed(0)}'
            </p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Rennend / stijl af</p>
            <p className="mt-1 text-lg font-semibold text-[var(--text)]">
              {session.runningDescentHmM.toFixed(0)} / {session.steepDescentHmM.toFixed(0)} m
            </p>
          </div>
        </div>

        {budget.overBudget && (
          <p className="mt-4 rounded-lg border border-[var(--status-warn)]/40 bg-[var(--badge-bg)] px-4 py-3 text-sm text-[var(--status-warn)]">
            Deze sessie kost je {budget.totalHmM.toFixed(0)} m afdaling, boven je grens van{' '}
            {budget.limitHmM} m. Op een pendelheuvel kun je die afdaling niet weglaten — verlaag het
            percentage, of verschuif hoogtemeters naar de gym (zie weekvolume hieronder).
          </p>
        )}

        {advanced && (
          <label className="mt-4 flex w-fit flex-col gap-1 text-sm text-[var(--text-3)]">
            Max. afdaling per sessie (m)
            <NumberField
              min={50}
              max={2000}
              step={25}
              value={descentLimit}
              onChange={setDescentLimit}
              className="w-32 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
            />
          </label>
        )}

        <div className="mt-5">
          <SessionBreakdown session={session} />
        </div>
      </div>

      <div>
      <div className="no-print">
        <h3 className="text-base font-semibold text-[var(--text)]">Opbouwschema naar wedstrijddag</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Vul de datum van je wedstrijd in voor een wekelijks schema dat opbouwt naar een piek en
          daarna afbouwt (taper), met dezelfde flankverdeling als hierboven.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
            Wedstrijddatum
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
            />
          </label>
          {advanced && (
            <>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
                Startpercentage
                <NumberField
                  min={10}
                  max={100}
                  step={5}
                  value={startPercentInput}
                  onChange={setStartPercentInput}
                  className="w-28 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
                Trainingen per week
                <NumberField
                  min={1}
                  max={7}
                  value={sessionsPerWeekInput}
                  onChange={setSessionsPerWeekInput}
                  className="w-28 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
            </>
          )}
        </div>

        {advanced && sessionsPerWeek > 1 && (
          <div className="mt-4">
            <WeekdayPicker selected={weekdays} count={sessionsPerWeek} onChange={setCustomWeekdays} />
          </div>
        )}

        {weeklyAgenda.length > 0 && (
          <div className="mt-5">
            {weeklyAgenda.map((w) => (
              <WeekAgendaRow key={w.weekIndex} {...w} />
            ))}
          </div>
        )}

        {volumeWeeks.length > 0 && (
          <div className="mt-8">
            <WeeklyVolumePanel
              weeks={volumeWeeks}
              raceDensityHmPerKm={raceDensity}
              weekGoalMultiplier={weekGoalMultiplier}
              onWeekGoalMultiplierChange={setWeekGoalMultiplier}
              longRunDensity={longRunDensity}
              onLongRunDensityChange={setLongRunDensity}
            />
          </div>
        )}

        {scheduleEntries.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  'bergtrainer-schema.ics',
                  buildIcsCalendar(scheduleEntries, 'Bergtrainer schema'),
                  'text/calendar',
                )
              }
              className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
            >
              Toevoegen aan agenda (.ics)
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
            >
              Printen als A4-checklist
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  'bergtraining.json',
                  workoutToJson(buildWorkout(session, hill.name)),
                  'application/json',
                )
              }
              className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
            >
              Training naar horloge (.json)
            </button>
            <button
              type="button"
              onClick={() =>
                downloadTextFile(
                  'bergtraining.txt',
                  workoutToText(buildWorkout(session, hill.name)),
                  'text/plain',
                )
              }
              className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
            >
              Als tekst (.txt)
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--faint)]">
          Sessies gepland op {weekdays.map(weekdayName).join(', ')}.
        </p>
      </div>

      <div className="mt-8">
        <SessionReviewPanel plannedHmM={session.totalHmM} />
      </div>

      <PrintChecklist
        title="Bergtrainer — trainingsschema"
        subtitle={`${hill.name} · ${sessionsPerWeek}× per week op ${weekdays.map(weekdayName).join(', ')}`}
        weeks={printWeeks}
      />
      </div>
    </div>
  )
}
