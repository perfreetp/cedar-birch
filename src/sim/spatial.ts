// 空间哈希: 用于行人之间近邻查询 (社会力排斥 / 密度感知)
export class SpatialHash {
  cellSize: number
  minX: number
  minZ: number
  cols: number
  rows: number
  /** 每格起点 (CSR) */
  start: Int32Array
  /** 每格内行人索引 */
  items: Int32Array
  private counts: Int32Array
  private cellOfPerson: Int32Array
  private xs: Float32Array = new Float32Array(0)
  private zs: Float32Array = new Float32Array(0)
  n = 0

  constructor(minX: number, minZ: number, maxX: number, maxZ: number, cellSize = 1.0) {
    this.cellSize = cellSize
    this.minX = minX
    this.minZ = minZ
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize))
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize))
    const n = this.cols * this.rows
    this.start = new Int32Array(n + 1)
    this.counts = new Int32Array(n)
    this.items = new Int32Array(0)
    this.cellOfPerson = new Int32Array(0)
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor((x - this.minX) / this.cellSize)
    const j = Math.floor((z - this.minZ) / this.cellSize)
    if (i < 0 || j < 0 || i >= this.cols || j >= this.rows) return -1
    return j * this.cols + i
  }

  /** xs/zs 为前 n 个有效行人的坐标 */
  build(xs: Float32Array, zs: Float32Array, n: number) {
    this.xs = xs
    this.zs = zs
    this.n = n
    const cells = this.cols * this.rows
    if (this.items.length < n) this.items = new Int32Array(Math.max(n, 64))
    if (this.cellOfPerson.length < n) this.cellOfPerson = new Int32Array(Math.max(n, 64))
    const counts = this.counts
    counts.fill(0)
    const cellOfPerson = this.cellOfPerson
    for (let p = 0; p < n; p++) {
      const c = this.cellOf(xs[p], zs[p])
      cellOfPerson[p] = c
      if (c >= 0) counts[c]++
    }
    let acc = 0
    for (let c = 0; c < cells; c++) {
      this.start[c] = acc
      acc += counts[c]
    }
    this.start[cells] = acc
    counts.fill(0)
    const items = this.items
    for (let p = 0; p < n; p++) {
      const c = cellOfPerson[p]
      if (c < 0) continue
      items[this.start[c] + counts[c]++] = p
    }
  }

  /** 遍历点附近 r 半径内的候选 (回调返回 true 则停止) */
  query(x: number, z: number, r: number, cb: (idx: number) => boolean | void) {
    const cs = this.cellSize
    const i0 = Math.max(0, Math.floor((x - r - this.minX) / cs))
    const i1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / cs))
    const j0 = Math.max(0, Math.floor((z - r - this.minZ) / cs))
    const j1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / cs))
    if (i1 < i0 || j1 < j0) return
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.cols + i
        const s = this.start[c]
        const e = this.start[c + 1]
        for (let t = s; t < e; t++) {
          if (cb(this.items[t]) === true) return
        }
      }
    }
  }

  /** 统计半径 r 内(不含自身)的人数, 以及最近邻距离平方 */
  nearCount(x: number, z: number, r: number, self = -1): { count: number; nearestSq: number } {
    const r2 = r * r
    const cs = this.cellSize
    const i0 = Math.max(0, Math.floor((x - r - this.minX) / cs))
    const i1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / cs))
    const j0 = Math.max(0, Math.floor((z - r - this.minZ) / cs))
    const j1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / cs))
    let count = 0
    let nearestSq = r2
    const xs = this.xs
    const zs = this.zs
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.cols + i
        for (let t = this.start[c]; t < this.start[c + 1]; t++) {
          const p = this.items[t]
          if (p === self) continue
          const dx = xs[p] - x
          const dz = zs[p] - z
          const d2 = dx * dx + dz * dz
          if (d2 <= r2) {
            count++
            if (d2 < nearestSq) nearestSq = d2
          }
        }
      }
    }
    return { count, nearestSq }
  }

  /** 遍历 r 半径内的邻居并带距离 */
  forEachNear(x: number, z: number, r: number, cb: (idx: number, dx: number, dz: number, d2: number) => void, self = -1) {
    const r2 = r * r
    const cs = this.cellSize
    const i0 = Math.max(0, Math.floor((x - r - this.minX) / cs))
    const i1 = Math.min(this.cols - 1, Math.floor((x + r - this.minX) / cs))
    const j0 = Math.max(0, Math.floor((z - r - this.minZ) / cs))
    const j1 = Math.min(this.rows - 1, Math.floor((z + r - this.minZ) / cs))
    const xs = this.xs
    const zs = this.zs
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const c = j * this.cols + i
        for (let t = this.start[c]; t < this.start[c + 1]; t++) {
          const p = this.items[t]
          if (p === self) continue
          const dx = xs[p] - x
          const dz = zs[p] - z
          const d2 = dx * dx + dz * dz
          if (d2 <= r2) cb(p, dx, dz, d2)
        }
      }
    }
  }
}
