import { useMemo, useState } from 'react'
import { useApp, useSim } from '../../state/store.ts'
import type { LiveClient } from '../../state/liveClient.ts'
import { OBSTACLE_LABELS, ZONE_LABELS, ZONE_COLORS, type Obstacle, type Zone, type Vec2 } from '../../core/types.ts'
import { polygonArea, polygonCentroid } from '../../core/geometry.ts'
import { rectPolygon, roundedRectOutline } from '../../core/defaults.ts'
import { Section, SliderField, NumField, Empty } from '../components/controls.tsx'

/** 站台编辑模块: 轮廓 + 区块列表 + 障碍物列表 */
export function StationEditor({ onUpdate }: { onUpdate: () => void }) {
  const doc = useApp((s) => s.doc)
  const selection = useApp((s) => s.selection)
  const select = useApp((s) => s.select)
  const startDraft = useApp((s) => s.startDraft)
  const setDoc = useApp((s) => s.setDoc)
  const setParams = useApp((s) => s.setParams)
  const [zoneFilter, setZoneFilter] = useState<'all' | 'source' | 'sink'>('all')

  const stats = useMemo(() => {
    const sources = doc.zones.filter((z) => z.isSource)
    const sinks = doc.zones.filter((z) => z.isSink)
    const gates = doc.obstacles.filter((o) => o.kind === 'gate' && o.enabled)
    const laneTotal = gates.reduce((a, g) => a + Math.max(1, Math.round(g.gateCount ?? 1)), 0)
    return { sources, sinks, gates, laneTotal }
  }, [doc])

  const filteredZones = doc.zones.filter((z) => (zoneFilter === 'all' ? true : zoneFilter === 'source' ? z.isSource : z.isSink))

  const outlinePreset = (w: number, h: number) => {
    setDoc({ ...doc, outline: { outer: roundedRectOutline(w, h, Math.min(7, Math.min(w, h) / 4)) } }, '应用站台轮廓模板')
    onUpdate()
  }

  const addZone = (kind: Zone['kind']) => {
    const id = `zone_${Math.random().toString(36).slice(2, 8)}`
    const center = polygonCentroid(doc.outline.outer)
    const zone: Zone = {
      id,
      name: `${ZONE_LABELS[kind]}${doc.zones.filter((z) => z.kind === kind).length + 1}`,
      kind,
      polygon: rectPolygon(center[0], center[1], kind === 'stair' ? 7 : 12, kind === 'stair' ? 4.2 : 6),
      color: ZONE_COLORS[kind],
      isSink: kind === 'stair',
      serviceRate: kind === 'stair' ? 10 : undefined,
      isSource: kind === 'entry',
      arrivalCurveId: kind === 'entry' ? doc.curves[0]?.id : undefined,
      weight: kind === 'entry' ? 1 : undefined,
    }
    setDoc({ ...doc, zones: [...doc.zones, zone] }, '新增区块')
    select({ kind: 'zone', id })
    onUpdate()
  }

  const addObstacle = (kind: Obstacle['kind']) => {
    const id = `obs_${Math.random().toString(36).slice(2, 8)}`
    const center = polygonCentroid(doc.outline.outer)
    const sizes: Record<string, Vec2> = { gate: [3.2, 0.42], escalator: [12, 2.4], column: [0.9, 0.9], stair: [6, 3], barrier: [4, 0.25], shop: [8, 3], custom: [2, 2] }
    const lanes = 4
    const o: Obstacle = {
      id,
      kind,
      name: OBSTACLE_LABELS[kind],
      center,
      rotation: 0,
      size: sizes[kind] ?? [2, 2],
      height: kind === 'column' ? 3.2 : kind === 'shop' ? 3 : 1.1,
      weight: kind === 'column' ? 0.15 : kind === 'shop' ? 0.05 : 0.9,
      capacity: kind === 'gate' ? lanes * 45 : kind === 'column' ? 6 : 40,
      gateCount: kind === 'gate' ? lanes : undefined,
      gateWeights: kind === 'gate' ? Array.from({ length: lanes }, () => 0.9) : undefined,
      gateCapacities: kind === 'gate' ? Array.from({ length: lanes }, () => 45) : undefined,
      enabled: true,
      solid: true,
      color: kind === 'gate' ? '#5b8def' : kind === 'column' ? '#c9ced8' : undefined,
      beltSpeed: kind === 'escalator' ? 0.65 : undefined,
    }
    setDoc({ ...doc, obstacles: [...doc.obstacles, o] }, '新增障碍物')
    select({ kind: 'obstacle', id })
    onUpdate()
  }

  return (
    <>
      <Section title="站台轮廓" badge={`${Math.abs(polygonArea(doc.outline.outer)).toFixed(0)} m²`}>
        <div className="row3">
          <button className="btn sm" onClick={() => outlinePreset(80, 22)}>
            80×22 侧式
          </button>
          <button className="btn sm" onClick={() => outlinePreset(124, 26)}>
            124×26 岛式
          </button>
          <button className="btn sm" onClick={() => outlinePreset(160, 30)}>
            160×30 大站
          </button>
        </div>
        <button className="btn" onClick={() => startDraft('outline')}>
          ✎ 手动绘制外轮廓
        </button>
        <div className="hint">绘制后在场景中单击落点，双击或 Enter 闭合。轮廓决定可通行边界。</div>
        <div className="divider" />
        <div className="field">
          <label>
            <span>站名</span>
          </label>
          <input value={doc.meta.name} onChange={(e) => setDoc({ ...doc, meta: { ...doc.meta, name: e.target.value } }, '修改站名')} />
        </div>
        <div className="field">
          <label>
            <span>线路</span>
          </label>
          <input value={doc.meta.line} onChange={(e) => setDoc({ ...doc, meta: { ...doc.meta, line: e.target.value } }, '修改线路')} />
        </div>
      </Section>

      <Section title="区块" badge={`${doc.zones.length}`}>
        <div className="row3">
          <button className="btn sm" onClick={() => addZone('paid')}>
            付费区
          </button>
          <button className="btn sm" onClick={() => addZone('unpaid')}>
            非付费区
          </button>
          <button className="btn sm" onClick={() => addZone('stair')}>
            楼梯口
          </button>
        </div>
        <div className="row3">
          <button className="btn sm" onClick={() => addZone('entry')}>
            进站口
          </button>
          <button className="btn sm" onClick={() => addZone('platform-edge')}>
            站台边缘
          </button>
          <button className="btn sm" onClick={() => startDraft('zone', 'paid')}>
            手绘区块
          </button>
        </div>
        <div className="row3">
          {(
            [
              ['all', `全部 ${doc.zones.length}`],
              ['source', `进站口 ${stats.sources.length}`],
              ['sink', `楼梯口 ${stats.sinks.length}`],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`btn sm ${zoneFilter === k ? 'active' : ''}`} onClick={() => setZoneFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="list">
          {filteredZones.length === 0 && <Empty>暂无区块</Empty>}
          {filteredZones.map((z) => (
            <button
              key={z.id}
              className={`list-item ${selection.kind === 'zone' && selection.id === z.id ? 'selected' : ''}`}
              onClick={() => select({ kind: 'zone', id: z.id })}
            >
              <span className="dot" style={{ background: z.color }} />
              <span className="grow">
                <div className="title">{z.name}</div>
                <div className="sub">
                  {ZONE_LABELS[z.kind]} · {Math.abs(polygonArea(z.polygon)).toFixed(0)} m²
                  {z.isSource ? ' · 投放' : ''}
                  {z.isSink ? ` · 疏散 ${z.serviceRate ?? 8}/s` : ''}
                </div>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="障碍物" badge={`${doc.obstacles.length}`}>
        <div className="row3">
          {(['gate', 'escalator', 'column'] as Obstacle['kind'][]).map((k) => (
            <button key={k} className="btn sm" onClick={() => addObstacle(k)}>
              {OBSTACLE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="row3">
          {(['stair', 'barrier', 'shop'] as Obstacle['kind'][]).map((k) => (
            <button key={k} className="btn sm" onClick={() => addObstacle(k)}>
              {OBSTACLE_LABELS[k]}
            </button>
          ))}
        </div>
        <div className="hint">
          闸机 {stats.gates.length} 组 · 通道 {stats.laneTotal} 条。在场景中单击空白处可直接放置工具栏选中的障碍物。
        </div>
        <div className="list">
          {doc.obstacles.length === 0 && <Empty>暂无障碍物</Empty>}
          {doc.obstacles.map((o) => (
            <button
              key={o.id}
              className={`list-item ${selection.kind === 'obstacle' && selection.id === o.id ? 'selected' : ''}`}
              onClick={() => select({ kind: 'obstacle', id: o.id })}
            >
              <span
                className="dot"
                style={{ background: o.enabled ? o.color ?? '#94a3b8' : '#3a4453' }}
                title={o.enabled ? '启用' : '停用'}
              />
              <span className="grow">
                <div className="title">
                  {o.name}
                  {o.kind === 'gate' ? ` · ${o.gateCount ?? 1} 通道` : ''}
                </div>
                <div className="sub">
                  {OBSTACLE_LABELS[o.kind]} · 权重 {o.weight.toFixed(2)} · 承载 {Math.round(o.capacity)}
                  {o.solid ? '' : ' · 非实体'}
                </div>
              </span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="站台几何参数" defaultOpen={false}>
        <NumField label="网格边长 (热力)" value={doc.params.gridSize} step={64} min={128} max={1024} unit="px" onChange={(v) => setParams({ gridSize: Math.round(v) }, '修改热力网格')} />
        <SliderField label="色带上限" value={doc.params.densityMax} min={3} max={10} step={0.5} unit="人/m²" onChange={(v) => setParams({ densityMax: v }, '修改色带上限')} />
      </Section>
    </>
  )
}

export function SimParamsPanel({
  client,
  readOnly,
}: {
  client: LiveClient | null
  readOnly?: boolean
}) {
  const doc = useApp((s) => s.doc)
  const setParams = useApp((s) => s.setParams)
  const info = useSim((s) => s.info)
  const replayDuration = useSim((s) => s.duration)
  const imported = useSim((s) => s.imported)
  const p = doc.params
  const ro = !!readOnly
  return (
    <>
      <Section title="行人流参数" badge={ro ? '只读' : undefined}>
        <>
        <SliderField label="同时在场上限" value={p.maxPeople} min={1000} max={20000} step={500} unit="人" disabled={ro} onChange={(v) => setParams({ maxPeople: v }, '修改人数上限')} />
        <SliderField label="期望速度" value={p.meanSpeed} min={0.6} max={2} step={0.05} unit="m/s" fmt={(v) => v.toFixed(2)} disabled={ro} onChange={(v) => setParams({ meanSpeed: v }, '修改速度')} />
        <SliderField label="速度离散度" value={p.speedSigma} min={0} max={0.6} step={0.01} fmt={(v) => v.toFixed(2)} disabled={ro} onChange={(v) => setParams({ speedSigma: v }, '修改速度离散度')} />
        <SliderField label="行人半径" value={p.radius} min={0.15} max={0.45} step={0.01} unit="m" fmt={(v) => v.toFixed(2)} disabled={ro} onChange={(v) => setParams({ radius: v }, '修改行人半径')} />
        <div className="divider" />
        <SliderField label="排斥强度" value={p.repulsion} min={0.5} max={6} step={0.1} fmt={(v) => v.toFixed(1)} disabled={ro} onChange={(v) => setParams({ repulsion: v }, '修改排斥强度')} />
        <SliderField label="密度减速系数" value={p.congestionFactor} min={0} max={1.5} step={0.05} fmt={(v) => v.toFixed(2)} disabled={ro} onChange={(v) => setParams({ congestionFactor: v }, '修改拥堵系数')} />
        <div className="divider" />
        <SliderField label="BVH 避让探测" value={p.rayAvoidDist} min={0.8} max={5} step={0.1} unit="m" fmt={(v) => v.toFixed(1)} disabled={ro} onChange={(v) => setParams({ rayAvoidDist: v }, '修改避让距离')} />
        </>
        {ro && <div className="hint">回放参数来自导出包，仅供查看。</div>}
      </Section>
      <Section title="仿真与快照">
        <SliderField
          label="仿真时长"
          value={imported ? Math.round(replayDuration * 10) / 10 : p.duration}
          min={imported ? Math.max(1, replayDuration) : 120}
          max={imported ? Math.max(1, replayDuration) : 3600}
          step={imported ? 0.2 : 60}
          unit="s"
          disabled={ro}
          fmt={(v) => `${Math.round(v)}`}
          onChange={(v) => {
            if (!imported) setParams({ duration: v }, '修改仿真时长')
          }}
        />
        <SliderField label="时间步长" value={p.dt} min={0.05} max={0.25} step={0.01} unit="s" fmt={(v) => v.toFixed(2)} disabled={ro} onChange={(v) => setParams({ dt: v }, '修改步长')} />
        <div className="field">
          <label>
            <span>快照间隔</span>
            <span className="val">200 ms (固定)</span>
          </label>
          <input type="text" value="200 ms / 帧 · 5 帧/秒" disabled />
        </div>
        <div className="hint">
          总帧数约 {Math.ceil(p.duration / (p.snapshotIntervalMs / 1000))} 帧；每帧为 512×512 的密度栅格。
        </div>
        {info && (
          <div style={{ marginTop: 4 }}>
            <div className="hud-kv">
              <span className="k">导航网格</span>
              <span className="v">
                {info.cols}×{info.rows}
              </span>
            </div>
            <div className="hud-kv">
              <span className="k">可通行面积</span>
              <span className="v">{info.totalArea.toFixed(0)} m²</span>
            </div>
            <div className="hud-kv">
              <span className="k">峰值到达率</span>
              <span className="v">{info.spawnRate.toFixed(1)} 人/s</span>
            </div>
            <div className="hud-kv">
              <span className="k">稳态人数估算</span>
              <span className="v">{info.steadyEstimate.toLocaleString()}</span>
            </div>
          </div>
        )}
      </Section>
      <Section title="压力测试" defaultOpen={false} badge={ro ? '回放不可用' : undefined}>
        <div className="hint">直接在场内铺满指定人数，用于验证 20000 人同时在场时的密度场与渲染性能。</div>
        <div className="row2">
          <button className="btn sm" disabled={!client || ro} onClick={() => client?.fill(5000)}>
            填 5,000 人
          </button>
          <button className="btn sm" disabled={!client || ro} onClick={() => client?.fill(20000)}>
            填 20,000 人
          </button>
        </div>
        <div className="hint">填充后切到「仿真」页并播放，可观察 2 万人同时在场的密度场。</div>
      </Section>
    </>
  )
}
