import { create } from 'zustand'
import type {
  Equipment,
  ReturnVent,
  RoomSpec,
  SimSettings,
  Snapshot,
  SupplyVent,
  WallName,
} from '../types'
import { MAX_PARTICLES } from '../types'
import { clamp, uid, wallLength } from '../lib/geometry'

export type PageId = 0 | 1 | 2 | 3

interface AppState {
  page: PageId
  room: RoomSpec
  equipment: Equipment[]
  supplies: SupplyVent[]
  returns: ReturnVent[]
  settings: SimSettings
  /** 设备/风口拓扑变化计数,驱动引擎重建 */
  layoutVersion: number
  bumpLayout: () => void

  setPage: (p: PageId) => void
  setRoom: (patch: Partial<RoomSpec>) => void
  addEquipment: () => void
  updateEquipment: (id: string, patch: Partial<Equipment>) => void
  removeEquipment: (id: string) => void
  updateSupply: (id: string, patch: Partial<SupplyVent>) => void
  updateReturn: (id: string, patch: Partial<ReturnVent>) => void
  addReturn: (wall: WallName) => void
  removeReturn: (id: string) => void
  setSettings: (patch: Partial<SimSettings>) => void
  loadSnapshot: (s: Snapshot) => void
}

const DEFAULT_ROOM: RoomSpec = { width: 12, depth: 9, height: 3.2, supplyCount: 4 }

function makeEquipment(index: number, room: RoomSpec): Equipment {
  const cols = 3
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    id: uid('eq'),
    name: `设备 ${index + 1}`,
    x: -room.width / 2 + 2.5 + col * 3.4,
    z: -room.depth / 2 + 2.4 + row * 3.2,
    w: 1.6,
    d: 1.2,
    h: 1.8,
    rotation: 0,
    color: 0x4a90d9,
  }
}

/** 按送风口数量在顶棚上做近似均匀的行列网格布局 */
export function gridSupplies(count: number, room: RoomSpec): SupplyVent[] {
  const n = Math.max(1, count)
  const cols = Math.ceil(Math.sqrt(n * (room.width / room.depth)))
  const rows = Math.ceil(n / cols)
  const marginX = room.width * 0.18
  const marginZ = room.depth * 0.18
  const out: SupplyVent[] = []
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const fx = cols === 1 ? 0.5 : c / (cols - 1)
    const fz = rows === 1 ? 0.5 : r / (rows - 1)
    out.push({
      id: uid('sv'),
      x: -room.width / 2 + marginX + fx * (room.width - 2 * marginX),
      z: -room.depth / 2 + marginZ + fz * (room.depth - 2 * marginZ),
      gear: 3,
      azimuth: 0,
      tilt: 0,
    })
  }
  return out
}

function defaultReturns(room: RoomSpec): ReturnVent[] {
  const mk = (wall: WallName, frac: number): ReturnVent => ({
    id: uid('rv'),
    wall,
    along: wallLength(wall, room) * frac,
    y: clamp(room.height * 0.25, 0.3, 1.2),
    width: 1.0,
    height: 0.5,
  })
  return [mk('west', 0.5), mk('east', 0.5)]
}

export const useAppStore = create<AppState>((set) => ({
  page: 0,
  room: DEFAULT_ROOM,
  equipment: [makeEquipment(0, DEFAULT_ROOM), makeEquipment(1, DEFAULT_ROOM)],
  supplies: gridSupplies(DEFAULT_ROOM.supplyCount, DEFAULT_ROOM),
  returns: defaultReturns(DEFAULT_ROOM),
  settings: {
    targetCount: MAX_PARTICLES,
    speedMul: 1,
    sliceEnabled: false,
    sliceHeight: DEFAULT_ROOM.height / 2,
    sliceBand: 0.35,
    running: true,
  },
  layoutVersion: 0,
  bumpLayout: () => set((s) => ({ layoutVersion: s.layoutVersion + 1 })),

  setPage: (p) => set({ page: p }),

  setRoom: (patch) =>
    set((s) => {
      const room = { ...s.room, ...patch }
      room.width = clamp(room.width, 4, 40)
      room.depth = clamp(room.depth, 4, 40)
      room.height = clamp(room.height, 2.4, 8)
      room.supplyCount = clamp(Math.round(room.supplyCount), 1, 24)
      let supplies = s.supplies
      // 数量变化时重排,保留已有风口的参数
      if (patch.supplyCount !== undefined && patch.supplyCount !== s.room.supplyCount) {
        const grid = gridSupplies(room.supplyCount, room)
        supplies = grid.map((g, i) => (s.supplies[i] ? { ...g, ...s.supplies[i], x: g.x, z: g.z } : g))
      } else {
        // 房间尺寸变化:把超出边界的风口/设备拉回
        supplies = s.supplies.map((v) => ({
          ...v,
          x: clamp(v.x, -room.width / 2 + 0.2, room.width / 2 - 0.2),
          z: clamp(v.z, -room.depth / 2 + 0.2, room.depth / 2 - 0.2),
        }))
      }
      const equipment = s.equipment.map((e) => {
        const hx = room.width / 2 - e.w / 2 - 0.1
        const hz = room.depth / 2 - e.d / 2 - 0.1
        return { ...e, x: clamp(e.x, -hx, hx), z: clamp(e.z, -hz, hz), h: Math.min(e.h, room.height - 0.1) }
      })
      const returns = s.returns.map((r) => ({ ...r, along: clamp(r.along, 0, wallLength(r.wall, room)) }))
      const settings = {
        ...s.settings,
        sliceHeight: clamp(s.settings.sliceHeight, 0.1, room.height - 0.1),
      }
      return { room, supplies, equipment, returns, settings, layoutVersion: s.layoutVersion + 1 }
    }),

  addEquipment: () =>
    set((s) => ({
      equipment: [...s.equipment, makeEquipment(s.equipment.length, s.room)],
      layoutVersion: s.layoutVersion + 1,
    })),

  updateEquipment: (id, patch) =>
    set((s) => ({
      equipment: s.equipment.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      layoutVersion: s.layoutVersion + 1,
    })),

  removeEquipment: (id) =>
    set((s) => ({
      equipment: s.equipment.filter((e) => e.id !== id),
      layoutVersion: s.layoutVersion + 1,
    })),

  updateSupply: (id, patch) =>
    set((s) => ({
      supplies: s.supplies.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      layoutVersion: s.layoutVersion + 1,
    })),

  updateReturn: (id, patch) =>
    set((s) => ({
      returns: s.returns.map((v) => (v.id === id ? { ...v, ...patch } : v)),
      layoutVersion: s.layoutVersion + 1,
    })),

  addReturn: (wall) =>
    set((s) => ({
      returns: [
        ...s.returns,
        {
          id: uid('rv'),
          wall,
          along: wallLength(wall, s.room) * 0.5,
          y: clamp(s.room.height * 0.25, 0.3, 1.2),
          width: 1.0,
          height: 0.5,
        },
      ],
      layoutVersion: s.layoutVersion + 1,
    })),

  removeReturn: (id) =>
    set((s) => ({
      returns: s.returns.filter((v) => v.id !== id),
      layoutVersion: s.layoutVersion + 1,
    })),

  setSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch }
      settings.targetCount = clamp(Math.round(settings.targetCount), 500, MAX_PARTICLES)
      settings.sliceHeight = clamp(settings.sliceHeight, 0.05, s.room.height - 0.05)
      settings.sliceBand = clamp(settings.sliceBand, 0.05, 2)
      return { settings }
    }),

  loadSnapshot: (snap) =>
    set((s) => ({
      room: snap.room,
      equipment: snap.equipment,
      supplies: snap.supplies,
      returns: snap.returns,
      settings: { ...s.settings, running: false },
      layoutVersion: s.layoutVersion + 1,
    })),
}))
