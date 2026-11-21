const DB_NAME = 'dam-break-flood-viz'
const DB_VERSION = 1
export const CHUNK_FRAMES = 8 // 每个数据块包含的帧数

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta')
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export interface SavedDataset {
  meta: import('../types').DatasetMeta
  terrain: Float32Array
  arrival: Float32Array // 到达时间栅格(秒,-1 未淹没)
}

export async function saveDataset(meta: SavedDataset['meta'], terrain: Float32Array, arrival: Float32Array, frames: Float32Array[]): Promise<void> {
  await clearDataset()
  await tx('meta', 'readwrite', (s) => s.put({ meta, terrain, arrival }, 'dataset'))
  const chunkCount = Math.ceil(frames.length / CHUNK_FRAMES)
  for (let c = 0; c < chunkCount; c++) {
    const slice = frames.slice(c * CHUNK_FRAMES, (c + 1) * CHUNK_FRAMES)
    const frameSize = slice[0].length
    const packed = new Float32Array(slice.length * frameSize)
    slice.forEach((f, i) => packed.set(f, i * frameSize))
    await tx('chunks', 'readwrite', (s) => s.put(packed, c))
  }
}

export async function loadDataset(): Promise<SavedDataset | null> {
  try {
    const v = await tx<SavedDataset | undefined>('meta', 'readonly', (s) => s.get('dataset') as IDBRequest<SavedDataset | undefined>)
    return v ?? null
  } catch {
    return null
  }
}

/** 按块读取帧数据(每块 CHUNK_FRAMES 帧,打包为一个 Float32Array) */
export async function loadChunk(chunkIndex: number): Promise<Float32Array | null> {
  try {
    const v = await tx<Float32Array | undefined>('chunks', 'readonly', (s) => s.get(chunkIndex) as IDBRequest<Float32Array | undefined>)
    return v ?? null
  } catch {
    return null
  }
}

export async function clearDataset(): Promise<void> {
  try {
    await tx('meta', 'readwrite', (s) => s.clear())
    await tx('chunks', 'readwrite', (s) => s.clear())
  } catch {
    /* ignore */
  }
}
