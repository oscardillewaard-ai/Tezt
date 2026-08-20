import type { RouteStats } from './gpx'

export interface SavedRoute {
  id: string
  savedAt: string
  stats: RouteStats
}

const RACE_KEY = 'gpx-trainer:races'
const BERG_KEY = 'gpx-trainer:bergen'

function readList(key: string): SavedRoute[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    return JSON.parse(raw) as SavedRoute[]
  } catch {
    return []
  }
}

function writeList(key: string, list: SavedRoute[]) {
  localStorage.setItem(key, JSON.stringify(list))
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function listRaces(): SavedRoute[] {
  return readList(RACE_KEY)
}

export function listBergen(): SavedRoute[] {
  return readList(BERG_KEY)
}

export function saveRace(stats: RouteStats): SavedRoute {
  const entry: SavedRoute = { id: makeId(), savedAt: new Date().toISOString(), stats }
  writeList(RACE_KEY, [entry, ...readList(RACE_KEY)])
  return entry
}

export function saveBerg(stats: RouteStats): SavedRoute {
  const entry: SavedRoute = { id: makeId(), savedAt: new Date().toISOString(), stats }
  writeList(BERG_KEY, [entry, ...readList(BERG_KEY)])
  return entry
}

export function deleteRace(id: string) {
  writeList(RACE_KEY, readList(RACE_KEY).filter((r) => r.id !== id))
}

export function deleteBerg(id: string) {
  writeList(BERG_KEY, readList(BERG_KEY).filter((r) => r.id !== id))
}
