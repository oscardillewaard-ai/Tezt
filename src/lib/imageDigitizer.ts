export interface AxisPoint {
  /** Pixel coordinate on the image (x for the x-axis, y for the y-axis). */
  px: number
  /** The real-world value (km for x, meters for y) that pixel represents. */
  value: number
}

export interface AxisCalibration {
  x1: AxisPoint
  x2: AxisPoint
  y1: AxisPoint
  y2: AxisPoint
}

export interface RgbColor {
  r: number
  g: number
  b: number
}

function pixelToValue(px: number, a: AxisPoint, b: AxisPoint): number {
  if (a.px === b.px) return a.value
  return a.value + ((px - a.px) * (b.value - a.value)) / (b.px - a.px)
}

export function pixelXToDistanceKm(px: number, calib: AxisCalibration): number {
  return pixelToValue(px, calib.x1, calib.x2)
}

export function pixelYToElevationM(py: number, calib: AxisCalibration): number {
  return pixelToValue(py, calib.y1, calib.y2)
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2)
}

export function sampleColorAt(ctx: CanvasRenderingContext2D, x: number, y: number): RgbColor {
  const [r, g, b] = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
  return { r, g, b }
}

export interface DigitizedPoint {
  distanceKm: number
  ele: number
}

/**
 * Traces a chart line by scanning each pixel column between the two x-axis
 * calibration points for pixels close to `curveColor`, averaging matches per
 * column, and linearly interpolating columns with no match. Column-by-column
 * scanning (rather than trying to fit a single curve) handles the sub-pixel
 * jitter and anti-aliasing of a real screenshot without needing edge
 * detection or ML.
 */
export function traceCurve(
  ctx: CanvasRenderingContext2D,
  imageWidth: number,
  imageHeight: number,
  calib: AxisCalibration,
  curveColor: RgbColor,
  tolerance = 60,
): DigitizedPoint[] {
  const xStart = Math.max(0, Math.round(Math.min(calib.x1.px, calib.x2.px)))
  const xEnd = Math.min(imageWidth - 1, Math.round(Math.max(calib.x1.px, calib.x2.px)))
  if (xEnd <= xStart) return []

  const { data } = ctx.getImageData(xStart, 0, xEnd - xStart + 1, imageHeight)
  const columnY: (number | null)[] = []

  // Take the topmost matching pixel per column, not an average. Elevation
  // charts are almost always drawn as a filled area under the line (often
  // with a height-varying gradient fill, e.g. green-to-yellow toward
  // peaks) — the line itself sits at the top of that fill, so the topmost
  // match is correct whether the color sample landed on the thin stroke or
  // on the fill beneath it, and it isn't dragged toward the middle of a
  // tall filled column the way an average would be.
  for (let x = xStart; x <= xEnd; x++) {
    let topY: number | null = null
    for (let y = 0; y < imageHeight; y++) {
      const idx = (y * (xEnd - xStart + 1) + (x - xStart)) * 4
      const px: RgbColor = { r: data[idx], g: data[idx + 1], b: data[idx + 2] }
      if (colorDistance(px, curveColor) <= tolerance) {
        topY = y
        break
      }
    }
    columnY.push(topY)
  }

  // Fill gaps by linear interpolation between the nearest valid columns.
  const filled = [...columnY]
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== null) continue
    let left = i - 1
    while (left >= 0 && filled[left] === null) left--
    let right = i + 1
    while (right < filled.length && filled[right] === null) right++
    if (left >= 0 && right < filled.length) {
      const lv = filled[left] as number
      const rv = filled[right] as number
      filled[i] = lv + ((rv - lv) * (i - left)) / (right - left)
    } else if (left >= 0) {
      filled[i] = filled[left]
    } else if (right < filled.length) {
      filled[i] = filled[right]
    }
  }

  const points: DigitizedPoint[] = []
  for (let i = 0; i < filled.length; i++) {
    const y = filled[i]
    if (y === null) continue
    const x = xStart + i
    points.push({
      distanceKm: pixelXToDistanceKm(x, calib),
      ele: pixelYToElevationM(y, calib),
    })
  }

  // Calibration clicks aren't guaranteed left-to-right.
  points.sort((a, b) => a.distanceKm - b.distanceKm)
  return points
}

/** Small moving average to smooth pixel-level jitter before handing off to the app's segmentation logic. */
export function smoothDigitizedPoints(points: DigitizedPoint[], windowSize = 3): DigitizedPoint[] {
  return points.map((_, i) => {
    const start = Math.max(0, i - windowSize)
    const end = Math.min(points.length, i + windowSize + 1)
    const slice = points.slice(start, end)
    const ele = slice.reduce((s, p) => s + p.ele, 0) / slice.length
    return { distanceKm: points[i].distanceKm, ele }
  })
}
