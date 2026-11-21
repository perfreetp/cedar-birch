// 全局状态 (zustand)
import { create } from 'zustand'
import type { ArrivalCurve, Obstacle, SimParams, StationDoc, Vec2, Zone, ZoneKind } from '../core/types.ts'
import { DEFAULT_OBSTACLE, ZONE_COLORS } from '../core/types.ts'
import { createDemoStation, emptyStation, uid } from '../core/defaults.ts'
import type { FrameStats } from '../sim/engine.ts'

export type Tool = 'select' | 'zone' | 'obstacle' | 'gate' | 'escalator' | 'column' | 'stair' | 'pan'
export type Mode = 'edit' | 'sim' | 'replay'

export type Selection =
  | { kind: 'none' }
  | { kind: 'outline' }
  | { kind: 'zone'; id: string }
  | { kind: 'obstacle'; id: string }

export interface Toast {
  id: string
  text: string
  kind: 'info' | 'error' | 'success'
}

export interface HistoryEntry {
  doc: StationDoc
  label: string
}

export interface AppState {
  doc: StationDoc
  mode: Mode
  tool: Tool
  selection: Selection
  draft: Vec2[]
  draftKind: 'outline' | 'zone' | null
  draftZoneKind: ZoneKind
  draftCursor: Vec2 | null
  obstacleKind: Obstacle['kind']
  past: HistoryEntry[]
  future: HistoryEntry[]
  toasts: Toast[]
  dirty: boolean
  showOutlineWizard: boolean

  setDoc: (doc: StationDoc, label?: string) => void
  updateDoc: (fn: (d: StationDoc) => void, label?: string) => void
  setMode: (m: Mode) => void
  setTool: (t: Tool) => void
  select: (s: Selection) => void
  startDraft: (kind: 'outline' | 'zone', zoneKind?: ZoneKind) => void
  addDraftPoint: (p: Vec2) => void
  setDraftCursor: (p: Vec2 | null) => void
  removeLastDraftPoint: () => void
  commitDraft: () => void
  cancelDraft: () => void
  undo: () => void
  redo: () => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: string) => void
  setObstacleKind: (k: Obstacle['kind']) => void
  setObstacle: (id: string, patch: Partial<Obstacle>, label?: string) => void
  setZone: (id: string, patch: Partial<Zone>, label?: string) => void
  setParams: (patch: Partial<SimParams>, label?: string) => void
  setCurve: (id: string, patch: Partial<ArrivalCurve>, label?: string) => void
  addCurve: () => string
  removeCurve: (id: string) => void
  loadStation: (doc: StationDoc) => void
  newStation: (kind: 'demo' | 'empty') => void
  deleteSelection: () => void
  duplicateSelection: () => void
  setShowOutlineWizard: (v: boolean) => void
}

const clone = (d: StationDoc): StationDoc => JSON.parse(JSON.stringify(d)) as StationDoc

let toastSeq = 0

export const useApp = create<AppState>((set, get) => ({
  doc: createDemoStation(),
  mode: 'edit',
  tool: 'select',
  selection: { kind: 'none' },
  draft: [],
  draftKind: null,
  draftCursor: null,
  draftZoneKind: 'paid',
  obstacleKind: 'column',
  past: [],
  future: [],
  toasts: [],
  dirty: false,
  showOutlineWizard: false,

  setDoc: (doc, label = '修改') => {
    const prev = get().doc
    set((s) => ({ doc, past: [...s.past.slice(-49), { doc: clone(prev), label }], future: [], dirty: true }))
  },

  updateDoc: (fn, label = '修改') => {
    const prev = get().doc
    const next = clone(prev)
    fn(next)
    next.updatedAt = Date.now()
    set((s) => ({ doc: next, past: [...s.past.slice(-49), { doc: clone(prev), label }], future: [], dirty: true }))
  },

  setMode: (mode) => set({ mode, draft: [], draftKind: null, draftCursor: null }),
  setTool: (tool) => set((s) => ({ tool, draft: [], draftKind: null, draftCursor: null, selection: tool === 'select' ? s.selection : { kind: 'none' } })),
  select: (selection) => set({ selection }),

  startDraft: (kind, zoneKind) =>
    set({ draft: [], draftKind: kind, draftZoneKind: zoneKind ?? get().draftZoneKind, draftCursor: null }),

  addDraftPoint: (p) =>
    set((s) => {
      if (!s.draftKind) return {}
      const last = s.draft[s.draft.length - 1]
      if (last && Math.hypot(last[0] - p[0], last[1] - p[1]) < 0.15) return {}
      return { draft: [...s.draft, [round2(p[0]), round2(p[1])] as Vec2] }
    }),

  setDraftCursor: (draftCursor) => set({ draftCursor }),

  removeLastDraftPoint: () => set((s) => ({ draft: s.draft.slice(0, -1) })),

  commitDraft: () => {
    const { draft, draftKind, draftZoneKind } = get()
    if (!draftKind || draft.length < 3) {
      set({ draft: [], draftKind: null, draftCursor: null })
      if (draftKind) get().toast('至少需要 3 个点才能闭合多边形', 'error')
      return
    }
    if (draftKind === 'outline') {
      get().updateDoc((d) => {
        d.outline = { ...d.outline, outer: draft.map((p) => [...p] as Vec2) }
      }, '设置站台轮廓')
      get().toast('站台轮廓已更新', 'success')
    } else {
      const id = uid('zone')
      get().updateDoc((d) => {
        const label =
          draftZoneKind === 'paid'
            ? '付费区'
            : draftZoneKind === 'unpaid'
              ? '非付费区'
              : draftZoneKind === 'stair'
                ? '楼梯口'
                : draftZoneKind === 'entry'
                  ? '进站口'
                  : '区块'
        d.zones.push({
          id,
          name: `${label}${d.zones.filter((z) => z.kind === draftZoneKind).length + 1}`,
          kind: draftZoneKind,
          polygon: draft.map((p) => [...p] as Vec2),
          color: ZONE_COLORS[draftZoneKind],
          isSink: draftZoneKind === 'stair',
          serviceRate: draftZoneKind === 'stair' ? 10 : undefined,
          isSource: draftZoneKind === 'entry',
          arrivalCurveId: draftZoneKind === 'entry' ? d.curves[0]?.id : undefined,
          weight: draftZoneKind === 'entry' ? 1 : undefined,
        })
      }, '圈定区块')
      set({ selection: { kind: 'zone', id } })
      get().toast('区块已创建', 'success')
    }
    set({ draft: [], draftKind: null, draftCursor: null })
  },

  cancelDraft: () => set({ draft: [], draftKind: null, draftCursor: null }),

  undo: () => {
    const { past, future, doc } = get()
    if (!past.length) return
    const entry = past[past.length - 1]
    set({
      doc: entry.doc,
      past: past.slice(0, -1),
      future: [{ doc: clone(doc), label: entry.label }, ...future].slice(0, 50),
      dirty: true,
    })
  },

  redo: () => {
    const { past, future, doc } = get()
    if (!future.length) return
    const entry = future[0]
    set({ doc: entry.doc, past: [...past, { doc: clone(doc), label: entry.label }], future: future.slice(1), dirty: true })
  },

  toast: (text, kind = 'info') => {
    const id = `t${++toastSeq}`
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind }] }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  setObstacleKind: (k) => set({ obstacleKind: k }),

  setObstacle: (id, patch, label = '修改障碍物') =>
    get().updateDoc((d) => {
      const o = d.obstacles.find((x) => x.id === id)
      if (o) Object.assign(o, patch)
    }, label),

  setZone: (id, patch, label = '修改区块') =>
    get().updateDoc((d) => {
      const z = d.zones.find((x) => x.id === id)
      if (z) Object.assign(z, patch)
    }, label),

  setParams: (patch, label = '修改参数') =>
    get().updateDoc((d) => {
      Object.assign(d.params, patch)
    }, label),

  setCurve: (id, patch, label = '修改到达曲线') =>
    get().updateDoc((d) => {
      const c = d.curves.find((x) => x.id === id)
      if (c) Object.assign(c, patch)
    }, label),

  addCurve: () => {
    const id = uid('curve')
    get().updateDoc((d) => {
      d.curves.push({
        id,
        name: `到达曲线 ${d.curves.length + 1}`,
        points: [
          [0, 0],
          [120, 30],
          [360, 20],
          [600, 5],
        ],
        color: ['#4cc9f0', '#f72585', '#b5179e', '#ffd166', '#06d6a0'][d.curves.length % 5],
      })
    }, '新建到达曲线')
    return id
  },

  removeCurve: (id) =>
    get().updateDoc((d) => {
      if (d.curves.length <= 1) return
      d.curves = d.curves.filter((c) => c.id !== id)
      for (const z of d.zones) if (z.arrivalCurveId === id) z.arrivalCurveId = d.curves[0].id
    }, '删除到达曲线'),

  loadStation: (doc) =>
    set({
      doc,
      past: [],
      future: [],
      selection: { kind: 'none' },
      draft: [],
      draftKind: null,
      draftCursor: null,
      mode: 'edit',
      dirty: false,
    }),

  newStation: (kind) => {
    const doc = kind === 'demo' ? createDemoStation() : emptyStation()
    set({
      doc,
      past: [],
      future: [],
      selection: { kind: 'none' },
      draft: [],
      draftKind: null,
      draftCursor: null,
      mode: 'edit',
      dirty: true,
    })
  },

  deleteSelection: () => {
    const sel = get().selection
    if (sel.kind === 'zone') {
      get().updateDoc((d) => {
        d.zones = d.zones.filter((z) => z.id !== sel.id)
      }, '删除区块')
      set({ selection: { kind: 'none' } })
    } else if (sel.kind === 'obstacle') {
      get().updateDoc((d) => {
        d.obstacles = d.obstacles.filter((o) => o.id !== sel.id)
      }, '删除障碍物')
      set({ selection: { kind: 'none' } })
    }
  },

  duplicateSelection: () => {
    const sel = get().selection
    if (sel.kind === 'obstacle') {
      const src = get().doc.obstacles.find((o) => o.id === sel.id)
      if (!src) return
      const id = uid('obs')
      get().updateDoc((d) => {
        d.obstacles.push({ ...JSON.parse(JSON.stringify(src)), id, center: [src.center[0] + src.size[0] + 0.6, src.center[1]] })
      }, '复制障碍物')
      set({ selection: { kind: 'obstacle', id } })
    } else if (sel.kind === 'zone') {
      const src = get().doc.zones.find((z) => z.id === sel.id)
      if (!src) return
      const id = uid('zone')
      const minX = Math.min(...src.polygon.map((p) => p[0]))
      const maxX = Math.max(...src.polygon.map((p) => p[0]))
      const dx = maxX - minX + 1
      get().updateDoc((d) => {
        d.zones.push({
          ...JSON.parse(JSON.stringify(src)),
          id,
          name: `${src.name} 副本`,
          polygon: src.polygon.map(([x, z]) => [x + dx, z] as Vec2),
        })
      }, '复制区块')
      set({ selection: { kind: 'zone', id } })
    }
  },

  setShowOutlineWizard: (v) => set({ showOutlineWizard: v }),
}))

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

export function defaultObstacleSize(kind: Obstacle['kind']): Vec2 {
  switch (kind) {
    case 'gate':
      return [3.2, 0.42]
    case 'escalator':
      return [12, 2.4]
    case 'column':
      return [0.9, 0.9]
    case 'stair':
      return [6, 3]
    case 'barrier':
      return [4, 0.25]
    case 'shop':
      return [8, 3]
    default:
      return [2, 2]
  }
}

export function defaultObstacleProps(kind: Obstacle['kind']): Partial<Obstacle> {
  const base: Partial<Obstacle> = { ...DEFAULT_OBSTACLE, kind, size: defaultObstacleSize(kind) }
  switch (kind) {
    case 'gate':
      return { ...base, name: '闸机组', height: 1.0, weight: 0.9, capacity: 180, gateCount: 4, solid: true, color: '#5b8def' }
    case 'escalator':
      return { ...base, name: '扶梯', height: 1.1, weight: 0.95, capacity: 40, solid: true, beltSpeed: 0.65, color: '#7f8c9b' }
    case 'column':
      return { ...base, name: '立柱', height: 3.2, weight: 0.15, capacity: 6, solid: true, color: '#c9ced8' }
    case 'stair':
      return { ...base, name: '楼梯', height: 0.9, weight: 0.9, capacity: 60, solid: true, color: '#e9c46a' }
    case 'barrier':
      return { ...base, name: '护栏', height: 1.0, weight: 0.1, capacity: 4, solid: true, color: '#94a3b8' }
    case 'shop':
      return { ...base, name: '商铺', height: 3, weight: 0.05, capacity: 30, solid: true, color: '#6b7280' }
    default:
      return base
  }
}

// ---- 仿真 UI 状态 ----
export interface SimState {
  running: boolean
  speed: number
  playhead: number
  duration: number
  frameStart: number
  frameEnd: number
  framesAvailable: number
  displayFrame: number
  stats: FrameStats | null
  agentCount: number
  renderedAgents: number
  info: {
    cols: number
    rows: number
    cell: number
    walkableCells: number
    sources: number
    sinks: number
    lanes: number
    totalArea: number
    spawnRate: number
    steadyEstimate: number
  } | null
  recomputing: boolean
  recomputeProgress: number
  recomputePhase: string
  scrubbing: boolean
  workerError: string | null
  agentSnapshotTime: number
  imported: boolean
  importName: string | null
  busy: string | null
  busyProgress: number
}

export const useSim = create<SimState>(() => ({
  running: false,
  speed: 1,
  playhead: 0,
  duration: 600,
  frameStart: 0,
  frameEnd: 0,
  framesAvailable: 0,
  displayFrame: 0,
  stats: null,
  agentCount: 0,
  renderedAgents: 0,
  info: null,
  recomputing: false,
  recomputeProgress: 0,
  recomputePhase: '',
  scrubbing: false,
  workerError: null,
  agentSnapshotTime: 0,
  imported: false,
  importName: null,
  busy: null,
  busyProgress: 0,
}))
