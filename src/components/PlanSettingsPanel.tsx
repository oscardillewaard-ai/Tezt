import type { PlanSettings } from '../lib/plan'
import { NumberField } from './NumberField'

interface PlanSettingsPanelProps {
  settings: PlanSettings
  onChange: (settings: PlanSettings) => void
  sessionsPerWeek: number
  onSessionsPerWeekChange: (v: number) => void
  /** Empty means "start this week"; a date lets the build begin later. */
  startDate: string
  onStartDateChange: (v: string) => void
}

const FIELD =
  'w-24 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]'
const LABEL = 'flex flex-col gap-1 text-sm text-[var(--text-3)]'

export function PlanSettingsPanel({
  settings,
  onChange,
  sessionsPerWeek,
  onSessionsPerWeekChange,
  startDate,
  onStartDateChange,
}: PlanSettingsPanelProps) {
  const set = (patch: Partial<PlanSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="mt-4 rounded-lg border border-[var(--border)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--faint)]">Schema-instellingen</p>

      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className={LABEL}>
          Eerste trainingsweek
          <input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
          />
        </label>
        <label className={LABEL}>
          Trainingen per week
          <NumberField
            min={1}
            max={7}
            value={sessionsPerWeek}
            onChange={onSessionsPerWeekChange}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Start (% van D+)
          <NumberField
            min={5}
            max={150}
            step={5}
            value={settings.startPercent}
            onChange={(v) => set({ startPercent: v })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Piek (% van D+)
          <NumberField
            min={20}
            max={250}
            step={5}
            value={settings.peakPercent}
            onChange={(v) => set({ peakPercent: v })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Wedstrijdweek (%)
          <NumberField
            min={0}
            max={100}
            step={5}
            value={settings.taperPercent}
            onChange={(v) => set({ taperPercent: v })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Taperweken
          <NumberField
            min={0}
            max={6}
            value={settings.taperWeeks < 0 ? 2 : settings.taperWeeks}
            onChange={(v) => set({ taperWeeks: v })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Rustweek elke
          <NumberField
            min={0}
            max={12}
            value={settings.restWeekEvery}
            onChange={(v) => set({ restWeekEvery: v })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          Rustweek op (%)
          <NumberField
            min={10}
            max={100}
            step={5}
            value={settings.restWeekPercent}
            onChange={(v) => set({ restWeekPercent: v })}
            className={FIELD}
          />
        </label>
      </div>

      <p className="mt-3 text-xs text-[var(--faint)]">
        {settings.restWeekEvery > 0
          ? `Elke ${settings.restWeekEvery}e week is een rustweek op ${settings.restWeekPercent}% van wat die week anders gevraagd zou hebben. De piekweek en de taper blijven ongemoeid.`
          : 'Rustweken staan uit — zet "rustweek elke" op bijvoorbeeld 4 om er elke vierde week een in te plannen.'}{' '}
        Taperweken zijn de weken vlak voor de wedstrijd waarin je afbouwt; laat de eerste
        trainingsweek leeg om vanaf deze week te beginnen.
      </p>
    </div>
  )
}
