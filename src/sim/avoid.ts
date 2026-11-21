// 基于 three-mesh-bvh 的障碍物射线避让
// 在仿真 Worker 中运行: 只用 three 的核心数学与 BufferGeometry, 不涉及渲染器.
//
// 思路: 把所有实体障碍物的矩形沿周边生成"防护墙"三角面 (高度方向拉伸到 2m, 以便
// 任意高度的射线都能命中), 构建一棵 MeshBVH. 行人每步向目标方向发射 3 条扇形射线,
// 命中则沿命中面法线滑移 + 切向偏转, 实现平滑绕行.
import { BufferGeometry, Float32BufferAttribute, Ray, Vector3 } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import type { Obstacle, Vec2 } from '../core/types.ts'
import { obstacleCorners } from '../core/geometry.ts'

export interface HitInfo {
  distance: number
  normalX: number
  normalZ: number
  obstacle: number
}

export class ObstacleBVH {
  bvh: MeshBVH | null = null
  obstacleOfTri: number[] = []
  /** 障碍物数量 (闸机算一个) */
  obstacleCount = 0
  /** 每个实体 OBB: cx, cz, cosR, sinR, hx, hz (Float32Array, 6 per box) */
  obb = new Float32Array(0)

  build(obstacles: Obstacle[]) {
    const positions: number[] = []
    const obstacleOfTri: number[] = []
    /** 收集到的实体 OBB (闸机拆成多个机箱) */
    const obbs: { cx: number; cz: number; cos: number; sin: number; hx: number; hz: number }[] = []
    const solid = obstacles.filter((o) => o.enabled && o.solid)
    solid.forEach((o) => {
      if (o.kind === 'gate') {
        // 闸机是"半透膜": 通行代价与承载人数在导航网格中体现, 但机箱不是实体墙,
        // 否则 0.68m 的通道扣除行人半径后几乎没有余量, 会造成死锁.
        // 这里只登记一个 OBB 供 UI 判断, 不生成射线三角面.
        obbs.push({ cx: o.center[0], cz: o.center[1], cos: Math.cos(o.rotation), sin: Math.sin(o.rotation), hx: 0.01, hz: 0.01 })
        this.obstacleCount++
        return
      }
      const oi = this.obstacleCount++
      obbs.push({ cx: o.center[0], cz: o.center[1], cos: Math.cos(o.rotation), sin: Math.sin(o.rotation), hx: o.size[0] / 2, hz: o.size[1] / 2 })
      const corners = obstacleCorners(o)
      const h = Math.max(2.2, o.height)
      // 每边一个竖直四边形 (两个三角形), 法线朝外
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % corners.length]
        positions.push(a[0], -1, a[1], b[0], -1, b[1], b[0], h, b[1])
        obstacleOfTri.push(oi)
        positions.push(a[0], -1, a[1], b[0], h, b[1], a[0], h, a[1])
        obstacleOfTri.push(oi)
      }
    })
    this.obb = new Float32Array(obbs.length * 6)
    obbs.forEach((b, i) => {
      this.obb[i * 6] = b.cx
      this.obb[i * 6 + 1] = b.cz
      this.obb[i * 6 + 2] = b.cos
      this.obb[i * 6 + 3] = b.sin
      this.obb[i * 6 + 4] = b.hx
      this.obb[i * 6 + 5] = b.hz
    })
    this.obstacleOfTri = obstacleOfTri
    if (positions.length === 0) {
      this.bvh = null
      return
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.computeVertexNormals()
    this.bvh = new MeshBVH(geo, { targetLeafSize: 8, strategy: 0 })
  }

  /** 在 (x,z) 处沿方向 (dx,dz) 射线检测, y 取 0.9 高度 */
  raycast(ox: number, oz: number, dx: number, dz: number, maxDist: number, y = 0.9): HitInfo | null {
    if (!this.bvh) return null
    const ray = new Ray(new Vector3(ox, y, oz), new Vector3(dx, 0, dz).normalize())
    const hit = this.bvh.raycastFirst(ray, 0, 0, maxDist) as unknown as
      | { distance: number; face: { normal: Vector3 }; a?: number }
      | null
    if (!hit) return null
    // 三角面法线在竖直墙上为水平方向
    const n = hit.face?.normal
    if (!n) return null
    return {
      distance: hit.distance,
      normalX: n.x,
      normalZ: n.z,
      obstacle: 0,
    }
  }

  /**
   * 多点扇形探测: 返回推荐的偏移方向 (单位向量, 未归一化可能为 0).
   * 采样 -60°..60° 共 angles 条射线, 选最"开阔"的方向.
   */
  probe(ox: number, oz: number, gx: number, gz: number, dist: number, angles: number[]): { bx: number; bz: number; hit: boolean } {
    if (!this.bvh) return { bx: gx, bz: gz, hit: false }
    const base = Math.atan2(gz, gx)
    let bestScore = -Infinity
    let bestDir = base
    let anyHit = false
    const ray = new Ray()
    const origin = new Vector3()
    const dir = new Vector3()
    for (const a of angles) {
      const ang = base + a
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      origin.set(ox, 0.9, oz)
      dir.set(c, 0, s)
      ray.origin.copy(origin)
      ray.direction.copy(dir)
      const hit = this.bvh.raycastFirst(ray, 0, 0, dist) as unknown as { distance: number } | null
      let score: number
      if (hit) {
        anyHit = true
        // 命中: 距离越远分数越高, 且偏离目标角度越多扣分
        score = hit.distance / dist - Math.abs(a) * 0.9
      } else {
        score = 1.35 - Math.abs(a) * 0.55
      }
      if (score > bestScore) {
        bestScore = score
        bestDir = ang
      }
    }
    void origin
    return { bx: Math.cos(bestDir), bz: Math.sin(bestDir), hit: anyHit }
  }

  /** 该点是否位于某个实体障碍物内部 (OBB 判定) */
  insideSolid(x: number, z: number, pad = 0): boolean {
    const obb = this.obb
    const n = obb.length / 6
    for (let i = 0; i < n; i++) {
      const cx = obb[i * 6]
      const cz = obb[i * 6 + 1]
      const c = obb[i * 6 + 2]
      const s = obb[i * 6 + 3]
      const hx = obb[i * 6 + 4] + pad
      const hz = obb[i * 6 + 5] + pad
      const dx = x - cx
      const dz = z - cz
      const lx = dx * c + dz * s
      const lz = -dx * s + dz * c
      if (Math.abs(lx) < hx && Math.abs(lz) < hz) return true
    }
    return false
  }
}

export function cornersOfPoly(poly: Vec2[]): Vec2[] {
  return poly
}
