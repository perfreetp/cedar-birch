import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {value !== undefined && <span className="val">{value}</span>}
      </label>
      {children}
    </div>
  )
}

export function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step = 0.1,
  unit,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
  disabled?: boolean
}) {
  const [text, setText] = useState(String(value))
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(String(round(value)))
  }, [value])
  const commit = (t: string) => {
    const n = Number(t)
    if (Number.isFinite(n)) onChange(clampNum(n, min, max))
    else setText(String(round(value)))
  }
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        {unit && <span className="val">{unit}</span>}
      </label>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          commit(text)
        }}
        onChange={(e) => {
          setText(e.target.value)
          commit(e.target.value)
        }}
      />
    </div>
  )
}

export function SliderField({
  fieldKey,
  label,
  value,
  onChange,
  min,
  max,
  step,
  fmt,
  unit,
  disabled,
}: {
  fieldKey?: string
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
  fmt?: (v: number) => string
  unit?: string
  disabled?: boolean
}) {
  return (
    <div className="field" data-key={fieldKey}>
      <label>
        <span>{label}</span>
        <span className="val">
          {fmt ? fmt(value) : value}
          {unit ? ` ${unit}` : ''}
        </span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}



export function TextField({
  label,
  value,
  onChange,
  placeholder,
  mono,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <div className="field">
      <label>
        <span>{label}</span>
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        style={mono ? { fontFamily: 'var(--mono)' } : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  hint?: string
}) {
  return (
    <label className="check-row" title={hint}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Section({
  title,
  children,
  badge,
  defaultOpen = true,
  right,
}: {
  title: string
  children: ReactNode
  badge?: ReactNode
  defaultOpen?: boolean
  right?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`section ${open ? 'open' : ''}`}>
      <div className="section-head" onClick={() => setOpen((o) => !o)}>
        <span className="section-chevron">▶</span>
        <span>{title}</span>
        {badge !== undefined && <span className="section-badge">{badge}</span>}
        {right && (
          <span style={{ marginLeft: 'auto' }} onClick={(e) => e.stopPropagation()}>
            {right}
          </span>
        )}
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="tl-speed" style={{ display: 'flex' }}>
      {options.map((o) => (
        <button
          key={o.value}
          className={o.value === value ? 'active' : ''}
          style={{ flex: 1, padding: '4px 6px', fontSize: 11 }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>
}

export function clampNum(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min
  if (max !== undefined && v > max) return max
  return v
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000
}

export function fmtTime(t: number): string {
  if (!Number.isFinite(t)) return '--:--'
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${String(m).padStart(2, '0')}:${sec.toFixed(1).padStart(4, '0')}`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  narrow,
}: {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  narrow?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`modal ${narrow ? 'narrow' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <div style={{ marginLeft: 'auto' }}>
            <button className="btn icon ghost" onClick={onClose} title="关闭 (Esc)">
              ✕
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
