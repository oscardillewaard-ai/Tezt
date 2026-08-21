import { useRef, useState } from 'react'
import { deriveHillFromGpx, type DerivedHill } from '../lib/hillFromGpx'
import { updateFlank } from '../lib/customHills'
import { HillMap } from './HillMap'
import { NumberField } from './NumberField'

interface HillBuilderProps {
  saved: DerivedHill[]
  onSave: (hill: DerivedHill) => void
  onDelete: (id: string) => void
  onUse: (hill: DerivedHill) => void
}

export function HillBuilder({ saved, onSave, onDelete, onUse }: HillBuilderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<DerivedHill | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const text = await file.text()
      setDraft(deriveHillFromGpx(text, file.name.replace(/\.gpx$/i, '')))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kon deze GPX niet analyseren.')
      setDraft(null)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Eigen heuvel</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Upload een GPX van een sessie die je op je eigen heuvel liep. De app herkent de flanken aan
        waar de beklimmingen beginnen, en meet lengte, hoogtewinst en rondtijd per flank.
      </p>

      {saved.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--faint)]">Opgeslagen heuvels</p>
          <div className="space-y-2">
            {saved.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-3)] px-4 py-2.5"
              >
                <button type="button" onClick={() => onUse(h)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium text-[var(--text-2)]">{h.name}</p>
                  <p className="text-xs text-[var(--faint)]">
                    {h.flanks.length} flanken · {h.location}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(h.id)}
                  aria-label={`${h.name} verwijderen`}
                  className="shrink-0 rounded-full px-2 py-1 text-[var(--faint)] hover:bg-[var(--surface-2-hover)] hover:text-[var(--text-2)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div
        onClick={() => inputRef.current?.click()}
        className="mt-4 cursor-pointer rounded-xl border-2 border-dashed border-[var(--border-2)] p-6 text-center hover:border-[var(--muted)]"
      >
        <p className="font-medium text-[var(--text-2)]">Sleep een sessie-GPX hierheen</p>
        <p className="mt-1 text-sm text-[var(--muted)]">of klik om te bladeren</p>
        <input
          ref={inputRef}
          type="file"
          accept=".gpx"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>

      {error && <p className="mt-3 text-sm text-[var(--status-warn)]">{error}</p>}

      {draft && (
        <div className="mt-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-[var(--text-2)]">{draft.name}</p>
            <p className="mt-1 text-xs text-[var(--faint)]">{draft.source}</p>
            <p className="mt-2 rounded-lg bg-[var(--surface-3)] px-4 py-3 text-sm text-[var(--text-3)]">
              {draft.note}
            </p>
          </div>

          <HillMap
            flanks={draft.flanks.map((f) => ({ id: f.id, aspect: f.aspect, trace: f.trace }))}
            height={200}
          />

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                  <th className="py-2 pr-3 font-medium">Flank</th>
                  <th className="py-2 pr-3 font-medium">Herh.</th>
                  <th className="py-2 pr-3 font-medium">Lengte m</th>
                  <th className="py-2 pr-3 font-medium">Helling %</th>
                  <th className="py-2 pr-3 font-medium">HM</th>
                  <th className="py-2 pr-3 font-medium">Min/pendel</th>
                </tr>
              </thead>
              <tbody>
                {draft.flanks.map((f) => (
                  <tr key={f.id} className="border-b border-[var(--border-soft)] text-[var(--text-2)]">
                    <td className="py-2 pr-3">{f.name}</td>
                    <td className="py-2 pr-3 text-[var(--muted)]">{f.repCount}×</td>
                    <td className="py-2 pr-3">
                      <NumberField
                        min={10}
                        max={5000}
                        value={f.distanceM}
                        onChange={(v) => setDraft(updateFlank(draft, f.id, { distanceM: v }))}
                        className="w-20 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberField
                        min={1}
                        max={60}
                        step={0.1}
                        value={f.gradientPercent}
                        onChange={(v) => setDraft(updateFlank(draft, f.id, { gradientPercent: v }))}
                        className="w-20 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberField
                        min={1}
                        max={2000}
                        value={f.hmOneWay}
                        onChange={(v) => setDraft(updateFlank(draft, f.id, { hmOneWay: v }))}
                        className="w-20 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberField
                        min={0.5}
                        max={120}
                        step={0.1}
                        value={f.minutesPerRep}
                        onChange={(v) => setDraft(updateFlank(draft, f.id, { minutesPerRep: v }))}
                        className="w-20 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-2 py-1 text-[var(--text)]"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[var(--faint)]">
            Waarden komen uit de GPX en zijn aanpasbaar — handig voor een flank die je maar één keer
            liep, of waarvan je de echte lengte kent.
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(draft)
                onUse(draft)
                setDraft(null)
              }}
              className="rounded-md bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-emerald-300"
            >
              Bewaren en gebruiken
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="rounded-md border border-[var(--border-2)] px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
            >
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
