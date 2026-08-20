import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import { buildWeeklyPlan, computeSession } from '../lib/plan'
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

interface TrainingPlanProps {
  race: RouteStats
  berg: RouteStats
  advanced: boolean
}

function formatWeekLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

const DEFAULT_START_PERCENT = 40
const DEFAULT_SESSIONS_PER_WEEK = 1

export function TrainingPlan({ race, berg, advanced }: TrainingPlanProps) {
  const [targetPercent, setTargetPercent] = useState(100)
  const [sessionsPerWeekInput, setSessionsPerWeekInput] = useState(DEFAULT_SESSIONS_PER_WEEK)
  const [startPercentInput, setStartPercentInput] = useState(DEFAULT_START_PERCENT)
  const [raceDate, setRaceDate] = useState('')
  const sessionsPerWeek = advanced ? sessionsPerWeekInput : DEFAULT_SESSIONS_PER_WEEK
  const startPercent = advanced ? startPercentInput : DEFAULT_START_PERCENT

  const session = useMemo(
    () => computeSession(race, berg, targetPercent),
    [race, berg, targetPercent],
  )

  const weeklyPlan = useMemo(() => {
    if (!raceDate) return []
    const parsed = new Date(raceDate)
    if (Number.isNaN(parsed.getTime())) return []
    return buildWeeklyPlan(race, berg, parsed, new Date(), sessionsPerWeek, 110, startPercent)
  }, [race, berg, raceDate, sessionsPerWeek, startPercent])

  const [customWeekdays, setCustomWeekdays] = useState<number[] | null>(null)
  // A custom day selection only applies while it still matches how many
  // sessions the week has; otherwise fall back to the evenly-spread default.
  // Deriving this beats resetting it in an effect, which would render one
  // frame with a stale mismatched selection first.
  const weekdays =
    customWeekdays && customWeekdays.length === sessionsPerWeek
      ? customWeekdays
      : weekdaysForSessionsPerWeek(sessionsPerWeek)

  const scheduleEntries: ScheduleEntry[] = useMemo(
    () =>
      weeklyPlan.flatMap((w) =>
        w.repsPerSession.map((reps, i) => ({
          date: sessionDate(w.weekStart, weekdays[i] ?? weekdays[0]),
          title: `Bergtraining: ${reps}× herhaling`,
          description: `Weekdoel: ${w.isRaceWeek ? 'wedstrijdweek' : `${w.targetPercent}% van D+`}. Deze sessie: ${reps}× (${(reps * berg.distanceKm).toFixed(1)} km, ${(reps * berg.gainM).toFixed(0)} m D+). Hele week: ${w.repsPerSession.join(' + ')}×, ${w.totalGainM.toFixed(0)} m D+.`,
        })),
      ),
    [weeklyPlan, weekdays, berg.distanceKm, berg.gainM],
  )

  const printWeeks = weeklyPlan.map((w) => ({
    label: formatWeekLabel(w.weekStart, w.weekEnd),
    goal: w.isRaceWeek ? 'Wedstrijdweek' : `${w.targetPercent}% van D+`,
    sessions: w.repsPerSession.map(
      (reps, i) => `${weekdayName(weekdays[i] ?? weekdays[0])}: ${reps}× herhaling`,
    ),
  }))

  const weeklyAgenda = weeklyPlan.map((w) => {
    const days: DayCell[] = Array.from({ length: 7 }, (_, i) => {
      const iso = i + 1
      const sessionIdx = weekdays.indexOf(iso)
      if (sessionIdx === -1) {
        return { iso, label: '', detail: 'Rustdag', isTrainingDay: false }
      }
      const reps = w.repsPerSession[sessionIdx] ?? 0
      return {
        iso,
        label: `${reps}×`,
        detail: `${reps} herhaling(en) — ${(reps * berg.distanceKm).toFixed(1)} km, ${(reps * berg.gainM).toFixed(0)} m D+`,
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

  if (berg.gainM <= 0) {
    return (
      <p className="text-sm text-[var(--status-warn)]">
        Deze trainingsberg heeft geen meetbare hoogtewinst. Kies een ander GPX-bestand.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div className="no-print">
        <h3 className="text-base font-semibold text-[var(--text)]">Eén training</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Hoeveel keer moet je de berg op om (een deel van) de hoogtemeters van de wedstrijd na te
          bootsen?
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
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Herhalingen</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--accent-emerald-text)]">{session.reps}×</p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Totale D+</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.totalGainM.toFixed(0)} m
            </p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Afstand</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.totalDistanceKm.toFixed(1)} km
            </p>
          </div>
          <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-[var(--muted)]">% van wedstrijd</p>
            <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
              {session.percentOfRace.toFixed(0)}%
            </p>
          </div>
        </div>
      </div>

      <div>
      <div className="no-print">
        <h3 className="text-base font-semibold text-[var(--text)]">Opbouwschema naar wedstrijddag</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Vul de datum van je wedstrijd in voor een wekelijks schema dat opbouwt naar een piek en
          daarna afbouwt (taper).
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
                Trainingen per week
                <NumberField
                  min={1}
                  max={7}
                  value={sessionsPerWeekInput}
                  onChange={setSessionsPerWeekInput}
                  className="w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
                Startpercentage
                <NumberField
                  min={10}
                  max={100}
                  step={5}
                  value={startPercentInput}
                  onChange={setStartPercentInput}
                  className="w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
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
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--faint)]">
          Sessies gepland op {weekdays.map(weekdayName).join(', ')}.
        </p>
      </div>

      <PrintChecklist
        title="Bergtrainer — trainingsschema"
        subtitle={`${berg.name} · ${sessionsPerWeek}× per week op ${weekdays.map(weekdayName).join(', ')}`}
        weeks={printWeeks}
      />
      </div>
    </div>
  )
}
