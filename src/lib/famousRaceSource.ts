import type { FamousRace } from './famousRaces'

/**
 * How much a race's GPX source line can be trusted. The manifest records
 * research of varying certainty, and sending someone to a dead or unchecked
 * link is worse than telling them it is unchecked.
 */
export type GpxSourceStatus = 'listed' | 'unverified' | 'dead' | 'none'

export function gpxSourceStatus(race: FamousRace): GpxSourceStatus {
  const source = race.gpxSource.toLowerCase()
  if (source.includes('no public gpx')) return 'none'
  if (source.includes('no longer resolves')) return 'dead'
  if (
    source.includes('(verify') ||
    source.includes('not confirmed') ||
    source.includes('not found') ||
    race.login.toLowerCase().includes('verify')
  ) {
    return 'unverified'
  }
  return 'listed'
}

/**
 * What the reader needs in order to download, in plain Dutch. The manifest's
 * `login` column carries research markers ("verify", "—") that must not reach
 * the screen; null means "say nothing about this".
 */
export function loginRequirement(race: FamousRace): string | null {
  const login = race.login.trim()
  const normalized = login.toLowerCase()
  if (normalized === 'no' || normalized === '—' || normalized === 'n/a') return null
  // Bare "verify" only records that nobody checked — the unverified warning covers that.
  if (normalized === 'verify') return null
  if (normalized === 'verify/yes') return 'Waarschijnlijk een (gratis) account, niet zeker'
  return login
}

/**
 * Pulls the two facts worth showing for a dead source out of the manifest's
 * note. The phrasing ("<domain> no longer resolves", "unconfirmed lead
 * <domain>") is written by us in races.json and is the contract here; anything
 * that doesn't match simply yields null and the raw note is shown instead.
 */
export function deadSourceInfo(race: FamousRace): { domain: string | null; lead: string | null } {
  return {
    domain: race.gpxSource.match(/^([\w.-]+) no longer resolves/)?.[1] ?? null,
    lead: race.gpxSource.match(/unconfirmed lead ([\w.-]+)/)?.[1] ?? null,
  }
}

/** First http(s) URL in a gpxSource string, if any — for a clickable link. */
export function extractGpxUrl(gpxSource: string): string | null {
  const match = gpxSource.match(/https?:\/\/[^\s;()]+/)
  return match ? match[0].replace(/[),.]+$/, '') : null
}
