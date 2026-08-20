interface PrintChecklistWeek {
  label: string
  goal: string
  sessions: string[]
}

interface PrintChecklistProps {
  title: string
  subtitle: string
  weeks: PrintChecklistWeek[]
}

export function PrintChecklist({ title, subtitle, weeks }: PrintChecklistProps) {
  return (
    <div className="hidden bg-white p-4 text-black print:block">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mb-4 text-sm text-gray-700">{subtitle}</p>
      {weeks.map((w) => (
        <div key={w.label} className="mb-3 break-inside-avoid">
          <h2 className="border-b border-black pb-0.5 text-sm font-semibold">
            {w.label} — {w.goal}
          </h2>
          <ul>
            {w.sessions.map((s, i) => (
              <li key={i} className="flex items-center gap-2 py-0.5 text-sm">
                <span className="inline-block h-3.5 w-3.5 shrink-0 border border-black" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
