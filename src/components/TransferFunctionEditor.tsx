import { useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { Channel } from '../types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 可拖动的传输函数编辑器:上方不透明度曲线(含直方图背景),下方颜色停靠点色带 */
export function TransferFunctionEditor() {
  const activeChannel = useStore((s) => s.activeChannel)
  const volumeChannel = useStore((s) => s.volumeChannel)
  const tf = useStore((s) => s.tf[s.activeChannel])
  const histograms = useStore((s) => s.histograms)
  const setTF = useStore((s) => s.setTF)
  const setActiveChannel = useStore((s) => s.setActiveChannel)
  const setVolumeChannel = useStore((s) => s.setVolumeChannel)

  const [selColor, setSelColor] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  const update = (next: typeof tf) => setTF(activeChannel, next)

  // ---------- 不透明度停靠点 ----------
  const svgPos = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    return {
      t: clamp01((e.clientX - r.left) / r.width),
      v: clamp01(1 - (e.clientY - r.top) / r.height),
    }
  }

  const dragOpacity = (i: number) => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    e.stopPropagation()
  }
  const moveOpacity = (i: number) => (e: React.PointerEvent) => {
    if (!(e.buttons & 1)) return
    const { t, v } = svgPos(e)
    const stops = tf.opacityStops.map((s, j) => (j === i ? { t, v } : s))
    update({ ...tf, opacityStops: stops })
  }
  const removeOpacity = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (tf.opacityStops.length <= 1) return
    update({ ...tf, opacityStops: tf.opacityStops.filter((_, j) => j !== i) })
  }
  const addOpacity = (e: React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect()
    const t = clamp01((e.clientX - r.left) / r.width)
    const v = clamp01(1 - (e.clientY - r.top) / r.height)
    update({ ...tf, opacityStops: [...tf.opacityStops, { t, v }] })
  }

  // ---------- 颜色停靠点 ----------
  const barT = (e: PointerEvent | React.PointerEvent) => {
    const r = barRef.current!.getBoundingClientRect()
    return clamp01((e.clientX - r.left) / r.width)
  }
  const startDragColor = (i: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    setSelColor(i)
    const move = (ev: PointerEvent) => {
      const t = barT(ev)
      const stops = tf.colorStops.map((s, j) => (j === i ? { ...s, t } : s))
      update({ ...tf, colorStops: stops })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const addColor = (e: React.MouseEvent) => {
    const t = barT(e as unknown as PointerEvent)
    // 取当前渐变在该位置的颜色作为新停靠点颜色
    const stops = [...tf.colorStops].sort((a, b) => a.t - b.t)
    let color = '#ffffff'
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k].t && t <= stops[k + 1].t) {
        color = stops[k].color
        break
      }
    }
    update({ ...tf, colorStops: [...tf.colorStops, { t, color }] })
    setSelColor(tf.colorStops.length)
  }
  const removeColor = (i: number) => {
    if (tf.colorStops.length <= 1) return
    update({ ...tf, colorStops: tf.colorStops.filter((_, j) => j !== i) })
    setSelColor(null)
  }
  const setColor = (color: string) => {
    if (selColor === null) return
    update({ ...tf, colorStops: tf.colorStops.map((s, j) => (j === selColor ? { ...s, color } : s)) })
  }

  // ---------- 直方图 ----------
  const hist = histograms?.[activeChannel]
  let histPath = ''
  if (hist) {
    const max = Math.max(1, ...hist)
    const pts = hist.map((v, i) => {
      const x = (i / (hist.length - 1)) * 100
      const y = 100 - (Math.log(1 + v) / Math.log(1 + max)) * 100
      return `${x.toFixed(2)},${y.toFixed(1)}`
    })
    histPath = `M0,100 L${pts.join(' L')} L100,100 Z`
  }

  const sortedOpacity = [...tf.opacityStops].sort((a, b) => a.t - b.t)
  const opacityLine = sortedOpacity.map((s) => `${s.t * 100},${(1 - s.v) * 100}`).join(' ')
  const gradient = `linear-gradient(to right, ${[...tf.colorStops]
    .sort((a, b) => a.t - b.t)
    .map((s) => `${s.color} ${(s.t * 100).toFixed(1)}%`)
    .join(', ')})`

  const channels: { key: Channel; label: string }[] = [
    { key: 'temp', label: '温度' },
    { key: 'speed', label: '流速' },
  ]

  return (
    <section className="panel">
      <h2>传输函数</h2>
      <div className="tab-row">
        {channels.map((c) => (
          <button
            key={c.key}
            className={activeChannel === c.key ? 'tab active' : 'tab'}
            onClick={() => setActiveChannel(c.key)}
          >
            {c.label}
          </button>
        ))}
        <label className="vol-ch">
          体渲染
          <input
            type="checkbox"
            checked={volumeChannel === activeChannel}
            onChange={(e) => e.target.checked && setVolumeChannel(activeChannel)}
          />
        </label>
      </div>

      <div className="tf-opacity" onDoubleClick={addOpacity}>
        <svg ref={svgRef} viewBox="0 0 100 100" preserveAspectRatio="none">
          {histPath && <path d={histPath} className="tf-hist" />}
          <polyline points={opacityLine} className="tf-line" />
          {tf.opacityStops.map((s, i) => (
            <circle
              key={i}
              cx={s.t * 100}
              cy={(1 - s.v) * 100}
              r={3.2}
              className="tf-stop"
              onPointerDown={dragOpacity(i)}
              onPointerMove={moveOpacity(i)}
              onDoubleClick={removeOpacity(i)}
            />
          ))}
        </svg>
      </div>
      <div className="hint">拖动调整 · 双击空白添加 · 双击停靠点删除</div>

      <div className="tf-bar-wrap" ref={barRef} onDoubleClick={addColor}>
        <div className="tf-bar" style={{ background: gradient }} />
        {tf.colorStops.map((s, i) => (
          <div
            key={i}
            className={selColor === i ? 'tf-handle selected' : 'tf-handle'}
            style={{ left: `${s.t * 100}%`, background: s.color }}
            onPointerDown={startDragColor(i)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              removeColor(i)
            }}
          />
        ))}
      </div>
      <div className="tf-color-row">
        <input
          type="color"
          value={selColor !== null ? tf.colorStops[selColor]?.color ?? '#ffffff' : '#ffffff'}
          onChange={(e) => setColor(e.target.value)}
          disabled={selColor === null}
        />
        <span className="hint">{selColor !== null ? `停靠点 #${selColor + 1}` : '点击色带手柄选择'}</span>
      </div>
    </section>
  )
}
