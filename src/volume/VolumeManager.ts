// 体数据管理:原始场纹理(切片用)+ 烘焙后的发射/消光纹理(光线步进用)+ LUT 纹理
// 主线程只负责上传纹理;解析、归一化、烘焙都在 Worker 中完成。
import * as THREE from 'three'
import type { Channel, DatasetMeta, TransferFunction } from '../types'
import { getPool } from '../workers/pool'
import { computeLUT } from './lut'

interface UploadItem {
  chunkId: number
  data: Uint8Array
  target: 'raw' | 'vol'
}

export class VolumeManager {
  private renderer: THREE.WebGLRenderer
  meta: DatasetMeta | null = null
  rawChunks = new Map<number, Uint8Array>()

  rawTex: THREE.Data3DTexture | null = null // RG8:归一化 temp/speed
  volTex: THREE.Data3DTexture | null = null // RGBA8:烘焙后的发射色 + 消光
  lutTex: THREE.DataTexture // 256×2 RGBA:第 0 行温度,第 1 行流速

  boxMin = new THREE.Vector3(-1, -1, -1)
  boxMax = new THREE.Vector3(1, 1, 1)

  /** setData 后置位,提示渲染循环需要触发一次烘焙 */
  bakeRequested = false

  private uploadQueue: UploadItem[] = []
  private bakeGen = 0
  private histPending = false
  private histT = new Uint32Array(256)
  private histS = new Uint32Array(256)

  onProgress: (done: number, total: number) => void = () => {}
  onReady: () => void = () => {}
  onHistograms: (temp: Uint32Array, speed: Uint32Array) => void = () => {}

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer
    this.lutTex = new THREE.DataTexture(new Uint8Array(256 * 2 * 4), 256, 2, THREE.RGBAFormat)
    this.lutTex.minFilter = THREE.LinearFilter
    this.lutTex.magFilter = THREE.LinearFilter
    this.lutTex.wrapS = THREE.ClampToEdgeWrapping
    this.lutTex.wrapT = THREE.ClampToEdgeWrapping
    this.lutTex.needsUpdate = true
  }

  get hasData(): boolean {
    return this.meta !== null
  }

  chunkCount(): number {
    if (!this.meta) return 0
    const [a, b, c] = this.meta.chunkGrid
    return a * b * c
  }

  chunkOriginSize(chunkId: number): { origin: [number, number, number]; size: [number, number, number] } {
    const m = this.meta!
    const [cgx, cgy] = m.chunkGrid
    const cs = m.chunkSize
    const [nx, ny, nz] = m.header.dims
    const cx = chunkId % cgx
    const cy = Math.floor(chunkId / cgx) % cgy
    const cz = Math.floor(chunkId / (cgx * cgy))
    const ox = cx * cs
    const oy = cy * cs
    const oz = cz * cs
    return {
      origin: [ox, oy, oz],
      size: [Math.min(cs, nx - ox), Math.min(cs, ny - oy), Math.min(cs, nz - oz)],
    }
  }

  setData(meta: DatasetMeta, chunks: Map<number, Uint8Array>): void {
    this.disposeTextures()
    this.meta = meta
    this.rawChunks = chunks
    const [nx, ny, nz] = meta.header.dims

    this.rawTex = make3DTex(nx, ny, nz, 2)
    this.volTex = make3DTex(nx, ny, nz, 4)

    // 世界坐标包围盒:物理尺寸归一化到最长边 2,居中
    const [sx, sy, sz] = meta.header.spacing
    const px = nx * sx
    const py = ny * sy
    const pz = nz * sz
    const scale = 2 / Math.max(px, py, pz)
    this.boxMin.set((-px * scale) / 2, (-py * scale) / 2, (-pz * scale) / 2)
    this.boxMax.set((px * scale) / 2, (py * scale) / 2, (pz * scale) / 2)

    for (const [id, data] of chunks) this.uploadQueue.push({ chunkId: id, data, target: 'raw' })
    this.histPending = true
    this.histT = new Uint32Array(256)
    this.histS = new Uint32Array(256)
    this.bakeRequested = true
  }

  clear(): void {
    this.disposeTextures()
    this.meta = null
    this.rawChunks.clear()
    this.uploadQueue = []
    this.bakeGen++
    this.boxMin.set(-1, -1, -1)
    this.boxMax.set(1, 1, 1)
  }

  /** 只更新 LUT 纹理(切片色标立即生效,不重建体纹理) */
  updateLuts(tf: { temp: TransferFunction; speed: TransferFunction }): void {
    const data = this.lutTex.image.data as Uint8Array
    data.set(computeLUT(tf.temp), 0)
    data.set(computeLUT(tf.speed), 256 * 4)
    this.lutTex.needsUpdate = true
  }

  /** 按当前传输函数重新烘焙体纹理(Worker 并行,逐块 texSubImage3D 上传) */
  async rebake(tf: { temp: TransferFunction; speed: TransferFunction }, channel: Channel): Promise<void> {
    if (!this.meta || this.rawChunks.size === 0) return
    this.updateLuts(tf)
    const gen = ++this.bakeGen
    const lut = computeLUT(tf[channel])
    const ids = [...this.rawChunks.keys()]
    let done = 0
    this.onProgress(0, ids.length)
    const pool = getPool()
    await Promise.all(
      ids.map((id) => {
        const raw = this.rawChunks.get(id)!
        const copy = raw.slice() // 转移给 Worker 的副本
        return pool
          .exec(
            {
              type: 'bake',
              jobId: gen * 100000 + id,
              chunkId: id,
              raw: copy.buffer,
              lut,
              channel: channel === 'temp' ? 0 : 1,
            },
            [copy.buffer],
          )
          .then((res) => {
            if (gen !== this.bakeGen) return // 已被更新的烘焙取代
            this.uploadQueue.push({ chunkId: id, data: new Uint8Array(res.baked), target: 'vol' })
            if (this.histPending) {
              const ht = new Uint32Array(res.histT)
              const hs = new Uint32Array(res.histS)
              for (let i = 0; i < 256; i++) {
                this.histT[i] += ht[i]
                this.histS[i] += hs[i]
              }
            }
            done++
            this.onProgress(done, ids.length)
          })
      }),
    )
    if (gen !== this.bakeGen) return
    if (this.histPending) {
      this.histPending = false
      this.onHistograms(this.histT, this.histS)
    }
    this.onReady()
  }

  /** 每帧调用:限量上传排队的纹理块,保持帧率平稳 */
  update(perFrame = 4): void {
    let budget = perFrame
    while (budget-- > 0 && this.uploadQueue.length > 0) {
      const item = this.uploadQueue.shift()!
      const tex = item.target === 'raw' ? this.rawTex : this.volTex
      if (tex) this.uploadChunk(tex, item)
    }
  }

  private uploadChunk(tex: THREE.Data3DTexture, item: UploadItem): void {
    const { origin, size } = this.chunkOriginSize(item.chunkId)
    // 同步 CPU 侧数据(保持一致性)
    const comps = tex.format === THREE.RGFormat ? 2 : 4
    writeSubVolume(tex.image.data as Uint8Array, tex.image.width, tex.image.height, comps, origin, size, item.data)

    const gl = this.renderer.getContext() as WebGL2RenderingContext
    this.renderer.initTexture(tex)
    const props = (this.renderer as unknown as { properties: { get(t: unknown): { __webglTexture?: WebGLTexture } } }).properties.get(tex)
    if (!props?.__webglTexture) return
    gl.bindTexture(gl.TEXTURE_3D, props.__webglTexture)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    const format = comps === 2 ? gl.RG : gl.RGBA
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      origin[0],
      origin[1],
      origin[2],
      size[0],
      size[1],
      size[2],
      format,
      gl.UNSIGNED_BYTE,
      item.data,
    )
  }

  private disposeTextures(): void {
    this.rawTex?.dispose()
    this.volTex?.dispose()
    this.rawTex = null
    this.volTex = null
  }
}

function make3DTex(nx: number, ny: number, nz: number, comps: 2 | 4): THREE.Data3DTexture {
  const tex = new THREE.Data3DTexture(new Uint8Array(nx * ny * nz * comps), nx, ny, nz)
  tex.format = comps === 2 ? THREE.RGFormat : THREE.RGBAFormat
  tex.type = THREE.UnsignedByteType
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.wrapS = THREE.ClampToEdgeWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.wrapR = THREE.ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

function writeSubVolume(
  dst: Uint8Array,
  nx: number,
  ny: number,
  comps: number,
  origin: [number, number, number],
  size: [number, number, number],
  src: Uint8Array,
): void {
  const [ox, oy, oz] = origin
  const [sx, sy, sz] = size
  const rowBytes = sx * comps
  for (let z = 0; z < sz; z++) {
    for (let y = 0; y < sy; y++) {
      const dstOff = ((oz + z) * ny + (oy + y)) * nx * comps + ox * comps
      const srcOff = (z * sy + y) * rowBytes
      dst.set(src.subarray(srcOff, srcOff + rowBytes), dstOff)
    }
  }
}
