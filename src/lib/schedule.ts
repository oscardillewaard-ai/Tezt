export interface ScheduleEntry {
  date: Date
  title: string
  description: string
}

// index = sessions per week, value = ISO weekday numbers (1=Mon..7=Sun) to train on.
const WEEKDAY_SETS: number[][] = [
  [],
  [2], // Tue
  [2, 4], // Tue, Thu
  [1, 3, 5], // Mon, Wed, Fri
  [1, 2, 4, 5],
  [1, 2, 3, 4, 5],
  [1, 2, 3, 4, 5, 6],
  [1, 2, 3, 4, 5, 6, 7],
]

export function weekdaysForSessionsPerWeek(sessionsPerWeek: number): number[] {
  return WEEKDAY_SETS[Math.min(7, Math.max(1, sessionsPerWeek))] ?? [2]
}

const WEEKDAY_NAMES = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

export function weekdayName(isoWeekday: number): string {
  return WEEKDAY_NAMES[isoWeekday - 1] ?? ''
}

/** weekStart must be the Monday of that week (matches computeWeeklyTargets' convention). */
export function sessionDate(weekStart: Date, isoWeekday: number): Date {
  const d = new Date(weekStart)
  d.setDate(d.getDate() + (isoWeekday - 1))
  return d
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

function formatIcsDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
}

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildIcsCalendar(entries: ScheduleEntry[], calendarName: string): string {
  const dtstamp = `${formatIcsDate(new Date())}T000000Z`
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bergtrainer//NL',
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]
  entries.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:bergtrainer-${formatIcsDate(e.date)}-${i}@bergtrainer.local`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(e.date)}`,
      `SUMMARY:${escapeIcsText(e.title)}`,
      `DESCRIPTION:${escapeIcsText(e.description)}`,
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

export function downloadTextFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
