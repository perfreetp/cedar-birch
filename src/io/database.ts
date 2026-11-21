// IndexedDB 持久化:数据集元信息 + 归一化后的原始场块(RG uint8)
import type { DatasetMeta } from '../types'

const DB_NAME = 'lcf-volume-viewer'
const DB_VERSION = 1
const META_STORE = 'meta'
const CHUNK_STORE = 'chunks'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
      if (!db.objectStoreNames.contains(CHUNK_STORE)) db.createObjectStore(CHUNK_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export interface StoredDataset {
  meta: DatasetMeta
  histograms: { temp: number[]; speed: number[] }
}

export async function saveDataset(
  meta: DatasetMeta,
  histograms: { temp: number[]; speed: number[] },
  chunks: Map<number, Uint8Array>,
): Promise<void> {
  const db = await openDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([META_STORE, CHUNK_STORE], 'readwrite')
      const cs = t.objectStore(CHUNK_STORE)
      cs.clear()
      t.objectStore(META_STORE).put({ meta, histograms } satisfies StoredDataset, 'current')
      for (const [id, data] of chunks) cs.put(data, id)
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

export async function loadStoredDataset(): Promise<{
  stored: StoredDataset
  chunks: Map<number, Uint8Array>
} | null> {
  const db = await openDB()
  try {
    const stored = await tx<StoredDataset | undefined>(db, META_STORE, 'readonly', (s) => s.get('current') as IDBRequest)
    if (!stored) return null
    const chunks = new Map<number, Uint8Array>()
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(CHUNK_STORE, 'readonly')
      const req = t.objectStore(CHUNK_STORE).openCursor()
      req.onsuccess = () => {
        const cur = req.result
        if (!cur) return resolve()
        chunks.set(Number(cur.key), cur.value as Uint8Array)
        cur.continue()
      }
      req.onerror = () => reject(req.error)
    })
    return { stored, chunks }
  } finally {
    db.close()
  }
}

export async function clearStoredDataset(): Promise<void> {
  const db = await openDB()
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction([META_STORE, CHUNK_STORE], 'readwrite')
      t.objectStore(META_STORE).clear()
      t.objectStore(CHUNK_STORE).clear()
      t.oncomplete = () => resolve()
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}
