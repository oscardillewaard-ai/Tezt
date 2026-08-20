import { useMemo, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import type { TrainingHill } from '../lib/hills'
import { buildFlankWeeklyPlan, computeFlankSession, type FlankSessionPlan } from '../lib/flankPlan'

interface FlankTrainingPlanProps {
  race: RouteStats
  hill: TrainingHill
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
          <tr className="border-b border-slate-800 text-slate-400">
            <th className="py-2 pr-4 font-medium">Flank</th>
            <th className="py-2 pr-4 font-medium">Aandeel wedstrijdterrein</th>
            <th className="py-2 pr-4 font-medium">Herhalingen</th>
            <th className="py-2 pr-4 font-medium">HM</th>
            <th className="py-2 pr-4 font-medium">Tijd</th>
          </tr>
        </thead>
        <tbody>
          {session.allocations.map((a) => (
            <tr key={a.flank.id} className="border-b border-slate-800/60 text-slate-200">
              <td className="py-2 pr-4">{a.flank.name}</td>
              <td className="py-2 pr-4">{(a.shareOfClimb * 100).toFixed(0)}%</td>
              <td className="py-2 pr-4">{a.reps}×</td>
              <td className="py-2 pr-4">{a.hmM.toFixed(0)} m</td>
              <td className="py-2 pr-4">{a.minutes.toFixed(0)}'</td>
            </tr>
          ))}
          {session.warmup && (
            <tr className="text-slate-400">
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

export function FlankTrainingPlan({ race, hill }: FlankTrainingPlanProps) {
  const [targetPercent, setTargetPercent] = useState(100)
  const [raceDate, setRaceDate] = useState('')
  const [startPercent, setStartPercent] = useState(40)
  const [sessionsPerWeek, setSessionsPerWeek] = useState(1)

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
      <p className="text-sm text-amber-400">
        Er zijn geen losse klimmen of afdalingen te herkennen in deze wedstrijd-GPX, dus kan de mix
        niet over de flanken verdeeld worden.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-base font-semibold text-slate-100">Eén training</h3>
        <p className="mt-1 text-sm text-slate-400">
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
              className="w-16 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-right text-sm text-slate-100"
            />
            <span className="text-sm text-slate-400">%</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Totale D+</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.totalHmM.toFixed(0)} m
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">% van wedstrijd</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.percentOfRace.toFixed(0)}%
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Duur</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">
              {session.totalMinutes.toFixed(0)}'
            </p>
          </div>
          <div className="rounded-lg bg-slate-800/60 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Rennend / stijl af</p>
            <p className="mt-1 text-lg font-semibold text-slate-100">
              {session.runningDescentHmM.toFixed(0)} / {session.steepDescentHmM.toFixed(0)} m
            </p>
          </div>
        </div>

        <div className="mt-5">
          <SessionBreakdown session={session} />
        </div>
      </div>

      <div>
        <h3 className="text-base font-semibold text-slate-100">Opbouwschema naar wedstrijddag</h3>
        <p className="mt-1 text-sm text-slate-400">
          Vul de datum van je wedstrijd in voor een wekelijks schema dat opbouwt naar een piek en
          daarna afbouwt (taper), met dezelfde flankverdeling als hierboven.
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
            Startpercentage
            <input
              type="number"
              min={10}
              max={100}
              step={5}
              value={startPercent}
              onChange={(e) => setStartPercent(Math.max(10, Number(e.target.value)))}
              className="w-28 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100"
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
              className="w-28 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-slate-100"
            />
          </label>
        </div>

        {weeklyPlan.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
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
