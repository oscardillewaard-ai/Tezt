import { useMemo, useState } from 'react'
import { FAMOUS_RACE_GROUPS, FAMOUS_RACES, type FamousRace } from '../lib/famousRaces'
import {
  deadSourceInfo,
  extractGpxUrl,
  gpxSourceStatus,
  loginRequirement,
} from '../lib/famousRaceSource'

interface FamousRacePanelProps {
  onGoToUpload: () => void
}

function matchesQuery(race: FamousRace, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  return (
    race.name.toLowerCase().includes(q) ||
    race.location.toLowerCase().includes(q) ||
    race.organizer.toLowerCase().includes(q)
  )
}

export function FamousRacePanel({ onGoToUpload }: FamousRacePanelProps) {
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(
    () =>
      FAMOUS_RACES.filter((r) => (group ? r.groupLabel === group : true) && matchesQuery(r, query)),
    [query, group],
  )

  const selected = selectedId ? FAMOUS_RACES.find((r) => r.id === selectedId) ?? null : null
  const gpxUrl = selected ? extractGpxUrl(selected.gpxSource) : null
  const status = selected ? gpxSourceStatus(selected) : null
  const loginNeeded = selected ? loginRequirement(selected) : null
  const deadSource = selected ? deadSourceInfo(selected) : { domain: null, lead: null }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Bekende wedstrijd</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Kies een echte trailrace uit de lijst. Bergtrainer levert geen GPX-bestanden — je krijgt een
        link naar de bron en downloadt de track zelf, waarna je 'm uploadt via "Eigen GPX".
      </p>

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Zoek op naam of locatie…"
        className="mt-4 w-full rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--faint)]"
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setGroup(null)}
          className={`rounded-full px-2.5 py-1 text-xs ${
            group === null
              ? 'bg-orange-400 text-slate-900'
              : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
          }`}
        >
          Alle categorieën
        </button>
        {FAMOUS_RACE_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setGroup(g)}
            className={`rounded-full px-2.5 py-1 text-xs ${
              group === g
                ? 'bg-orange-400 text-slate-900'
                : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-[var(--border-2)]">
        {filtered.length === 0 ? (
          <p className="p-3 text-sm text-[var(--faint)]">Geen wedstrijd gevonden.</p>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`block w-full border-b border-[var(--border-2)] px-3 py-2 text-left text-sm last:border-b-0 ${
                selectedId === r.id
                  ? 'bg-orange-400/10 text-[var(--text)]'
                  : 'text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]'
              }`}
            >
              <span className="font-medium">{r.name}</span>
              <span className="ml-2 text-xs text-[var(--faint)]">{r.location}</span>
            </button>
          ))
        )}
      </div>

      {selected && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-[var(--text-2)]">{selected.name}</p>
              <span className="shrink-0 rounded-full bg-[var(--badge-bg)] px-2 py-0.5 text-[11px] font-medium text-[var(--badge-text)]">
                {selected.category}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--faint)]">
              {selected.organizer} · {selected.location} · {selected.dateLabel}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">Afstand (organisator)</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">{selected.distance}</p>
            </div>
            <div className="rounded-lg bg-[var(--surface-3)] px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-[var(--muted)]">D+ (organisator)</p>
              <p className="mt-1 text-sm font-semibold text-[var(--text)]">{selected.officialDPlus}</p>
            </div>
          </div>
          <p className="text-xs text-[var(--faint)]">
            Let op: afstand/D+ uit een GPX-bestand wijkt vaak 1–5% af van deze organisator-cijfers
            (trackdichtheid, hoogtebron, smoothing) — normaal en geen fout in de GPX.
          </p>

          {status === 'none' ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-[var(--text-2)]">
              <p className="font-medium text-[var(--text)]">Geen publieke GPX beschikbaar</p>
              <p className="mt-1">
                Deze wedstrijd publiceert bewust geen parcoursbestand. Kies een{' '}
                <span className="font-medium">generiek voorbeeldprofiel</span> of vul de klimmen
                handmatig in.
              </p>
              <p className="mt-2 text-xs text-[var(--faint)]">Bron: {selected.gpxSource}</p>
            </div>
          ) : status === 'dead' ? (
            <div className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-[var(--text-2)]">
              <p className="font-medium text-[var(--text)]">Bron bestaat niet meer</p>
              <p className="mt-1">
                {deadSource.domain
                  ? `De vermelde website (${deadSource.domain}) bestaat niet meer.`
                  : 'De vermelde website bestaat niet meer.'}
                {deadSource.lead
                  ? ` Mogelijk is de wedstrijd verhuisd naar ${deadSource.lead} — niet bevestigd.`
                  : ''}
              </p>
              <p className="mt-1">
                Zoek de wedstrijd zelf op bij de organisator en upload de GPX via{' '}
                <span className="font-medium">"Eigen GPX"</span>.
              </p>
              <p className="mt-2 text-xs text-[var(--faint)]">Bron: {selected.gpxSource}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-[var(--border-2)] bg-[var(--surface-3)] px-4 py-3 text-sm">
              <p className="font-medium text-[var(--text)]">Zo kom je aan de GPX</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[var(--text-2)]">
                <li>
                  {gpxUrl ? (
                    <>
                      Ga naar{' '}
                      <a
                        href={gpxUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-500 underline hover:text-orange-400"
                      >
                        {gpxUrl}
                      </a>{' '}
                      en download de GPX.
                    </>
                  ) : (
                    <>Zoek de GPX op via: {selected.gpxSource}</>
                  )}
                </li>
                {loginNeeded && <li>Nodig om te downloaden: {loginNeeded}.</li>}
                {selected.terms !== '—' && <li>Let op: {selected.terms}.</li>}
                <li>
                  Kom terug naar Bergtrainer, kies hierboven <span className="font-medium">"Eigen GPX"</span>{' '}
                  en upload het gedownloade bestand.
                </li>
              </ol>
              {status === 'unverified' && (
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  Deze bron is niet nagelopen: de link volgt het gebruikelijke patroon van de
                  organisator, maar kan verouderd zijn of geen directe GPX bieden. Kom je er niet
                  uit, zoek de wedstrijd dan zelf op bij de organisator.
                </p>
              )}
              <button
                type="button"
                onClick={onGoToUpload}
                className="mt-3 rounded-full bg-orange-400 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-orange-300"
              >
                Ga naar Eigen GPX-upload
              </button>
            </div>
          )}

          <p className="text-[11px] text-[var(--faint)]">
            Bergtrainer host of herverspreidt geen racebestanden — je downloadt zelf rechtstreeks bij
            de bron, met inachtneming van de voorwaarden van de organisator.
          </p>
        </div>
      )}
    </div>
  )
}
