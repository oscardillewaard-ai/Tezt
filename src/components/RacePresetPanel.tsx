import type { RouteStats } from '../lib/gpx'
import { generateSyntheticRace, type RaceArchetype } from '../lib/syntheticRaces'
import { StatCard } from './StatCard'
import { ElevationChart } from './ElevationChart'

interface RacePresetPanelProps {
  archetypes: RaceArchetype[]
  selected: RaceArchetype | null
  onSelect: (archetype: RaceArchetype) => void
  distanceKm: number
  onDistanceChange: (distanceKm: number) => void
}

export function RacePresetPanel({
  archetypes,
  selected,
  onSelect,
  distanceKm,
  onDistanceChange,
}: RacePresetPanelProps) {
  const route: RouteStats | null = selected ? generateSyntheticRace(selected, distanceKm) : null

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Ultrarace</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Voorbeeldwedstrijd: een indicatief profiel voor een type terrein, geen echte race-GPX.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {archetypes.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelect(a)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              selected?.id === a.id
                ? 'bg-orange-400 text-slate-900'
                : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {selected && route && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-[var(--text-2)]">{selected.location}</p>
              <span className="shrink-0 rounded-full bg-[var(--badge-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--badge-text)]">
                Generiek profiel
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--faint)]">{selected.note}</p>
          </div>

          <label className="block">
            <span className="text-xs uppercase tracking-wide text-[var(--faint)]">
              Afstand: {distanceKm} km
            </span>
            <input
              type="range"
              min={selected.minDistanceKm}
              max={selected.maxDistanceKm}
              step={5}
              value={distanceKm}
              onChange={(e) => onDistanceChange(Number(e.target.value))}
              className="mt-1 w-full accent-orange-400"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Afstand" value={`${route.distanceKm.toFixed(0)} km`} />
            <StatCard label="D+" value={`${route.gainM.toFixed(0)} m`} />
            <StatCard label="D-" value={`${route.lossM.toFixed(0)} m`} />
          </div>
          <ElevationChart profile={route.profile} color="#f97316" />
        </div>
      )}
    </div>
  )
}
