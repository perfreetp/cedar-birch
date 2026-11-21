/**
 * 均匀网格空间哈希(空间分块剔除)。
 * 用整数 key 代替字符串 key,查询返回去重后的对象 id 列表。
 */
export class SpatialHash {
  readonly cell: number
  private readonly map = new Map<number, number[]>()
  private readonly tag: number[] = []
  private querySerial = 0
  private readonly ox: number
  private readonly oy: number
  private readonly oz: number

  constructor(cell: number, originX = 0, originY = 0, originZ = 0) {
    this.cell = cell
    this.ox = originX
    this.oy = originY
    this.oz = originZ
  }

  clear(): void {
    this.map.clear()
  }

  private keyOf(ix: number, iy: number, iz: number): number {
    // 11 bit 每轴(0..2047),房间尺度足够
    return ((ix + 2048) & 0x7ff) | (((iy + 2048) & 0x7ff) << 11) | (((iz + 2048) & 0x7ff) << 22)
  }

  private cellOf(v: number, o: number): number {
    return Math.floor((v - o) / this.cell)
  }

  /** 把一个 AABB 覆盖到的所有格子登记上对象 id */
  insertBox(
    minX: number, minY: number, minZ: number,
    maxX: number, maxY: number, maxZ: number,
    id: number,
  ): void {
    const x0 = this.cellOf(minX, this.ox)
    const x1 = this.cellOf(maxX, this.ox)
    const y0 = this.cellOf(minY, this.oy)
    const y1 = this.cellOf(maxY, this.oy)
    const z0 = this.cellOf(minZ, this.oz)
    const z1 = this.cellOf(maxZ, this.oz)
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          const key = this.keyOf(ix, iy, iz)
          let bucket = this.map.get(key)
          if (!bucket) {
            bucket = []
            this.map.set(key, bucket)
          }
          bucket.push(id)
        }
      }
    }
  }

  /** 查询点周围 3×3×3 邻域内的对象 id(自动去重) */
  query(x: number, y: number, z: number, out: number[]): number[] {
    out.length = 0
    this.querySerial += 1
    const cx = this.cellOf(x, this.ox)
    const cy = this.cellOf(y, this.oy)
    const cz = this.cellOf(z, this.oz)
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (let iz = cz - 1; iz <= cz + 1; iz++) {
          const bucket = this.map.get(this.keyOf(ix, iy, iz))
          if (!bucket) continue
          for (let k = 0; k < bucket.length; k++) {
            const id = bucket[k]
            if (this.tag[id] !== this.querySerial) {
              this.tag[id] = this.querySerial
              out.push(id)
            }
          }
        }
      }
    }
    return out
  }
}
