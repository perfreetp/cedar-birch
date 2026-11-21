// Node 侧引擎约束测试:用最小 DOM stub 承载 three.js,验证
// 1) 20000 粒子稳态运行 2) 无设备穿透 3) 回风吸收与寿命回收 4) 切片统计 5) 设备移动联动重建
import { EventEmitter } from 'node:events'

function makeCanvasStub(w = 256, h = 256): any {
  return {
    width: w,
    height: h,
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getContext: () => ({
      createImageData: (cw: number, ch: number) => ({
        width: cw,
        height: ch,
        data: new Uint8ClampedArray(cw * ch * 4),
      }),
      putImageData() {},
      clearRect() {},
      fillRect() {},
      strokeRect() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      fillText() {},
      scale() {},
      setTransform() {},
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
  }
}

;(globalThis as any).document = {
  createElement: (tag: string) => (tag === 'canvas' ? makeCanvasStub() : { style: {}, appendChild() {} }),
  addEventListener() {},
  removeEventListener() {},
}
;(globalThis as any).window = { addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1 }
;(globalThis as any).self = globalThis
;(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}
;(globalThis as any).HTMLCanvasElement = class {}
;(globalThis as any).ImageData = class {}

const THREE = await import('three')

// WebGL stub(只覆盖 ParticleSystem 构造期 three 调用到的接口)
class GLStub {
  static instances = 0
  constructor() {
    GLStub.instances++
  }
  getExtension() {
    return { UNSIGNED_INT_24_8: 1 }
  }
  getParameter() {
    return 'stub'
  }
  getShaderPrecisionFormat() {
    return { rangeMin: 1, rangeMax: 1, precision: 1 }
  }
  createShader() {
    return {}
  }
  shaderSource() {}
  compileShader() {}
  getShaderParameter() {
    return true
  }
  createProgram() {
    return {}
  }
  attachShader() {}
  linkProgram() {}
  getProgramParameter() {
    return true
  }
  useProgram() {}
  createBuffer() {
    return {}
  }
  bindBuffer() {}
  bufferData() {}
  createTexture() {
    return {}
  }
  bindTexture() {}
  texImage2D() {}
  texParameteri() {}
  enable() {}
  disable() {}
  enableVertexAttribArray() {}
  vertexAttribPointer() {}
  viewport() {}
  clearColor() {}
  clear() {}
  drawArrays() {}
  uniform1f() {}
  uniform1i() {}
  uniform2f() {}
  uniform3f() {}
  uniformMatrix4fv() {}
  getUniformLocation() {
    return {}
  }
  getAttribLocation() {
    return 0
  }
  blendFunc() {}
  depthMask() {}
  depthFunc() {}
  cullFace() {}
}
const { ParticleSystem } = await import('../src/engine/ParticleSystem.ts')
const { useAppStore } = await import('../src/store/useAppStore.ts')

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${msg}`)
  }
}

const st0 = useAppStore.getState()
const scene = new THREE.Scene()
const settings = { ...st0.settings, targetCount: 20000, running: true }
const engine = new ParticleSystem(scene, st0.room, settings)
engine.syncLayout(st0.room, st0.equipment, st0.supplies, st0.returns)

// 预热到稳态
const t0 = performance.now()
for (let i = 0; i < 600; i++) engine.step(1 / 60)
const elapsed = performance.now() - t0
const alive = engine.getAlive()
assert(alive > 15000, `稳态粒子数 ${alive} 接近目标 20000`)
assert(elapsed / 600 < 40, `平均每帧耗时 ${(elapsed / 600).toFixed(2)}ms (<40ms)`)

// 无穿透:检查存活粒子不进入任一设备 OBB 内部(y 在设备高度范围内)
let penetrated = 0
const equips = st0.equipment
// 直接读取内部位置数组(测试目的)
const pos = (engine as any).pos as Float32Array
for (let i = 0; i < alive; i++) {
  const x = pos[i * 3]
  const y = pos[i * 3 + 1]
  const z = pos[i * 3 + 2]
  for (const e of equips) {
    const c = Math.cos(e.rotation)
    const s = Math.sin(e.rotation)
    const dx = x - e.x
    const dz = z - e.z
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    if (Math.abs(lx) < e.w / 2 - 0.02 && Math.abs(lz) < e.d / 2 - 0.02 && y < e.h - 0.02 && y > 0.05) {
      penetrated++
    }
  }
}
assert(penetrated === 0, `600 帧后无粒子进入设备内部(穿透数 ${penetrated})`)

// 房间边界约束
let outside = 0
const hx = st0.room.width / 2
const hz = st0.room.depth / 2
for (let i = 0; i < alive; i++) {
  const x = pos[i * 3]
  const y = pos[i * 3 + 1]
  const z = pos[i * 3 + 2]
  if (x < -hx - 0.05 || x > hx + 0.05 || z < -hz - 0.05 || z > hz + 0.05 || y < -0.02 || y > st0.room.height + 0.05) {
    outside++
  }
}
assert(outside === 0, `无粒子越出房间(越界数 ${outside})`)

// 寿命回收:粒子年龄不超过 life 上限附近(14~22s,运行 10s 还未到上限,先验证 age 有界)
const ages = (engine as any).age as Float32Array
let ageMax = 0
for (let i = 0; i < alive; i++) ageMax = Math.max(ageMax, ages[i])
assert(ageMax <= 10.05, `粒子年龄随仿真时间有界(最大 ${ageMax.toFixed(2)}s ≈ 运行时长)`)

// 再跑 900 帧(共 25s),验证寿命回收 + 重采样持续进行
const before = alive
for (let i = 0; i < 900; i++) engine.step(1 / 60)
assert(engine.getAlive() > 12000, `寿命回收后粒子池保持填充(回收后 ${engine.getAlive()},之前 ${before})`)
let overLife = 0
for (let i = 0; i < engine.getAlive(); i++) if (ages[i] > 22.5) overLife++
assert(overLife === 0, `无超龄悬浮粒子(超龄 ${overLife})`)

// 切片统计
engine.setSettings({ ...settings, sliceEnabled: true, sliceHeight: 1.0, sliceBand: 0.4, running: true })
for (let i = 0; i < 30; i++) engine.step(1 / 60)
let inBand = 0
for (let i = 0; i < engine.getAlive(); i++) {
  const y = pos[i * 3 + 1]
  if (Math.abs(y - 1.0) <= 0.2) inBand++
}
assert(inBand > 50, `高度切片带内存在可统计粒子(带内 ${inBand})`)

// 设备移动联动:把设备 1 移到房间中央并旋转,重建后粒子不得穿透
const moved = { ...equips[0], x: 0, z: 0, rotation: Math.PI / 4 }
const newEquips = [moved, equips[1]]
engine.syncLayout(st0.room, newEquips, st0.supplies, st0.returns)
for (let i = 0; i < 120; i++) engine.step(1 / 60)
let pen2 = 0
for (let i = 0; i < engine.getAlive(); i++) {
  const x = pos[i * 3]
  const y = pos[i * 3 + 1]
  const z = pos[i * 3 + 2]
  const c = Math.cos(moved.rotation)
  const s = Math.sin(moved.rotation)
  const dx = x - moved.x
  const dz = z - moved.z
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  if (Math.abs(lx) < moved.w / 2 - 0.02 && Math.abs(lz) < moved.d / 2 - 0.02 && y < moved.h - 0.02 && y > 0.05) pen2++
}
assert(pen2 === 0, `设备移动+旋转重建后无穿透(穿透数 ${pen2})`)

// 粒子池复用:反复清空/恢复不崩溃
engine.reset()
assert(engine.getAlive() === 0, 'reset 后池为空')
engine.restoreParticles({ count: 100, positions: new Array(300).fill(1), ages: new Array(100).fill(0.5) })
assert(engine.getAlive() === 100, '快照粒子帧可还原(100)')
for (let i = 0; i < 60; i++) engine.step(1 / 60)
assert(engine.getAlive() > 0, '还原后仿真继续运行')

console.log(`\nWebGL stub 实例数:${GLStub.instances}(应为 0,引擎本身不创建渲染器)`)
console.log('全部引擎约束测试完成。')
