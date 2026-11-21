import { useMemo, useRef, useState } from 'react'
import { useApp, useSim } from '../../state/store.ts'
import { Section, Empty, fmtTime } from '../components/controls.tsx'
import type { LiveClient } from '../../state/liveClient.ts'

/**
 * 回放中的闸机联动面板:
 * 每个通道一条滑杆, 改动立即从当前帧向后重算 (节流: 松手才应用).
 * 也提供整组闸机的统一权重调整.
 */
export function GatePanel({ client, onEdit }: { client: LiveClient | null; onEdit: (id: string) => void }) {
  const doc = useApp((s) => s.doc)
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const setObstacle = useApp((s) => s.setObstacle)
  const playhead = useSim((s) => s.playhead)
  const recomputing = useSim((s) => s.recomputing)
  const progress = useSim((s) => s.recomputeProgress)
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const lastApply = useRef<Map<string, number>>(new Map())

  const gates = useMemo(() => doc.obstacles.filter((o) => o.kind === 'gate' && o.enabled), [doc.obstacles])
  const pendingGate = selection.kind === 'obstacle' ? selection.id : null

  const applyLane = (obstacleId: string, laneIndex: number, weight: number) => {
    const o = doc.obstacles.find((x) => x.id === obstacleId)
    if (!o) return
    const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
    const gw = o.gateWeights ? [...o.gateWeights] : new Array(lanes).fill(o.weight)
    gw[laneIndex] = weight
    const gc = o.gateCapacities ? [...o.gateCapacities] : new Array(lanes).fill(o.capacity / lanes)
    setObstacle(obstacleId, { gateWeights: gw }, '调整通道权重')
    client?.setGateWeights([{ obstacleId, laneIndex, weight, capacity: gc[laneIndex] }])
  }

  const applyAll = (obstacleId: string, weight: number) => {
    const o = doc.obstacles.find((x) => x.id === obstacleId)
    if (!o) return
    const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
    setObstacle(obstacleId, { weight, gateWeights: new Array(lanes).fill(weight) }, '调整闸机权重')
    client?.setGateWeights([{ obstacleId, weight }])
  }

  return (
    <Section
      title="闸机联动"
      badge={recomputing ? `${Math.round(progress * 100)}%` : `${gates.length} 组`}
      right={
        recomputing ? (
          <span className="spinner" style={{ width: 11, height: 11, borderWidth: 1.5 }} />
        ) : (
          <span className="tag">{fmtTime(playhead)}</span>
        )
      }
    >
      {gates.length === 0 && <Empty>站台内还没有启用的闸机。</Empty>}
      {gates.map((g) => {
        const lanes = Math.max(1, Math.round(g.gateCount ?? 1))
        const active = pendingGate === g.id
        return (
          <div key={g.id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <button
                className={`list-item ${active ? 'selected' : ''}`}
                style={{ padding: '5px 8px' }}
                onClick={() => select({ kind: 'obstacle', id: g.id })}
              >
                <span className="dot" style={{ background: g.color ?? '#5b8def' }} />
                <span className="grow">
                  <div className="title" style={{ fontSize: 11.5 }}>
                    {g.name}
                  </div>
                  <div className="sub">
                    {lanes} 通道 · 权重 {g.weight.toFixed(2)} · 承载 {Math.round(g.capacity)}
                  </div>
                </span>
              </button>
              <button className="btn sm" onClick={() => onEdit(g.id)} title="在 3D 中弹窗逐通道调整">
                调整
              </button>
            </div>
            {active && (
              <div className="list" style={{ paddingLeft: 6 }}>
                <div className="row2">
                  <button className="btn sm" onClick={() => applyAll(g.id, 1)}>
                    全开 1.00
                  </button>
                  <button className="btn sm" onClick={() => applyAll(g.id, 0.25)}>
                    限流 0.25
                  </button>
                </div>
                {Array.from({ length: lanes }).map((_, i) => {
                  const w = drafts[`${g.id}:${i}`] ?? g.gateWeights?.[i] ?? g.weight
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <span className="tag blue" style={{ minWidth: 46, justifyContent: 'center' }}>
                        #{i + 1}
                      </span>
                      <input
                        type="range"
                        min={0.02}
                        max={1}
                        step={0.01}
                        value={w}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setDrafts((d) => ({ ...d, [`${g.id}:${i}`]: v }))
                          // 节流: 每 140ms 最多触发一次联动重算, 拖动手感与算力平衡
                          const key = `${g.id}:${i}`
                          const now = performance.now()
                          const last = lastApply.current.get(key) ?? 0
                          if (now - last > 140) {
                            lastApply.current.set(key, now)
                            applyLane(g.id, i, v)
                          }
                        }}
                        onPointerUp={(e) => {
                          applyLane(g.id, i, Number((e.target as HTMLInputElement).value))
                        }}
                        onKeyUp={(e) => {
                          applyLane(g.id, i, Number((e.target as HTMLInputElement).value))
                        }}
                      />
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10, width: 28, textAlign: 'right' }}>
                        {w.toFixed(2)}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
      <div className="hint">
        拖到松手即从当前帧（{fmtTime(playhead)}）向后联动重算；之前的帧保留原样，便于对比限流效果。
      </div>
      <button className="btn" disabled={!client} onClick={() => client?.seek(playhead)}>
        从当前帧强制刷新
      </button>
    </Section>
  )
}
