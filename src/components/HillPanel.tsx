import { lazy, Suspense, useState } from 'react'
import type { TrainingHill } from '../lib/hills'
import { HillMap } from './HillMap'
import type { TracedFlank } from '../lib/flankVisuals'

// three.js roughly doubles the bundle, and most visits never open the 3D
// view — so it only downloads once someone actually asks for it.
const Hill3D = lazy(() => import('./Hill3D').then((m) => ({ default: m.Hill3D })))

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
  const [view, setView] = useState<'geen' | 'kaart' | '3d'>('geen')
  const traced: TracedFlank[] = (selected?.flanks ?? [])
    .filter((f): f is typeof f & { trace: NonNullable<typeof f.trace> } => !!f.trace?.length)
    .map((f) => ({ id: f.id, aspect: f.aspect, trace: f.trace }))

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Trainingsberg</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
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
                : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
            }`}
          >
            {hill.name}
          </button>
        ))}
      </div>

      {selected && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-2)]">{selected.location}</p>
            <p className="mt-1 text-xs text-[var(--faint)]">{selected.source}</p>
          </div>
          <p className="rounded-lg bg-[var(--surface-3)] px-4 py-3 text-sm text-[var(--text-3)]">
            {selected.note}
          </p>

          {traced.length > 0 && (
            <div>
              <div className="mb-2 flex gap-1">
                {(['geen', 'kaart', '3d'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={`rounded-full px-3 py-1 text-xs ${
                      view === v
                        ? 'bg-[var(--surface-2-active)] text-[var(--text)]'
                        : 'bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--text-2)]'
                    }`}
                  >
                    {v === 'geen' ? 'Geen weergave' : v === 'kaart' ? 'Plattegrond' : '3D'}
                  </button>
                ))}
              </div>
              {view === 'kaart' && <HillMap flanks={traced} />}
              {view === '3d' && (
                <Suspense
                  fallback={
                    <p className="rounded-lg bg-[var(--surface-3)] px-4 py-8 text-center text-sm text-[var(--muted)]">
                      3D-weergave laden…
                    </p>
                  }
                >
                  <Hill3D flanks={traced} />
                </Suspense>
              )}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Flank</th>
                  <th className="py-2 pr-4 font-medium">Lengte</th>
                  <th className="py-2 pr-4 font-medium">Helling</th>
                  <th className="py-2 pr-4 font-medium">HM</th>
                  <th className="py-2 pr-4 font-medium">Op / af</th>
                </tr>
              </thead>
              <tbody>
                {selected.flanks.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--border-soft)] text-[var(--text-2)]">
                    <td className="py-2 pr-4">{f.name}</td>
                    <td className="py-2 pr-4">{f.distanceM} m</td>
                    <td className="py-2 pr-4">{f.gradientPercent}%</td>
                    <td className="py-2 pr-4">{f.hmOneWay} m</td>
                    <td className="py-2 pr-4 text-[var(--muted)]">
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
