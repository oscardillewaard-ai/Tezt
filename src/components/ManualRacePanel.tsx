import type { RouteStats } from '../lib/gpx'
import {
  buildManualRace,
  manualTerrainLengthKm,
  type ManualRaceInput,
  type ManualTerrainBand,
} from '../lib/manualRace'
import { NumberField } from './NumberField'
import { StatCard } from './StatCard'
import { ElevationChart } from './ElevationChart'

interface ManualRacePanelProps {
  input: ManualRaceInput
  onChange: (input: ManualRaceInput) => void
  onSave?: (route: RouteStats) => void
}

const FIELD =
  'rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]'
const LABEL = 'flex flex-col gap-1 text-sm text-[var(--text-3)]'

export function ManualRacePanel({ input, onChange, onSave }: ManualRacePanelProps) {
  const route = buildManualRace(input)
  const terrainKm = manualTerrainLengthKm(input)
  const shareTotal = input.bands.reduce((s, b) => s + b.sharePercent, 0)

  const set = (patch: Partial<ManualRaceInput>) => onChange({ ...input, ...patch })
  const setBand = (id: string, patch: Partial<ManualTerrainBand>) =>
    set({ bands: input.bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) })
  const addBand = () =>
    set({
      bands: [
        ...input.bands,
        {
          id: `band-${Date.now()}`,
          label: 'Nieuw',
          gradientPercent: 12,
          sharePercent: 10,
          count: 2,
        },
      ],
    })
  const removeBand = (id: string) => set({ bands: input.bands.filter((b) => b.id !== id) })

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Ultrarace</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Handmatig: tik de cijfers uit het roadbook in. De steilte-verdeling bepaalt op welke flanken
        de training terechtkomt, dus die telt zwaarder dan het exacte profiel.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className={`${LABEL} min-w-0 flex-1`}>
          Naam
          <input
            type="text"
            value={input.name}
            onChange={(e) => set({ name: e.target.value })}
            className={`${FIELD} w-full`}
          />
        </label>
        <label className={LABEL}>
          Afstand (km)
          <NumberField
            min={1}
            max={500}
            step={1}
            value={input.distanceKm}
            onChange={(v) => set({ distanceKm: v })}
            className={`${FIELD} w-24`}
          />
        </label>
        <label className={LABEL}>
          D+ (m)
          <NumberField
            min={0}
            max={30000}
            step={50}
            value={input.gainM}
            onChange={(v) => set({ gainM: v })}
            className={`${FIELD} w-28`}
          />
        </label>
        <label className={LABEL}>
          D- (m)
          <NumberField
            min={0}
            max={30000}
            step={50}
            value={input.lossM}
            onChange={(v) => set({ lossM: v })}
            className={`${FIELD} w-28`}
          />
        </label>
      </div>

      <p className="mt-5 text-xs uppercase tracking-wide text-[var(--faint)]">
        Verdeling over steilte
      </p>
      <div className="mt-2 space-y-3">
        {input.bands.map((b) => (
          <div key={b.id} className="rounded-lg border border-[var(--border)] p-3">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={b.label}
                aria-label={`Naam band ${b.label}`}
                onChange={(e) => setBand(b.id, { label: e.target.value })}
                className={`${FIELD} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => removeBand(b.id)}
                aria-label={`${b.label} verwijderen`}
                disabled={input.bands.length <= 1}
                className="shrink-0 rounded-full px-2 py-1.5 text-[var(--faint)] hover:bg-[var(--surface-2-hover)] hover:text-[var(--text-2)] disabled:opacity-40"
              >
                ×
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className={LABEL}>
                Stijging (%)
                <NumberField
                  min={1}
                  max={60}
                  value={b.gradientPercent}
                  onChange={(v) => setBand(b.id, { gradientPercent: v })}
                  className={`${FIELD} w-full`}
                />
              </label>
              <label className={LABEL}>
                Aandeel D+ (%)
                <NumberField
                  min={0}
                  max={100}
                  step={5}
                  value={b.sharePercent}
                  onChange={(v) => setBand(b.id, { sharePercent: v })}
                  className={`${FIELD} w-full`}
                />
              </label>
              <label className={LABEL}>
                Aantal klimmen
                <NumberField
                  min={1}
                  max={50}
                  value={b.count}
                  onChange={(v) => setBand(b.id, { count: v })}
                  className={`${FIELD} w-full`}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addBand}
          className="text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
        >
          Steilte toevoegen
        </button>
        {shareTotal !== 100 && (
          <span className="text-xs text-[var(--faint)]">
            Aandelen tellen op tot {shareTotal}% — ze worden naar verhouding herschaald.
          </span>
        )}
      </div>

      {terrainKm > input.distanceKm && (
        <p className="mt-3 rounded-lg border border-[var(--status-warn)]/40 bg-[var(--badge-bg)] px-4 py-3 text-sm text-[var(--status-warn)]">
          Bij deze steiltes hebben de klimmen en afdalingen samen {terrainKm.toFixed(1)} km nodig,
          meer dan de opgegeven {input.distanceKm.toFixed(1)} km. Het profiel is ingedikt om te
          passen; verhoog de afstand of de steilte voor een kloppend beeld.
        </p>
      )}

      <div className="mt-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Afstand" value={`${route.distanceKm.toFixed(1)} km`} />
          <StatCard label="D+" value={`${route.gainM.toFixed(0)} m`} />
          <StatCard label="D-" value={`${route.lossM.toFixed(0)} m`} />
        </div>
        <ElevationChart profile={route.profile} color="#f97316" />
        {onSave && (
          <button
            type="button"
            onClick={() => onSave(route)}
            className="text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
          >
            Route bewaren voor later
          </button>
        )}
      </div>
    </div>
  )
}
