// 密度场栅格化: 行人位置 -> 512x512 物理密度纹理 (人/m²)
//
// 关键点: 站台是长条形, 512x512 的纹理覆盖 124m x 26m, 因此纹理像素在 x/z 方向
// 的物理尺寸相差很大. 若直接 "每像素有人计数 / 像素面积", 单个行人会被算成几十人/m².
// 正确做法是在物理空间做核密度估计: 每个行人沿双线性权重铺 1 个单位质量,
// 再做各向同性的高斯平滑 (σ ≈ 0.6m), 最后除以纹理像素的物理面积.
// 这样均匀密度场保持不变, 单人峰值约 0.44 人/m² (低于 0.5 档, 不显示).

export interface DensityField {
  size: number
  texelArea: number
  cellX: number
  cellZ: number
}

export class DensityRasterizer {
  size: number
  minX: number
  minZ: number
  cellX: number
  cellZ: number
  private counts: Float32Array
  private tmp: Float32Array
  private density: Float32Array
  private sigmaPhys: number

  constructor(size: number, minX: number, minZ: number, maxX: number, maxZ: number, sigmaPhys = 0.62) {
    this.size = size
    this.minX = minX
    this.minZ = minZ
    this.cellX = Math.max(1e-4, (maxX - minX) / size)
    this.cellZ = Math.max(1e-4, (maxZ - minZ) / size)
    this.sigmaPhys = sigmaPhys
    const n = size * size
    this.counts = new Float32Array(n)
    this.tmp = new Float32Array(n)
    this.density = new Float32Array(n)
  }

  get texelArea(): number {
    return this.cellX * this.cellZ
  }

  /** 用当前行人坐标生成密度场, 结果写入 out (0..255, 上限 16 人/m²) */
  rasterize(xs: Float32Array, zs: Float32Array, n: number, out: Uint8Array): { maxDensity: number; bandCounts: Uint32Array } {
    const S = this.size
    const counts = this.counts
    counts.fill(0)
    const invCX = 1 / this.cellX
    const invCZ = 1 / this.cellZ
    for (let p = 0; p < n; p++) {
      const gx = (xs[p] - this.minX) * invCX - 0.5
      const gz = (zs[p] - this.minZ) * invCZ - 0.5
      if (!(gx > -2 && gz > -2 && gx < S + 1 && gz < S + 1)) continue
      const i0 = Math.floor(gx)
      const j0 = Math.floor(gz)
      const tx = gx - i0
      const tz = gz - j0
      const w00 = (1 - tx) * (1 - tz)
      const w10 = tx * (1 - tz)
      const w01 = (1 - tx) * tz
      const w11 = tx * tz
      const i1 = i0 + 1
      const j1 = j0 + 1
      let r0 = j0 * S
      let r1 = j1 * S
      if (j0 >= 0 && j0 < S) {
        if (i0 >= 0 && i0 < S) counts[r0 + i0] += w00
        if (i1 >= 0 && i1 < S) counts[r0 + i1] += w10
      }
      if (j1 >= 0 && j1 < S) {
        if (i0 >= 0 && i0 < S) counts[r1 + i0] += w01
        if (i1 >= 0 && i1 < S) counts[r1 + i1] += w11
      }
      void r0
      void r1
    }

    // 三遍盒式模糊近似高斯 (O(N)), 半径按物理 σ 换算到各轴
    const sigmaX = this.sigmaPhys * invCX
    const sigmaZ = this.sigmaPhys * invCZ
    const rX = Math.max(1, Math.round((Math.sqrt(4 * sigmaX * sigmaX + 1) - 1) / 2))
    const rZ = Math.max(1, Math.round((Math.sqrt(4 * sigmaZ * sigmaZ + 1) - 1) / 2))

    let src = counts
    let dst = this.tmp
    for (let pass = 0; pass < 3; pass++) {
      boxBlurH(src, dst, S, rX)
      boxBlurV(dst, src, S, rZ)
    }
    const den = src
    const invArea = 1 / this.texelArea
    const density = this.density
    const bandCounts = new Uint32Array(6)
    let maxD = 0
    for (let k = 0; k < den.length; k++) {
      const d = den[k] * invArea
      density[k] = d
      if (d > maxD) maxD = d
      let code = (d / 16) * 255
      if (code > 255) code = 255
      out[k] = code
      let b = -1
      if (d >= 0.5 && d < 1.5) b = 0
      else if (d >= 1.5 && d < 2.6) b = 1
      else if (d >= 2.6 && d < 3.8) b = 2
      else if (d >= 3.8 && d < 4.9) b = 3
      else if (d >= 4.9 && d <= 6.0) b = 4
      else if (d > 6.0) b = 5
      if (b >= 0) bandCounts[b]++
    }
    return { maxDensity: maxD, bandCounts }
  }

  /** 取任意纹理坐标的密度 (人/m²) */
  densityAt(u: number, v: number): number {
    const S = this.size
    const i = Math.min(S - 1, Math.max(0, Math.floor(u * S)))
    const j = Math.min(S - 1, Math.max(0, Math.floor(v * S)))
    return this.density[j * S + i]
  }
}

function boxBlurH(src: Float32Array, dst: Float32Array, S: number, r: number) {
  const inv = 1 / (2 * r + 1)
  for (let j = 0; j < S; j++) {
    const row = j * S
    let sum = 0
    // 初始化窗口 (边缘钳制)
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(S - 1, Math.max(0, i))]
    for (let i = 0; i < S; i++) {
      dst[row + i] = sum * inv
      const add = src[row + Math.min(S - 1, i + r + 1)]
      const sub = src[row + Math.max(0, i - r)]
      sum += add - sub
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, S: number, r: number) {
  const inv = 1 / (2 * r + 1)
  for (let i = 0; i < S; i++) {
    let sum = 0
    for (let j = -r; j <= r; j++) sum += src[Math.min(S - 1, Math.max(0, j)) * S + i]
    for (let j = 0; j < S; j++) {
      dst[j * S + i] = sum * inv
      const add = src[Math.min(S - 1, j + r + 1) * S + i]
      const sub = src[Math.max(0, j - r) * S + i]
      sum += add - sub
    }
  }
}
