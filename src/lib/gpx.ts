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

export interface ClimbSegment {
  startDistanceKm: number
  endDistanceKm: number
  /** Vertical magnitude in meters — elevation gained (climbs) or lost (descents). Always positive. */
  gainM: number
  lengthM: number
  gradientPercent: number
}

export interface RouteStats {
  name: string
  distanceKm: number
  gainM: number
  lossM: number
  profile: ProfilePoint[]
  climbSegments: ClimbSegment[]
  /**
   * Individual descents, same shape as climbSegments. A pendel flank is
   * climbed and descended over the same ground, so a race descent needs a
   * flank match just as much as a race climb does — matching climbs alone
   * would ignore how steep the way down actually is.
   */
  descentSegments: ClimbSegment[]
}

interface ElevationSwing {
  startIdx: number
  endIdx: number
  deltaM: number
}

/**
 * Splits an elevation trace into alternating climb/descent swings using a
 * zigzag-style reversal filter: a trend only flips once elevation reverses by
 * more than the threshold from its running extreme. This is independent of
 * point spacing, unlike thresholding the delta between adjacent points
 * directly — a dense track (e.g. a 1Hz GPS log at hiking pace) can have a
 * legitimate per-point elevation change well under a meter even on a steep
 * climb, so a fixed per-point threshold would silently zero it out.
 */
function segmentSwings(
  points: { distanceKm: number; ele: number }[],
  reversalThresholdM: number,
): ElevationSwing[] {
  if (points.length < 2) return []

  const swings: ElevationSwing[] = []
  const pushSwing = (startIdx: number, endIdx: number) => {
    const deltaM = points[endIdx].ele - points[startIdx].ele
    if (deltaM === 0) return
    swings.push({ startIdx, endIdx, deltaM })
  }

  let extremeIdx = 0
  let dir: 1 | -1 | 0 = 0
  let runExtremeIdx = 0

  for (let i = 1; i < points.length; i++) {
    if (dir === 0) {
      const delta = points[i].ele - points[extremeIdx].ele
      if (Math.abs(delta) >= reversalThresholdM) {
        dir = delta > 0 ? 1 : -1
        runExtremeIdx = i
      }
      continue
    }

    const runExtreme = points[runExtremeIdx].ele
    if (dir === 1) {
      if (points[i].ele >= runExtreme) {
        runExtremeIdx = i
      } else if (runExtreme - points[i].ele >= reversalThresholdM) {
        pushSwing(extremeIdx, runExtremeIdx)
        extremeIdx = runExtremeIdx
        dir = -1
        runExtremeIdx = i
      }
    } else {
      if (points[i].ele <= runExtreme) {
        runExtremeIdx = i
      } else if (points[i].ele - runExtreme >= reversalThresholdM) {
        pushSwing(extremeIdx, runExtremeIdx)
        extremeIdx = runExtremeIdx
        dir = 1
        runExtremeIdx = i
      }
    }
  }

  pushSwing(extremeIdx, runExtremeIdx)

  return swings
}

function swingsToSegments(
  points: { distanceKm: number; ele: number }[],
  swings: ElevationSwing[],
  direction: 'climb' | 'descent',
): ClimbSegment[] {
  const segments: ClimbSegment[] = []
  for (const swing of swings) {
    if (direction === 'climb' ? swing.deltaM <= 0 : swing.deltaM >= 0) continue
    const start = points[swing.startIdx]
    const end = points[swing.endIdx]
    const lengthM = (end.distanceKm - start.distanceKm) * 1000
    if (lengthM <= 0) continue
    const magnitudeM = Math.abs(swing.deltaM)
    segments.push({
      startDistanceKm: start.distanceKm,
      endDistanceKm: end.distanceKm,
      gainM: magnitudeM,
      lengthM,
      gradientPercent: (magnitudeM / lengthM) * 100,
    })
  }
  return segments
}

/** Splits an elevation trace into individual climbs, filtering out reversals under the threshold. */
export function segmentClimbs(
  points: { distanceKm: number; ele: number }[],
  reversalThresholdM = 8,
): ClimbSegment[] {
  return swingsToSegments(points, segmentSwings(points, reversalThresholdM), 'climb')
}

/** Splits an elevation trace into individual descents, filtering out reversals under the threshold. */
export function segmentDescents(
  points: { distanceKm: number; ele: number }[],
  reversalThresholdM = 8,
): ClimbSegment[] {
  return swingsToSegments(points, segmentSwings(points, reversalThresholdM), 'descent')
}

/** Total elevation gain and loss from the same reversal-filtered swings, so totals stay consistent with the climb list. */
function totalGainLoss(
  points: { distanceKm: number; ele: number }[],
  reversalThresholdM: number,
): { gainM: number; lossM: number } {
  const swings = segmentSwings(points, reversalThresholdM)
  let gainM = 0
  let lossM = 0
  for (const swing of swings) {
    if (swing.deltaM > 0) gainM += swing.deltaM
    else lossM += -swing.deltaM
  }
  return { gainM, lossM }
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

/**
 * Finds descendants by local name, ignoring any namespace prefix. GPX files
 * are namespaced, and while a default xmlns leaves tagName bare ("trkpt"),
 * exporters that use an explicit prefix produce "gpx:trkpt" — which
 * getElementsByTagName(name) does not match, since on XML documents it
 * compares the full qualified name.
 */
function byLocalName(root: Document | Element, localName: string): Element[] {
  const all = root.getElementsByTagName('*')
  const out: Element[] = []
  for (let i = 0; i < all.length; i++) {
    const el = all[i]
    if ((el.localName ?? el.nodeName).toLowerCase() === localName) out.push(el)
  }
  return out
}

export function parseGpx(xmlText: string, fallbackName: string): RouteStats {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml')
  const parserError = doc.getElementsByTagName('parsererror')[0]
  if (parserError) {
    throw new Error('Dit bestand kon niet als GPX worden gelezen.')
  }

  const trkpts = byLocalName(doc, 'trkpt')
  const source = trkpts.length > 0 ? trkpts : byLocalName(doc, 'rtept')
  if (source.length < 2) {
    throw new Error('Geen (voldoende) trackpunten gevonden in dit GPX-bestand.')
  }

  // Prefer the track's own name, then the file metadata's. A bare "first
  // <name> anywhere" would often pick up the author or a waypoint instead.
  const trkEl = byLocalName(doc, 'trk')[0] ?? byLocalName(doc, 'rte')[0]
  const metadataEl = byLocalName(doc, 'metadata')[0]
  const rawName =
    (trkEl ? byLocalName(trkEl, 'name')[0]?.textContent?.trim() : undefined) ??
    (metadataEl ? byLocalName(metadataEl, 'name')[0]?.textContent?.trim() : undefined)
  const name = rawName && rawName.length > 0 ? rawName : fallbackName

  // Read coordinates first, keeping elevation optional. A point without <ele>
  // must not be dropped: plenty of exports carry elevation on only some
  // points (or none at all), and discarding those points used to throw away
  // the whole track. Missing values are interpolated from their neighbours
  // below instead.
  const raw: { lat: number; lon: number; ele: number | null }[] = []
  for (const pt of source) {
    const lat = parseFloat(pt.getAttribute('lat') ?? '')
    const lon = parseFloat(pt.getAttribute('lon') ?? '')
    if (Number.isNaN(lat) || Number.isNaN(lon)) continue
    const eleText = byLocalName(pt, 'ele')[0]?.textContent
    const parsed = eleText != null ? parseFloat(eleText) : NaN
    raw.push({ lat, lon, ele: Number.isNaN(parsed) ? null : parsed })
  }

  if (raw.length < 2) {
    throw new Error('Dit GPX-bestand bevat geen bruikbare coördinaten.')
  }
  if (raw.every((p) => p.ele === null)) {
    throw new Error(
      'Dit GPX-bestand bevat geen hoogtedata (alleen coördinaten). Exporteer de route opnieuw mét hoogteprofiel.',
    )
  }

  // Fill gaps: interpolate between known elevations, extend flat at the ends.
  const firstKnown = raw.findIndex((p) => p.ele !== null)
  const lastKnown = raw.length - 1 - [...raw].reverse().findIndex((p) => p.ele !== null)
  for (let i = 0; i < raw.length; i++) {
    if (raw[i].ele !== null) continue
    if (i < firstKnown) {
      raw[i].ele = raw[firstKnown].ele
      continue
    }
    if (i > lastKnown) {
      raw[i].ele = raw[lastKnown].ele
      continue
    }
    let left = i - 1
    while (left >= 0 && raw[left].ele === null) left--
    let right = i + 1
    while (right < raw.length && raw[right].ele === null) right++
    const lv = raw[left].ele as number
    const rv = raw[right].ele as number
    raw[i].ele = lv + ((rv - lv) * (i - left)) / (right - left)
  }

  const points: TrackPoint[] = []
  let cumulativeDistanceM = 0

  for (const { lat, lon, ele: maybeEle } of raw) {
    const ele = maybeEle as number
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

  const distanceKm = points[points.length - 1].distanceKm

  const smoothedTrace = points.map((p, i) => ({ distanceKm: p.distanceKm, ele: smoothed[i] }))
  // A tighter threshold for the headline D+/D- totals so small rollers still
  // count; a coarser one for the climb list so gradient-matching isn't
  // fragmented by noise-sized micro-segments.
  const { gainM, lossM } = totalGainLoss(smoothedTrace, 3)
  const climbSegments = segmentClimbs(smoothedTrace, 8)
  const descentSegments = segmentDescents(smoothedTrace, 8)

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

  return { name, distanceKm, gainM, lossM, profile, climbSegments, descentSegments }
}
