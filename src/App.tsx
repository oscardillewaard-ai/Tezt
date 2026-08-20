import { useEffect, useState } from 'react'
import type { RouteStats } from './lib/gpx'
import { BUILTIN_HILLS, type TrainingHill } from './lib/hills'
import { BUILTIN_RACE_ARCHETYPES, generateSyntheticRace, type RaceArchetype } from './lib/syntheticRaces'
import { useLocalStorageState } from './lib/useLocalStorageState'
import {
  deleteBerg,
  deleteRace,
  listBergen,
  listRaces,
  saveBerg,
  saveRace,
} from './lib/storage'
import { RoutePanel } from './components/RoutePanel'
import { HillPanel } from './components/HillPanel'
import { RacePresetPanel } from './components/RacePresetPanel'
import { TrainingPlan } from './components/TrainingPlan'
import { FlankTrainingPlan } from './components/FlankTrainingPlan'
import { OnboardingModal } from './components/OnboardingModal'

type BergMode = 'gpx' | 'hill'
type RaceMode = 'gpx' | 'preset'
type UiMode = 'simple' | 'advanced'
type Theme = 'light' | 'dark'

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

function App() {
  const [hasOnboarded, setHasOnboarded] = useLocalStorageState('bergtrainer:onboarded', false)
  const [uiMode, setUiMode] = useLocalStorageState<UiMode>('bergtrainer:ui-mode', 'simple')
  const [theme, setTheme] = useLocalStorageState<Theme>(
    'bergtrainer:theme',
    systemPrefersDark() ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#020617' : '#f8fafc')
  }, [theme])

  const [race, setRace] = useState<RouteStats | null>(null)
  const [racePreset, setRacePreset] = useState<RaceArchetype | null>(null)
  const [raceDistanceKm, setRaceDistanceKm] = useState<number>(0)
  const [raceMode, setRaceMode] = useState<RaceMode>('gpx')
  const [berg, setBerg] = useState<RouteStats | null>(null)
  const [hill, setHill] = useState<TrainingHill | null>(BUILTIN_HILLS[0] ?? null)
  const [bergMode, setBergMode] = useState<BergMode>('hill')
  const [savedRaces, setSavedRaces] = useState(listRaces)
  const [savedBergen, setSavedBergen] = useState(listBergen)

  const effectiveRace: RouteStats | null =
    raceMode === 'preset'
      ? racePreset
        ? generateSyntheticRace(racePreset, raceDistanceKm || racePreset.defaultDistanceKm)
        : null
      : race

  return (
    <div className="min-h-svh bg-[var(--bg)] text-[var(--text)]">
      {!hasOnboarded && <OnboardingModal onDismiss={() => setHasOnboarded(true)} />}
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="no-print mb-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-[var(--text)]">Bergtrainer</h1>
              <p className="mt-2 text-[var(--muted)]">
                Upload de GPX van je ultrarace en kies je trainingsberg. Bergtrainer matcht elke
                klim uit de wedstrijd op de flank met de dichtstbijzijnde helling en bouwt daar een
                trainingsschema omheen tot wedstrijddag.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Weergavemodus"
              className="flex shrink-0 gap-1 rounded-full bg-[var(--nav-bg)] p-1"
            >
              <button
                type="button"
                role="radio"
                aria-checked={uiMode === 'simple'}
                onClick={() => setUiMode('simple')}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  uiMode === 'simple'
                    ? 'bg-[var(--surface-2-active)] text-[var(--text)]'
                    : 'text-[var(--muted)] hover:text-[var(--text-2)]'
                }`}
              >
                Eenvoudig
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={uiMode === 'advanced'}
                onClick={() => setUiMode('advanced')}
                className={`rounded-full px-3 py-1.5 text-sm ${
                  uiMode === 'advanced'
                    ? 'bg-[var(--surface-2-active)] text-[var(--text)]'
                    : 'text-[var(--muted)] hover:text-[var(--text-2)]'
                }`}
              >
                Uitgebreid
              </button>
            </div>
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
              title={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--nav-bg)] text-[var(--text-2)] hover:text-[var(--text)]"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
          </div>
        </header>

        <div className="no-print grid gap-6 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRaceMode('gpx')}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                  raceMode === 'gpx'
                    ? 'bg-orange-400 text-slate-900'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
                }`}
              >
                Eigen GPX
              </button>
              <button
                type="button"
                onClick={() => setRaceMode('preset')}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                  raceMode === 'preset'
                    ? 'bg-orange-400 text-slate-900'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
                }`}
              >
                Voorbeeldwedstrijd
              </button>
            </div>

            {raceMode === 'gpx' ? (
              <RoutePanel
                title="Ultrarace"
                description="De GPX-track van de wedstrijd waar je je op voorbereidt."
                color="#f97316"
                accentClass="border-orange-400 bg-orange-400/5"
                route={race}
                onRouteChange={setRace}
                saved={savedRaces}
                onSave={(r) => setSavedRaces([saveRace(r), ...savedRaces])}
                onDeleteSaved={(id) => {
                  deleteRace(id)
                  setSavedRaces(savedRaces.filter((s) => s.id !== id))
                }}
              />
            ) : (
              <RacePresetPanel
                archetypes={BUILTIN_RACE_ARCHETYPES}
                selected={racePreset}
                onSelect={(a) => {
                  setRacePreset(a)
                  setRaceDistanceKm(a.defaultDistanceKm)
                }}
                distanceKm={raceDistanceKm || (racePreset?.defaultDistanceKm ?? 0)}
                onDistanceChange={setRaceDistanceKm}
              />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setBergMode('hill')}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                  bergMode === 'hill'
                    ? 'bg-emerald-400 text-slate-900'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
                }`}
              >
                Vaste heuvel
              </button>
              <button
                type="button"
                onClick={() => setBergMode('gpx')}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                  bergMode === 'gpx'
                    ? 'bg-emerald-400 text-slate-900'
                    : 'bg-[var(--surface-2)] text-[var(--text-3)] hover:bg-[var(--surface-2-hover)]'
                }`}
              >
                Eigen GPX
              </button>
            </div>

            {bergMode === 'hill' ? (
              <HillPanel hills={BUILTIN_HILLS} selected={hill} onSelect={setHill} />
            ) : (
              <RoutePanel
                title="Trainingsberg"
                description="Eén ronde/beklimming van de berg waar je traint."
                color="#34d399"
                accentClass="border-emerald-400 bg-emerald-400/5"
                route={berg}
                onRouteChange={setBerg}
                saved={savedBergen}
                onSave={(r) => setSavedBergen([saveBerg(r), ...savedBergen])}
                onDeleteSaved={(id) => {
                  deleteBerg(id)
                  setSavedBergen(savedBergen.filter((s) => s.id !== id))
                }}
              />
            )}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 print:border-0 print:bg-white print:p-0">
          {bergMode === 'hill' && effectiveRace && hill ? (
            <FlankTrainingPlan race={effectiveRace} hill={hill} advanced={uiMode === 'advanced'} />
          ) : bergMode === 'gpx' && effectiveRace && berg ? (
            <TrainingPlan race={effectiveRace} berg={berg} advanced={uiMode === 'advanced'} />
          ) : (
            <p className="text-sm text-[var(--faint)]">
              {bergMode === 'hill'
                ? 'Kies een wedstrijd en een heuvel om een trainingsplan te zien.'
                : 'Kies zowel een wedstrijd als een trainingsberg-GPX om een trainingsplan te zien.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
