import { computeWeekVolume } from '../lib/weeklyVolume'
import { NumberField } from './NumberField'

export interface VolumeWeekRow {
  key: number
  label: string
  hillHmM: number
  emphasisClass: string
}

interface WeeklyVolumePanelProps {
  weeks: VolumeWeekRow[]
  raceDensityHmPerKm: number
  weekGoalMultiplier: number
  onWeekGoalMultiplierChange: (v: number) => void
  longRunDensity: number
  onLongRunDensityChange: (v: number) => void
}

export function WeeklyVolumePanel({
  weeks,
  raceDensityHmPerKm,
  weekGoalMultiplier,
  onWeekGoalMultiplierChange,
  longRunDensity,
  onLongRunDensityChange,
}: WeeklyVolumePanelProps) {
  if (weeks.length === 0) return null

  return (
    <div className="no-print">
      <h3 className="text-base font-semibold text-[var(--text)]">Weekvolume: heuvel + de rest</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        De heuvelsessie levert maar een deel van je weekdoel. Het verschil zit in hoe bergachtig je
        long run is — niet in extra pendels. Deze wedstrijd vraagt{' '}
        <strong className="text-[var(--text-2)]">{raceDensityHmPerKm.toFixed(0)} hm/km</strong>.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
          Weekdoel = heuvelsessie ×
          <NumberField
            min={1}
            max={6}
            step={0.5}
            value={weekGoalMultiplier}
            onChange={onWeekGoalMultiplierChange}
            className="w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
          Long run dichtheid (hm/km)
          <NumberField
            min={1}
            max={60}
            value={longRunDensity}
            onChange={onLongRunDensityChange}
            className="w-28 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
          />
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--muted)]">
              <th className="py-2 pr-4 font-medium">Week</th>
              <th className="py-2 pr-4 font-medium">Heuvel</th>
              <th className="py-2 pr-4 font-medium">Weekdoel</th>
              <th className="py-2 pr-4 font-medium">Nog te vullen</th>
              <th className="py-2 pr-4 font-medium">Long run</th>
              <th className="py-2 pr-4 font-medium">of gym</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => {
              const v = computeWeekVolume(w.hillHmM, weekGoalMultiplier, longRunDensity)
              return (
                <tr key={w.key} className={`border-b border-[var(--border-soft)] ${w.emphasisClass}`}>
                  <td className="py-2 pr-4">{w.label}</td>
                  <td className="py-2 pr-4">{v.hillHmM.toFixed(0)} m</td>
                  <td className="py-2 pr-4">{v.weekGoalHmM.toFixed(0)} m</td>
                  <td className="py-2 pr-4">{v.gapHmM.toFixed(0)} m</td>
                  <td className="py-2 pr-4">{v.longRunKm.toFixed(1)} km</td>
                  <td className="py-2 pr-4 text-[var(--muted)]">{v.gymHmM.toFixed(0)} m</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-xs text-[var(--faint)]">
        Gym-kolom: dezelfde hoogtemeters op de loopband of stairmaster, voor weken waarin de heuvel
        of een heuvelachtige long run er niet in zit.
      </p>
    </div>
  )
}
