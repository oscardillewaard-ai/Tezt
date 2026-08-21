import type { LocalPoint } from './hillFromGpx'

/** Everything the map and 3D view need from a flank: which one it is, and where it runs. */
export interface TracedFlank {
  id: string
  aspect: string
  trace: LocalPoint[]
}

/** Shared per-flank colours so the plan, the map and the 3D view agree. */
export const FLANK_COLORS = ['#f97316', '#34d399', '#60a5fa', '#f472b6', '#facc15', '#a78bfa']
