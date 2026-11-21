import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'postprocessing'
import { RenderPass } from 'postprocessing'
import { EffectPass } from 'postprocessing'
import { BloomEffect } from 'postprocessing'
import { VignetteEffect } from 'postprocessing'
import type { DatasetMeta } from '../types'
import { DEPTH_RAMP, DEPTH_THRESHOLD } from '../types'
import { frameCache } from '../core/frameCache'
import { state, tick } from '../core/store'

const Z_SCALE = 1.5 // 垂直夸张

const WATER_VERT = /* glsl */ `
uniform sampler2D tTerrain;
uniform sampler2D tDepthA;
uniform sampler2D tDepthB;
uniform float uMix;
uniform float uZScale;
varying float vDepth;
varying vec2 vUv;
varying vec3 vWorldPos;

float depthAt(vec2 uv) {
  return mix(texture2D(tDepthA, uv).r, texture2D(tDepthB, uv).r, uMix);
}

void main() {
  vUv = uv;
  float d = depthAt(uv);
  vDepth = d;
  vec3 pos = position;
  pos.y = (texture2D(tTerrain, uv).r + max(d, 0.0)) * uZScale + 0.15;
  vWorldPos = pos;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`

const WATER_FRAG = /* glsl */ `
uniform sampler2D tTerrain;
uniform sampler2D tDepthA;
uniform sampler2D tDepthB;
uniform sampler2D tRamp;
uniform float uMix;
uniform float uZScale;
uniform float uTexel;
uniform float uCellWorld;
uniform float uThreshold;
uniform float uMaxDepth;
uniform float uTime;
uniform vec3 uSunDir;
varying float vDepth;
varying vec2 vUv;
varying vec3 vWorldPos;

float depthAtF(vec2 uv) {
  return mix(texture2D(tDepthA, uv).r, texture2D(tDepthB, uv).r, uMix);
}
float surfaceAtF(vec2 uv) {
  return texture2D(tTerrain, uv).r + max(depthAtF(uv), 0.0);
}

void main() {
  if (vDepth < uThreshold) discard;
  // 六级色带:0.5m ~ 5m 映射到 0..1
  float t = clamp((vDepth - 0.5) / (5.0 - 0.5), 0.0, 1.0);
  vec3 ramp = texture2D(tRamp, vec2(t, 0.5)).rgb;
  // 超过 5m 继续加深
  ramp *= 1.0 - 0.25 * clamp((vDepth - 5.0) / max(uMaxDepth - 5.0, 1.0), 0.0, 1.0);

  // 片元级水面法线(2 纹素差分,平滑逐格噪声)
  float e = uTexel * 2.0;
  float w = 2.0 * e * uCellWorld;
  float hx = surfaceAtF(vUv + vec2(e, 0.0)) - surfaceAtF(vUv - vec2(e, 0.0));
  float hz = surfaceAtF(vUv + vec2(0.0, e)) - surfaceAtF(vUv - vec2(0.0, e));
  vec3 n = normalize(vec3(-hx * uZScale / w, 1.0, -hz * uZScale / w));

  float diff = max(dot(n, uSunDir), 0.0) * 0.45 + 0.55;
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 2.0);
  vec3 spec = vec3(1.0, 0.98, 0.9) * pow(max(dot(reflect(-uSunDir, n), viewDir), 0.0), 32.0) * 0.22;

  vec3 color = ramp * diff + spec + fresnel * vec3(0.18, 0.26, 0.3);

  // 前锋线发光:水深接近阈值处提亮
  float edge = 1.0 - smoothstep(uThreshold, uThreshold + 0.22, vDepth);
  color += vec3(0.35, 0.9, 1.0) * edge * 1.05;

  float alpha = mix(0.72, 0.94, clamp(vDepth / 3.0, 0.0, 1.0));
  alpha = max(alpha, edge * 0.95);
  gl_FragColor = vec4(color, alpha);
}
`

function buildRampTexture(): THREE.DataTexture {
  const N = 128
  const data = new Float32Array(N * 4)
  const stops = DEPTH_RAMP
  for (let i = 0; i < N; i++) {
    const d = 0.5 + (i / (N - 1)) * (5.0 - 0.5)
    let a = stops[0]
    let b = stops[stops.length - 1]
    for (let s = 0; s < stops.length - 1; s++) {
      if (d >= stops[s].stop && d <= stops[s + 1].stop) {
        a = stops[s]
        b = stops[s + 1]
        break
      }
    }
    const t = Math.min(Math.max((d - a.stop) / (b.stop - a.stop || 1), 0), 1)
    data[i * 4] = a.color[0] + (b.color[0] - a.color[0]) * t
    data[i * 4 + 1] = a.color[1] + (b.color[1] - a.color[1]) * t
    data[i * 4 + 2] = a.color[2] + (b.color[2] - a.color[2]) * t
    data[i * 4 + 3] = 1
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.FloatType)
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

function elevColor(t: number): [number, number, number] {
  // 河谷绿 → 黄褐 → 灰岩
  const c1 = [0.20, 0.38, 0.20]
  const c2 = [0.48, 0.40, 0.26]
  const c3 = [0.60, 0.58, 0.56]
  if (t < 0.5) {
    const k = t / 0.5
    return [c1[0] + (c2[0] - c1[0]) * k, c1[1] + (c2[1] - c1[1]) * k, c1[2] + (c2[2] - c1[2]) * k]
  }
  const k = (t - 0.5) / 0.5
  return [c2[0] + (c3[0] - c2[0]) * k, c2[1] + (c3[1] - c2[1]) * k, c2[2] + (c3[2] - c2[2]) * k]
}

export class FloodScene {
  private renderer!: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera!: THREE.PerspectiveCamera
  private controls!: OrbitControls
  private composer!: EffectComposer
  private terrainMesh: THREE.Mesh | null = null
  private waterMesh: THREE.Mesh | null = null
  private waterUniforms: Record<string, THREE.IUniform> = {}
  private clock = new THREE.Clock()
  private raycaster = new THREE.Raycaster()
  private marker: THREE.Mesh
  private camAnim: { fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTgt: THREE.Vector3; toTgt: THREE.Vector3; t: number } | null = null
  private texRequestId = 0
  private meta: DatasetMeta | null = null
  private container: HTMLElement | null = null
  private resizeObs: ResizeObserver | null = null
  private disposed = false

  constructor() {
    this.scene.background = new THREE.Color(0x0e141b)
    this.scene.fog = new THREE.Fog(0x0e141b, 4000, 16000)
    const sun = new THREE.DirectionalLight(0xffffff, 1.25)
    sun.position.set(-0.5, 1, 0.35).normalize()
    this.scene.add(sun)
    this.scene.add(new THREE.AmbientLight(0xbfd4e6, 0.38))
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, depthTest: false, transparent: true, opacity: 0.95 }),
    )
    this.marker.renderOrder = 10
    this.marker.visible = false
    this.scene.add(this.marker)
  }

  init(container: HTMLElement): void {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(this.renderer.domElement)

    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 60000)
    this.camera.position.set(0, 3000, 4200)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.495

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    const bloom = new BloomEffect({
      intensity: 0.55,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.2,
      mipmapBlur: true,
      radius: 0.7,
    })
    this.composer.addPass(new EffectPass(this.camera, bloom, new VignetteEffect({ offset: 0.25, darkness: 0.55 })))

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.renderer.setAnimationLoop(() => this.frame())
  }

  private resize(): void {
    if (!this.container || !this.renderer) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
    this.composer.setSize(w, h)
  }

  /** 数据集变化后重建地形与水面 */
  build(meta: DatasetMeta, terrain: Float32Array): void {
    this.meta = meta
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh)
      this.terrainMesh.geometry.dispose()
      ;(this.terrainMesh.material as THREE.Material).dispose()
    }
    if (this.waterMesh) {
      this.scene.remove(this.waterMesh)
      this.waterMesh.geometry.dispose()
      ;(this.waterMesh.material as THREE.Material).dispose()
    }

    const { width, height, cellSize, minElev, maxElev } = meta
    const W = width * cellSize
    const H = height * cellSize
    // 雾效范围随场景尺度调整
    const m0 = Math.max(W, H)
    this.scene.fog = new THREE.Fog(0x0e141b, m0 * 2.0, m0 * 6)

    // 地形几何
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(width * height * 3)
    const col = new Float32Array(width * height * 3)
    const uv = new Float32Array(width * height * 2)
    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const i = r * width + c
        const e = Number.isFinite(terrain[i]) ? terrain[i] : minElev
        pos[i * 3] = (c + 0.5) * cellSize - W / 2
        pos[i * 3 + 1] = e * Z_SCALE
        pos[i * 3 + 2] = (r + 0.5) * cellSize - H / 2
        const t = (e - minElev) / Math.max(maxElev - minElev, 1e-6)
        const [cr, cg, cb] = elevColor(t)
        col[i * 3] = cr
        col[i * 3 + 1] = cg
        col[i * 3 + 2] = cb
        uv[i * 2] = (c + 0.5) / width
        uv[i * 2 + 1] = (r + 0.5) / height
      }
    }
    const idx = new Uint32Array((width - 1) * (height - 1) * 6)
    let k = 0
    for (let r = 0; r < height - 1; r++) {
      for (let c = 0; c < width - 1; c++) {
        const a = r * width + c
        const b = a + 1
        const d = a + width
        const e = d + 1
        idx[k++] = a; idx[k++] = d; idx[k++] = b
        idx[k++] = b; idx[k++] = d; idx[k++] = e
      }
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))
    geo.computeVertexNormals()

    const terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true })
    this.terrainMesh = new THREE.Mesh(geo, terrainMat)
    this.scene.add(this.terrainMesh)

    // 地形高度纹理(供水着色器采样)
    const terrainTex = new THREE.DataTexture(new Float32Array(terrain), width, height, THREE.RedFormat, THREE.FloatType)
    terrainTex.magFilter = THREE.LinearFilter
    terrainTex.minFilter = THREE.LinearFilter
    terrainTex.needsUpdate = true

    // 水面几何(与地形同网格,顶点着色器中抬升)
    const waterGeo = new THREE.BufferGeometry()
    waterGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3))
    waterGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2))
    waterGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1))

    const placeholder = new THREE.DataTexture(new Float32Array(width * height), width, height, THREE.RedFormat, THREE.FloatType)
    placeholder.needsUpdate = true

    this.waterUniforms = {
      tTerrain: { value: terrainTex },
      tDepthA: { value: placeholder },
      tDepthB: { value: placeholder },
      tRamp: { value: buildRampTexture() },
      uMix: { value: 0 },
      uZScale: { value: Z_SCALE },
      uCellWorld: { value: Math.max(W, H) },
      uTexel: { value: 1 / width },
      uThreshold: { value: DEPTH_THRESHOLD },
      uMaxDepth: { value: Math.max(meta.maxDepth, 5) },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(-0.5, 1, 0.35).normalize() },
    }
    const waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: this.waterUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat)
    this.waterMesh.renderOrder = 2
    this.waterMesh.frustumCulled = false
    this.scene.add(this.waterMesh)

    this.setView(state.viewMode, true)
    this.updateWaterTextures()
  }

  /** 视角切换:top 俯视 / oblique 斜视 */
  setView(mode: 'top' | 'oblique', instant = false): void {
    if (!this.meta || !this.camera) return
    const W = this.meta.width * this.meta.cellSize
    const H = this.meta.height * this.meta.cellSize
    const m = Math.max(W, H)
    const toPos = mode === 'top' ? new THREE.Vector3(0, m * 1.25, 0.01) : new THREE.Vector3(0, m * 0.72, m * 0.92)
    const toTgt = new THREE.Vector3(0, 0, mode === 'top' ? 0 : -m * 0.05)
    if (instant) {
      this.camera.position.copy(toPos)
      this.controls.target.copy(toTgt)
      this.camAnim = null
      return
    }
    this.camAnim = { fromPos: this.camera.position.clone(), toPos, fromTgt: this.controls.target.clone(), toTgt, t: 0 }
  }

  /** 拾取地形上的点,返回栅格行列 */
  pick(ndcX: number, ndcY: number): { col: number; row: number } | null {
    if (!this.terrainMesh || !this.meta) return null
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera)
    const hits = this.raycaster.intersectObject(this.terrainMesh)
    if (!hits.length || !hits[0].uv) return null
    const u = hits[0].uv.x
    const v = hits[0].uv.y
    const col = Math.min(Math.floor(u * this.meta.width), this.meta.width - 1)
    const row = Math.min(Math.floor(v * this.meta.height), this.meta.height - 1)
    this.showMarker(col, row)
    return { col, row }
  }

  private showMarker(col: number, row: number): void {
    if (!this.meta || !state.terrain) return
    const { width, cellSize } = this.meta
    const W = width * cellSize
    const H = this.meta.height * cellSize
    const e = state.terrain[row * width + col] || 0
    this.marker.position.set((col + 0.5) * cellSize - W / 2, e * Z_SCALE + cellSize * 0.6, (row + 0.5) * cellSize - H / 2)
    this.marker.scale.setScalar(cellSize * 0.6)
    this.marker.visible = true
  }

  hideMarker(): void {
    this.marker.visible = false
  }

  private async updateWaterTextures(): Promise<void> {
    if (!this.meta || !this.waterUniforms.tDepthA) return
    const count = this.meta.frameCount
    const idxA = Math.min(Math.floor(state.currentFrame), count - 1)
    const idxB = Math.min(idxA + 1, count - 1)
    const mix = state.currentFrame - idxA
    const reqId = ++this.texRequestId
    frameCache.prefetch(idxA)
    const [texA, texB] = await Promise.all([frameCache.getTexture(idxA), frameCache.getTexture(idxB)])
    if (reqId !== this.texRequestId || !texA || !texB) return
    this.waterUniforms.tDepthA.value = texA
    this.waterUniforms.tDepthB.value = texB
    this.waterUniforms.uMix.value = mix
  }

  private lastFrameKey = ''

  private frame(): void {
    if (this.disposed) return
    const dt = Math.min(this.clock.getDelta(), 0.1)
    tick(dt)

    // 相机过渡动画
    if (this.camAnim) {
      this.camAnim.t = Math.min(this.camAnim.t + dt / 0.8, 1)
      const k = this.camAnim.t
      const ease = k * k * (3 - 2 * k)
      this.camera.position.lerpVectors(this.camAnim.fromPos, this.camAnim.toPos, ease)
      this.controls.target.lerpVectors(this.camAnim.fromTgt, this.camAnim.toTgt, ease)
      if (this.camAnim.t >= 1) this.camAnim = null
    }
    this.controls.update()

    if (this.meta) {
      const key = `${Math.floor(state.currentFrame * 1000)}`
      if (key !== this.lastFrameKey) {
        this.lastFrameKey = key
        void this.updateWaterTextures()
      }
      this.waterUniforms.uTime.value = (this.waterUniforms.uTime.value as number) + dt
    }

    this.composer.render()
  }

  dispose(): void {
    this.disposed = true
    this.resizeObs?.disconnect()
    this.renderer?.setAnimationLoop(null)
    this.renderer?.dispose()
    this.renderer?.domElement.remove()
  }
}
