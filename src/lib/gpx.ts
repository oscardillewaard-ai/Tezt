export interface TrackPoint {
  lat: number
  lon: number
  ele: number
  distanceKm: number
}

export interface ProfilePoint {
  distanceKm: number
  ele: number
}

export interface RouteStats {
  name: string
  distanceKm: number
  gainM: number
  lossM: number
  profile: ProfilePoint[]
}

const EARTH_RADIUS_M = 6371000

function haversineMeters(a: TrackPoint, b: { lat: number; lon: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))
}

export function parseGpx(xmlText: string, fallbackName: string): RouteStats {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) {
    throw new Error('Dit bestand kon niet als GPX worden gelezen.')
  }

  const trkpts = Array.from(doc.getElementsByTagName('trkpt'))
  const source = trkpts.length > 0 ? trkpts : Array.from(doc.getElementsByTagName('rtept'))
  if (source.length < 2) {
    throw new Error('Geen (voldoende) trackpunten gevonden in dit GPX-bestand.')
  }

  const rawName = doc.querySelector('trk > name, metadata > name')?.textContent?.trim()
  const name = rawName && rawName.length > 0 ? rawName : fallbackName

  const points: TrackPoint[] = []
  let cumulativeDistanceM = 0

  for (const pt of source) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '')
    const lon = parseFloat(pt.getAttribute('lon') ?? '')
    const eleText = pt.getElementsByTagName('ele')[0]?.textContent
    const ele = eleText !== undefined && eleText !== null ? parseFloat(eleText) : NaN
    if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(ele)) continue

    const prev = points[points.length - 1]
    if (prev) {
      cumulativeDistanceM += haversineMeters(prev, { lat, lon })
    }
    points.push({ lat, lon, ele, distanceKm: cumulativeDistanceM / 1000 })
  }

  if (points.length < 2) {
    throw new Error('Dit GPX-bestand bevat geen bruikbare hoogtedata.')
  }

  // Smooth elevation with a small moving average to reduce GPS/barometer noise
  // before summing gain/loss, otherwise jitter wildly overstates D+.
  const windowSize = 5
  const smoothed = points.map((_, i) => {
    const start = Math.max(0, i - windowSize)
    const end = Math.min(points.length, i + windowSize + 1)
    const slice = points.slice(start, end)
    return slice.reduce((sum, p) => sum + p.ele, 0) / slice.length
  })

  let gainM = 0
  let lossM = 0
  const minDelta = 1 // meters, ignore sub-meter noise between consecutive smoothed points
  for (let i = 1; i < smoothed.length; i++) {
    const delta = smoothed[i] - smoothed[i - 1]
    if (delta > minDelta) gainM += delta
    else if (delta < -minDelta) lossM += -delta
  }

  const distanceKm = points[points.length - 1].distanceKm

  // Resample to a bounded number of points for charting/storage.
  const maxProfilePoints = 300
  const step = Math.max(1, Math.floor(points.length / maxProfilePoints))
  const profile: ProfilePoint[] = []
  for (let i = 0; i < points.length; i += step) {
    profile.push({ distanceKm: points[i].distanceKm, ele: points[i].ele })
  }
  const last = points[points.length - 1]
  if (profile[profile.length - 1]?.distanceKm !== last.distanceKm) {
    profile.push({ distanceKm: last.distanceKm, ele: last.ele })
  }

  return { name, distanceKm, gainM, lossM, profile }
}
