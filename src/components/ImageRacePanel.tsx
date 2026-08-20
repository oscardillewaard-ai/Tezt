import { useRef, useState } from 'react'
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
  x1: 'Klik op een punt op de x-as (afstand) waarvan je de waarde weet — bijvoorbeeld het beginpunt.',
  x2: 'Klik op een tweede punt op de x-as, zo ver mogelijk van het eerste (bijv. het eindpunt).',
  y1: 'Klik op een punt op de y-as (hoogte) waarvan je de waarde weet — bijvoorbeeld een gridlijn.',
  y2: 'Klik op een tweede punt op de y-as, zo ver mogelijk van het eerste.',
  curve: 'Klik ergens midden op de hoogtelijn zelf, zodat de kleur herkend kan worden.',
  processing: 'Bezig met verwerken…',
  result: '',
}

function nextStep(step: Step): Step {
  const order: Step[] = ['upload', 'x1', 'x2', 'y1', 'y2', 'curve', 'processing', 'result']
  return order[order.indexOf(step) + 1] ?? 'result'
}

export function ImageRacePanel({ onRouteReady }: ImageRacePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas || step === 'upload' || step === 'processing' || step === 'result') return
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const px = (e.clientX - rect.left) * scaleX
    const py = (e.clientY - rect.top) * scaleY

    if (step === 'curve') {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const color = sampleColorAt(ctx, px, py)
      setCurveColor(color)
      void runDigitization(color)
      return
    }

    // x1/x2 steps use the horizontal pixel; y1/y2 use the vertical pixel.
    const isXStep = step === 'x1' || step === 'x2'
    setPendingPx(isXStep ? px : py)
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
  }

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
            <p className="mb-2 rounded-lg bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-2)]">
              {STEP_INSTRUCTIONS[step]}
            </p>
          )}
          {step === 'processing' && (
            <p className="mb-2 rounded-lg bg-[var(--surface-3)] px-3 py-2 text-sm text-[var(--text-2)]">
              Lijn wordt nagetekend…
            </p>
          )}

          <div className="overflow-x-auto">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="w-full max-w-full cursor-crosshair rounded-lg border border-[var(--border-2)]"
              style={{ imageRendering: 'pixelated' }}
            />
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
