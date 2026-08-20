const DAY_NAMES = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

export interface DayCell {
  iso: number
  label: string
  detail: string
  isTrainingDay: boolean
}

interface WeekAgendaRowProps {
  weekLabel: string
  goalLabel: string
  emphasisClass: string
  days: DayCell[]
}

export function WeekAgendaRow({ weekLabel, goalLabel, emphasisClass, days }: WeekAgendaRowProps) {
  return (
    <div className="border-b border-[var(--border-soft)] py-3">
      <div className={`flex items-baseline justify-between text-sm ${emphasisClass}`}>
        <span className="font-medium">{weekLabel}</span>
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
    </div>
  )
}
