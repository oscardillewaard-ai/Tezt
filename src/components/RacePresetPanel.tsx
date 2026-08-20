import type { RouteStats } from '../lib/gpx'
import { generateSyntheticRace, type RaceArchetype } from '../lib/syntheticRaces'
import { StatCard } from './StatCard'
import { ElevationChart } from './ElevationChart'

interface RacePresetPanelProps {
  archetypes: RaceArchetype[]
  selected: RaceArchetype | null
  onSelect: (archetype: RaceArchetype) => void
}

export function RacePresetPanel({ archetypes, selected, onSelect }: RacePresetPanelProps) {
  const route: RouteStats | null = selected ? generateSyntheticRace(selected) : null

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-lg font-semibold text-slate-100">Ultrarace</h2>
      <p className="mt-0.5 text-sm text-slate-400">
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
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
              <p className="text-sm font-medium text-slate-200">{selected.location}</p>
              <span className="shrink-0 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                Generiek profiel
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{selected.note}</p>
          </div>

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
