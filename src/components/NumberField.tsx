import { useState } from 'react'

interface NumberFieldProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  className?: string
}

/**
 * A number input whose displayed text is independent of the clamped value.
 * A plain controlled <input type="number"> that clamps on every keystroke
 * makes the field un-clearable: backspacing to "" immediately snaps back to
 * min, so you can never retype a new value. Here the text can go empty or
 * transiently invalid while typing; clamping only happens once there's a
 * parseable number, and the display is normalized on blur.
 */
export function NumberField({ value, onChange, min, max, step, className }: NumberFieldProps) {
  const [text, setText] = useState(String(value))
  // Resync the text when the value changes from outside (e.g. the paired
  // slider). Done during render rather than in an effect so there's no
  // extra commit showing the stale text first.
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(String(value))
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        setText(raw)
        if (raw === '') return
        const n = Number(raw)
        if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
      }}
      onBlur={() => {
        const n = Math.min(max, Math.max(min, Number(text) || value))
        setText(String(n))
        onChange(n)
      }}
      className={className}
    />
  )
}
