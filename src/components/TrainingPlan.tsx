import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import { buildWeeklyPlan, computeSession } from '../lib/plan'

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

  if (berg.gainM <= 0) {
    return (
      <p className="text-sm text-[var(--status-warn)]">
        Deze trainingsberg heeft geen meetbare hoogtewinst. Kies een ander GPX-bestand.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div>
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
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={sessionsPerWeekInput}
                  onChange={(e) => setSessionsPerWeekInput(Math.max(1, Number(e.target.value)))}
                  className="w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
                Startpercentage
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={5}
                  value={startPercentInput}
                  onChange={(e) => setStartPercentInput(Math.max(10, Number(e.target.value)))}
                  className="w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>
            </>
          )}
        </div>

        {weeklyPlan.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Week</th>
                  <th className="py-2 pr-4 font-medium">Doel</th>
                  <th className="py-2 pr-4 font-medium">Herhalingen</th>
                  <th className="py-2 pr-4 font-medium">D+</th>
                  <th className="py-2 pr-4 font-medium">Afstand</th>
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
                    <td className="py-2 pr-4">{w.repsPerSession.join(' + ')}×</td>
                    <td className="py-2 pr-4">{w.totalGainM.toFixed(0)} m</td>
                    <td className="py-2 pr-4">{w.totalDistanceKm.toFixed(1)} km</td>
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
