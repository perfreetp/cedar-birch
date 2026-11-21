import { useMemo, useState } from 'react'
import { useApp, useSim } from '../../state/store.ts'
import type { Obstacle, Zone, ZoneKind } from '../../core/types.ts'
import { OBSTACLE_LABELS, ZONE_LABELS, ZONE_COLORS } from '../../core/types.ts'
import { Field, NumField, SliderField, TextField, CheckField, Section, Empty, Modal, fmtTime } from '../components/controls.tsx'
import { polygonArea, polygonCentroid } from '../../core/geometry.ts'

export function InspectorPanel({
  onGateEdit,
  onGateWeight,
}: {
  onGateEdit: (id: string) => void
  onGateWeight?: (id: string, weight: number) => void
}) {
  const doc = useApp((s) => s.doc)
  const selection = useApp((s) => s.selection)
  const mode = useApp((s) => s.mode)

  const obstacle = selection.kind === 'obstacle' ? doc.obstacles.find((o) => o.id === selection.id) : null
  const zone = selection.kind === 'zone' ? doc.zones.find((z) => z.id === selection.id) : null

  if (obstacle) return <ObstacleProps obstacle={obstacle} onGateEdit={onGateEdit} onGateWeight={onGateWeight} />
  if (zone) return <ZoneProps zone={zone} />
  if (mode !== 'edit') return null
  return (
    <Section title="属性" defaultOpen>
      <Empty>
        在场景中选择障碍物或区块
        <br />
        即可在此编辑通行权重与承载人数
      </Empty>
      <StationSummary />
    </Section>
  )
}

function StationSummary() {
  const doc = useApp((s) => s.doc)
  const area = useMemo(() => {
    let a = Math.abs(polygonArea(doc.outline.outer))
    for (const h of doc.outline.holes ?? []) a -= Math.abs(polygonArea(h))
    return a
  }, [doc.outline])
  const paid = doc.zones.filter((z) => z.kind === 'paid').reduce((s, z) => s + Math.abs(polygonArea(z.polygon)), 0)
  return (
    <>
      <div className="divider" />
      <div className="hud-kv">
        <span className="k">站台面积</span>
        <span className="v">{area.toFixed(0)} m²</span>
      </div>
      <div className="hud-kv">
        <span className="k">付费区</span>
        <span className="v">{paid.toFixed(0)} m²</span>
      </div>
      <div className="hud-kv">
        <span className="k">区块 / 障碍物</span>
        <span className="v">
          {doc.zones.length} / {doc.obstacles.length}
        </span>
      </div>
      <div className="hud-kv">
        <span className="k">进站口 / 楼梯口</span>
        <span className="v">
          {doc.zones.filter((z) => z.isSource).length} / {doc.zones.filter((z) => z.isSink).length}
        </span>
      </div>
    </>
  )
}

function ObstacleProps({
  obstacle,
  onGateEdit,
  onGateWeight,
}: {
  obstacle: Obstacle
  onGateEdit: (id: string) => void
  onGateWeight?: (id: string, weight: number) => void
}) {
  const setObstacle = useApp((s) => s.setObstacle)
  const mode = useApp((s) => s.mode)
  const [showLanes, setShowLanes] = useState(false)
  const o = obstacle
  const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
  const totalLaneCap = (o.gateCapacities ?? Array.from({ length: lanes }, () => o.capacity / lanes)).reduce((a, b) => a + b, 0)

  return (
    <Section
      title={OBSTACLE_LABELS[o.kind]}
      badge={o.enabled ? undefined : '已停用'}
      right={
        <button className="btn sm danger" onClick={() => useApp.getState().deleteSelection()} title="删除 (Delete)">
          删除
        </button>
      }
    >
      <TextField label="名称" value={o.name} onChange={(v) => setObstacle(o.id, { name: v }, '重命名障碍物')} />
      <div className="row2">
        <NumField label="X" value={o.center[0]} step={0.1} onChange={(v) => setObstacle(o.id, { center: [v, o.center[1]] }, '移动障碍物')} />
        <NumField label="Z" value={o.center[1]} step={0.1} onChange={(v) => setObstacle(o.id, { center: [o.center[0], v] }, '移动障碍物')} />
      </div>
      <div className="row2">
        <NumField label="宽" value={o.size[0]} step={0.1} min={0.2} onChange={(v) => setObstacle(o.id, { size: [v, o.size[1]] }, '调整尺寸')} />
        <NumField label="深" value={o.size[1]} step={0.1} min={0.1} onChange={(v) => setObstacle(o.id, { size: [o.size[0], v] }, '调整尺寸')} />
      </div>
      <SliderField
        label="朝向"
        value={Math.round((o.rotation * 180) / Math.PI)}
        min={-180}
        max={180}
        step={1}
        unit="°"
        onChange={(v) => setObstacle(o.id, { rotation: (v * Math.PI) / 180 }, '旋转障碍物')}
      />
      <div className="row2">
        <NumField label="高度" value={o.height} step={0.1} min={0.05} unit="m" onChange={(v) => setObstacle(o.id, { height: v }, '调整高度')} />
        <div className="field">
          <label>
            <span>状态</span>
          </label>
          <CheckField label="启用" checked={o.enabled} onChange={(v) => setObstacle(o.id, { enabled: v }, v ? '启用' : '停用')} />
        </div>
      </div>

      <div className="divider" />

      <div className="section-head" style={{ padding: '0 0 6px', cursor: 'default', borderBottom: 'none', background: 'transparent' }}>
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>通行约束</span>
      </div>
      <SliderField
        fieldKey="weight"
        label="通行权重"
        value={o.weight}
        min={0.02}
        max={1}
        step={0.01}
        fmt={(v) => v.toFixed(2)}
        unit="(越高越易通过)"
        onChange={(v) => {
          setObstacle(o.id, { weight: v, gateWeights: undefined }, '修改通行权重')
          if (mode !== 'edit' && o.kind === 'gate') onGateWeight?.(o.id, v)
        }}
      />
      <NumField
        label="最大承载人数"
        value={o.capacity}
        step={10}
        min={1}
        unit={o.kind === 'gate' ? `合计 · 通道均 ${(totalLaneCap / lanes).toFixed(0)}` : '人'}
        onChange={(v) => setObstacle(o.id, { capacity: v, gateCapacities: undefined }, '修改承载人数')}
      />
      <CheckField label="实体阻挡 (行人与射线避让)" checked={o.solid} onChange={(v) => setObstacle(o.id, { solid: v }, '切换实体阻挡')} />

      {o.kind === 'gate' && (
        <>
          <div className="divider" />
          <div className="row2">
            <NumField
              label="通道数"
              value={lanes}
              step={1}
              min={1}
              max={24}
              onChange={(v) => {
                const n = Math.max(1, Math.min(24, Math.round(v)))
                const w = lanes * 0.68 + 0.4
                const perW = (o.gateWeights ?? Array.from({ length: lanes }, () => o.weight)).slice(0, n)
                while (perW.length < n) perW.push(o.weight)
                const perC = (o.gateCapacities ?? Array.from({ length: lanes }, () => o.capacity / lanes)).slice(0, n)
                while (perC.length < n) perC.push(o.capacity / lanes)
                void w
                setObstacle(o.id, { gateCount: n, gateWeights: perW, gateCapacities: perC }, '修改通道数')
              }}
            />
            <div className="field">
              <label>
                <span>通道权重</span>
              </label>
              <button className="btn sm" onClick={() => setShowLanes((v) => !v)}>
                {showLanes ? '收起' : '逐通道编辑'}
              </button>
            </div>
          </div>
          {showLanes && (
            <div className="list">
              {Array.from({ length: lanes }).map((_, i) => {
                const w = o.gateWeights?.[i] ?? o.weight
                const c = o.gateCapacities?.[i] ?? o.capacity / lanes
                return (
                  <div key={i} className="list-item" style={{ cursor: 'default', padding: '6px 8px' }}>
                    <span className="tag blue">#{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <input
                        type="range"
                        min={0.02}
                        max={1}
                        step={0.01}
                        value={w}
                        onChange={(e) => {
                          const gw = [...(o.gateWeights ?? Array.from({ length: lanes }, () => o.weight))]
                          gw[i] = Number(e.target.value)
                          setObstacle(o.id, { gateWeights: gw }, `调整通道 ${i + 1} 权重`)
                        }}
                      />
                    </div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 10, width: 30, textAlign: 'right' }}>{w.toFixed(2)}</span>
                    <input
                      type="number"
                      value={Math.round(c)}
                      style={{ width: 56, padding: '2px 4px', fontSize: 10 }}
                      onChange={(e) => {
                        const gc = [...(o.gateCapacities ?? Array.from({ length: lanes }, () => o.capacity / lanes))]
                        gc[i] = Number(e.target.value)
                        setObstacle(o.id, { gateCapacities: gc }, `调整通道 ${i + 1} 承载`)
                      }}
                    />
                  </div>
                )
              })}
            </div>
          )}
          {mode !== 'edit' && (
            <button className="btn primary" onClick={() => onGateEdit(o.id)} title="从当前帧起向后重算">
              ⟳ 从当前帧联动重算
            </button>
          )}
          <div className="hint">
            权重影响通行代价与限流强度；承载人数是通道前的排队容量上限，超出后速度按比例衰减。
          </div>
        </>
      )}

      {(o.kind === 'escalator' || o.kind === 'stair') && (
        <>
          <div className="divider" />
          <SliderField
            label="传送速度"
            value={o.beltSpeed ?? 0}
            min={-1.2}
            max={1.2}
            step={0.05}
            unit="m/s"
            fmt={(v) => v.toFixed(2)}
            onChange={(v) => setObstacle(o.id, { beltSpeed: v }, '调整扶梯速度')}
          />
          <div className="hint">正值沿本地 +Z 方向运送，负值反向。行人在扶梯上会叠加该速度。</div>
        </>
      )}
    </Section>
  )
}

function ZoneProps({ zone }: { zone: Zone }) {
  const setZone = useApp((s) => s.setZone)
  const doc = useApp((s) => s.doc)
  const updateDoc = useApp((s) => s.updateDoc)
  const c = polygonCentroid(zone.polygon)
  const area = Math.abs(polygonArea(zone.polygon))

  const moveTo = (x: number, z: number) => {
    const dx = x - c[0]
    const dz = z - c[1]
    setZone(zone.id, { polygon: zone.polygon.map(([px, pz]) => [px + dx, pz + dz] as [number, number]) }, '移动区块')
  }

  return (
    <Section
      title={ZONE_LABELS[zone.kind]}
      right={
        <button className="btn sm danger" onClick={() => useApp.getState().deleteSelection()} title="删除">
          删除
        </button>
      }
    >
      <TextField label="名称" value={zone.name} onChange={(v) => setZone(zone.id, { name: v }, '重命名区块')} />
      <div className="row2">
        <NumField label="中心 X" value={round1(c[0])} step={0.1} onChange={(v) => moveTo(v, c[1])} />
        <NumField label="中心 Z" value={round1(c[1])} step={0.1} onChange={(v) => moveTo(c[0], v)} />
      </div>
      <div className="row2">
        <Field label="面积" value={`${area.toFixed(0)} m²`}>
          <div />
        </Field>
        <Field label="顶点数" value={zone.polygon.length}>
          <div />
        </Field>
      </div>
      <div className="field">
        <label>
          <span>类型</span>
        </label>
        <select
          value={zone.kind}
          onChange={(e) => {
            const k = e.target.value as ZoneKind
            setZone(
              zone.id,
              {
                kind: k,
                color: ZONE_COLORS[k],
                isSink: k === 'stair' ? true : zone.isSink,
                serviceRate: k === 'stair' ? (zone.serviceRate ?? 10) : zone.serviceRate,
                isSource: k === 'entry' ? true : zone.isSource,
                arrivalCurveId: k === 'entry' ? (zone.arrivalCurveId ?? doc.curves[0]?.id) : zone.arrivalCurveId,
              },
              '修改区块类型',
            )
          }}
        >
          {(Object.keys(ZONE_LABELS) as ZoneKind[]).map((k) => (
            <option key={k} value={k}>
              {ZONE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="divider" />
      <CheckField label="作为疏散点 (行人到达后离开)" checked={!!zone.isSink} onChange={(v) => setZone(zone.id, { isSink: v }, '切换疏散点')} />
      {zone.isSink && (
        <SliderField
          label="疏散服务率"
          value={zone.serviceRate ?? 8}
          min={1}
          max={40}
          step={0.5}
          unit="人/秒"
          fmt={(v) => v.toFixed(1)}
          onChange={(v) => setZone(zone.id, { serviceRate: v }, '修改疏散率')}
        />
      )}
      <CheckField label="作为进站口 (行人由此投放)" checked={!!zone.isSource} onChange={(v) => setZone(zone.id, { isSource: v }, '切换进站口')} />
      {zone.isSource && (
        <>
          <div className="field">
            <label>
              <span>到达曲线</span>
            </label>
            <select value={zone.arrivalCurveId ?? ''} onChange={(e) => setZone(zone.id, { arrivalCurveId: e.target.value }, '切换到达曲线')}>
              {doc.curves.map((c2) => (
                <option key={c2.id} value={c2.id}>
                  {c2.name}
                </option>
              ))}
            </select>
          </div>
          <SliderField
            label="投放权重"
            value={zone.weight ?? 1}
            min={0.05}
            max={3}
            step={0.05}
            fmt={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => setZone(zone.id, { weight: v }, '修改投放权重')}
          />
        </>
      )}
      <button
        className="btn sm"
        onClick={() => {
          updateDoc((d) => {
            const target = d.zones.find((z) => z.id === zone.id)
            if (!target) return
            target.polygon = [...target.polygon].reverse()
          }, '反转区块顶点顺序')
        }}
      >
        反转顶点顺序
      </button>
    </Section>
  )
}

export function GateWeightDialog({
  obstacleId,
  onClose,
  onApply,
}: {
  obstacleId: string | null
  onClose: () => void
  onApply: (changes: { obstacleId: string; laneIndex?: number; weight?: number; capacity?: number }[]) => void
}) {
  const doc = useApp((s) => s.doc)
  const playhead = useSim((s) => s.playhead)
  const [weights, setWeights] = useState<Record<string, number>>({})
  const o = doc.obstacles.find((x) => x.id === obstacleId)
  if (!obstacleId || !o) return null
  const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
  const getW = (i: number) => weights[`${obstacleId}:${i}`] ?? o.gateWeights?.[i] ?? o.weight
  const setW = (i: number, v: number) => setWeights((w) => ({ ...w, [`${obstacleId}:${i}`]: v }))

  return (
    <Modal
      title={`闸机权重 · ${o.name}`}
      onClose={onClose}
      narrow
      footer={
        <>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const changes = Array.from({ length: lanes }).map((_, i) => ({
                obstacleId,
                laneIndex: i,
                weight: getW(i),
                capacity: o.gateCapacities?.[i] ?? o.capacity / lanes,
              }))
              onApply(changes)
              onClose()
            }}
          >
            应用并从 {fmtTime(playhead)} 重算
          </button>
        </>
      }
    >
      <div className="hint">
        修改后将从当前帧（{fmtTime(playhead)}）向后重算热力序列；之前的帧保持原样，便于对比。
      </div>
      {Array.from({ length: lanes }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="tag blue">通道 {i + 1}</span>
          <input type="range" min={0.02} max={1} step={0.01} value={getW(i)} onChange={(e) => setW(i, Number(e.target.value))} />
          <span style={{ fontFamily: 'var(--mono)', width: 34, textAlign: 'right' }}>{getW(i).toFixed(2)}</span>
        </div>
      ))}
      <div className="row2">
        <button
          className="btn"
          onClick={() => {
            const v = 0.9
            setWeights(Object.fromEntries(Array.from({ length: lanes }).map((_, i) => [`${obstacleId}:${i}`, v])))
          }}
        >
          全部设为 0.90
        </button>
        <button
          className="btn"
          onClick={() => {
            const v = 0.35
            setWeights(Object.fromEntries(Array.from({ length: lanes }).map((_, i) => [`${obstacleId}:${i}`, v])))
          }}
        >
          全部设为 0.35
        </button>
      </div>
    </Modal>
  )
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
