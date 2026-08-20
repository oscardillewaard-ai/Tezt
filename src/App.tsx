import { useState } from 'react'
import type { RouteStats } from './lib/gpx'
import { BUILTIN_HILLS, type TrainingHill } from './lib/hills'
import { BUILTIN_RACE_ARCHETYPES, generateSyntheticRace, type RaceArchetype } from './lib/syntheticRaces'
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

type BergMode = 'gpx' | 'hill'
type RaceMode = 'gpx' | 'preset'

function App() {
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
    <div className="min-h-svh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-100">Bergtrainer</h1>
          <p className="mt-2 text-slate-400">
            Upload de GPX van je ultrarace en kies je trainingsberg. Bergtrainer matcht elke klim
            uit de wedstrijd op de flank met de dichtstbijzijnde helling en bouwt daar een
            trainingsschema omheen tot wedstrijddag.
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRaceMode('gpx')}
                className={`flex-1 rounded-full px-3 py-1.5 text-sm ${
                  raceMode === 'gpx'
                    ? 'bg-orange-400 text-slate-900'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          {bergMode === 'hill' && effectiveRace && hill ? (
            <FlankTrainingPlan race={effectiveRace} hill={hill} />
          ) : bergMode === 'gpx' && effectiveRace && berg ? (
            <TrainingPlan race={effectiveRace} berg={berg} />
          ) : (
            <p className="text-sm text-slate-500">
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
