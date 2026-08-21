const DAY_NAMES = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

export interface DayCell {
  iso: number
  label: string
  detail: string
  isTrainingDay: boolean
}

/**
 * One training day spelled out: which flanks/pendels, how many reps each.
 * The seven-day grid only has room for a rep count, so the actual "welke
 * pendel" answer lives in these lines underneath it.
 */
export interface AgendaSessionLine {
  dayLabel: string
  parts: string[]
}

interface WeekAgendaRowProps {
  weekLabel: string
  goalLabel: string
  emphasisClass: string
  days: DayCell[]
  sessions?: AgendaSessionLine[]
  isRestWeek?: boolean
}

export function WeekAgendaRow({
  weekLabel,
  goalLabel,
  emphasisClass,
  days,
  sessions = [],
  isRestWeek = false,
}: WeekAgendaRowProps) {
  return (
    <div className="border-b border-[var(--border-soft)] py-3">
      <div className={`flex flex-wrap items-baseline justify-between gap-2 text-sm ${emphasisClass}`}>
        <span className="flex items-baseline gap-2">
          <span className="font-medium">{weekLabel}</span>
          {isRestWeek && (
            <span className="rounded-full bg-[var(--badge-bg)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--status-info)]">
              Rustweek
            </span>
          )}
        </span>
        <span>{goalLabel}</span>
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1">
        {days.map((d) => (
          <div
            key={d.iso}
            title={d.detail}
            className={`rounded-md px-1 py-2 text-center text-xs ${
              d.isTrainingDay
                ? 'bg-[var(--surface-3)] text-[var(--text-2)]'
                : 'text-[var(--faint)]'
            }`}
          >
            <div className="text-[10px] uppercase">{DAY_NAMES[d.iso - 1]}</div>
            <div className="mt-0.5 font-semibold">{d.label || '–'}</div>
          </div>
        ))}
      </div>
      {sessions.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
          {sessions.map((s) => (
            <li key={s.dayLabel} className="flex flex-wrap gap-x-2">
              <span className="font-medium text-[var(--text-3)]">{s.dayLabel}</span>
              <span>{s.parts.length > 0 ? s.parts.join(' · ') : 'geen herhalingen'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
