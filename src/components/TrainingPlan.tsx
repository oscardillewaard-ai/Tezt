import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import { buildWeeklyPlan, computeSession } from '../lib/plan'

interface TrainingPlanProps {
  race: RouteStats
  berg: RouteStats
}

function formatWeekLabel(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
  return `${fmt(start)} – ${fmt(end)}`
}

export function TrainingPlan({ race, berg }: TrainingPlanProps) {
  const [targetPercent, setTargetPercent] = useState(100)
  const [sessionsPerWeek, setSessionsPerWeek] = useState(1)
  const [raceDate, setRaceDate] = useState('')

  const session = useMemo(
    () => computeSession(race, berg, targetPercent),
    [race, berg, targetPercent],
  )

  const weeklyPlan = useMemo(() => {
    if (!raceDate) return []
    const parsed = new Date(raceDate)
    if (Number.isNaN(parsed.getTime())) return []
    return buildWeeklyPlan(race, berg, parsed, new Date(), sessionsPerWeek)
  }, [race, berg, raceDate, sessionsPerWeek])

  if (berg.gainM <= 0) {
    return (
      <p className="text-sm text-amber-400">
        Deze trainingsberg heeft geen meetbare hoogtewinst. Kies een ander GPX-bestand.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-slate-100">Eén training</h3>
        <p className="mt-1 text-sm text-slate-400">
          Hoeveel keer moet je de berg op om (een deel van) de hoogtemeters van de wedstrijd na te
          bootsen?
        </p>

        <div className="mt-4 flex items-center gap-3">
          <input
            type="range"
            min={20}
            max={150}
            step={5}
            value={targetPercent}
            onChange={(e) => setTargetPercent(Number(e.target.value))}
            className="w-full accent-emerald-400"
          />
          <span className="w-16 shrink-0 text-right text-sm text-slate-300">
            {targetPercent}%
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Herhalingen</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-400">{session.reps}×</p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Totale D+</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.totalGainM.toFixed(0)} m
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Afstand</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.totalDistanceKm.toFixed(1)} km
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">% van wedstrijd</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.percentOfRace.toFixed(0)}%
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-slate-100">Opbouwschema naar wedstrijddag</h3>
        <p className="mt-1 text-sm text-slate-400">
          Vul de datum van je wedstrijd in voor een wekelijks schema dat opbouwt naar een piek en
          daarna afbouwt (taper).
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Wedstrijddatum
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            Trainingen per week
            <input
              type="number"
              min={1}
              max={7}
              value={sessionsPerWeek}
              onChange={(e) => setSessionsPerWeek(Math.max(1, Number(e.target.value)))}
              className="w-24 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100"
            />
          </label>
        </div>

        {weeklyPlan.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
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
                    className={`border-b border-slate-800/60 ${
                      w.isRaceWeek
                        ? 'text-amber-300'
                        : w.isTaper
                          ? 'text-sky-300'
                          : 'text-slate-200'
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
