import { useEffect, useRef, useState } from 'react'
import type { RouteStats } from '../lib/gpx'
import { segmentClimbs, segmentDescents } from '../lib/gpx'
import {
  sampleColorAt,
  smoothDigitizedPoints,
  traceCurve,
  type AxisCalibration,
  type RgbColor,
} from '../lib/imageDigitizer'
import { StatCard } from './StatCard'
import { ElevationChart } from './ElevationChart'

interface ImageRacePanelProps {
  onRouteReady: (route: RouteStats) => void
}

type Step = 'upload' | 'x1' | 'x2' | 'y1' | 'y2' | 'curve' | 'processing' | 'result'

const STEP_INSTRUCTIONS: Record<Step, string> = {
  upload: '',
  x1: 'Kies een punt op de x-as (afstand) waarvan je de waarde weet — bijvoorbeeld het beginpunt.',
  x2: 'Kies een tweede punt op de x-as, zo ver mogelijk van het eerste (bijv. het eindpunt).',
  y1: 'Kies een punt op de y-as (hoogte) waarvan je de waarde weet — bijvoorbeeld een gridlijn.',
  y2: 'Kies een tweede punt op de y-as, zo ver mogelijk van het eerste.',
  curve: 'Kies een punt midden op de hoogtelijn zelf. Controleer in het vergrootglas of het kleurbolletje de kleur van de lijn heeft — daarop wordt de lijn nagetekend.',
  processing: 'Bezig met verwerken…',
  result: '',
}

/**
 * Loupe size in CSS pixels, and how much bigger things look inside it than
 * on the page. Magnification is relative to the image *as displayed*, not to
 * its stored pixels: a 900px-wide screenshot squeezed into a 320px phone
 * column would otherwise blow up into a handful of giant blocks with no
 * context around them.
 */
const LOUPE_SIZE = 104
const LOUPE_MAGNIFY = 5

function toHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Where the finger is, in both image pixels and CSS pixels over the canvas,
 * plus the colour under it. Kept while the pointer is down so the loupe can
 * follow the finger and the pick only lands on release — on a phone the
 * finger covers exactly the pixel you're aiming at, so picking on touch-down
 * means aiming blind.
 */
interface Probe {
  px: number
  py: number
  cssX: number
  cssY: number
  /** Image pixels per CSS pixel, so the loupe can size its crop by what's on screen. */
  scale: number
  color: RgbColor
}

function nextStep(step: Step): Step {
  const order: Step[] = ['upload', 'x1', 'x2', 'y1', 'y2', 'curve', 'processing', 'result']
  return order[order.indexOf(step) + 1] ?? 'result'
}

export function ImageRacePanel({ onRouteReady }: ImageRacePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [step, setStep] = useState<Step>('upload')
  const [error, setError] = useState<string | null>(null)
  const [imgSize, setImgSize] = useState<{ w: number; h: number } | null>(null)

  const [x1, setX1] = useState<{ px: number; value?: number } | null>(null)
  const [x2, setX2] = useState<{ px: number; value?: number } | null>(null)
  const [y1, setY1] = useState<{ px: number; value?: number } | null>(null)
  const [y2, setY2] = useState<{ px: number; value?: number } | null>(null)
  const [curveColor, setCurveColor] = useState<RgbColor | null>(null)
  const [pendingPx, setPendingPx] = useState<number | null>(null)
  const [valueInput, setValueInput] = useState('')

  const [result, setResult] = useState<RouteStats | null>(null)
  const [raceName, setRaceName] = useState('Van afbeelding')

  function loadImage(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0)
        setImgSize({ w: img.naturalWidth, h: img.naturalHeight })
        setStep('x1')
        setError(null)
      }
      img.onerror = () => setError('Kon deze afbeelding niet laden.')
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  const canPick = step !== 'upload' && step !== 'processing' && step !== 'result'

  /** Reads the pointer position as image pixels, clamped to the image. */
  function readProbe(e: React.PointerEvent<HTMLCanvasElement>): Probe | null {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return null
    const rect = canvas.getBoundingClientRect()
    const cssX = e.clientX - rect.left
    const cssY = e.clientY - rect.top
    const px = Math.min(canvas.width - 1, Math.max(0, (cssX * canvas.width) / rect.width))
    const py = Math.min(canvas.height - 1, Math.max(0, (cssY * canvas.height) / rect.height))
    return {
      px,
      py,
      cssX,
      cssY,
      scale: canvas.width / rect.width,
      color: sampleColorAt(ctx, px, py),
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canPick) return
    // Capture so the loupe keeps following even when the finger slides off
    // the edge of the image.
    e.currentTarget.setPointerCapture(e.pointerId)
    setProbe(readProbe(e))
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canPick || !probe) return
    setProbe(readProbe(e))
  }

  function handlePointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!canPick) return
    const p = readProbe(e) ?? probe
    setProbe(null)
    if (!p) return

    if (step === 'curve') {
      setCurveColor(p.color)
      void runDigitization(p.color)
      return
    }

    // x1/x2 steps use the horizontal pixel; y1/y2 use the vertical pixel.
    const isXStep = step === 'x1' || step === 'x2'
    setPendingPx(isXStep ? p.px : p.py)
    setValueInput('')
  }

  function confirmValue() {
    const value = parseFloat(valueInput.replace(',', '.'))
    if (pendingPx === null || Number.isNaN(value)) return
    if (step === 'x1') setX1({ px: pendingPx, value })
    else if (step === 'x2') setX2({ px: pendingPx, value })
    else if (step === 'y1') setY1({ px: pendingPx, value })
    else if (step === 'y2') setY2({ px: pendingPx, value })
    setPendingPx(null)
    setValueInput('')
    setStep(nextStep(step))
  }

  async function runDigitization(color: RgbColor) {
    setStep('processing')
    setError(null)
    try {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      // Compare against undefined, not falsiness: 0 is a perfectly normal
      // calibration value (an axis almost always starts at 0 km / 0 m), and
      // a truthiness check would reject it as "not set".
      if (
        !canvas ||
        !ctx ||
        x1?.value === undefined ||
        x2?.value === undefined ||
        y1?.value === undefined ||
        y2?.value === undefined
      ) {
        throw new Error('Kalibratie is onvolledig.')
      }
      const calib: AxisCalibration = {
        x1: { px: x1.px, value: x1.value },
        x2: { px: x2.px, value: x2.value },
        y1: { px: y1.px, value: y1.value },
        y2: { px: y2.px, value: y2.value },
      }

      const raw = traceCurve(ctx, canvas.width, canvas.height, calib, color)
      if (raw.length < 2) {
        throw new Error(
          'Kon geen lijn herkennen met deze kleur. Probeer opnieuw en klik preciezer op de lijn.',
        )
      }
      const smoothed = smoothDigitizedPoints(raw)
      const climbSegments = segmentClimbs(smoothed, 8)
      const descentSegments = segmentDescents(smoothed, 8)
      const gainM = climbSegments.reduce((s, c) => s + c.gainM, 0)
      const lossM = descentSegments.reduce((s, c) => s + c.gainM, 0)
      const distanceKm = smoothed[smoothed.length - 1].distanceKm - smoothed[0].distanceKm

      const route: RouteStats = {
        name: raceName,
        distanceKm,
        gainM,
        lossM,
        profile: smoothed.map((p) => ({
          distanceKm: p.distanceKm - smoothed[0].distanceKm,
          ele: p.ele,
        })),
        climbSegments,
        descentSegments,
      }
      setResult(route)


      setStep('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verwerken is mislukt.')
      setStep('curve')
    }
  }

  function reset() {
    setStep('upload')
    setX1(null)
    setX2(null)
    setY1(null)
    setY2(null)
    setCurveColor(null)
    setPendingPx(null)
    setResult(null)
    setError(null)
    setImgSize(null)
    setProbe(null)
  }

  // Paint the magnified crop under the finger. Drawing in an effect keeps it
  // in step with the probe state without re-rendering the source canvas.
  useEffect(() => {
    const loupe = loupeRef.current
    const source = canvasRef.current
    if (!loupe || !source) return
    const ctx = loupe.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE)
    if (!probe) return
    const cropSize = (LOUPE_SIZE / LOUPE_MAGNIFY) * probe.scale
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      source,
      probe.px - cropSize / 2,
      probe.py - cropSize / 2,
      cropSize,
      cropSize,
      0,
      0,
      LOUPE_SIZE,
      LOUPE_SIZE,
    )

    // Guides: a vertical line for the x-axis steps, horizontal for the y-axis
    // steps, a full crosshair when picking the line's colour. Each is drawn
    // twice — a wide light stroke under a thin dark one — so it stays visible
    // whether the crop is white paper or a dark fill.
    const mid = LOUPE_SIZE / 2
    const line = (x1p: number, y1p: number, x2p: number, y2p: number) => {
      ctx.beginPath()
      ctx.moveTo(x1p, y1p)
      ctx.lineTo(x2p, y2p)
      ctx.stroke()
    }
    const showVertical = step !== 'y1' && step !== 'y2'
    const showHorizontal = step !== 'x1' && step !== 'x2'
    for (const [width, color] of [
      [3, 'rgba(255,255,255,0.85)'],
      [1, 'rgba(17,24,39,0.85)'],
    ] as const) {
      ctx.lineWidth = width
      ctx.strokeStyle = color
      if (showVertical) line(mid, 0, mid, LOUPE_SIZE)
      if (showHorizontal) line(0, mid, LOUPE_SIZE, mid)
    }
  }, [probe, step])

  // The canvas stays mounted even during the upload step: loadImage needs
  // canvasRef.current to draw into before it can advance the step, so
  // rendering the canvas only once the step advanced would deadlock.
  const showCanvas = step !== 'upload'
  const showCalibrationMarkers = step !== 'upload' && step !== 'processing'

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold text-[var(--text)]">Ultrarace uit afbeelding</h2>
      <p className="mt-0.5 text-sm text-[var(--muted)]">
        Upload een screenshot van een hoogteprofiel (bijv. van een race-website). Je kalibreert de
        assen met een paar klikken, daarna wordt de lijn automatisch nagetekend — volledig
        client-side, geen upload naar een server.
      </p>

      {step === 'upload' && (
        <div
          onClick={() => document.getElementById('image-race-input')?.click()}
          className="mt-4 cursor-pointer rounded-xl border-2 border-dashed border-[var(--border-2)] p-6 text-center hover:border-[var(--muted)]"
        >
          <p className="font-medium text-[var(--text-2)]">Sleep een afbeelding hierheen</p>
          <p className="mt-1 text-sm text-[var(--muted)]">of klik om te bladeren</p>
          <input
            id="image-race-input"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadImage(file)
            }}
          />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-[var(--status-warn)]">{error}</p>}

      <div className={showCanvas ? 'mt-4' : 'hidden'}>
        <div>
          {step !== 'result' && step !== 'processing' && step !== 'upload' && (
            <>
              <p className="mb-1 rounded-lg bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-2)]">
                {STEP_INSTRUCTIONS[step]}
              </p>
              <p className="mb-2 text-xs text-[var(--faint)]">
                Houd je vinger (of muisknop) op de afbeelding: het vergrootglas hierboven laat
                uitvergroot zien waar je staat en welke kleur eronder zit. Sleep tot het kruis goed
                staat en laat dan los — pas bij loslaten wordt het punt gekozen. Scrollen doe je
                naast de afbeelding.
              </p>
            </>
          )}
          {step === 'processing' && (
            <p className="mb-2 rounded-lg bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-2)]">
              Lijn wordt nagetekend…
            </p>
          )}

          {/* The loupe sits above the image in its own reserved row: a
              phone's image is often shorter than the loupe, so an overlay
              following the finger would spill out of the card, and letting
              it appear only while probing would shift the image out from
              under the finger that summoned it. */}
          {canPick && (
            <div className="mb-2 flex items-center gap-3">
              <canvas
                ref={loupeRef}
                width={LOUPE_SIZE}
                height={LOUPE_SIZE}
                aria-label="Vergrootglas"
                className="shrink-0 rounded-lg border border-[var(--border-2)] bg-[var(--surface-3)]"
                style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
              />
              <div className="min-w-0 text-xs">
                {probe ? (
                  <>
                    <p className="flex items-center gap-1.5 font-medium text-[var(--text-2)]">
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-[var(--border-2)]"
                        style={{
                          background: `rgb(${probe.color.r},${probe.color.g},${probe.color.b})`,
                        }}
                      />
                      {toHex(probe.color)}
                    </p>
                    <p className="mt-1 text-[var(--faint)]">
                      {step === 'curve'
                        ? 'Dit is de kleur waarop de lijn wordt nagetekend.'
                        : step === 'x1' || step === 'x2'
                          ? 'Zet de verticale lijn precies op je ijkpunt.'
                          : 'Zet de horizontale lijn precies op je ijkpunt.'}
                    </p>
                    <p className="mt-1 text-[var(--faint)]">Laat los om te kiezen.</p>
                  </>
                ) : (
                  <p className="text-[var(--faint)]">
                    Houd je vinger op de afbeelding — hier zie je uitvergroot waar je staat en welke
                    kleur eronder zit.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="relative">
            <canvas
              ref={canvasRef}
              aria-label="Hoogteprofiel-afbeelding"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setProbe(null)}
              className="w-full max-w-full cursor-crosshair touch-none select-none rounded-lg border border-[var(--border-2)]"
              style={{ imageRendering: 'pixelated' }}
            />

            {/* Where the axis points landed, drawn over the image so you can
                see what you picked instead of only reading the numbers. */}
            {showCalibrationMarkers && imgSize && (
              <>
                {[x1, x2].map((m, i) =>
                  m ? (
                    <div
                      key={`x${i}`}
                      className="pointer-events-none absolute inset-y-0 w-px bg-orange-400/80"
                      style={{ left: `${(m.px / imgSize.w) * 100}%` }}
                    />
                  ) : null,
                )}
                {[y1, y2].map((m, i) =>
                  m ? (
                    <div
                      key={`y${i}`}
                      className="pointer-events-none absolute inset-x-0 h-px bg-emerald-400/80"
                      style={{ top: `${(m.px / imgSize.h) * 100}%` }}
                    />
                  ) : null,
                )}
              </>
            )}

            {/* Live crosshair: your fingertip covers the pixel you're aiming
                at, so the lines run the full width and height of the image
                and stay visible around it. */}
            {probe && imgSize && (
              <>
                {step !== 'y1' && step !== 'y2' && (
                  <div
                    className="pointer-events-none absolute inset-y-0 w-px bg-orange-500"
                    style={{ left: `${(probe.px / imgSize.w) * 100}%` }}
                  />
                )}
                {step !== 'x1' && step !== 'x2' && (
                  <div
                    className="pointer-events-none absolute inset-x-0 h-px bg-orange-500"
                    style={{ top: `${(probe.py / imgSize.h) * 100}%` }}
                  />
                )}
              </>
            )}
          </div>

          {pendingPx !== null && (
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                autoFocus
                value={valueInput}
                onChange={(e) => setValueInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmValue()}
                placeholder={step === 'x1' || step === 'x2' ? 'km' : 'meter'}
                className="w-32 rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
              />
              <button
                type="button"
                onClick={confirmValue}
                className="rounded-md bg-orange-400 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-orange-300"
              >
                Bevestigen
              </button>
            </div>
          )}

          {showCalibrationMarkers && imgSize && (
            <p className="mt-2 text-xs text-[var(--faint)]">
              {x1 && `x1: ${x1.value ?? '?'}km  `}
              {x2 && `x2: ${x2.value ?? '?'}km  `}
              {y1 && `y1: ${y1.value ?? '?'}m  `}
              {y2 && `y2: ${y2.value ?? '?'}m`}
            </p>
          )}

          {step === 'result' && result && (
            <div className="mt-5 space-y-4">
              {curveColor && (
                <p className="flex items-center gap-2 text-xs text-[var(--faint)]">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-[var(--border-2)]"
                    style={{
                      background: `rgb(${curveColor.r}, ${curveColor.g}, ${curveColor.b})`,
                    }}
                  />
                  Lijn nagetekend op deze kleur
                </p>
              )}
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  Naam wedstrijd
                </span>
                <input
                  type="text"
                  value={raceName}
                  onChange={(e) => setRaceName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[var(--border-2)] bg-[var(--surface-2)] px-3 py-1.5 text-[var(--text)]"
                />
              </label>

              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Afstand" value={`${result.distanceKm.toFixed(1)} km`} />
                <StatCard label="D+" value={`${result.gainM.toFixed(0)} m`} />
                <StatCard label="D-" value={`${result.lossM.toFixed(0)} m`} />
              </div>
              <ElevationChart profile={result.profile} color="#f97316" />

              <p className="text-xs text-[var(--faint)]">
                Vergelijk deze afstand en D+ met wat er op de afbeelding staat. Wijkt het af, klik
                dan opnieuw en zet de ijkpunten preciezer op de as.
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onRouteReady({ ...result, name: raceName })}
                  className="rounded-md bg-orange-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-orange-300"
                >
                  Gebruik deze wedstrijd
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="rounded-md border border-[var(--border-2)] px-4 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-2-hover)]"
                >
                  Opnieuw
                </button>
              </div>
            </div>
          )}

          {step !== 'result' && step !== 'upload' && (
            <button
              type="button"
              onClick={reset}
              className="mt-3 text-sm text-[var(--muted)] underline decoration-dotted hover:text-[var(--text-2)]"
            >
              Opnieuw beginnen
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
