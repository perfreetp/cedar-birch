import * as THREE from 'three'
import type { Equipment, ReturnVent, RoomSpec, SimSettings, SupplyVent } from '../types'
import { ageColorRamp, ventDirection, ventSpeed, returnVentWorldPos } from '../lib/geometry'
import { SpatialHash } from '../lib/spatial'

const MAX = 20000
const CELL = 0.8
const ABSORB_RADIUS = 0.3
const SUCTION_RADIUS = 3.2
const HEAT_CELL = 0.25
const COLOR_AGE_REF = 10 // 停留 10s 达到色带红色端

interface EquipCache {
  cx: number
  cz: number
  h: number
  hw: number
  hd: number
  cos: number
  sin: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface VentCache {
  x: number
  y: number
  z: number
  dx: number
  dy: number
  dz: number
  speed: number
  weight: number
}

interface ReturnCache {
  x: number
  y: number
  z: number
}

export interface EngineStats {
  fps: number
  alive: number
  avgAge: number
  maxDensity: number
  avgLife: number
}

const VERT = /* glsl */ `
  attribute vec3 aColor;
  varying vec3 vColor;
  uniform float uSize;
  uniform bool uSlice;
  uniform float uSliceY;
  uniform float uBand;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float hidden = uSlice && abs(position.y - uSliceY) > uBand * 0.5 ? 0.0 : 1.0;
    float atten = clamp(10.0 / max(0.1, -mv.z), 0.45, 1.35);
    gl_PointSize = hidden * uSize * atten;
    gl_Position = projectionMatrix * mv;
  }
`

const FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float a = smoothstep(0.25, 0.06, r2);
    gl_FragColor = vec4(vColor, a * 0.92);
  }
`

/**
 * 粒子流场引擎:
 * - 定长 TypedArray 粒子池 + swap-remove 复用,零逐帧 GC
 * - 均匀网格 SpatialHash 做设备分块剔除,每粒子只测邻近 3×3×3 格
 * - 子步长 OBB 碰撞:侧面推出 + 顶面落地滑移,杜绝穿透与悬空堆积
 * - 高度切片:顶点着色器隐藏带外粒子,CPU 统计带内密度画热力图
 */
export class ParticleSystem {
  readonly points: THREE.Points
  readonly heatmap: THREE.Mesh

  private scene: THREE.Scene
  private room: RoomSpec
  private settings: SimSettings

  private equips: EquipCache[] = []
  private vents: VentCache[] = []
  private returns: ReturnCache[] = []
  private hash = new SpatialHash(CELL)
  private queryBuf: number[] = []
  private maxEquipH = 0

  // 粒子池(SoA)
  private pos: Float32Array
  private vel: Float32Array
  private age: Float32Array
  private life: Float32Array
  private phase: Float32Array
  private src: Int16Array
  private colors: Float32Array
  private geometry: THREE.BufferGeometry
  private material: THREE.ShaderMaterial
  private alive = 0
  private rr = 0
  private avgLife = 10
  private wheel: number[] = []

  // 热力图
  private heatCanvas: HTMLCanvasElement
  private heatCtx: CanvasRenderingContext2D
  private heatTex: THREE.CanvasTexture
  private heatCounts: Uint16Array = new Uint16Array(0)
  private gx = 0
  private gz = 0
  private heatFrame = 0
  private maxDensity = 0

  private colorLut: Float32Array
  private time = 0
  private fps = 0
  private fpsFrames = 0
  private fpsTimer = 0
  private statCb: ((s: EngineStats) => void) | null = null
  private statTimer = 0

  constructor(scene: THREE.Scene, room: RoomSpec, settings: SimSettings) {
    this.scene = scene
    this.room = room
    this.settings = settings

    this.pos = new Float32Array(MAX * 3)
    this.vel = new Float32Array(MAX * 3)
    this.colors = new Float32Array(MAX * 3)
    this.age = new Float32Array(MAX)
    this.life = new Float32Array(MAX)
    this.phase = new Float32Array(MAX)
    this.src = new Int16Array(MAX).fill(-1)

    this.geometry = new THREE.BufferGeometry()
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3))
    this.geometry.setDrawRange(0, 0)

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: {
        uSize: { value: 7 },
        uSlice: { value: false },
        uSliceY: { value: room.height / 2 },
        uBand: { value: settings.sliceBand },
      },
    })
    this.points = new THREE.Points(this.geometry, this.material)
    this.points.frustumCulled = false
    scene.add(this.points)

    // 颜色 LUT
    this.colorLut = new Float32Array(256 * 3)
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = ageColorRamp(i / 255)
      this.colorLut[i * 3] = r / 255
      this.colorLut[i * 3 + 1] = g / 255
      this.colorLut[i * 3 + 2] = b / 255
    }

    // 热力图
    this.heatCanvas = document.createElement('canvas')
    this.heatCtx = this.heatCanvas.getContext('2d')!
    this.heatTex = new THREE.CanvasTexture(this.heatCanvas)
    this.heatTex.minFilter = THREE.LinearFilter
    this.heatTex.magFilter = THREE.LinearFilter
    const mat = new THREE.MeshBasicMaterial({
      map: this.heatTex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      opacity: 0.75,
    })
    this.heatmap = new THREE.Mesh(new THREE.PlaneGeometry(room.width, room.depth), mat)
    this.heatmap.rotation.x = -Math.PI / 2
    this.heatmap.visible = false
    scene.add(this.heatmap)
    this.resizeHeatGrid()
  }

  onStats(cb: (s: EngineStats) => void): void {
    this.statCb = cb
  }

  private resizeHeatGrid(): void {
    this.gx = Math.ceil(this.room.width / HEAT_CELL)
    this.gz = Math.ceil(this.room.depth / HEAT_CELL)
    this.heatCounts = new Uint16Array(this.gx * this.gz)
    this.heatCanvas.width = this.gx
    this.heatCanvas.height = this.gz
  }

  /** 布局/风口变化:重建空间分块与缓存(粒子池保留,碰撞解算会自动把受困粒子推出) */
  syncLayout(room: RoomSpec, equips: Equipment[], supplies: SupplyVent[], returns: ReturnVent[]): void {
    const roomChanged = room.width !== this.room.width || room.depth !== this.room.depth || room.height !== this.room.height
    this.room = room
    if (roomChanged) this.resizeHeatGrid()

    this.equips = equips.map((e) => {
      const hw = e.w / 2
      const hd = e.d / 2
      const c = Math.cos(e.rotation)
      const s = Math.sin(e.rotation)
      // OBB 四角求世界 AABB,供空间哈希登记
      let minX = Infinity
      let maxX = -Infinity
      let minZ = Infinity
      let maxZ = -Infinity
      for (const lx of [-hw, hw]) {
        for (const lz of [-hd, hd]) {
          const wx = e.x + lx * c + lz * s
          const wz = e.z - lx * s + lz * c
          minX = Math.min(minX, wx)
          maxX = Math.max(maxX, wx)
          minZ = Math.min(minZ, wz)
          maxZ = Math.max(maxZ, wz)
        }
      }
      return { cx: e.x, cz: e.z, h: e.h, hw, hd, cos: c, sin: s, minX, maxX, minZ, maxZ }
    })

    this.hash = new SpatialHash(CELL, -room.width / 2, 0, -room.depth / 2)
    this.equips.forEach((q, id) => {
      this.hash.insertBox(q.minX, 0, q.minZ, q.maxX, q.h, q.maxZ, id)
    })
    this.maxEquipH = this.equips.reduce((m, q) => Math.max(m, q.h), 0)

    this.vents = supplies.map((v) => {
      const [dx, dy, dz] = ventDirection(v)
      const speed = ventSpeed(v)
      return { x: v.x, y: room.height - 0.03, z: v.z, dx, dy, dz, speed, weight: speed }
    })
    this.wheel = []
    let acc = 0
    for (const v of this.vents) {
      acc += v.weight
      this.wheel.push(acc)
    }

    this.returns = returns.map((r) => {
      const [x, y, z] = returnVentWorldPos(r, room)
      return { x, y, z }
    })
  }

  setSettings(s: SimSettings): void {
    this.settings = s
    const u = this.material.uniforms
    u.uSlice.value = s.sliceEnabled
    u.uBand.value = s.sliceBand
    u.uSliceY.value = s.sliceHeight
    this.heatmap.visible = s.sliceEnabled
    this.heatmap.position.y = s.sliceHeight
  }

  reset(): void {
    this.alive = 0
    this.geometry.setDrawRange(0, 0)
    this.heatCounts.fill(0)
  }

  getAlive(): number {
    return this.alive
  }

  /** 导出用:抓取存活粒子帧 */
  captureParticles(): { count: number; positions: number[]; ages: number[] } {
    const positions: number[] = []
    const ages: number[] = []
    for (let i = 0; i < this.alive; i++) {
      positions.push(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2])
      ages.push(this.age[i])
    }
    return { count: this.alive, positions, ages }
  }

  /** 导入还原粒子帧 */
  restoreParticles(data: { count: number; positions: number[]; ages: number[] }): void {
    this.reset()
    const n = Math.min(data.count, MAX, Math.floor(data.positions.length / 3))
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = data.positions[i * 3]
      this.pos[i * 3 + 1] = data.positions[i * 3 + 1]
      this.pos[i * 3 + 2] = data.positions[i * 3 + 2]
      this.age[i] = data.ages[i] ?? 0
      this.life[i] = 14 + Math.random() * 8
      this.phase[i] = Math.random() * Math.PI * 2
      this.src[i] = i % Math.max(1, this.vents.length)
    }
    this.alive = n
    this.geometry.setDrawRange(0, n)
  }

  private pickVent(): number {
    if (this.wheel.length === 0) return -1
    const total = this.wheel[this.wheel.length - 1]
    const r = Math.random() * total
    let lo = 0
    let hi = this.wheel.length - 1
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.wheel[mid] < r) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  private spawnOne(): void {
    if (this.alive >= MAX || this.vents.length === 0) return
    const vi = this.pickVent()
    const v = this.vents[vi]
    const hx = this.room.width / 2 - 0.15
    const hz = this.room.depth / 2 - 0.15

    // 落点若在出生高度与设备实体相交则抖动重试,避免出生即穿透
    let x = v.x
    let z = v.z
    let ok = false
    const spawnY = this.room.height - 0.1
    for (let tryN = 0; tryN < 4; tryN++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 0.16
      x = Math.max(-hx, Math.min(hx, v.x + Math.cos(a) * r))
      z = Math.max(-hz, Math.min(hz, v.z + Math.sin(a) * r))
      const cand = this.hash.query(x, spawnY, z, this.queryBuf)
      let blocked = false
      for (const id of cand) {
        const q = this.equips[id]
        const dx = x - q.cx
        const dz = z - q.cz
        const lx = dx * q.cos - dz * q.sin
        const lz = dx * q.sin + dz * q.cos
        if (Math.abs(lx) < q.hw && Math.abs(lz) < q.hd && spawnY < q.h) {
          blocked = true
          break
        }
      }
      if (!blocked) {
        ok = true
        break
      }
    }
    if (!ok) return

    const i = this.alive++
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = v.y
    this.pos[i * 3 + 2] = z
    const jitter = 0.05
    this.vel[i * 3] = v.dx * v.speed + (Math.random() - 0.5) * jitter
    this.vel[i * 3 + 1] = v.dy * v.speed
    this.vel[i * 3 + 2] = v.dz * v.speed + (Math.random() - 0.5) * jitter
    this.age[i] = 0
    this.life[i] = 14 + Math.random() * 8
    this.phase[i] = Math.random() * Math.PI * 2
    this.src[i] = vi
  }

  private kill(index: number): void {
    const last = this.alive - 1
    if (index !== last) {
      // swap-remove:末尾槽位移交,池索引恒为 [0, alive)
      const p = index * 3
      const q = last * 3
      this.pos[p] = this.pos[q]
      this.pos[p + 1] = this.pos[q + 1]
      this.pos[p + 2] = this.pos[q + 2]
      this.vel[p] = this.vel[q]
      this.vel[p + 1] = this.vel[q + 1]
      this.vel[p + 2] = this.vel[q + 2]
      this.age[index] = this.age[last]
      this.life[index] = this.life[last]
      this.phase[index] = this.phase[last]
      this.src[index] = this.src[last]
    }
    this.src[last] = -1
    this.alive = last
  }

  /** OBB 侧面推出 + 顶面落地;返回 true 表示发生了碰撞修正 */
  private collide(i: number, prevY: number): boolean {
    const py = this.pos[i * 3 + 1]
    // 高于最高设备的粒子不可能与任何设备相交,直接跳过空间哈希查询
    if (py > this.maxEquipH + 0.02) return false
    const px = this.pos[i * 3]
    const pz = this.pos[i * 3 + 2]
    const ids = this.hash.query(px, py, pz, this.queryBuf)
    let hit = false
    for (let k = 0; k < ids.length; k++) {
      const q = this.equips[ids[k]]
      const dx = px - q.cx
      const dz = pz - q.cz
      const lx = dx * q.cos - dz * q.sin
      const lz = dx * q.sin + dz * q.cos
      if (Math.abs(lx) > q.hw + 0.02 || Math.abs(lz) > q.hd + 0.02) continue
      if (py > q.h + 0.02) continue

      // 顶面落地(本子步从上方穿越顶平面):落顶并保留水平速度滑移,不悬空堆积
      if (prevY >= q.h - 0.001 && py <= q.h && Math.abs(lx) < q.hw - 0.01 && Math.abs(lz) < q.hd - 0.01) {
        this.pos[i * 3 + 1] = q.h + 0.015
        if (this.vel[i * 3 + 1] < 0) this.vel[i * 3 + 1] = 0
        hit = true
        continue
      }
      if (py >= q.h) continue

      // 侧面:沿最小穿透轴推出,并消去法向入射速度(小反弹)
      const penX = q.hw + 0.015 - Math.abs(lx)
      const penZ = q.hd + 0.015 - Math.abs(lz)
      if (penX < penZ) {
        const sx = lx >= 0 ? 1 : -1
        // 本地 +x 轴的世界方向 = (cos, -sin)
        const nx = q.cos * sx
        const nz = -q.sin * sx
        this.pos[i * 3] += nx * penX
        this.pos[i * 3 + 2] += nz * penX
        const vn = this.vel[i * 3] * nx + this.vel[i * 3 + 2] * nz
        if (vn < 0) {
          this.vel[i * 3] -= nx * vn * 1.15
          this.vel[i * 3 + 2] -= nz * vn * 1.15
        }
      } else {
        const sz = lz >= 0 ? 1 : -1
        // 本地 +z 轴的世界方向 = (sin, cos)
        const nx = q.sin * sz
        const nz = q.cos * sz
        this.pos[i * 3] += nx * penZ
        this.pos[i * 3 + 2] += nz * penZ
        const vn = this.vel[i * 3] * nx + this.vel[i * 3 + 2] * nz
        if (vn < 0) {
          this.vel[i * 3] -= nx * vn * 1.15
          this.vel[i * 3 + 2] -= nz * vn * 1.15
        }
      }
      hit = true
    }
    return hit
  }

  step(rawDt: number): void {
    const dt = Math.min(rawDt, 1 / 30)
    const s = this.settings
    if (!s.running) {
      this.pushStats(dt)
      return
    }
    this.time += dt

    // ---- 发射预算:按稳态寿命反推速率,填充期加倍 ----
    const target = s.targetCount
    const rate = target / Math.min(20, Math.max(4, this.avgLife))
    const fill = this.alive < target * 0.9 ? 2.2 : 1
    let budget = Math.min(420, Math.floor(rate * dt * fill))
    while (budget-- > 0 && this.alive < target) {
      this.rr++
      this.spawnOne()
    }

    const sub = 2
    const h = dt / sub
    const hx = this.room.width / 2 - 0.03
    const hz = this.room.depth / 2 - 0.03
    const H = this.room.height - 0.03
    const mul = s.speedMul

    for (let pass = 0; pass < sub; pass++) {
      for (let i = 0; i < this.alive; i++) {
        const p = i * 3
        const px = this.pos[p]
        const py = this.pos[p + 1]
        const pz = this.pos[p + 2]

        // ---- 速度场:射流余速 + 下沉 + 湍流 + 回风抽吸 ----
        const vi = this.src[i] >= 0 ? this.src[i] : 0
        const v = this.vents[vi]
        if (v) {
          const jet = Math.exp(-this.age[i] * 0.28) * mul
          this.vel[p] += v.dx * v.speed * jet * h * 1.4
          this.vel[p + 1] += v.dy * v.speed * jet * h * 1.4
          this.vel[p + 2] += v.dz * v.speed * jet * h * 1.4
        }
        this.vel[p + 1] -= 0.12 * h // 缓下沉(洁净室气流组织)

        const ph = this.phase[i]
        const t = this.time
        this.vel[p] += Math.sin(1.7 * px + 1.1 * t + ph) * 0.18 * h
        this.vel[p + 1] += Math.sin(2.3 * py + 1.7 * t + ph * 1.3) * 0.1 * h
        this.vel[p + 2] += Math.sin(1.9 * pz + 0.9 * t + ph * 0.7) * 0.18 * h

        for (let r = 0; r < this.returns.length; r++) {
          const rv = this.returns[r]
          const dx = rv.x - px
          const dy = rv.y - py
          const dz = rv.z - pz
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
          if (dist < SUCTION_RADIUS && dist > 1e-4) {
            const pull = (0.9 / (0.35 + dist * 0.55)) * h
            this.vel[p] += (dx / dist) * pull
            this.vel[p + 1] += (dy / dist) * pull
            this.vel[p + 2] += (dz / dist) * pull
            if (dist < ABSORB_RADIUS) {
              this.kill(i)
              i--
              break
            }
          }
        }
        if (i < 0) continue
        if (i >= this.alive) break

        // 阻尼 + 限速,保证子步位移不超 MAX_STEP,几何上无法隧穿
        const damp = Math.exp(-0.9 * h)
        this.vel[p] *= damp
        this.vel[p + 1] *= damp
        this.vel[p + 2] *= damp
        const sp2 = this.vel[p] ** 2 + this.vel[p + 1] ** 2 + this.vel[p + 2] ** 2
        if (sp2 > 2.25) {
          const k = 1.5 / Math.sqrt(sp2)
          this.vel[p] *= k
          this.vel[p + 1] *= k
          this.vel[p + 2] *= k
        }

        const prevY = this.pos[p + 1]
        this.pos[p] += this.vel[p] * h
        this.pos[p + 1] += this.vel[p + 1] * h
        this.pos[p + 2] += this.vel[p + 2] * h

        // 房间六面约束
        if (this.pos[p] < -hx) {
          this.pos[p] = -hx
          if (this.vel[p] < 0) this.vel[p] *= -0.2
        } else if (this.pos[p] > hx) {
          this.pos[p] = hx
          if (this.vel[p] > 0) this.vel[p] *= -0.2
        }
        if (this.pos[p + 2] < -hz) {
          this.pos[p + 2] = -hz
          if (this.vel[p + 2] < 0) this.vel[p + 2] *= -0.2
        } else if (this.pos[p + 2] > hz) {
          this.pos[p + 2] = hz
          if (this.vel[p + 2] > 0) this.vel[p + 2] *= -0.2
        }
        if (this.pos[p + 1] < 0.03) {
          this.pos[p + 1] = 0.03
          if (this.vel[p + 1] < 0) this.vel[p + 1] = 0
        } else if (this.pos[p + 1] > H) {
          this.pos[p + 1] = H
          if (this.vel[p + 1] > 0) this.vel[p + 1] = 0
        }

        // 设备碰撞:单步位移 ≤ 2.5cm,设备最薄 0.4m,单遍 OBB 修正即无法隧穿
        this.collide(i, prevY)
      }
    }

    // ---- 老化 / 寿命回收(防永久悬浮) ----
    let ageSum = 0
    for (let i = 0; i < this.alive; i++) {
      this.age[i] += dt
      ageSum += this.age[i]
      if (this.age[i] > this.life[i]) {
        this.avgLife = this.avgLife * 0.96 + this.age[i] * 0.04
        this.kill(i)
        i--
      }
    }

    this.updateColors()
    this.updateHeatmap(dt)
    this.geometry.setDrawRange(0, this.alive)
    ;(this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geometry.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true
    this.pushStats(dt, ageSum)
  }

  private updateColors(): void {
    for (let i = 0; i < this.alive; i++) {
      const t = Math.min(1, this.age[i] / COLOR_AGE_REF)
      const idx = Math.min(255, (t * 255) | 0) * 3
      const p = i * 3
      this.colors[p] = this.colorLut[idx]
      this.colors[p + 1] = this.colorLut[idx + 1]
      this.colors[p + 2] = this.colorLut[idx + 2]
    }
  }

  private updateHeatmap(dt: number): void {
    this.heatFrame++
    this.statTimer += dt
    if (!this.settings.sliceEnabled || this.heatFrame % 4 !== 0) return
    const counts = this.heatCounts
    counts.fill(0)
    const y0 = this.settings.sliceHeight - this.settings.sliceBand / 2
    const y1 = this.settings.sliceHeight + this.settings.sliceBand / 2
    const hx = this.room.width / 2
    const hz = this.room.depth / 2
    let maxC = 0
    for (let i = 0; i < this.alive; i++) {
      const y = this.pos[i * 3 + 1]
      if (y < y0 || y > y1) continue
      const ix = ((this.pos[i * 3] + hx) / HEAT_CELL) | 0
      const iz = ((this.pos[i * 3 + 2] + hz) / HEAT_CELL) | 0
      if (ix < 0 || ix >= this.gx || iz < 0 || iz >= this.gz) continue
      const c = ++counts[iz * this.gx + ix]
      if (c > maxC) maxC = c
    }
    this.maxDensity = maxC

    const img = this.heatCtx.createImageData(this.gx, this.gz)
    for (let i = 0; i < counts.length; i++) {
      const c = counts[i]
      const o = i * 4
      if (c === 0) {
        img.data[o + 3] = 0
        continue
      }
      const t = Math.min(1, Math.log(1 + c) / Math.log(1 + Math.max(1, maxC)))
      const [r, g, b] = ageColorRamp(0.15 + t * 0.75)
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 40 + Math.round(180 * t)
    }
    this.heatCtx.putImageData(img, 0, 0)
    this.heatTex.needsUpdate = true
  }

  private pushStats(dt: number, ageSum?: number): void {
    this.fpsTimer += dt
    this.fpsFrames++
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer)
      this.fpsTimer = 0
      this.fpsFrames = 0
      if (this.statCb) {
        this.statCb({
          fps: this.fps,
          alive: this.alive,
          avgAge: this.alive && ageSum !== undefined ? ageSum / this.alive : 0,
          maxDensity: this.maxDensity,
          avgLife: this.avgLife,
        })
      }
    }
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
    this.heatTex.dispose()
    ;(this.heatmap.material as THREE.Material).dispose()
    this.heatmap.geometry.dispose()
    this.scene.remove(this.points)
    this.scene.remove(this.heatmap)
  }
}
