import { reactive, computed } from 'vue'
import type { DatasetMeta, PickedInfo, RasterGrid } from '../types'
import { DEPTH_THRESHOLD } from '../types'
import { parseRasterFile, makeDemoTerrain, makeDemoFloodSeries } from './raster'
import { computeStats, computeArrivalTime } from './analysis'
import { frameCache } from './frameCache'
import { saveDataset, loadDataset, clearDataset } from './idb'

export const SPEEDS = [
  { label: '慢速 ×0.5', value: 0.5 },
  { label: '常速 ×1', value: 1 },
  { label: '快速 ×2', value: 2 },
]
export const BASE_FPS = 2 // 常速下每秒推进的帧数

interface State {
  loading: boolean
  loadMessage: string
  meta: DatasetMeta | null
  terrain: Float32Array | null
  arrival: Float32Array | null
  /** 连续帧位置(小数表示帧间插值) */
  currentFrame: number
  playing: boolean
  speedIndex: number
  viewMode: 'top' | 'oblique'
  picked: PickedInfo | null
  /** 数据是否来自本地存储恢复 */
  restored: boolean
}

export const state = reactive<State>({
  loading: false,
  loadMessage: '',
  meta: null,
  terrain: null,
  arrival: null,
  currentFrame: 0,
  playing: false,
  speedIndex: 1,
  viewMode: 'oblique',
  picked: null,
  restored: false,
})

export const frameCount = computed(() => state.meta?.frameCount ?? 0)
export const currentFrameIndex = computed(() => Math.min(Math.floor(state.currentFrame), frameCount.value - 1))
export const currentTime = computed(() => {
  if (!state.meta) return 0
  const i = currentFrameIndex.value
  const t = state.meta.times
  const f = state.currentFrame - i
  const a = t[i]
  const b = t[Math.min(i + 1, t.length - 1)]
  return a + (b - a) * Math.max(0, Math.min(1, f))
})
export const currentArea = computed(() => {
  if (!state.meta) return 0
  return state.meta.areas[currentFrameIndex.value] ?? 0
})

function setDataset(meta: DatasetMeta, terrain: Float32Array, arrival: Float32Array, frames: Float32Array[] | null): void {
  state.meta = meta
  state.terrain = terrain
  state.arrival = arrival
  state.currentFrame = 0
  state.playing = false
  state.picked = null
  frameCache.configure(meta.width, meta.height, meta.frameCount, frames)
}

/** 加载演示数据集 */
export async function loadDemo(): Promise<void> {
  state.loading = true
  state.loadMessage = '正在生成演示地形与洪水过程…'
  try {
    await new Promise((r) => setTimeout(r, 30))
    const terrainGrid = makeDemoTerrain()
    const frames = makeDemoFloodSeries(terrainGrid)
    const interval = 600
    const times = frames.map((_, i) => i * interval)
    const { areas, maxDepth } = computeStats(frames, terrainGrid.cellSize)
    const arrival = computeArrivalTime(frames, times)
    const meta = buildMeta('演示数据(峡谷溃坝)', terrainGrid, times, areas, maxDepth)
    setDataset(meta, terrainGrid.data, arrival, frames)
    state.restored = false
    persist(meta, terrainGrid.data, arrival, frames)
  } finally {
    state.loading = false
    state.loadMessage = ''
  }
}

/** 从文件加载:1 个地形文件 + N 个水深帧文件 */
export async function loadFromFiles(terrainFile: File, frameFiles: File[], intervalSec: number): Promise<void> {
  state.loading = true
  try {
    state.loadMessage = '解析地形…'
    const terrainGrid = await parseRasterFile(terrainFile)
    const sorted = [...frameFiles].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    const frames: Float32Array[] = []
    for (let i = 0; i < sorted.length; i++) {
      state.loadMessage = `解析水深帧 ${i + 1}/${sorted.length}…`
      const g = await parseRasterFile(sorted[i])
      if (g.width !== terrainGrid.width || g.height !== terrainGrid.height) {
        throw new Error(`帧 ${sorted[i].name} 尺寸 ${g.width}×${g.height} 与地形 ${terrainGrid.width}×${terrainGrid.height} 不一致`)
      }
      frames.push(g.data)
    }
    if (!frames.length) throw new Error('未选择水深帧文件')
    state.loadMessage = '统计淹没面积与到达时间…'
    await new Promise((r) => setTimeout(r, 30))
    const times = frames.map((_, i) => i * intervalSec)
    const { areas, maxDepth } = computeStats(frames, terrainGrid.cellSize)
    const arrival = computeArrivalTime(frames, times)
    const meta = buildMeta(terrainFile.name.replace(/\.[^.]+$/, ''), terrainGrid, times, areas, maxDepth)
    setDataset(meta, terrainGrid.data, arrival, frames)
    state.restored = false
    persist(meta, terrainGrid.data, arrival, frames)
  } finally {
    state.loading = false
    state.loadMessage = ''
  }
}

/** 启动时尝试从浏览器本地存储恢复 */
export async function restoreFromLocal(): Promise<boolean> {
  const saved = await loadDataset()
  if (!saved) return false
  state.loading = true
  state.loadMessage = '正在从本地存储恢复数据…'
  try {
    setDataset(saved.meta, saved.terrain, saved.arrival, null)
    state.restored = true
    return true
  } finally {
    state.loading = false
    state.loadMessage = ''
  }
}

export async function clearLocal(): Promise<void> {
  await clearDataset()
}

function buildMeta(name: string, grid: RasterGrid, times: number[], areas: number[], maxDepth: number): DatasetMeta {
  let minElev = Infinity
  let maxElev = -Infinity
  for (const v of grid.data) {
    if (!Number.isFinite(v)) continue
    if (v < minElev) minElev = v
    if (v > maxElev) maxElev = v
  }
  return {
    name,
    width: grid.width,
    height: grid.height,
    originX: grid.originX,
    originY: grid.originY,
    cellSize: grid.cellSize,
    frameCount: times.length,
    times,
    minElev,
    maxElev,
    maxDepth,
    areas,
    createdAt: Date.now(),
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null
function persist(meta: DatasetMeta, terrain: Float32Array, arrival: Float32Array, frames: Float32Array[]): void {
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    saveDataset(meta, terrain, arrival, frames).catch((e) => console.warn('本地保存失败', e))
  }, 300)
}

/* 播放控制 */
export function togglePlay(): void {
  if (!state.meta) return
  if (!state.playing && state.currentFrame >= frameCount.value - 1.001) state.currentFrame = 0
  state.playing = !state.playing
}
export function pause(): void {
  state.playing = false
}
export function stepFrame(delta: number): void {
  if (!state.meta) return
  state.playing = false
  state.currentFrame = Math.min(Math.max(Math.round(state.currentFrame) + delta, 0), frameCount.value - 1)
}
export function seek(frame: number): void {
  if (!state.meta) return
  state.currentFrame = Math.min(Math.max(frame, 0), frameCount.value - 1)
}
export function setSpeed(i: number): void {
  state.speedIndex = Math.min(Math.max(i, 0), SPEEDS.length - 1)
}

/** 播放推进(由渲染循环调用) */
export function tick(dtSec: number): void {
  if (!state.playing || !state.meta) return
  state.currentFrame += dtSec * BASE_FPS * SPEEDS[state.speedIndex].value
  if (state.currentFrame >= frameCount.value - 1) {
    state.currentFrame = frameCount.value - 1
    state.playing = false
  }
}

/** 点击查询:当前帧水深 + 到达时间 */
export async function queryPoint(col: number, row: number): Promise<PickedInfo | null> {
  const meta = state.meta
  if (!meta || !state.terrain || !state.arrival) return null
  if (col < 0 || row < 0 || col >= meta.width || row >= meta.height) return null
  const idx = row * meta.width + col
  const frame = await frameCache.getFrameData(currentFrameIndex.value)
  const depth = frame ? frame[idx] || 0 : 0
  const picked: PickedInfo = {
    col,
    row,
    x: meta.originX + (col + 0.5) * meta.cellSize,
    y: meta.originY - (row + 0.5) * meta.cellSize,
    elev: state.terrain[idx],
    depth: Number.isFinite(depth) ? depth : 0,
    arrivalTime: state.arrival[idx],
  }
  state.picked = picked
  return picked
}

export { DEPTH_THRESHOLD }
