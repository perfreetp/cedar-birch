import { useEffect, useRef } from 'react'
import { DENSITY_BANDS, OVERLOAD_COLOR, bandColorCSS } from '../../core/format.ts'
import { useSim } from '../../state/store.ts'

export function Legend({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const stats = useSim((s) => s.stats)
  const bands = stats?.bandCounts ?? [0, 0, 0, 0, 0, 0]
  const total = bands.reduce((a, b) => a + b, 0)
  if (collapsed) {
    return (
      <button className="btn sm" style={{ position: 'absolute', right: 10, bottom: 10, zIndex: 10 }} onClick={onToggle}>
        图例
      </button>
    )
  }
  return (
    <div className="legend">
      <div className="legend-title">
        <span>密度 人/m²</span>
        <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={onToggle} title="收起">
          ▾
        </button>
      </div>
      {DENSITY_BANDS.map((b, i) => (
        <div className="legend-row" key={i}>
          <span className="legend-swatch" style={{ background: bandColorCSS((b.min + b.max) / 2) }} />
          <span>
            {b.label}
            {i === 0 && <span style={{ color: 'var(--text-3)' }}> 起</span>}
          </span>
          <span className="n">{total ? `${((bands[i] / total) * 100).toFixed(0)}%` : '—'}</span>
        </div>
      ))}
      <div className="legend-row">
        <span className="legend-swatch" style={{ background: `rgb(${OVERLOAD_COLOR.map((c) => Math.round(c * 255)).join(',')})` }} />
        <span>&gt; 6.0 超载</span>
        <span className="n">{total ? `${((bands[5] / total) * 100).toFixed(0)}%` : '—'}</span>
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        峰值 {stats ? stats.maxDensity.toFixed(2) : '—'} 人/m²
      </div>
    </div>
  )
}

/** 鼠标位置的密度读数 */
export function DensityReadout({
  position,
  density,
  pos,
}: {
  position: { x: number; y: number } | null
  density: number | null
  pos: { x: number; z: number }
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !position) return
    el.style.left = `${position.x}px`
    el.style.top = `${position.y}px`
  }, [position])
  if (!position) return null
  return (
    <div className="readout" ref={ref}>
      <span className="lbl">x</span>
      {pos.x.toFixed(1)}
      <span className="lbl" style={{ marginLeft: 8 }}>
        z
      </span>
      {pos.z.toFixed(1)}
      <span className="lbl" style={{ marginLeft: 8 }}>
        ρ
      </span>
      <span style={{ color: density && density >= 4.9 ? '#f87171' : density && density >= 2.6 ? '#fcd34d' : '#7dd3fc' }}>
        {density === null ? '—' : `${density.toFixed(2)}`}
      </span>
      <span className="lbl">人/m²</span>
    </div>
  )
}
