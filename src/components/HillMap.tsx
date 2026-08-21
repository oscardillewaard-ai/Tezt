import { FLANK_COLORS, type TracedFlank } from '../lib/flankVisuals'

interface HillMapProps {
  flanks: TracedFlank[]
  height?: number
}

/**
 * Top-down plan of the hill: each flank drawn from its own foot up to the
 * shared summit, in metres relative to that summit. Coordinates come
 * straight from the GPS trace, so this is the hill's real shape rather than
 * a sketch.
 */
export function HillMap({ flanks, height = 260 }: HillMapProps) {
  const pts = flanks.flatMap((f) => f.trace)
  if (pts.length === 0) return null

  const pad = 24
  const minX = Math.min(...pts.map((p) => p.x))
  const maxX = Math.max(...pts.map((p) => p.x))
  const minY = Math.min(...pts.map((p) => p.y))
  const maxY = Math.max(...pts.map((p) => p.y))
  const spanX = Math.max(1, maxX - minX)
  const spanY = Math.max(1, maxY - minY)
  // Keep one scale for both axes so the plan isn't stretched.
  const width = 640
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY)
  const cx = (x: number) => pad + (x - minX) * scale + ((width - pad * 2) - spanX * scale) / 2
  // SVG y grows downward, north should point up.
  const cy = (y: number) => height - pad - (y - minY) * scale - ((height - pad * 2) - spanY * scale) / 2

  const scaleBarM = spanX > 400 ? 100 : spanX > 150 ? 50 : 20
  const scaleBarPx = scaleBarM * scale

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[320px] rounded-lg bg-[var(--surface-3)]"
        role="img"
        aria-label="Bovenaanzicht van de heuvel met de flanken"
      >
        {flanks.map((f, i) => (
          <polyline
            key={f.id}
            points={f.trace.map((p) => `${cx(p.x).toFixed(1)},${cy(p.y).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={FLANK_COLORS[i % FLANK_COLORS.length]}
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {flanks.map((f, i) => {
          const foot = f.trace[0]
          if (!foot) return null
          return (
            <g key={`${f.id}-foot`}>
              <circle
                cx={cx(foot.x)}
                cy={cy(foot.y)}
                r={4}
                fill={FLANK_COLORS[i % FLANK_COLORS.length]}
              />
              <text
                x={cx(foot.x)}
                y={cy(foot.y) - 8}
                textAnchor="middle"
                className="fill-[var(--text-2)]"
                fontSize={11}
              >
                {f.aspect}
              </text>
            </g>
          )
        })}

        {/* summit sits at the local origin by construction */}
        <circle cx={cx(0)} cy={cy(0)} r={5} className="fill-[var(--text)]" />
        <text x={cx(0)} y={cy(0) - 10} textAnchor="middle" className="fill-[var(--text)]" fontSize={11}>
          top
        </text>

        <g transform={`translate(${pad}, ${height - 12})`}>
          <line x1={0} y1={0} x2={scaleBarPx} y2={0} className="stroke-[var(--muted)]" strokeWidth={2} />
          <text x={scaleBarPx + 6} y={4} className="fill-[var(--muted)]" fontSize={10}>
            {scaleBarM} m
          </text>
        </g>
        <g transform={`translate(${width - pad}, ${pad})`}>
          <line x1={0} y1={10} x2={0} y2={-6} className="stroke-[var(--muted)]" strokeWidth={2} />
          <polygon points="0,-10 -4,-2 4,-2" className="fill-[var(--muted)]" />
          <text x={0} y={22} textAnchor="middle" className="fill-[var(--muted)]" fontSize={10}>
            N
          </text>
        </g>
      </svg>
    </div>
  )
}
