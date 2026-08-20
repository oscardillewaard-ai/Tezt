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

function isSaved(route: RouteStats, saved: SavedRoute[]): boolean {
  return saved.some(
    (s) =>
      s.stats.name === route.name &&
      Math.abs(s.stats.distanceKm - route.distanceKm) < 0.01 &&
      Math.abs(s.stats.gainM - route.gainM) < 1,
  )
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
  const [showUpload, setShowUpload] = useState(false)

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
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">{title}</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">{description}</p>

      {!route && saved.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs uppercase tracking-wide text-[var(--faint)]">Kies een route</p>
          <div className="space-y-2">
            {saved.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-lg bg-[var(--surface-3)] px-4 py-2.5"
              >
                <button
                  type="button"
                  onClick={() => onRouteChange(s.stats)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-[var(--text-2)]">{s.stats.name}</p>
                  <p className="text-xs text-[var(--faint)]">
                    {s.stats.distanceKm.toFixed(1)} km · D+ {s.stats.gainM.toFixed(0)} m
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteSaved(s.id)}
                  aria-label={`${s.stats.name} verwijderen`}
                  className="shrink-0 rounded-full px-2 py-1 text-[var(--faint)] hover:bg-[var(--surface-2-hover)] hover:text-[var(--text-2)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!route && saved.length > 0 && !showUpload && (
        <button
          type="button"
          onClick={() => setShowUpload(true)}
          className="mt-3 text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
        >
          Nieuwe GPX toevoegen
        </button>
      )}

      {(showUpload || saved.length === 0 || route) && (
        <div className="mt-4">
          <FileDrop
            label={route ? 'Ander GPX-bestand kiezen' : 'Sleep een GPX-bestand hierheen'}
            hint="of klik om te bladeren"
            onFile={handleFile}
            accentClass={accentClass}
          />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      {route && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-[var(--text-2)]">{route.name}</p>
            <button
              type="button"
              onClick={() => onRouteChange(null)}
              className="shrink-0 text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
            >
              Andere route kiezen
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Afstand" value={`${route.distanceKm.toFixed(1)} km`} />
            <StatCard label="D+" value={`${route.gainM.toFixed(0)} m`} />
            <StatCard label="D-" value={`${route.lossM.toFixed(0)} m`} />
          </div>
          <ElevationChart profile={route.profile} color={color} />
          {!isSaved(route, saved) && (
            <button
              type="button"
              onClick={() => onSave(route)}
              className="text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
            >
              Route bewaren voor later
            </button>
          )}
        </div>
      )}
    </div>
  )
}
