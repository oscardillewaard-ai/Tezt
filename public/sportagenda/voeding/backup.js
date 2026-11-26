// Voeding in de gewone Tarapp-back-up (Meer → Back-up en herstellen).
// app.js laadt dit bestand alleen bij exporteren of terugzetten.
// Het dagboek-id en de tokens voor de Worker gaan bewust niet mee (net als de
// Parkenjacht-koppeling): een teruggezette telefoon krijgt een eigen dagboek en
// stuurt alle regels daar opnieuw heen.

import { SCHEMA_VERSIE, schoonRegel } from './kern.js'
import { alle, bewaarInstellingen, leesInstellingen, migreerInstellingen, wisAlles, zetVeel } from './opslag.js'

/** Alles van Voeding als één object, of null als er (nog) niets is. */
export async function exporteer() {
  const [producten, dagboek] = await Promise.all([alle('producten'), alle('dagboek')])
  const instellingen = leesInstellingen()
  if (!producten.length && !dagboek.length && !instellingen.persoon) return null
  return {
    schema: SCHEMA_VERSIE,
    instellingen,
    producten,
    dagboek: dagboek.map(({ dirty: _dirty, ...r }) => r),
  }
}

/** Een back-up terugzetten (vervangt wat er nu in Voeding staat). Oudere schema's worden omgezet. */
export async function importeer(data) {
  if (!data || typeof data !== 'object') throw new Error('Geen Voeding-gegevens in deze back-up')
  const migrated = migreerBackup(data)
  await wisAlles()
  await zetVeel('producten', migrated.producten)
  await zetVeel('dagboek', migrated.dagboek.map((r) => ({ ...r, dirty: 1 })))
  bewaarInstellingen(migrated.instellingen)
  return migrated
}

/** Back-up van een oudere schemaversie naar de huidige. */
export function migreerBackup(data) {
  const schema = Number(data.schema) || 1
  if (schema > SCHEMA_VERSIE) throw new Error('Deze back-up komt uit een nieuwere Tarapp. Werk de app eerst bij.')
  // schema 1 is de eerste versie; volgende versies krijgen hier hun eigen stap.
  return {
    schema: SCHEMA_VERSIE,
    instellingen: migreerInstellingen(data.instellingen),
    producten: (Array.isArray(data.producten) ? data.producten : []).filter((p) => p && typeof p.id === 'string' && typeof p.naam === 'string'),
    dagboek: (Array.isArray(data.dagboek) ? data.dagboek : []).map(schoonRegel).filter(Boolean),
  }
}
