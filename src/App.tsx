import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp, useSim, type Mode } from './state/store.ts'
import { LiveClient } from './state/liveClient.ts'
import { Viewport, type ViewPrefs } from './ui/Viewport.tsx'
import { StationEditor, SimParamsPanel } from './ui/modules/StationEditor.tsx'
import { ArrivalPanel, DataPanel } from './ui/modules/ArrivalPanel.tsx'
import { InspectorPanel, GateWeightDialog } from './ui/modules/Inspector.tsx'
import { GatePanel } from './ui/modules/GatePanel.tsx'
import { HelpDialog } from './ui/components/HelpDialog.tsx'
import { StationLibrary, ReplayLibrary, BusyOverlay } from './ui/modules/Library.tsx'
import { useDataActions } from './ui/dataActions.ts'
import type { TimelineMarker } from './ui/components/Timeline.tsx'
import { DEFAULT_PREFS, loadPrefs, savePrefs, type Prefs } from './core/storage.ts'
import { getRun } from './core/storage.ts'
import { fmtBytes } from './ui/components/controls.tsx'

const MODES: { value: Mode; label: string }[] = [
  { value: 'edit', label: '站台编辑' },
  { value: 'sim', label: '仿真' },
  { value: 'replay', label: '回放' },
]

export default function App() {
  const mode = useApp((s) => s.mode)
  const setMode = useApp((s) => s.setMode)
  const doc = useApp((s) => s.doc)
  const [prefs, setPrefs] = useState<ViewPrefs>(() => ({ ...DEFAULT_PREFS, ...loadPrefs() }))
  const [client, setClient] = useState<LiveClient | null>(null)
  const [showStationLib, setShowStationLib] = useState(false)
  const [showReplayLib, setShowReplayLib] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [gateDialog, setGateDialog] = useState<string | null>(null)
  const [gateMarkers, setGateMarkers] = useState<TimelineMarker[]>([])
  const clientRef = useRef<LiveClient | null>(null)
  const docRef = useRef(doc)
  const lastRebuiltDoc = useRef<string>('')

  // 初始化仿真客户端 (只创建一次)
  useEffect(() => {
    const c = new LiveClient(useApp.getState().doc)
    clientRef.current = c
    lastRebuiltDoc.current = geometrySignature(useApp.getState().doc)
    setClient(c)
    const off = c.onError((m) => {
      useApp.getState().toast(`仿真错误: ${m}`, 'error')
    })
    return () => {
      off()
      c.dispose()
      if (clientRef.current === c) clientRef.current = null
      setClient((cur) => (cur === c ? null : cur))
    }
  }, [])

  // 文档变更时重建仿真 (防抖, 只重建几何相关部分)
  useEffect(() => {
    docRef.current = doc
    const c = clientRef.current
    if (!c) return
    const sig = geometrySignature(doc)
    if (sig === lastRebuiltDoc.current) return
    const t = setTimeout(() => {
      if (!clientRef.current) return
      lastRebuiltDoc.current = sig
      clientRef.current.updateDoc(doc)
      useSim.setState({ duration: doc.params.duration, recomputing: false, recomputeProgress: 0 })
    }, 420)
    return () => clearTimeout(t)
  }, [doc])

  // 切换模式: 进入仿真时自动暂停回放
  useEffect(() => {
    if (mode === 'edit') clientRef.current?.pause()
  }, [mode])

  // 偏好持久化
  useEffect(() => {
    savePrefs(prefs as unknown as Prefs)
  }, [prefs])

  const actions = useDataActions(client)

  const markers: TimelineMarker[] = useMemo(() => gateMarkers, [gateMarkers])

  const handleOpenStation = useCallback((d: typeof doc) => {
    useApp.getState().loadStation(d)
    lastRebuiltDoc.current = ''
    clientRef.current?.pause()
    setShowStationLib(false)
    useApp.getState().toast(`已打开「${d.meta.name}」`, 'success')
  }, [])

  const handleOpenRun = useCallback(async (meta: { id: string; name: string }) => {
    const run = await getRun(meta.id)
    if (!run) return
    useSim.setState({ busy: '正在载入回放…' })
    useApp.getState().loadStation(run.doc)
    lastRebuiltDoc.current = geometrySignature(run.doc)
    await new Promise((r) => setTimeout(r, 30))
    clientRef.current?.loadRun(
      run.doc,
      run.frames.map((f, i) => {
        const snap = run.agentsSnapshots.find((a) => Math.abs(a.time - f.time) < 0.05)
        return { frame: i, time: f.time, compressed: f.compressed, stats: f.stats, agents: snap?.agents }
      }),
      run.agentsSnapshots,
    )
    setMode('replay')
    setShowReplayLib(false)
    setGateMarkers((run.gateEvents ?? []).map((e) => ({ time: e.time, label: `${e.label} ${e.time.toFixed(1)}s`, kind: 'gate' })))
    useSim.setState({ busy: null, imported: true, importName: run.doc.meta.name })
    useApp.getState().toast(`已载入回放「${meta.name}」`, 'success')
  }, [setMode])

  // '?' 快捷键打开帮助
  useEffect(() => {
    const onHelp = () => setShowHelp(true)
    window.addEventListener('phs:help', onHelp)
    return () => window.removeEventListener('phs:help', onHelp)
  }, [])

  // 导入后自动打开回放
  useEffect(() => {
    const onOpen = (ev: Event) => {
      const id = (ev as CustomEvent<{ id: string }>).detail?.id
      if (id) handleOpenRun({ id, name: '导入的仿真包' })
    }
    window.addEventListener('phs:open-replay', onOpen as EventListener)
    return () => window.removeEventListener('phs:open-replay', onOpen as EventListener)
  }, [handleOpenRun])

  const onGateEdit = useCallback((id: string) => {
    setGateDialog(id)
  }, [])

  /** Inspector 中直接调整整组闸机权重时, 也从当前帧联动重算 */
  const onGateWeight = useCallback((id: string, weight: number) => {
    clientRef.current?.setGateWeights([{ obstacleId: id, weight }])
    const t = useSim.getState().playhead
    setGateMarkers((m) => [...m.slice(-40), { time: t, label: `闸机权重 ${t.toFixed(1)}s`, kind: 'gate' }])
  }, [])

  const applyGateChanges = useCallback(
    (changes: { obstacleId: string; laneIndex?: number; weight?: number; capacity?: number }[]) => {
      const s = useApp.getState()
      s.updateDoc((d) => {
        for (const c of changes) {
          const o = d.obstacles.find((x) => x.id === c.obstacleId)
          if (!o) continue
          const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
          if (c.laneIndex === undefined) {
            if (c.weight !== undefined) o.weight = c.weight
          } else {
            const gw = o.gateWeights ? [...o.gateWeights] : new Array(lanes).fill(o.weight)
            gw[c.laneIndex] = c.weight ?? gw[c.laneIndex]
            o.gateWeights = gw
            if (c.capacity !== undefined) {
              const gc = o.gateCapacities ? [...o.gateCapacities] : new Array(lanes).fill(o.capacity / lanes)
              gc[c.laneIndex] = c.capacity
              o.gateCapacities = gc
            }
          }
        }
      }, '修改闸机权重')
      clientRef.current?.setGateWeights(changes)
      const t = useSim.getState().playhead
      setGateMarkers((m) => [...m.slice(-40), { time: t, label: `闸机权重 ${t.toFixed(1)}s`, kind: 'gate' }])
      // 保持几何签名不变, 避免触发整站重建
      lastRebuiltDoc.current = geometrySignature(useApp.getState().doc)
      useApp.getState().toast('已从当前帧向后联动重算', 'success')
    },
    [],
  )

  const sidebarContent = (() => {
    if (mode === 'edit') {
      return (
        <>
          <InspectorPanel onGateEdit={onGateEdit} onGateWeight={onGateWeight} />
          <StationEditor onUpdate={() => undefined} />
        </>
      )
    }
    if (mode === 'sim') {
      return (
        <>
          <GatePanel client={client} onEdit={onGateEdit} />
          <InspectorPanel onGateEdit={onGateEdit} onGateWeight={onGateWeight} />
          <ArrivalPanel />
          <SimParamsPanel client={client} />
          <DataPanel
            onExport={actions.exportRun}
            onImport={actions.importRun}
            onOpenStation={() => setShowStationLib(true)}
            onSaveStation={actions.saveCurrentStation}
            onLoadRun={() => setShowReplayLib(true)}
          />
        </>
      )
    }
    return (
      <>
        <GatePanel client={client} onEdit={onGateEdit} />
        <InspectorPanel onGateEdit={onGateEdit} onGateWeight={onGateWeight} />
        <ArrivalPanel readOnly />
        <SimParamsPanel client={client} readOnly />
        <DataPanel
          onExport={actions.exportRun}
          onImport={actions.importRun}
          onOpenStation={() => setShowStationLib(true)}
          onSaveStation={actions.saveCurrentStation}
          onLoadRun={() => setShowReplayLib(true)}
        />
      </>
    )
  })()

  return (
    <div className="app">
      <TopBar
        mode={mode}
        setMode={setMode}
        onNew={(k) => {
          useApp.getState().newStation(k)
          lastRebuiltDoc.current = ''
        }}
        onOpenStation={() => setShowStationLib(true)}
        onSave={actions.saveCurrentStation}
        onExport={actions.exportRun}
        onImport={actions.importRun}
        onHelp={() => setShowHelp(true)}
        prefs={prefs}
        setPrefs={setPrefs}
      />
      <div className="main">
        <Viewport
          client={client}
          prefs={prefs}
          markers={markers}
          onEditDoc={() => {
            // 文档已经变化, 由上面的防抖 effect 统一重建, 这里无需额外处理
          }}
          onGateEdit={(id) => onGateEdit(id)}
          onSeekInfo={() => undefined}
        />
        <div className="sidebar">
          <div className="sidebar-scroll">{sidebarContent}</div>
          <StatusStrip />
        </div>
      </div>
      <Toasts />
      {showStationLib && <StationLibrary onClose={() => setShowStationLib(false)} onOpen={handleOpenStation} />}
      {showReplayLib && <ReplayLibrary onClose={() => setShowReplayLib(false)} onOpen={handleOpenRun} />}
      {gateDialog && (
        <GateWeightDialog obstacleId={gateDialog} onClose={() => setGateDialog(null)} onApply={applyGateChanges} />
      )}
      <BusyOverlay />
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  )
}

function geometrySignature(doc: ReturnType<typeof useApp.getState>['doc']): string {
  const z = doc.zones.map((z) => `${z.id}:${z.isSink ? 1 : 0}${z.isSource ? 1 : 0}:${z.serviceRate ?? ''}:${z.kind}`).join('|')
  const o = doc.obstacles
    .map((o) => `${o.id}:${o.enabled ? 1 : 0}:${o.center.map((v) => v.toFixed(2)).join(',')}:${o.size.map((v) => v.toFixed(2)).join(',')}:${o.rotation.toFixed(3)}:${o.kind}:${o.gateCount ?? 1}`)
    .join('|')
  const p = `${doc.params.radius}:${doc.params.gridSize}:${doc.params.duration}`
  const ol = doc.outline.outer.map(([x, z]) => `${x.toFixed(2)},${z.toFixed(2)}`).join(';')
  return `${ol}#${z}#${o}#${p}`
}

function TopBar({
  mode,
  setMode,
  onNew,
  onOpenStation,
  onSave,
  onExport,
  onImport,
  onHelp,
  prefs,
  setPrefs,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  onNew: (kind: 'demo' | 'empty') => void
  onOpenStation: () => void
  onSave: () => void
  onExport: () => void
  onImport: (f: File) => void
  onHelp: () => void
  prefs: ViewPrefs
  setPrefs: (fn: (p: ViewPrefs) => ViewPrefs) => void
}) {
  const doc = useApp((s) => s.doc)
  const undo = useApp((s) => s.undo)
  const redo = useApp((s) => s.redo)
  const canUndo = useApp((s) => s.past.length > 0)
  const canRedo = useApp((s) => s.future.length > 0)
  const dirty = useApp((s) => s.dirty)
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-icon">◉</span>
        <span>
          站台客流热力仿真
          <br />
          <small>Platform Heat Simulator</small>
        </span>
      </div>
      <div className="mode-switch">
        {MODES.map((m) => (
          <button key={m.value} className={mode === m.value ? 'active' : ''} onClick={() => setMode(m.value)}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="topbar-spacer" />
      <div className="topbar-actions">
        <span className="tag" style={{ maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis' }} title={doc.meta.name}>
          {doc.meta.name}
          {dirty ? ' *' : ''}
        </span>
        {mode === 'edit' && (
          <>
            <button className="btn sm" onClick={() => onNew('demo')} title="载入示例站台">
              示例
            </button>
            <button className="btn sm" onClick={() => onNew('empty')} title="新建空白站台">
              新建
            </button>
            <button className="btn sm" onClick={undo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
              ↶
            </button>
            <button className="btn sm" onClick={redo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)">
              ↷
            </button>
          </>
        )}
        <button className="btn sm" onClick={onOpenStation} title="站点库">
          站点库
        </button>
        <button className="btn sm" onClick={onSave} title="保存到浏览器">
          保存
        </button>
        <label className="btn sm" title="导入分享包">
          导入
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
        <button className="btn sm primary" onClick={onExport} title="导出仿真包">
          导出
        </button>
        <div className="sep" style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <button
          className={`btn sm ${prefs.cameraMode === 'top' ? 'active' : ''}`}
          onClick={() => setPrefs((p) => ({ ...p, cameraMode: p.cameraMode === 'top' ? 'orbit' : 'top' }))}
          title="切换 2D/3D 视图"
        >
          {prefs.cameraMode === 'top' ? '2D' : '3D'}
        </button>
        <ViewMenu prefs={prefs} setPrefs={setPrefs} />
        <button className="btn sm icon" onClick={onHelp} title="使用说明 (?)">
          ?
        </button>
      </div>
    </div>
  )
}

function ViewMenu({ prefs, setPrefs }: { prefs: ViewPrefs; setPrefs: (fn: (p: ViewPrefs) => ViewPrefs) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen((o) => !o)} title="显示选项">
        显示 ▾
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 6px)',
            background: 'var(--bg-1)',
            border: '1px solid var(--border-2)',
            borderRadius: 10,
            padding: 11,
            minWidth: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            boxShadow: '0 12px 40px rgba(0,0,0,.55)',
            zIndex: 50,
          }}
        >
          {(
            [
              ['showHeat', '热力层'],
              ['showBands', '五档配色 (关闭为连续渐变)'],
              ['showAgents', '行人'],
              ['showZones', '区块'],
              ['showObstacles', '障碍物'],
              ['showGrid', '2m 网格'],
            ] as [keyof ViewPrefs, string][]
          ).map(([k, label]) => (
            <label key={k} className="check-row">
              <input
                type="checkbox"
                checked={Boolean(prefs[k])}
                onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="divider" />
          <div className="field">
            <label>
              <span>热力不透明度</span>
              <span className="val">{Math.round(prefs.heatOpacity * 100)}%</span>
            </label>
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.01}
              value={prefs.heatOpacity}
              onChange={(e) => setPrefs((p) => ({ ...p, heatOpacity: Number(e.target.value) }))}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function StatusStrip() {
  const info = useSim((s) => s.info)
  const stats = useSim((s) => s.stats)
  const running = useSim((s) => s.running)
  const err = useSim((s) => s.workerError)
  const frames = useSim((s) => s.framesAvailable)
  const duration = useSim((s) => s.duration)
  const playhead = useSim((s) => s.playhead)
  const recomputing = useSim((s) => s.recomputing)
  const bytes = frames * 26 * 1024
  return (
    <div className="statusstrip">
      {err ? (
        <span className="bad" title={err}>
          ⚠ 仿真错误
        </span>
      ) : running ? (
        <span className="ok">● 运行中</span>
      ) : (
        <span>○ 暂停</span>
      )}
      <span className="sep">|</span>
      <span>{playhead.toFixed(1)}s / {duration}s</span>
      <span className="sep">|</span>
      <span>{stats ? `${stats.occupancy} 人` : '—'}</span>
      <span className="sep">|</span>
      <span>{frames} 帧 ≈ {fmtBytes(bytes)}</span>
      <span className="sep">|</span>
      <span>512² · 200ms</span>
      {recomputing && (
        <>
          <span className="sep">|</span>
          <span className="warn">联动重算中</span>
        </>
      )}
      <span style={{ marginLeft: 'auto' }}>{info ? `${info.cols}×${info.rows} 网格` : '初始化…'}</span>
    </div>
  )
}

function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
