import { useEffect, useMemo, useRef, useState } from 'react'
import { useSim } from '../../state/store.ts'
import { fmtTime } from './controls.tsx'
import type { LiveClient } from '../../state/liveClient.ts'

export interface TimelineMarker {
  time: number
  label: string
  kind: 'gate' | 'start' | 'end'
}

/**
 * 时间轴: 200ms 一帧的密度序列。
 * 拖动 = 逐帧预览 (缓存命中) 或回退重算; 松手后停在目标帧。
 * 顶部的柱状图为各帧最大密度 / 占用人数, 便于快速定位拥堵。
 */
export function Timeline({
  client,
  markers,
  onFrameInfo,
  aboveLegend,
}: {
  client: LiveClient
  markers: TimelineMarker[]
  onFrameInfo?: (frame: number, time: number) => void
  aboveLegend?: boolean
}) {
  const playhead = useSim((s) => s.playhead)
  const duration = useSim((s) => s.duration)
  const running = useSim((s) => s.running)
  const speed = useSim((s) => s.speed)
  const frameStart = useSim((s) => s.frameStart)
  const frameEnd = useSim((s) => s.frameEnd)
  const stats = useSim((s) => s.stats)
  const recomputing = useSim((s) => s.recomputing)
  const recomputeProgress = useSim((s) => s.recomputeProgress)
  const info = useSim((s) => s.info)
  const [dragging, setDragging] = useState(false)
  const trackRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const [barSamples, setBarSamples] = useState<{ time: number; occ: number; maxD: number }[]>([])
  const sampleRef = useRef<Map<number, { time: number; occ: number; maxD: number }>>(new Map())
  const lastPlayheadRef = useRef(0)
  const simSeconds = duration

  // 帧序列被重置 (帧数回落) 时清空历史采样
  useEffect(() => {
    if (frameEnd <= 1 && sampleRef.current.size > 0) {
      sampleRef.current.clear()
      setBarSamples([])
    }
  }, [frameEnd])

  // 采样帧统计 -> 柱状图 (仅记录, 不触发重渲染风暴: 2 秒节流)
  useEffect(() => {
    if (!stats) return
    const bucket = Math.round(stats.time * 2) / 2
    sampleRef.current.set(bucket, { time: bucket, occ: stats.occupancy, maxD: stats.maxDensity })
    const now = performance.now()
    if (now - lastPlayheadRef.current > 900) {
      lastPlayheadRef.current = now
      const arr = [...sampleRef.current.values()].sort((a, b) => a.time - b.time)
      setBarSamples(arr.slice(-400))
    }
  }, [stats])

  const maxOcc = useMemo(() => Math.max(10, ...barSamples.map((s) => s.occ)), [barSamples])
  const maxD = useMemo(() => Math.max(2, ...barSamples.map((s) => s.maxD)), [barSamples])

  const barFor = (t: number): { occ: number; maxD: number } | null => {
    let best: { occ: number; maxD: number } | null = null
    let bestD = Infinity
    for (const s of barSamples) {
      const d = Math.abs(s.time - t)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return bestD < 3 ? best : null
  }

  const timeAt = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const k = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return k * simSeconds
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    const el = trackRef.current
    if (!el) return
    el.setPointerCapture(ev.pointerId)
    setDragging(true)
    client.pause()
    const t = timeAt(ev.clientX)
    client.seek(t)
    onFrameInfo?.(Math.round(t / 0.2), t)
  }
  const onPointerMove = (ev: React.PointerEvent) => {
    if (!dragging) return
    const t = timeAt(ev.clientX)
    client.seek(t)
    onFrameInfo?.(Math.round(t / 0.2), t)
  }
  const onPointerUp = () => {
    if (dragging) {
      setDragging(false)
    }
  }

  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / Math.max(0.001, simSeconds)) * 100))}%`
  const cachedFrames = Math.max(0, frameEnd - frameStart)
  const interval = 0.2
  const cachedTo = frameEnd * interval

  return (
    <div className={`timeline ${aboveLegend ? 'above-legend' : ''}`}>
      <div className="tl-controls">
        <button className="tl-btn" onClick={() => client.seek(0)} title="回到开头">
          ⏮
        </button>
        <button
          className="tl-btn"
          onClick={() => client.seek(Math.max(0, playhead - interval * 5))}
          title="后退 1 秒"
        >
          ◀◀
        </button>
        <button className="tl-btn play" onClick={() => client.toggle()} title="播放 / 暂停 (空格)">
          {running ? '❚❚' : '▶'}
        </button>
        <button
          className="tl-btn"
          onClick={() => client.seek(Math.min(simSeconds, playhead + interval * 5))}
          title="前进 1 秒"
        >
          ▶▶
        </button>
        <div className="tl-time">
          {fmtTime(playhead)} <span className="dur">/ {fmtTime(simSeconds)}</span>
        </div>
        <div className="tl-speed tl-speed-full">
          {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
            <button key={s} className={speed === s ? 'active' : ''} onClick={() => client.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <select
          className="tl-speed-select"
          value={speed}
          onChange={(e) => client.setSpeed(Number(e.target.value))}
          title="播放速度"
        >
          {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <div className="tl-spacer" />
        {recomputing ? (
          <span className="tag amber tl-status" title="闸机权重变更后, 从当前帧向后重算">
            <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />
            联动重算 {Math.round(recomputeProgress * 100)}%
          </span>
        ) : (
          <span className="tag tl-status" title="已缓存的帧数 / 总帧数">
            帧 {Math.floor(playhead / interval)} · 缓存 {cachedFrames}
            {info ? ` · 目标 ${Math.ceil(duration / interval)}` : ''}
          </span>
        )}
        <button className="btn sm tl-opt" onClick={() => client.reset()} title="清空并重新开始">
          重置
        </button>
        <button
          className="btn sm tl-opt"
          onClick={() => {
            client.pause()
            client.seek(Math.min(simSeconds, playhead + interval))
            onFrameInfo?.(0, 0)
          }}
          title="前进一帧 (200ms)"
        >
          +1 帧
        </button>
      </div>

      <div className="tl-track-wrap">
        <div
          className="tl-track"
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: dragging ? 'grabbing' : 'pointer' }}
        >
          <div className="tl-bars" ref={barsRef}>
            {Array.from({ length: 80 }).map((_, i) => {
              const t = (i / 79) * simSeconds
              const b = barFor(t)
              if (!b) return <div key={i} className="tl-bar" style={{ opacity: 0.06 }} />
              const h = Math.max(0.06, Math.min(1, b.occ / maxOcc))
              const heat = Math.min(1, b.maxD / Math.max(2, maxD))
              return (
                <div
                  key={i}
                  className="tl-bar"
                  style={{
                    height: `${h * 100}%`,
                    opacity: 0.3 + heat * 0.6,
                    background:
                      heat > 0.75
                        ? 'linear-gradient(180deg,#f87171,#f59e0b)'
                        : heat > 0.4
                          ? 'linear-gradient(180deg,#fcd34d,#38bdf8)'
                          : 'linear-gradient(180deg,#38bdf8,#1e3a8a)',
                  }}
                  title={`${fmtTime(t)}  ${b.occ} 人  ρmax ${b.maxD.toFixed(2)}`}
                />
              )
            })}
          </div>
          <div className="tl-cached" style={{ width: pct(cachedTo) }} />
          <div className="tl-progress" style={{ width: pct(playhead) }} />
          {markers.map((m, i) => (
            <div key={i} className="tl-marker" style={{ left: pct(m.time) }} data-label={m.label} />
          ))}
          <div className="tl-head" style={{ left: pct(playhead) }} />
        </div>
        <div className="tl-ruler">
          {[0, 0.2, 0.4, 0.6, 0.8, 1].map((k) => (
            <span key={k}>{fmtTime(simSeconds * k)}</span>
          ))}
        </div>
      </div>
      {import.meta.env.DEV && dragging ? <div className="hint">拖动中</div> : null}
    </div>
  )
}
