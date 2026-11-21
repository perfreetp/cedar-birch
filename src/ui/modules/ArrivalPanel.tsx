import { useMemo, useState } from 'react'
import { useApp, useSim } from '../../state/store.ts'
import { Section, Empty } from '../components/controls.tsx'
import { CurveEditor } from '../components/CurveEditor.tsx'
import { sampleCurve } from '../../core/geometry.ts'
import type { Vec2 } from '../../core/types.ts'

/** 到达曲线 / 行人流生成模块 */
export function ArrivalPanel({ readOnly }: { readOnly?: boolean } = {}) {
  const doc = useApp((s) => s.doc)
  const setCurve = useApp((s) => s.setCurve)
  const addCurve = useApp((s) => s.addCurve)
  const removeCurve = useApp((s) => s.removeCurve)
  const setZone = useApp((s) => s.setZone)
  const select = useApp((s) => s.select)
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = doc.curves.find((c) => c.id === (activeId ?? doc.curves[0]?.id)) ?? doc.curves[0]

  const sources = doc.zones.filter((z) => z.isSource)

  const integral = useMemo(() => {
    if (!active) return { total: 0, peak: 0, peakT: 0 }
    let total = 0
    let peak = 0
    let peakT = 0
    for (let t = 0; t <= doc.params.duration; t += 0.5) {
      const v = sampleCurve(active.points, t)
      total += v * 0.5
      if (v > peak) {
        peak = v
        peakT = t
      }
    }
    return { total, peak, peakT }
  }, [active, doc.params.duration])

  const effectiveRate = useMemo(() => {
    if (!active) return { total: 0, peak: 0 }
    let total = 0
    let peak = 0
    for (let t = 0; t <= doc.params.duration; t += 0.5) {
      let v = 0
      for (const s of sources) {
        if ((s.arrivalCurveId ?? doc.curves[0]?.id) === active.id) v += sampleCurve(active.points, t) * (s.weight ?? 1)
      }
      total += v * 0.5
      if (v > peak) peak = v
    }
    return { total, peak }
  }, [active, sources, doc.curves, doc.params.duration])

  if (!active) return null

  return (
    <>
      <Section title="到达曲线" badge={`${doc.curves.length} 条`}>
        <div className="curve-legend">
          {doc.curves.map((c) => (
            <button
              key={c.id}
              className={`curve-chip ${active.id === c.id ? 'active' : ''}`}
              onClick={() => setActiveId(c.id)}
            >
              <span className="sw" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
        <input
          value={active.name}
          disabled={readOnly}
          onChange={(e) => setCurve(active.id, { name: e.target.value }, '重命名到达曲线')}
          style={{ fontWeight: 550 }}
        />
        <CurveEditor
          key={active.id}
          curve={active}
          curves={doc.curves}
          duration={doc.params.duration}
          readOnly={readOnly}
          onChange={(points: Vec2[], commit: boolean) => {
            setCurve(active.id, { points }, commit ? '编辑到达曲线' : '调整控制点')
          }}
        />
        <div className="hud-kv">
          <span className="k">曲线积分</span>
          <span className="v">{integral.total.toFixed(0)} 人</span>
        </div>
        <div className="hud-kv">
          <span className="k">峰值</span>
          <span className="v">
            {integral.peak.toFixed(1)} 人/s @ {integral.peakT.toFixed(0)}s
          </span>
        </div>
        {sources.length > 1 && (
          <div className="hud-kv">
            <span className="k">多进站口叠加峰值</span>
            <span className="v">{effectiveRate.peak.toFixed(1)} 人/s</span>
          </div>
        )}
        {!readOnly && (
          <div className="row2">
            <button className="btn sm" onClick={() => addCurve()}>
              + 新建曲线
            </button>
            <button className="btn sm danger" disabled={doc.curves.length <= 1} onClick={() => removeCurve(active.id)}>
              删除
            </button>
          </div>
        )}
        <div className="hint">{readOnly ? '回放包中的到达曲线（只读）' : '双击图表空白处添加控制点；拖动控制点调整；右键删除。'}</div>
      </Section>

      <Section title="进站口" badge={`${sources.length}`}>
        {sources.length === 0 && <Empty>尚未标记进站口。请先在「站台编辑」中圈出进站口区块。</Empty>}
        <div className="list">
          {sources.map((z) => {
            const curve = doc.curves.find((c) => c.id === (z.arrivalCurveId ?? doc.curves[0]?.id))
            return (
              <div key={z.id} className="list-item" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dot" style={{ background: z.color }} />
                  <span className="title" style={{ flex: 1 }}>{z.name}</span>
                  <button className="btn sm ghost" onClick={() => select({ kind: 'zone', id: z.id })}>
                    选中
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <select
                    value={z.arrivalCurveId ?? doc.curves[0]?.id}
                    onChange={(e) => setZone(z.id, { arrivalCurveId: e.target.value }, '切换到达曲线')}
                    style={{ fontSize: 11 }}
                  >
                    {doc.curves.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <span className="tag" style={{ color: curve?.color }}>
                    {(z.weight ?? 1).toFixed(2)}×
                  </span>
                </div>
                <input
                  type="range"
                  min={0.05}
                  max={3}
                  step={0.05}
                  disabled={readOnly}
                  value={z.weight ?? 1}
                  onChange={(e) => setZone(z.id, { weight: Number(e.target.value) }, '修改投放权重')}
                />
              </div>
            )
          })}
        </div>
      </Section>
    </>
  )
}

/** 数据管理: 站点库 + 导出 + 导入 */
export function DataPanel({
  onExport,
  onImport,
  onOpenStation,
  onSaveStation,
  onLoadRun,
}: {
  onExport: () => void
  onImport: (file: File) => void
  onOpenStation: () => void
  onSaveStation: () => void
  onLoadRun: () => void
}) {
  const dirty = useApp((s) => s.dirty)
  const imported = useSim((s) => s.imported)
  const busy = useSim((s) => s.busy)
  return (
    <Section title="数据" badge={dirty ? '未保存' : undefined}>
      <div className="row2">
        <button className="btn" onClick={onSaveStation}>
          💾 保存到本地
        </button>
        <button className="btn" onClick={onOpenStation}>
          📂 站点库
        </button>
      </div>
      <div className="row2">
        <button className="btn primary" onClick={onExport} disabled={!!busy}>
          ⬇ 导出仿真包
        </button>
        <label className="btn" style={{ justifyContent: 'center' }}>
          ⬆ 导入分享
          <input
            type="file"
            accept=".zip,.phs,.phsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onImport(f)
              e.currentTarget.value = ''
            }}
          />
        </label>
      </div>
      <button className="btn" onClick={onLoadRun} disabled={!imported}>
        🎞 打开回放库
      </button>
      <div className="hint">
        数据保存在浏览器 IndexedDB；导出包内含站点参数、512×512 密度帧序列（4bit+zlib）、行人快照、逐帧统计与到达曲线 CSV。
      </div>
    </Section>
  )
}
