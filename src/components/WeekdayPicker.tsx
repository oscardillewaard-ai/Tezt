const DAYS = [
  { iso: 1, label: 'Ma' },
  { iso: 2, label: 'Di' },
  { iso: 3, label: 'Wo' },
  { iso: 4, label: 'Do' },
  { iso: 5, label: 'Vr' },
  { iso: 6, label: 'Za' },
  { iso: 7, label: 'Zo' },
]

interface WeekdayPickerProps {
  selected: number[]
  count: number
  onChange: (days: number[]) => void
}

export function WeekdayPicker({ selected, count, onChange }: WeekdayPickerProps) {
  function toggle(iso: number) {
    if (selected.includes(iso)) {
      if (selected.length <= 1) return
      onChange(selected.filter((d) => d !== iso))
    } else if (selected.length >= count) {
      onChange([...selected.slice(1), iso].sort((a, b) => a - b))
    } else {
      onChange([...selected, iso].sort((a, b) => a - b))
    }
  }

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-wide text-[var(--muted)]">
        Trainingsdagen ({selected.length}/{count})
      </p>
      <div className="flex gap-1">
        {DAYS.map((d) => (
          <button
            key={d.iso}
            type="button"
            onClick={() => toggle(d.iso)}
            className={`h-9 w-9 rounded-full text-sm ${
              selected.includes(d.iso)
                ? 'bg-emerald-400 text-slate-900'
                : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  )
}
