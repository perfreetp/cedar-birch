import { useCallback, useMemo, useRef, useState } from 'react'
import type { ArrivalCurve, Vec2 } from '../../core/types.ts'
import { sampleCurve } from '../../core/geometry.ts'

/**
 * 到达曲线编辑器: 拖动控制点调整 (时间, 到达率).
 * - 单击空白处添加点
 * - 拖动点移动, 右键/双击删除
 * - 端点可横向拖动
 */
export function CurveEditor({
  curve,
  duration,
  onChange,
  height = 150,
  readOnly,
  curves,
}: {
  curve: ArrivalCurve
  duration: number
  onChange: (points: Vec2[], commit: boolean) => void
  height?: number
  readOnly?: boolean
  curves?: ArrivalCurve[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const W = 320
  const H = height
  const padL = 28
  const padR = 8
  const padT = 10
  const padB = 18

  const points = curve.points
  const maxRate = useMemo(() => {
    let m = 10
    for (const c of curves ?? [curve]) for (const p of c.points) m = Math.max(m, p[1])
    return Math.ceil(m / 10) * 10
  }, [curve, curves])

  const xOf = (t: number) => padL + (t / Math.max(1, duration)) * (W - padL - padR)
  const yOf = (v: number) => H - padB - (v / maxRate) * (H - padT - padB)
  const tOf = (x: number) => Math.max(0, Math.min(duration, ((x - padL) / (W - padL - padR)) * duration))
  const vOf = (y: number) => Math.max(0, ((H - padB - y) / (H - padT - padB)) * maxRate)

  const pos = useCallback((ev: React.PointerEvent | PointerEvent) => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    }
  }, [])

  const path = useMemo(() => {
    if (!points.length) return ''
    const sorted = [...points].sort((a, b) => a[0] - b[0])
    let d = ''
    for (let t = 0; t <= duration; t += Math.max(1, duration / 160)) {
      const v = sampleCurve(sorted, t)
      const x = xOf(t)
      const y = yOf(v)
      d += `${d ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`
    }
    return d
  }, [points, duration, maxRate, H])

  const areaPath = useMemo(() => {
    if (!path) return ''
    return `${path}L${xOf(duration)},${H - padB}L${padL},${H - padB}Z`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  const handlePointerDown = (i: number) => (ev: React.PointerEvent) => {
    if (readOnly) return
    ev.stopPropagation()
    ;(ev.target as Element).setPointerCapture(ev.pointerId)
    setDrag(i)
  }

  const handlePointerMove = (ev: React.PointerEvent) => {
    if (drag === null || readOnly) return
    const p = pos(ev)
    const next = points.map((q) => [...q] as Vec2)
    const t = Math.max(0, Math.min(duration, tOf(p.x)))
    const v = Math.max(0, vOf(p.y))
    next[drag] = [round(t, 1), round(v, 1)]
    // 保证时间单调
    const sorted = [...next].sort((a, b) => a[0] - b[0])
    onChange(sorted, false)
  }

  const handlePointerUp = () => {
    if (drag !== null) {
      onChange(points, true)
      setDrag(null)
    }
  }

  const addPoint = (ev: React.MouseEvent) => {
    if (readOnly) return
    const p = pos(ev as unknown as React.PointerEvent)
    const t = Math.max(0, Math.min(duration, tOf(p.x)))
    const v = Math.max(0, vOf(p.y))
    const next = [...points, [round(t, 1), round(v, 1)] as Vec2].sort((a, b) => a[0] - b[0])
    onChange(next, true)
  }

  const removePoint = (i: number) => (ev: React.MouseEvent) => {
    ev.stopPropagation()
    if (readOnly || points.length <= 2) return
    onChange(points.filter((_, k) => k !== i), true)
  }

  return (
    <div className="curve-editor">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={addPoint}
      >
        <defs>
          <linearGradient id={`cg-${curve.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={curve.color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={curve.color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* 网格 */}
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <line
            key={k}
            x1={padL}
            x2={W - padR}
            y1={padT + (H - padT - padB) * k}
            y2={padT + (H - padT - padB) * k}
            stroke="#1e2836"
            strokeWidth="1"
          />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <line
            key={k}
            y1={padT}
            y2={H - padB}
            x1={padL + (W - padL - padR) * k}
            x2={padL + (W - padL - padR) * k}
            stroke="#1e2836"
            strokeWidth="1"
          />
        ))}
        {/* 其他曲线 */}
        {(curves ?? []).filter((c) => c.id !== curve.id).map((c) => {
          let d = ''
          for (let t = 0; t <= duration; t += Math.max(2, duration / 80)) {
            d += `${d ? 'L' : 'M'}${xOf(t).toFixed(1)},${yOf(sampleCurve(c.points, t)).toFixed(1)}`
          }
          return <path key={c.id} d={d} fill="none" stroke={c.color} strokeWidth="1" opacity="0.28" />
        })}
        <path d={areaPath} fill={`url(#cg-${curve.id})`} />
        <path d={path} fill="none" stroke={curve.color} strokeWidth="1.8" />
        {/* 控制点 */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={xOf(p[0])}
              cy={yOf(p[1])}
              r={drag === i ? 5 : 3.6}
              fill="#0b0e14"
              stroke={curve.color}
              strokeWidth="1.8"
              style={{ cursor: readOnly ? 'default' : 'grab' }}
              onPointerDown={handlePointerDown(i)}
              onContextMenu={removePoint(i)}
            />
          </g>
        ))}
        {/* 轴标签 */}
        <text x={4} y={12} fill="#6f7f96" fontSize="8">
          {maxRate}
        </text>
        <text x={4} y={H - padB + 2} fill="#6f7f96" fontSize="8">
          0
        </text>
        <text x={padL} y={H - 4} fill="#6f7f96" fontSize="8">
          0s
        </text>
        <text x={W - padR} y={H - 4} fill="#6f7f96" fontSize="8" textAnchor="end">
          {Math.round(duration)}s
        </text>
        <text x={(padL + W - padR) / 2} y={H - 4} fill="#4b586b" fontSize="8" textAnchor="middle">
          双击空白添加控制点 · 右键删除
        </text>
      </svg>
    </div>
  )
}

function round(v: number, d: number): number {
  const k = 10 ** d
  return Math.round(v * k) / k
}
