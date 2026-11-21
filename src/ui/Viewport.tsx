import { useEffect, useRef, useState } from 'react'
import { StationScene } from '../three/scene.ts'
import { useApp, useSim, defaultObstacleProps, type Tool } from '../state/store.ts'
import type { LiveClient } from '../state/liveClient.ts'
import type { Vec2 } from '../core/types.ts'
import { obstacleCorners } from '../core/geometry.ts'
import { Legend, DensityReadout } from './components/Legend.tsx'
import { Timeline, type TimelineMarker } from './components/Timeline.tsx'
import { DENSITY_ENCODE_MAX } from '../core/format.ts'
import { fmtTime } from './components/controls.tsx'

export interface ViewPrefs {
  showZones: boolean
  showObstacles: boolean
  showAgents: boolean
  showHeat: boolean
  showGrid: boolean
  showBands: boolean
  heatOpacity: number
  cameraMode: 'orbit' | 'top'
}

export function Viewport({
  client,
  prefs,
  markers,
  onEditDoc,
  onGateEdit,
  onSeekInfo,
}: {
  client: LiveClient | null
  prefs: ViewPrefs
  markers: TimelineMarker[]
  onEditDoc: () => void
  onGateEdit: (obstacleId: string, laneIndex: number, weight: number) => void
  onSeekInfo: (frame: number, time: number) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StationScene | null>(null)
  const [ready, setReady] = useState(false)
  const [readout, setReadout] = useState<{ x: number; y: number; pos: Vec2; density: number | null } | null>(null)
  const [hoverRect, setHoverRect] = useState<Vec2[] | null>(null)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const heatRef = useRef<Uint8Array | null>(null)
  const dragRef = useRef<{ id: string; start: Vec2; center0: Vec2; moved: boolean } | null>(null)
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null)
  const shiftHeld = useRef(false)

  const doc = useApp((s) => s.doc)
  const mode = useApp((s) => s.mode)
  const tool = useApp((s) => s.tool)
  const selection = useApp((s) => s.selection)
  const draft = useApp((s) => s.draft)
  const draftKind = useApp((s) => s.draftKind)
  const draftCursor = useApp((s) => s.draftCursor)
  const obstacleKind = useApp((s) => s.obstacleKind)

  const simRunning = useSim((s) => s.running)
  const simPlayhead = useSim((s) => s.playhead)
  const info = useSim((s) => s.info)
  const busy = useSim((s) => s.busy)

  // ---------- 初始化场景 ----------
  useEffect(() => {
    if (!hostRef.current) return
    const scene = new StationScene(hostRef.current, useApp.getState().doc)
    sceneRef.current = scene
    scene.setOptions(prefs)
    setReady(true)
    let raf = 0
    let last = performance.now()
    const loop = () => {
      raf = requestAnimationFrame(loop)
      const now = performance.now()
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const st = useSim.getState()
      if (st.running && client) {
        // 播放头不得越过已生成的帧, 避免显示"未来"的空帧
        const horizon = Math.max(0, (st.frameEnd - 1) * 0.2)
        const next = Math.min(st.playhead + dt * st.speed, horizon)
        if (next >= st.duration - 1e-6) {
          client.setPlayhead(st.duration)
          client.pause()
        } else if (next > st.playhead + 1e-6) {
          client.setPlayhead(next)
        }
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      scene.dispose()
      sceneRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client])

  // ---------- 文档变化 ----------
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.setDoc(doc)
  }, [doc, ready])

  // ---------- 选项 ----------
  useEffect(() => {
    const sc = sceneRef.current
    if (!sc) return
    sc.setOptions(prefs)
    sc.setShowBands(prefs.showBands)
    sc.setHeatOpacity(prefs.heatOpacity)
  }, [prefs, ready])
  // 切换 2D/3D 时相机需要重新取景
  useEffect(() => {
    if (!ready) return
    sceneRef.current?.fitCamera()
  }, [prefs.cameraMode, ready])

  // ---------- 选中态 ----------
  useEffect(() => {
    const sc = sceneRef.current
    if (!sc) return
    sc.showSelection(
      selection.kind === 'obstacle' ? selection.id : null,
      selection.kind === 'zone' ? selection.id : null,
    )
  }, [selection, doc, ready])

  // ---------- 绘制草稿 ----------
  useEffect(() => {
    sceneRef.current?.showDraft(draft, draftCursor)
  }, [draft, draftCursor, ready])

  // ---------- 热力 & 行人 ----------
  useEffect(() => {
    if (!client) return
    const off1 = client.onHeat((f) => {
      heatRef.current = f.data
      sceneRef.current?.setHeat(f.data)
    })
    const off2 = client.onAgents((a) => {
      sceneRef.current?.setAgents(a)
    })
    return () => {
      off1()
      off2()
    }
  }, [client])

  // ---------- 键盘 ----------
  useEffect(() => {
    const st = useApp.getState
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const s = st()
      if (e.key === 'Escape') {
        if (s.draftKind) s.cancelDraft()
        else if (s.selection.kind !== 'none') s.select({ kind: 'none' })
      } else if (e.key === 'Enter') {
        if (s.draftKind) s.commitDraft()
      } else if ((e.key === 'z' && (e.ctrlKey || e.metaKey)) || e.key === 'Z') {
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault()
          if (e.shiftKey) s.redo()
          else s.undo()
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.draftKind) {
          e.preventDefault()
          s.removeLastDraftPoint()
        } else if (s.selection.kind !== 'none') {
          e.preventDefault()
          s.deleteSelection()
        }
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        s.duplicateSelection()
      } else if (e.key === ' ') {
        e.preventDefault()
        client?.toggle()
      } else if (e.key === 'r') {
        client?.reset()
      } else if (e.key === '?') {
        window.dispatchEvent(new CustomEvent('phs:help'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [client])

  // ---------- 指针交互 ----------
  const toNDC = (ev: React.PointerEvent) => ({ clientX: ev.clientX, clientY: ev.clientY })

  const densityAt = (p: Vec2): number | null => {
    const heat = heatRef.current
    const sc = sceneRef.current
    if (!heat || !sc) return null
    const b = sc.getHeatBounds()
    const u = (p[0] - b.minX) / b.w
    const v = (p[1] - b.minZ) / b.d
    if (u < 0 || v < 0 || u > 1 || v > 1) return null
    const S = 512
    const i = Math.min(S - 1, Math.max(0, Math.floor(u * S)))
    const j = Math.min(S - 1, Math.max(0, Math.floor(v * S)))
    const code = heat[j * S + i]
    return (code / 255) * DENSITY_ENCODE_MAX
  }

  const onPointerMove = (ev: React.PointerEvent) => {
    const sc = sceneRef.current
    if (!sc) return
    const gp = sc.groundPoint(toNDC(ev))
    if (gp) {
      const dens = densityAt(gp)
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
      setReadout({ x: ev.clientX - rect.left, y: ev.clientY - rect.top, pos: gp, density: dens })
    }
    // 拖拽障碍物
    const dr = dragRef.current
    if (dr && gp) {
      const dx = gp[0] - dr.start[0]
      const dz = gp[1] - dr.start[1]
      if (Math.abs(dx) + Math.abs(dz) > 0.15) {
        dr.moved = true
        useApp.getState().setObstacle(
          dr.id,
          { center: [round2(dr.center0[0] + dx), round2(dr.center0[1] + dz)] },
          '移动障碍物',
        )
      }
    }
    // 绘制草稿的跟随点
    if (draftKind && gp) {
      useApp.getState().setDraftCursor(gp)
    } else if (!draftKind && tool !== 'select' && tool !== 'pan' && gp) {
      // 预览新障碍物位置
      setHoverRect(hoverPreview(gp, tool, obstacleKind))
    } else if (hoverRect) {
      setHoverRect(null)
    }
  }

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return
    shiftHeld.current = ev.shiftKey
    const sc = sceneRef.current
    if (!sc) return
    pointerDownAt.current = { x: ev.clientX, y: ev.clientY }
    const gp = sc.groundPoint(toNDC(ev))
    const s = useApp.getState()

    if (mode !== 'edit') {
      // 仿真中: 点击闸机可弹出权重编辑 (由上层处理)
      const pick = sc.pick(toNDC(ev))
      if (pick?.kind === 'obstacle' && pick.id) {
        const o = s.doc.obstacles.find((x) => x.id === pick.id)
        if (o?.kind === 'gate') {
          s.select({ kind: 'obstacle', id: o.id })
          onGateEdit(o.id, -1, o.weight)
        }
      }
      return
    }

    // 绘图模式
    if (draftKind) {
      if (gp) s.addDraftPoint(gp)
      return
    }
    if (tool === 'zone') {
      if (gp) {
        s.startDraft('zone', s.draftZoneKind)
        s.addDraftPoint(gp)
      }
      return
    }
    if (tool === 'obstacle' || tool === 'gate' || tool === 'escalator' || tool === 'column' || tool === 'stair') {
      if (gp) placeObstacle(gp, tool)
      return
    }

    // 选择 / 拖动
    const pick = sc.pick(toNDC(ev))
    if (!pick) return
    if (pick.kind === 'obstacle' && pick.id) {
      s.select({ kind: 'obstacle', id: pick.id })
      const o = s.doc.obstacles.find((x) => x.id === pick.id)
      if (o && gp) dragRef.current = { id: o.id, start: gp, center0: [...o.center] as Vec2, moved: false }
    } else if (pick.kind === 'zone' && pick.id) {
      s.select({ kind: 'zone', id: pick.id })
    } else {
      s.select({ kind: 'none' })
    }
    onEditDoc()
  }

  const onPointerUp = () => {
    const dr = dragRef.current
    if (dr) {
      if (dr.moved) onEditDoc()
      dragRef.current = null
    }
    pointerDownAt.current = null
  }

  const onDoubleClick = () => {
    const s = useApp.getState()
    if (s.draftKind) s.commitDraft()
  }

  const placeObstacle = (p: Vec2, t: Tool) => {
    const s = useApp.getState()
    const kind = t === 'obstacle' ? s.obstacleKind : t === 'gate' ? 'gate' : t === 'escalator' ? 'escalator' : t === 'column' ? 'column' : 'stair'
    const props = defaultObstacleProps(kind)
    const id = `obs_${Math.random().toString(36).slice(2, 8)}`
    s.updateDoc((d) => {
      d.obstacles.push({
        id,
        kind,
        name: props.name ?? '障碍物',
        center: [round2(p[0]), round2(p[1])],
        rotation: 0,
        size: props.size ?? [2, 2],
        height: props.height ?? 1.2,
        weight: props.weight ?? 0.5,
        capacity: props.capacity ?? 40,
        gateCount: kind === 'gate' ? (props.gateCount ?? 4) : undefined,
        gateWeights: kind === 'gate' ? Array.from({ length: props.gateCount ?? 4 }, () => 0.9) : undefined,
        gateCapacities: kind === 'gate' ? Array.from({ length: props.gateCount ?? 4 }, () => 45) : undefined,
        enabled: true,
        solid: props.solid ?? true,
        color: props.color,
        beltSpeed: props.beltSpeed,
      })
    }, '放置障碍物')
    s.select({ kind: 'obstacle', id })
    // 放置后切回选择工具, 便于立即拖动/微调 (按住 Shift 可连续放置)
    if (!shiftHeld.current) s.setTool('select')
    onEditDoc()
  }

  const cancelDraw = () => {
    useApp.getState().cancelDraft()
    setHoverRect(null)
  }

  const showTimeline = mode !== 'edit'

  return (
    <div className="viewport-wrap">
      <div className="viewport" ref={hostRef} onPointerMove={onPointerMove} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerLeave={() => setReadout(null)} onDoubleClick={onDoubleClick} />

      {/* 顶部工具条 */}
      {mode === 'edit' && (
        <div className="toolbar">
          <div className="toolgroup">
            <button className={tool === 'select' && !draftKind ? 'active' : ''} onClick={() => useApp.getState().setTool('select')} title="选择 (Esc)">
              ▣ 选择
            </button>
            <div className="sep" />
            <button
              className={draftKind === 'outline' ? 'active' : ''}
              onClick={() => useApp.getState().startDraft('outline')}
              title="绘制站台外轮廓"
            >
              ⬠ 轮廓
            </button>
            <button
              className={tool === 'zone' || draftKind === 'zone' ? 'active' : ''}
              onClick={() => {
                useApp.getState().setTool('zone')
                useApp.getState().startDraft('zone', useApp.getState().draftZoneKind)
              }}
              title="圈定区块"
            >
              ▤ 区块
            </button>
          </div>
          <div className="toolgroup">
            <span className="toolgroup-label">障碍</span>
            {(
              [
                ['gate', '闸机'],
                ['escalator', '扶梯'],
                ['column', '立柱'],
                ['stair', '楼梯'],
                ['barrier', '护栏'],
                ['shop', '商铺'],
              ] as [typeof obstacleKind, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                className={tool === 'obstacle' && obstacleKind === k ? 'active' : ''}
                onClick={() => {
                  useApp.getState().setObstacleKind(k)
                  useApp.getState().setTool('obstacle')
                }}
                title={`放置${label}`}
              >
                {label}
              </button>
            ))}
          </div>
          {draftKind && (
            <div className="toolgroup">
              <span className="toolgroup-label" style={{ color: 'var(--warn)' }}>
                {draft.length} 点
              </span>
              <button onClick={() => useApp.getState().commitDraft()} disabled={draft.length < 3} title="闭合 (Enter)">
                ✓ 闭合
              </button>
              <button onClick={() => useApp.getState().removeLastDraftPoint()} disabled={!draft.length}>
                ⌫ 撤点
              </button>
              <button onClick={cancelDraw} title="取消 (Esc)">
                ✕ 取消
              </button>
            </div>
          )}
          {tool === 'zone' && !draftKind && (
            <div className="toolgroup">
              <span className="toolgroup-label">区块类型</span>
              {(
                [
                  ['paid', '付费区'],
                  ['unpaid', '非付费区'],
                  ['stair', '楼梯口'],
                  ['entry', '进站口'],
                  ['platform-edge', '站台边缘'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  className={useApp.getState().draftZoneKind === k ? 'active' : ''}
                  onClick={() => {
                    useApp.setState({ draftZoneKind: k })
                    useApp.getState().startDraft('zone', k)
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 悬浮统计 */}
      {mode !== 'edit' && <SimHud />}

      {/* 图例 */}
      {mode !== 'edit' && <Legend collapsed={legendCollapsed} onToggle={() => setLegendCollapsed((c) => !c)} />}

      {/* 时间轴 */}
      {showTimeline && client && (
        <Timeline
          client={client}
          markers={markers}
          onFrameInfo={onSeekInfo}
          aboveLegend={!legendCollapsed}
        />
      )}

      {/* 读数 */}
      {mode !== 'edit' && readout && <DensityReadout position={{ x: readout.x, y: readout.y }} density={readout.density} pos={{ x: readout.pos[0], z: readout.pos[1] }} />}

      {/* 编辑态提示 */}
      {mode === 'edit' && (
        <div className="tip-bar" style={{ bottom: showTimeline ? 74 : 10 }}>
          {draftKind
            ? `单击添加顶点（已 ${draft.length} 个）· 双击或 Enter 闭合 · Backspace 撤点 · Esc 取消`
            : tool === 'select'
              ? '单击选择 · 拖动移动 · Delete 删除 · Ctrl+D 复制 · Ctrl+Z 撤销'
              : tool === 'zone'
                ? '单击开始绘制区块 · 双击闭合'
                : '单击放置障碍物 · 选中后在右侧调整权重与承载人数'}
        </div>
      )}

      {/* 预热/忙碌遮罩 */}
      {busy && (
        <div className="loading">
          <div className="loading-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="spinner" />
              <span>{busy}</span>
            </div>
          </div>
        </div>
      )}

      {/* 就绪状态 & 源汇统计 (左上角第二行) */}
      {mode !== 'edit' && info && (
        <div className="hud nav-hud" style={{ right: 'auto', left: 10, top: 10, alignItems: 'flex-start' }}>
          <div className="hud-card" style={{ minWidth: 0 }}>
            <div className="hud-kv" style={{ fontSize: 10.5 }}>
              <span className="k">导航网格</span>
              <span className="v">
                {info.cols}×{info.rows} @ {info.cell.toFixed(2)}m
              </span>
            </div>
            <div className="hud-kv" style={{ fontSize: 10.5 }}>
              <span className="k">进站口 / 楼梯口</span>
              <span className="v">
                {info.sources} / {info.sinks}
              </span>
            </div>
            <div className="hud-kv" style={{ fontSize: 10.5 }}>
              <span className="k">闸机通道</span>
              <span className="v">{info.lanes}</span>
            </div>
          </div>
        </div>
      )}

      {mode === 'edit' && simRunning && (
        <div className="tip-bar" style={{ bottom: 74 }}>
          仿真运行中 — 请切到「仿真」页查看热力
        </div>
      )}
      <div className="hidden">{fmtTime(simPlayhead)}</div>
    </div>
  )
}

function SimHud() {
  const stats = useSim((s) => s.stats)
  const agentCount = useSim((s) => s.renderedAgents)
  const imported = useSim((s) => s.imported)
  if (!stats) return null
  const occ = stats.occupancy
  return (
    <div className="hud">
      <div className="hud-card">
        <div className="hud-kv">
          <span className="k">在场人数</span>
          <span className="v">{occ.toLocaleString()}</span>
        </div>
        <div className="hud-kv">
          <span className="k">已疏散</span>
          <span className="v">{stats.served.toLocaleString()}</span>
        </div>
        <div className="hud-kv">
          <span className="k">平均速度</span>
          <span className="v">{stats.meanSpeed.toFixed(2)} m/s</span>
        </div>
        <div className="hud-kv">
          <span className="k">峰值密度</span>
          <span className={`v ${stats.maxDensity > 6 ? 'bad' : stats.maxDensity > 3.8 ? 'warn' : ''}`}>
            {stats.maxDensity.toFixed(2)}
          </span>
        </div>
        <div className="hud-kv">
          <span className="k">闸机排队</span>
          <span className="v">{stats.waitingAtGates.toLocaleString()}</span>
        </div>
        {imported && (
          <div className="hud-kv">
            <span className="k">来源</span>
            <span className="v" style={{ fontSize: 10 }}>
              导入回放
            </span>
          </div>
        )}
        {agentCount > 0 && (
          <div className="hud-kv">
            <span className="k">渲染行人</span>
            <span className="v">
              {agentCount.toLocaleString()}
              {agentCount >= 5000 ? ' (抽样)' : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function hoverPreview(p: Vec2, _tool: Tool, kind: string): Vec2[] {
  const s = kind === 'gate' ? [3.2, 0.42] : kind === 'escalator' ? [12, 2.4] : kind === 'column' ? [0.9, 0.9] : kind === 'shop' ? [8, 3] : [2, 2]
  return obstacleCorners({
    id: '',
    kind: 'custom',
    name: '',
    center: p,
    rotation: 0,
    size: s as Vec2,
    height: 1,
    weight: 0.5,
    capacity: 1,
    enabled: true,
    solid: true,
  })
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
