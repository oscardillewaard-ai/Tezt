import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ProfilePoint } from '../lib/gpx'

interface ElevationChartProps {
  profile: ProfilePoint[]
  color: string
}

export function ElevationChart({ profile, color }: ElevationChartProps) {
  const maxDistanceKm = profile[profile.length - 1]?.distanceKm ?? 0
  const decimals = maxDistanceKm < 5 ? 2 : maxDistanceKm < 20 ? 1 : 0

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={profile} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.5} />
            <stop offset="100%" stopColor={color} stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
        <XAxis
          dataKey="distanceKm"
          tickFormatter={(v: number) => `${v.toFixed(decimals)}km`}
          stroke="#64748b"
          fontSize={12}
        />
        <YAxis
          tickFormatter={(v: number) => `${v.toFixed(0)}m`}
          stroke="#64748b"
          fontSize={12}
          width={50}
        />
        <Tooltip
          contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
          labelFormatter={(v) => `${Number(v).toFixed(2)} km`}
          formatter={(v) => [`${Number(v).toFixed(0)} m`, 'hoogte']}
        />
        <Area
          type="monotone"
          dataKey="ele"
          stroke={color}
          fill={`url(#fill-${color})`}
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
