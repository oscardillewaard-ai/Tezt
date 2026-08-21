import { useRef, useState } from 'react'
import { reviewSession, type SessionReview } from '../lib/sessionReview'
import { ElevationChart } from './ElevationChart'
import { NumberField } from './NumberField'

interface SessionReviewPanelProps {
  /** What the plan asked of this session, used as the default target. */
  plannedHmM: number
}

const VERDICT_STYLE: Record<SessionReview['verdict'], string> = {
  gehaald: 'text-[var(--accent-emerald-text)]',
  'ruim over': 'text-[var(--accent-emerald-text)]',
  'net niet': 'text-[var(--status-info)]',
  'onder doel': 'text-[var(--status-warn)]',
}

export function SessionReviewPanel({ plannedHmM }: SessionReviewPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [target, setTarget] = useState(Math.round(plannedHmM))
  const [review, setReview] = useState<SessionReview | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    try {
      const text = await file.text()
      setReview(reviewSession(text, file.name.replace(/\.gpx$/i, ''), target))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Kon deze GPX niet lezen.')
      setReview(null)
    }
  }

  return (
    <div className="no-print">
      <h3 className="text-base font-semibold text-[var(--text)]">Sessie terugkijken</h3>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Upload het bestand van je horloge na afloop en zie of je het doel gehaald hebt. Beoordeeld
        op hoogtemeters, niet op afstand of tijd — op een pendelheuvel is het klimmen het doel.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm text-[var(--text-3)]">
          Doel voor deze sessie (hm)
          <NumberField
            min={1}
            max={20000}
            value={target}
            onChange={(v) => {
              setTarget(v)
              setReview((r) => (r ? { ...reviewSessionAgain(r, v) } : r))
            }}
            className="w-32 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
          />
        </label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
        >
          Sessie-GPX kiezen
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".gpx"
          className="hidden"
          onChange={(e) => void handleFile(e.target.files?.[0])}
        />
      </div>

      {error && <p className="mt-3 text-sm text-[var(--status-warn)]">{error}</p>}

      {review && (
        <div className="mt-4 space-y-4">
          <p className="text-sm font-medium text-[var(--text-2)]">{review.actual.name}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Gelopen D+</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
                {review.achievedHmM.toFixed(0)} m
              </p>
            </div>
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Doel</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
                {review.targetHmM.toFixed(0)} m
              </p>
            </div>
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Verschil</p>
              <p className="mt-1 text-2xl font-semibold text-[var(--text)]">
                {review.differenceHmM >= 0 ? '+' : ''}
                {review.differenceHmM.toFixed(0)} m
              </p>
            </div>
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Oordeel</p>
              <p className={`mt-1 text-xl font-semibold ${VERDICT_STYLE[review.verdict]}`}>
                {review.percentOfTarget.toFixed(0)}% · {review.verdict}
              </p>
            </div>
          </div>
          <ElevationChart profile={review.actual.profile} color="#34d399" />
          <p className="text-xs text-[var(--faint)]">
            {review.actual.climbSegments.length} beklimmingen herkend over{' '}
            {review.actual.distanceKm.toFixed(1)} km.
          </p>
        </div>
      )}
    </div>
  )
}

/** Recomputes the verdict against a changed target without re-reading the file. */
function reviewSessionAgain(review: SessionReview, targetHmM: number): SessionReview {
  const percentOfTarget = targetHmM > 0 ? (review.achievedHmM / targetHmM) * 100 : 0
  return {
    ...review,
    targetHmM,
    percentOfTarget,
    differenceHmM: review.achievedHmM - targetHmM,
    verdict:
      percentOfTarget >= 115
        ? 'ruim over'
        : percentOfTarget >= 95
          ? 'gehaald'
          : percentOfTarget >= 85
            ? 'net niet'
            : 'onder doel',
  }
}
