import * as THREE from 'three'
import { CHUNK_FRAMES, loadChunk } from './idb'

const MAX_MEM_CHUNKS = 8 // 内存中最多缓存的帧数据块数
const MAX_TEXTURES = 32 // GPU 纹理缓存上限

function lruGet<K, V>(map: Map<K, V>, key: K): V | undefined {
  const v = map.get(key)
  if (v !== undefined) {
    map.delete(key)
    map.set(key, v)
  }
  return v
}

function lruSet<K, V>(map: Map<K, V>, key: K, value: V, cap: number, onEvict?: (v: V) => void): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > cap) {
    const oldest = map.keys().next().value as K
    const v = map.get(oldest)!
    map.delete(oldest)
    onEvict?.(v)
  }
}

/**
 * 栅格序列分块加载与纹理缓存:
 * - 帧数据按 CHUNK_FRAMES 帧一块存储(IndexedDB / 内存源)
 * - CPU 侧块级 LRU 缓存,GPU 侧 DataTexture 帧级 LRU 缓存
 */
export class FrameCache {
  width = 0
  height = 0
  frameCount = 0
  private frames: Float32Array[] | null = null // 内存数据源(新加载的数据集)
  private memChunks = new Map<number, Float32Array>()
  private pendingChunks = new Map<number, Promise<Float32Array | null>>()
  private textures = new Map<number, THREE.DataTexture>()
  private pendingTextures = new Map<number, Promise<THREE.DataTexture | null>>()

  configure(width: number, height: number, frameCount: number, frames: Float32Array[] | null): void {
    this.dispose()
    this.width = width
    this.height = height
    this.frameCount = frameCount
    this.frames = frames
  }

  private async loadChunkData(chunk: number): Promise<Float32Array | null> {
    const cached = lruGet(this.memChunks, chunk)
    if (cached) return cached
    let p = this.pendingChunks.get(chunk)
    if (!p) {
      p = this.frames
        ? Promise.resolve(this.packFromMemory(chunk))
        : loadChunk(chunk)
      this.pendingChunks.set(chunk, p)
      const done = p.then((data) => {
        this.pendingChunks.delete(chunk)
        if (data) lruSet(this.memChunks, chunk, data, MAX_MEM_CHUNKS)
        return data
      })
      return done
    }
    const data = await p
    if (data) lruSet(this.memChunks, chunk, data, MAX_MEM_CHUNKS)
    return data
  }

  private packFromMemory(chunk: number): Float32Array | null {
    if (!this.frames) return null
    const start = chunk * CHUNK_FRAMES
    const slice = this.frames.slice(start, start + CHUNK_FRAMES)
    if (!slice.length) return null
    const packed = new Float32Array(slice.length * this.width * this.height)
    slice.forEach((f, i) => packed.set(f, i * this.width * this.height))
    return packed
  }

  /** 获取单帧 CPU 数据(自动按块加载) */
  async getFrameData(index: number): Promise<Float32Array | null> {
    if (index < 0 || index >= this.frameCount) return null
    const chunk = Math.floor(index / CHUNK_FRAMES)
    const packed = await this.loadChunkData(chunk)
    if (!packed) return null
    const size = this.width * this.height
    const offset = (index - chunk * CHUNK_FRAMES) * size
    return packed.subarray(offset, offset + size)
  }

  /** 获取单帧 GPU 纹理(带 LRU 缓存) */
  async getTexture(index: number): Promise<THREE.DataTexture | null> {
    const cached = lruGet(this.textures, index)
    if (cached) return cached
    let p = this.pendingTextures.get(index)
    if (!p) {
      p = this.getFrameData(index).then((data) => {
        this.pendingTextures.delete(index)
        if (!data) return null
        const tex = new THREE.DataTexture(new Float32Array(data), this.width, this.height, THREE.RedFormat, THREE.FloatType)
        tex.magFilter = THREE.LinearFilter
        tex.minFilter = THREE.LinearFilter
        tex.wrapS = THREE.ClampToEdgeWrapping
        tex.wrapT = THREE.ClampToEdgeWrapping
        tex.needsUpdate = true
        lruSet(this.textures, index, tex, MAX_TEXTURES, (old) => old.dispose())
        return tex
      })
      this.pendingTextures.set(index, p)
    }
    return p
  }

  /** 预取当前播放位置附近的帧 */
  prefetch(center: number): void {
    for (let i = center; i <= Math.min(center + 4, this.frameCount - 1); i++) {
      if (!this.textures.has(i) && !this.pendingTextures.has(i)) void this.getTexture(i)
    }
  }

  dispose(): void {
    this.frames = null
    this.memChunks.clear()
    this.pendingChunks.clear()
    this.pendingTextures.clear()
    for (const t of this.textures.values()) t.dispose()
    this.textures.clear()
  }
}

export const frameCache = new FrameCache()
