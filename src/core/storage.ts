// 浏览器本地存储: IndexedDB 保存站点文档与已导入的回放; localStorage 保存 UI 偏好
import type { StationDoc } from './types.ts'
import type { ImportedRun } from './export.ts'

const DB_NAME = 'platform-heat-sim'
const DB_VERSION = 1
const STORE_DOCS = 'stations'
const STORE_RUNS = 'runs'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        const s = db.createObjectStore(STORE_DOCS, { keyPath: 'id' })
        s.createIndex('updatedAt', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const s = db.createObjectStore(STORE_RUNS, { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDB().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const s = t.objectStore(store)
        let result: IDBRequest<T> | void
        try {
          result = fn(s)
        } catch (err) {
          reject(err)
          return
        }
        t.oncomplete = () => resolve(result ? result.result : undefined)
        t.onerror = () => reject(t.error ?? new Error('IndexedDB 事务失败'))
        t.onabort = () => reject(t.error ?? new Error('IndexedDB 事务中止'))
      }),
  )
}

export async function listStations(): Promise<StationDoc[]> {
  const docs = (await tx<StationDoc[]>(STORE_DOCS, 'readonly', (s) => s.getAll())) ?? []
  return docs.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getStation(id: string): Promise<StationDoc | undefined> {
  return tx<StationDoc>(STORE_DOCS, 'readonly', (s) => s.get(id))
}

export async function saveStation(doc: StationDoc): Promise<void> {
  await tx(STORE_DOCS, 'readwrite', (s) => s.put({ ...doc, updatedAt: Date.now() }))
  notifyChange()
}

export async function deleteStation(id: string): Promise<void> {
  await tx(STORE_DOCS, 'readwrite', (s) => s.delete(id))
  notifyChange()
}

export interface StoredRunMeta {
  id: string
  name: string
  stationName: string
  frameCount: number
  createdAt: number
  createdAtISO: string
  duration: number
  notes: string
}

interface StoredRun extends StoredRunMeta {
  doc: StationDoc
  manifest: ImportedRun['manifest']
  frames: { time: number; compressed: Uint8Array; stats: ImportedRun['frames'][number]['stats'] }[]
  agentsSnapshots: { time: number; agents: ImportedRun['agentsSnapshots'][number]['agents'] }[]
  gateEvents?: ImportedRun['gateEvents']
}

export async function saveRun(run: ImportedRun, name: string): Promise<string> {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
  const stored: StoredRun = {
    id,
    name,
    stationName: run.doc.meta.name,
    frameCount: run.frames.length,
    createdAt: Date.now(),
    createdAtISO: new Date().toISOString(),
    duration: run.manifest.duration,
    notes: `${run.frames.length} 帧 · ${run.doc.meta.line || '未标注线路'}`,
    doc: run.doc,
    manifest: run.manifest,
    frames: run.frames.map((f) => ({ time: f.time, compressed: f.compressed, stats: f.stats })),
    agentsSnapshots: run.agentsSnapshots.map((a) => ({ time: a.time, agents: a.agents })),
    gateEvents: run.gateEvents,
  }
  await tx(STORE_RUNS, 'readwrite', (s) => s.put(stored))
  notifyChange()
  return id
}

export async function listRuns(): Promise<StoredRunMeta[]> {
  const runs = (await tx<StoredRun[]>(STORE_RUNS, 'readonly', (s) => s.getAll())) ?? []
  return runs
    .map((r) => ({
      id: r.id,
      name: r.name,
      stationName: r.stationName,
      frameCount: r.frameCount,
      createdAt: r.createdAt,
      createdAtISO: r.createdAtISO,
      duration: r.duration,
      notes: r.notes,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function getRun(id: string): Promise<ImportedRun | undefined> {
  const r = await tx<StoredRun>(STORE_RUNS, 'readonly', (s) => s.get(id))
  if (!r) return undefined
  return {
    doc: r.doc,
    manifest: r.manifest,
    frames: r.frames,
    agentsSnapshots: r.agentsSnapshots,
    gateEvents: r.gateEvents ?? [],
  }
}

export async function deleteRun(id: string): Promise<void> {
  await tx(STORE_RUNS, 'readwrite', (s) => s.delete(id))
  notifyChange()
}

/** 估算占用 */
export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  if (navigator.storage?.estimate) {
    const e = await navigator.storage.estimate()
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 }
  }
  return { usage: 0, quota: 0 }
}

type Listener = () => void
const listeners = new Set<Listener>()
export function onStorageChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function notifyChange() {
  for (const l of listeners) l()
}

// ---- UI 偏好 (localStorage) ----
const PREF_KEY = 'phs.prefs.v1'

export interface Prefs {
  showZones: boolean
  showObstacles: boolean
  showAgents: boolean
  showHeat: boolean
  showBands: boolean
  heatOpacity: number
  showGrid: boolean
  cameraMode: 'orbit' | 'top'
  lastStationId?: string
}

export const DEFAULT_PREFS: Prefs = {
  showZones: true,
  showObstacles: true,
  showAgents: true,
  showHeat: true,
  showBands: true,
  heatOpacity: 0.78,
  showGrid: false,
  cameraMode: 'orbit',
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p))
  } catch {
    /* 隐私模式等场景忽略 */
  }
}
