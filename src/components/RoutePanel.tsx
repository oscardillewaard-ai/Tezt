import { useState } from 'react'
import { parseGpx, type RouteStats } from '../lib/gpx'
import type { SavedRoute } from '../lib/storage'
import { FileDrop } from './FileDrop'
import { StatCard } from './StatCard'
import { ElevationChart } from './ElevationChart'

interface RoutePanelProps {
  title: string
  description: string
  color: string
  accentClass: string
  route: RouteStats | null
  onRouteChange: (route: RouteStats | null) => void
  saved: SavedRoute[]
  onSave: (route: RouteStats) => void
  onDeleteSaved: (id: string) => void
}

export function RoutePanel({
  title,
  description,
  color,
  accentClass,
  route,
  onRouteChange,
  saved,
  onSave,
  onDeleteSaved,
}: RoutePanelProps) {
  const [error, setError] = useState<string | null>(null)

  function handleFile(text: string, filename: string) {
    try {
      const fallbackName = filename.replace(/\.gpx$/i, '')
      const stats = parseGpx(text, fallbackName)
      onRouteChange(stats)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Onbekende fout bij het lezen van dit bestand.')
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
      <p className="mt-0.5 text-sm text-slate-400">{description}</p>

      <div className="mt-4">
        <FileDrop
          label={route ? 'Ander GPX-bestand kiezen' : 'Sleep een GPX-bestand hierheen'}
          hint="of klik om te bladeren"
          onFile={handleFile}
          accentClass={accentClass}
        />
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {saved.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">Opgeslagen routes</p>
          <div className="flex flex-wrap gap-2">
            {saved.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-1.5 rounded-full bg-slate-800 py-1 pl-3 pr-1.5 text-sm text-slate-300"
              >
                <button
                  type="button"
                  onClick={() => onRouteChange(s.stats)}
                  className="hover:text-white"
                >
                  {s.stats.name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSaved(s.id)}
                  aria-label={`${s.stats.name} verwijderen`}
                  className="rounded-full px-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {route && (
        <div className="mt-5 space-y-4">
          <p className="truncate text-sm font-medium text-slate-200">{route.name}</p>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Afstand" value={`${route.distanceKm.toFixed(1)} km`} />
            <StatCard label="D+" value={`${route.gainM.toFixed(0)} m`} />
            <StatCard label="D-" value={`${route.lossM.toFixed(0)} m`} />
          </div>
          <ElevationChart profile={route.profile} color={color} />
          <button
            type="button"
            onClick={() => onSave(route)}
            className="text-sm text-slate-400 underline decoration-dotted hover:text-slate-200"
          >
            Route bewaren voor later
          </button>
        </div>
      )}
    </div>
  )
}
