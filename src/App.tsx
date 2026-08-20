import { useState } from 'react'
import type { RouteStats } from './lib/gpx'
import {
  deleteBerg,
  deleteRace,
  listBergen,
  listRaces,
  saveBerg,
  saveRace,
} from './lib/storage'
import { RoutePanel } from './components/RoutePanel'
import { TrainingPlan } from './components/TrainingPlan'

function App() {
  const [race, setRace] = useState<RouteStats | null>(null)
  const [berg, setBerg] = useState<RouteStats | null>(null)
  const [savedRaces, setSavedRaces] = useState(listRaces)
  const [savedBergen, setSavedBergen] = useState(listBergen)

  return (
    <div className="min-h-svh bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-100">Bergtrainer</h1>
          <p className="mt-2 text-slate-400">
            Upload de GPX van je ultrarace en van jouw trainingsberg. Bergtrainer rekent uit
            hoeveel keer je die berg op moet om dezelfde hoogtemeters te trainen — en bouwt daar
            een schema omheen tot wedstrijddag.
          </p>
        </header>

        <div className="grid gap-6 sm:grid-cols-2">
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
          <RoutePanel
            title="Trainingsberg"
            description="Eén ronde/beklimming van de berg (bijv. skiberg) waar je traint."
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
        </div>

        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          {race && berg ? (
            <TrainingPlan race={race} berg={berg} />
          ) : (
            <p className="text-sm text-slate-500">
              Upload zowel een wedstrijd-GPX als een trainingsberg-GPX om een trainingsplan te
              zien.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
