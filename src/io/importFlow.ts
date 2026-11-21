// 文件导入流程:解析 → 64³ 分块 → Worker 提取/统计 → 归一化 → 交给 VolumeManager
import { extractChunkPayload, parseLcfFile } from './format'
import { saveDataset } from './database'
import { getPool } from '../workers/pool'
import { services } from '../scene/services'
import { useStore } from '../state/store'
import type { DatasetMeta, Vec3 } from '../types'

export const CHUNK_SIZE = 64

function chunkOriginSize(
  chunkId: number,
  chunkGrid: Vec3,
  dims: Vec3,
): { origin: [number, number, number]; size: [number, number, number] } {
  const [cgx, cgy] = chunkGrid
  const [nx, ny, nz] = dims
  const cx = chunkId % cgx
  const cy = Math.floor(chunkId / cgx) % cgy
  const cz = Math.floor(chunkId / (cgx * cgy))
  const ox = cx * CHUNK_SIZE
  const oy = cy * CHUNK_SIZE
  const oz = cz * CHUNK_SIZE
  return {
    origin: [ox, oy, oz],
    size: [Math.min(CHUNK_SIZE, nx - ox), Math.min(CHUNK_SIZE, ny - oy), Math.min(CHUNK_SIZE, nz - oz)],
  }
}

export async function importFile(file: File): Promise<void> {
  const store = useStore.getState()
  store.setProgress({ phase: 'parsing', done: 0, total: 1 })

  const buf = await file.arrayBuffer()
  const pf = parseLcfFile(buf)
  const dims = pf.header.dims
  const chunkGrid: Vec3 = [
    Math.ceil(dims[0] / CHUNK_SIZE),
    Math.ceil(dims[1] / CHUNK_SIZE),
    Math.ceil(dims[2] / CHUNK_SIZE),
  ]
  const total = chunkGrid[0] * chunkGrid[1] * chunkGrid[2]
  const ids = Array.from({ length: total }, (_, i) => i)
  const pool = getPool()

  // 第一遍:Worker 提取 temp/speed 并统计值域
  store.setProgress({ phase: 'extract', done: 0, total })
  const rgs = new Map<number, Float32Array>()
  let tMin = Infinity
  let tMax = -Infinity
  let sMin = Infinity
  let sMax = -Infinity
  let done = 0
  await Promise.all(
    ids.map(async (id) => {
      const { origin, size } = chunkOriginSize(id, chunkGrid, dims)
      const payload = extractChunkPayload(pf, origin, size)
      const res = await pool.exec(
        { type: 'extract', jobId: id, chunkId: id, payload: payload.buffer },
        [payload.buffer],
      )
      rgs.set(id, new Float32Array(res.rg))
      const [a, b, c, d] = res.stats as number[]
      if (a < tMin) tMin = a
      if (b > tMax) tMax = b
      if (c < sMin) sMin = c
      if (d > sMax) sMax = d
      done++
      useStore.getState().setProgress({ phase: 'extract', done, total })
    }),
  )

  // 第二遍:按全局值域归一化为 uint8
  const rawChunks = new Map<number, Uint8Array>()
  await Promise.all(
    ids.map(async (id) => {
      const rg = rgs.get(id)!
      const res = await pool.exec(
        { type: 'normalize', jobId: id, chunkId: id, rg: rg.buffer, ranges: [tMin, tMax, sMin, sMax] },
        [rg.buffer],
      )
      rawChunks.set(id, new Uint8Array(res.raw))
    }),
  )
  rgs.clear()

  const meta: DatasetMeta = {
    name: file.name,
    header: pf.header,
    ranges: { temp: [tMin, tMax], speed: [sMin, sMax] },
    chunkGrid,
    chunkSize: CHUNK_SIZE,
  }

  await services.whenVolume()
  services.volume!.setData(meta, rawChunks)
  useStore.getState().setMeta(meta)
  // 持久化在首次烘焙产出直方图后由 onHistograms 触发
}

/** 首次烘焙完成 → 拿到直方图 → 持久化整个数据集 */
export function wirePersistence(): void {
  const volume = services.volume
  if (!volume) return
  volume.onHistograms = (t, s) => {
    const temp = Array.from(t)
    const speed = Array.from(s)
    useStore.getState().setHistograms({ temp, speed })
    const meta = useStore.getState().meta
    if (meta) {
      saveDataset(meta, { temp, speed }, volume.rawChunks).catch((e) => console.warn('IndexedDB 保存失败', e))
    }
  }
}
