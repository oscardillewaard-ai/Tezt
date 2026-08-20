import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import type { TrainingHill } from '../lib/hills'
import { buildFlankWeeklyPlan, computeFlankSession, type FlankSessionPlan } from '../lib/flankPlan'

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
      <div>
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
            <input
              type="number"
              min={1}
              max={500}
              value={targetPercent}
              onChange={(e) => setTargetPercent(Math.max(1, Number(e.target.value)))}
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

        <div className="mt-5">
          <SessionBreakdown session={session} />
        </div>
      </div>

      <div>
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
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={5}
                  value={startPercentInput}
                  onChange={(e) => setStartPercentInput(Math.max(10, Number(e.target.value)))}
                  className="w-28 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
                Trainingen per week
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={sessionsPerWeekInput}
                  onChange={(e) => setSessionsPerWeekInput(Math.max(1, Number(e.target.value)))}
                  className="w-28 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
            </>
          )}
        </div>

        {weeklyPlan.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Week</th>
                  <th className="py-2 pr-4 font-medium">Doel</th>
                  {session.allocations.map((a) => (
                    <th key={a.flank.id} className="py-2 pr-4 font-medium">
                      {a.flank.pendelType} ({a.flank.aspect})
                    </th>
                  ))}
                  <th className="py-2 pr-4 font-medium">D+</th>
                  <th className="py-2 pr-4 font-medium">Duur</th>
                </tr>
              </thead>
              <tbody>
                {weeklyPlan.map((w) => (
                  <tr
                    key={w.weekIndex}
                    className={`border-b border-[var(--border-soft)] ${
                      w.isRaceWeek
                        ? 'text-[var(--status-warn)]'
                        : w.isTaper
                          ? 'text-[var(--status-info)]'
                          : 'text-[var(--text-2)]'
                    }`}
                  >
                    <td className="py-2 pr-4">{formatWeekLabel(w.weekStart, w.weekEnd)}</td>
                    <td className="py-2 pr-4">
                      {w.isRaceWeek ? 'Wedstrijdweek' : `${w.targetPercent}% van D+`}
                    </td>
                    {w.splits.map((s) => (
                      <td key={s.flank.id} className="py-2 pr-4">
                        {s.repsPerSession.join('+')}×
                      </td>
                    ))}
                    <td className="py-2 pr-4">{w.session.totalHmM.toFixed(0)} m</td>
                    <td className="py-2 pr-4">{w.session.totalMinutes.toFixed(0)}'</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
