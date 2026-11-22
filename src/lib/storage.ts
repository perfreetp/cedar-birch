import type { AppState, Boundary, ExtractSettings, DisplaySettings, SeveritySettings, RasterImage } from '../types';

const DB_NAME = 'bsr-db';
const DB_VERSION = 1;
const STORE = 'rasters';
const LS_KEY = 'bsr-state-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet(key: string): Promise<Blob | undefined> {
  const db = await openDb();
  const blob = await new Promise<Blob | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return blob;
}

async function idbDelete(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    for (const k of keys) tx.objectStore(STORE).delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export interface PersistedState {
  boundary: Boundary | null;
  extract: ExtractSettings;
  display: DisplaySettings;
  severity: SeveritySettings;
  rasterMeta: Array<{
    id: string;
    name: string;
    kind: RasterImage['kind'];
    width: number;
    height: number;
    pixelSize: number;
    origin: { x: number; y: number };
    verticalScale: number;
    demMode?: 'grayscale' | 'rgb';
    demMin?: number;
    demMax?: number;
  }>;
  savedAt: string;
}

/** 保存工程：影像/DEM 原始 Blob 入 IndexedDB，矢量与设置入 localStorage */
export async function saveProject(state: AppState): Promise<void> {
  const rasters = [state.imagery, state.preImagery, state.dem].filter((r): r is RasterImage => !!r);
  const meta: PersistedState['rasterMeta'] = [];
  for (const r of rasters) {
    await idbPut(r.id, r.blob);
    meta.push({
      id: r.id,
      name: r.name,
      kind: r.kind,
      width: r.width,
      height: r.height,
      pixelSize: r.pixelSize,
      origin: r.origin,
      verticalScale: r.verticalScale,
    });
  }
  const persisted: PersistedState = {
    boundary: state.boundary,
    extract: state.extract,
    display: state.display,
    severity: state.severity,
    rasterMeta: meta,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(LS_KEY, JSON.stringify(persisted));
}

export function loadPersistedState(): PersistedState | null {
  const raw = localStorage.getItem(LS_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

/** 恢复影像 Blob（DEM 需调用方按保存参数重新解码） */
export async function restoreBlob(id: string): Promise<Blob | undefined> {
  return idbGet(id);
}

export async function clearProject(): Promise<void> {
  const persisted = loadPersistedState();
  const keys = persisted ? persisted.rasterMeta.map((m) => m.id) : [];
  await idbDelete(keys);
  localStorage.removeItem(LS_KEY);
}

export function hasSavedProject(): boolean {
  return !!localStorage.getItem(LS_KEY);
}
