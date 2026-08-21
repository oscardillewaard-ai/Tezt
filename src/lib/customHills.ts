import type { DerivedHill } from './hillFromGpx'
import type { TrainingHill } from './hills'

const KEY = 'bergtrainer:hills'

export function listCustomHills(): DerivedHill[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as DerivedHill[]) : []
  } catch {
    return []
  }
}

function write(hills: DerivedHill[]) {
  localStorage.setItem(KEY, JSON.stringify(hills))
}

export function saveCustomHill(hill: DerivedHill): DerivedHill[] {
  const next = [hill, ...listCustomHills().filter((h) => h.id !== hill.id)]
  write(next)
  return next
}

export function deleteCustomHill(id: string): DerivedHill[] {
  const next = listCustomHills().filter((h) => h.id !== id)
  write(next)
  return next
}

/** Applies edited flank values to a stored hill, keeping everything else (traces, summit) intact. */
export function updateFlank(
  hill: DerivedHill,
  flankId: string,
  patch: Partial<TrainingHill['flanks'][number]>,
): DerivedHill {
  return {
    ...hill,
    flanks: hill.flanks.map((f) => (f.id === flankId ? { ...f, ...patch } : f)),
  }
}
