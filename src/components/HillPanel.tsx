import type { TrainingHill } from '../lib/hills'

const modeLabel: Record<string, string> = {
  jog: 'joggend',
  run: 'rennend',
  powerhike: 'powerhike',
  hike: 'lopend',
}

interface HillPanelProps {
  hills: TrainingHill[]
  selected: TrainingHill | null
  onSelect: (hill: TrainingHill) => void
}

export function HillPanel({ hills, selected, onSelect }: HillPanelProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-lg font-semibold text-slate-100">Trainingsberg</h2>
      <p className="mt-0.5 text-sm text-slate-400">
        Vaste heuvel met meerdere flanken. Elke flank heeft een eigen lengte, helling en
        pendeltype.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {hills.map((hill) => (
          <button
            key={hill.id}
            type="button"
            onClick={() => onSelect(hill)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              selected?.id === hill.id
                ? 'bg-emerald-400 text-slate-900'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {hill.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-200">{selected.location}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  selected.kind === 'measured'
                    ? 'bg-emerald-400/15 text-emerald-300'
                    : 'bg-amber-400/15 text-amber-300'
                }`}
              >
                {selected.kind === 'measured' ? 'GPS-gemeten' : 'Generiek profiel'}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{selected.source}</p>
          </div>
          <p className="rounded-lg bg-slate-800/60 px-4 py-3 text-sm text-slate-300">
            {selected.note}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 pr-4 font-medium">Flank</th>
                  <th className="py-2 pr-4 font-medium">Lengte</th>
                  <th className="py-2 pr-4 font-medium">Helling</th>
                  <th className="py-2 pr-4 font-medium">HM</th>
                  <th className="py-2 pr-4 font-medium">Op / af</th>
                </tr>
              </thead>
              <tbody>
                {selected.flanks.map((f) => (
                  <tr key={f.id} className="border-b border-slate-800/60 text-slate-200">
                    <td className="py-2 pr-4">{f.name}</td>
                    <td className="py-2 pr-4">{f.distanceM} m</td>
                    <td className="py-2 pr-4">{f.gradientPercent}%</td>
                    <td className="py-2 pr-4">{f.hmOneWay} m</td>
                    <td className="py-2 pr-4 text-slate-400">
                      {modeLabel[f.climbMode]} / {modeLabel[f.descendMode]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
