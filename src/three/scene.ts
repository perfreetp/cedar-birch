// Three.js 场景: 站台几何 / 遮挡正确的热力叠加 / 行人实例 / 编辑拾取
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { MeshBVH, acceleratedRaycast, computeBoundsTree } from 'three-mesh-bvh'
import type { Obstacle, StationDoc, Vec2 } from '../core/types.ts'
import { OBSTACLE_LABELS, ZONE_COLORS } from '../core/types.ts'
import { obstacleCorners, polygonBounds, pointInPolygon } from '../core/geometry.ts'
import type { AgentExport } from '../sim/engine.ts'
import { heatFragmentShader, heatVertexShader } from './shaders.ts'
import { DENSITY_BANDS, OVERLOAD_COLOR } from '../core/format.ts'

// 让所有 Mesh 都能用 BVH 加速拾取
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree as never
THREE.Mesh.prototype.raycast = acceleratedRaycast

export interface PickResult {
  kind: 'obstacle' | 'zone' | 'ground'
  id?: string
  point: Vec2
  height?: number
}

export interface ViewOptions {
  showZones: boolean
  showObstacles: boolean
  showAgents: boolean
  showHeat: boolean
  showGrid: boolean
  heatOpacity: number
  showBands: boolean
  cameraMode: 'orbit' | 'top'
}

const HEAT_Y = 0.035
const ZONE_Y = 0.012
const FLOOR_Y = 0

export class StationScene {
  container: HTMLElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  orthoCamera: THREE.OrthographicCamera
  controls: OrbitControls
  private raycaster = new THREE.Raycaster()
  private pointer = new THREE.Vector2()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  private root = new THREE.Group()
  private stationGroup = new THREE.Group()
  private obstacleGroup = new THREE.Group()
  private heatMesh: THREE.Mesh | null = null
  private heatTexture: THREE.DataTexture | null = null
  private heatMaterial: THREE.ShaderMaterial | null = null
  private agentsMesh: THREE.InstancedMesh | null = null
  private agentCapacity = 0
  private selectionHelper: THREE.Line | null = null
  private draftHelper: THREE.Line | null = null
  private draftDots: THREE.Points | null = null
  private gridHelper: THREE.LineSegments | null = null
  private hoverHelper: THREE.Line | null = null
  private zoneMeshes: THREE.Mesh[] = []

  private doc: StationDoc | null = null
  private opts: ViewOptions = {
    showZones: true,
    showObstacles: true,
    showAgents: true,
    showHeat: true,
    showGrid: false,
    heatOpacity: 0.78,
    showBands: true,
    cameraMode: 'orbit',
  }
  private animId = 0
  private disposed = false
  private onFrame?: (dt: number) => void
  private resizeObserver: ResizeObserver
  private heatSize = 512
  private heatBounds = { minX: 0, minZ: 0, w: 1, d: 1 }

  constructor(container: HTMLElement, doc: StationDoc) {
    this.container = container
    this.doc = doc
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.shadowMap.enabled = false
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.touchAction = 'none'

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#0d1117')
    this.scene.fog = new THREE.Fog('#0d1117', 200, 460)

    this.camera = new THREE.PerspectiveCamera(46, container.clientWidth / container.clientHeight, 0.1, 1200)
    this.orthoCamera = new THREE.OrthographicCamera(-60, 60, 40, -40, 0.1, 2000)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.maxPolarAngle = Math.PI * 0.495
    this.controls.minDistance = 8
    this.controls.maxDistance = 620
    this.controls.screenSpacePanning = false

    this.scene.add(this.root)
    this.root.add(this.stationGroup, this.obstacleGroup)

    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a3038, 1.15)
    const dir = new THREE.DirectionalLight(0xffffff, 1.55)
    dir.position.set(60, 120, 40)
    const dir2 = new THREE.DirectionalLight(0x9ec6ff, 0.5)
    dir2.position.set(-70, 60, -60)
    this.scene.add(hemi, dir, dir2)

    this.buildStation()
    this.fitCamera()
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.installTopViewControls()
    this.animate()
  }

  setFrameCallback(fn: (dt: number) => void) {
    this.onFrame = fn
  }

  resize() {
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h)
    const aspect = w / h
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
    const span = this.orthoSpan
    this.orthoCamera.left = -span * aspect
    this.orthoCamera.right = span * aspect
    this.orthoCamera.top = span
    this.orthoCamera.bottom = -span
    this.orthoCamera.updateProjectionMatrix()
  }

  private orthoSpan = 30

  fitCamera() {
    if (!this.doc) return
    const b = polygonBounds(this.doc.outline.outer)
    const w = b.maxX - b.minX
    const d = b.maxY - b.minY
    const cx = (b.minX + b.maxX) / 2
    const cz = (b.minY + b.maxY) / 2
    // 取景: 对包围盒 8 个角做投影拟合, 找到刚好完整入画的相机距离
    const aspect = Math.max(0.4, this.container.clientWidth / Math.max(1, this.container.clientHeight))
    const target = new THREE.Vector3(cx, 0, cz)
    this.controls.target.copy(target)
    const elev = (44 * Math.PI) / 180
    const dir = new THREE.Vector3(0, Math.sin(elev), Math.cos(elev)).normalize()
    const corners: THREE.Vector3[] = []
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        for (const y of [0, 3.4]) corners.push(new THREE.Vector3(cx + (sx * w) / 2, y, cz + (sz * d) / 2))
    const probeCam = new THREE.PerspectiveCamera(this.camera.fov, aspect, 0.1, 4000)
    const sphereR = 0.5 * Math.sqrt(w * w + d * d + 9) + 1
    const fit = (distance: number) => {
      probeCam.position.copy(target).addScaledVector(dir, distance)
      probeCam.lookAt(target)
      probeCam.updateMatrixWorld()
      probeCam.updateProjectionMatrix()
      let maxAbs = 0
      for (const c of corners) {
        const p = c.clone().project(probeCam)
        maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y))
      }
      return maxAbs
    }
    // 在 [0.05·R, 4·R] 内采样距离, 取最大投影 ≤ 0.88 的最小距离
    let dist = sphereR * 4
    for (let k = 0; k <= 320; k++) {
      const cand = sphereR * 0.05 + (sphereR * 4 - sphereR * 0.05) * (k / 320)
      if (fit(cand) <= 0.88) {
        dist = cand
        break
      }
    }
    this.camera.position.copy(target).addScaledVector(dir, dist)
    this.camera.lookAt(target)
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = Math.max(6, sphereR * 0.1)
    this.controls.maxDistance = dist * 3.2
    void probeCam
    this.camera.updateProjectionMatrix()
    this.controls.update()
    this.orthoSpan = Math.max(d * 0.66, (w / Math.max(0.5, aspect)) * 0.55)
    this.orthoCamera.position.set(cx, 220, cz)
    this.orthoCamera.up.set(0, 0, -1)
    this.orthoCamera.lookAt(cx, 0, cz)
    this.resize()
  }

  /** 2D 视图下: 滚轮缩放 + 左键拖拽平移 (OrbitControls 在正交相机下会打乱 up) */
  private installTopViewControls() {
    const el = this.renderer.domElement
    let dragging = false
    let lastX = 0
    let lastY = 0
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.opts.cameraMode !== 'top') return
        e.preventDefault()
        this.zoomTop(e.deltaY > 0 ? 1.12 : 1 / 1.12)
      },
      { passive: false },
    )
    el.addEventListener('pointerdown', (e) => {
      if (this.opts.cameraMode !== 'top' || e.button !== 0) return
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
    })
    window.addEventListener('pointerup', () => (dragging = false))
    window.addEventListener('pointermove', (e) => {
      if (!dragging || this.opts.cameraMode !== 'top') return
      const rect = el.getBoundingClientRect()
      const spanX = ((this.orthoCamera.right - this.orthoCamera.left) / Math.max(1, rect.width)) * 1
      const spanY = ((this.orthoCamera.top - this.orthoCamera.bottom) / Math.max(1, rect.height)) * 1
      const dx = -(e.clientX - lastX) * spanX
      const dz = -(e.clientY - lastY) * spanY
      lastX = e.clientX
      lastY = e.clientY
      this.panTop(dx, dz)
    })
  }

  setCameraMode(mode: 'orbit' | 'top') {
    this.opts.cameraMode = mode
    if (mode === 'top') {
      const b = polygonBounds(this.doc?.outline.outer ?? [[-5, -5], [5, -5], [5, 5], [-5, 5]])
      const cx = (b.minX + b.maxX) / 2
      const cz = (b.minY + b.maxY) / 2
      this.orthoCamera.position.set(cx, 220, cz)
      this.orthoCamera.up.set(0, 0, -1)
      this.orthoCamera.lookAt(cx, 0, cz)
      this.rh()
    }
  }

  private rh() {
    this.resize()
  }

  get activeCamera(): THREE.Camera {
    return this.opts.cameraMode === 'top' ? this.orthoCamera : this.camera
  }

  // ---------- 站台几何 ----------
  setDoc(doc: StationDoc) {
    this.doc = doc
    this.buildStation()
  }

  private disposeGroup(g: THREE.Group) {
    for (const child of [...g.children]) {
      g.remove(child)
      disposeObject(child)
    }
  }

  private buildStation() {
    const doc = this.doc
    if (!doc) return
    this.disposeGroup(this.stationGroup)
    this.disposeGroup(this.obstacleGroup)
    this.zoneMeshes = []

    const outer = doc.outline.outer
    if (!outer || outer.length < 3) return
    const b = polygonBounds(outer)

    // 地坪: 外轮廓挤出 0.18m, 侧面深色
    const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)))
    for (const hole of doc.outline.holes ?? []) {
      const p = new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z)))
      shape.holes.push(p)
    }
    const floorGeo = new THREE.ShapeGeometry(shape, 24)
    floorGeo.rotateX(-Math.PI / 2)
    floorGeo.computeVertexNormals()
    floorGeo.computeBoundsTree()
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#2a313c',
      roughness: 0.92,
      metalness: 0.06,
      side: THREE.DoubleSide,
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.position.y = FLOOR_Y
    floor.receiveShadow = false
    floor.name = 'floor'
    this.stationGroup.add(floor)

    // 底座 (挤出侧面), 提供厚度与阴影感
    const plinthShape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)))
    const plinthGeo = new THREE.ExtrudeGeometry(plinthShape, { depth: 0.5, bevelEnabled: false })
    plinthGeo.rotateX(Math.PI / 2)
    plinthGeo.translate(0, -0.5, 0)
    const plinth = new THREE.Mesh(
      plinthGeo,
      new THREE.MeshStandardMaterial({ color: '#161b22', roughness: 1, metalness: 0 }),
    )
    this.stationGroup.add(plinth)

    // 站台边缘安全带 (按 zone kind 渲染)
    for (const zone of doc.zones) {
      if (zone.polygon.length < 3) continue
      const zShape = new THREE.Shape(zone.polygon.map(([x, z]) => new THREE.Vector2(x, -z)))
      const geo = new THREE.ShapeGeometry(zShape, 16)
      geo.rotateX(-Math.PI / 2)
      geo.computeVertexNormals()
      geo.computeBoundsTree()
      const base = new THREE.Color(zone.color || ZONE_COLORS[zone.kind] || '#888')
      const isZone = zone.kind === 'paid' || zone.kind === 'unpaid'
      const mat = new THREE.MeshStandardMaterial({
        color: base,
        transparent: true,
        opacity: isZone ? 0.2 : 0.42,
        roughness: 0.85,
        metalness: 0.02,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
      const m = new THREE.Mesh(geo, mat)
      m.position.y = ZONE_Y + (zone.kind === 'paid' ? 0 : 0.002)
      m.userData.zoneId = zone.id
      m.name = `zone-${zone.id}`
      m.renderOrder = 1
      this.stationGroup.add(m)
      this.zoneMeshes.push(m)

      // 区块描边
      const outlinePts = zone.polygon.map(([x, z]) => new THREE.Vector3(x, ZONE_Y + 0.012, z))
      const lineGeo = new THREE.BufferGeometry().setFromPoints([...outlinePts, outlinePts[0]])
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: base, transparent: true, opacity: 0.95 }))
      line.renderOrder = 2
      this.stationGroup.add(line)
    }

    // 轮廓描边
    const outerPts = outer.map(([x, z]) => new THREE.Vector3(x, FLOOR_Y + 0.02, z))
    const outerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([...outerPts, outerPts[0]]),
      new THREE.LineBasicMaterial({ color: '#7dd3fc', transparent: true, opacity: 0.75 }),
    )
    outerLine.renderOrder = 3
    this.stationGroup.add(outerLine)

    // 网格
    this.buildGrid(b)

    this.buildObstacles()
    this.buildHeatMesh(b)
    this.applyOptions()
  }

  private buildGrid(b: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (this.gridHelper) {
      this.stationGroup.remove(this.gridHelper)
      disposeObject(this.gridHelper)
      this.gridHelper = null
    }
    const pts: number[] = []
    const step = 2
    const x0 = Math.floor(b.minX / step) * step
    const x1 = Math.ceil(b.maxX / step) * step
    const z0 = Math.floor(b.minY / step) * step
    const z1 = Math.ceil(b.maxY / step) * step
    for (let x = x0; x <= x1; x += step) pts.push(x, 0.045, z0, x, 0.045, z1)
    for (let z = z0; z <= z1; z += step) pts.push(x0, 0.045, z, x1, 0.045, z)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    const mat = new THREE.LineBasicMaterial({ color: '#3b4757', transparent: true, opacity: 0.42, depthWrite: false })
    const grid = new THREE.LineSegments(geo, mat)
    grid.renderOrder = 2
    grid.name = 'grid'
    grid.visible = this.opts.showGrid
    this.stationGroup.add(grid)
    this.gridHelper = grid
  }

  private buildObstacles() {
    const doc = this.doc
    if (!doc) return
    for (const o of doc.obstacles) {
      if (!o.enabled) continue
      const mesh = this.makeObstacleMesh(o)
      if (mesh) this.obstacleGroup.add(mesh)
    }
  }

  private makeObstacleMesh(o: Obstacle): THREE.Mesh | null {
    const [w, d] = o.size
    const h = Math.max(0.06, o.height)
    let geo: THREE.BufferGeometry
    let color = new THREE.Color(o.color ?? '#8b98a8')
    let opacity = 1
    if (o.kind === 'gate') {
      // 闸机: 底座 + 每通道两侧机箱
      const group = new THREE.Group()
      const baseGeo = new THREE.BoxGeometry(w, 0.16, d)
      baseGeo.computeBoundsTree()
      const baseMat = new THREE.MeshStandardMaterial({
        color: '#37404d',
        roughness: 0.75,
        metalness: 0.35,
      })
      const base = new THREE.Mesh(baseGeo, baseMat)
      base.position.set(0, 0.08, 0)
      base.userData = { obstacleId: o.id, isGateBase: true }
      group.add(base)
      const lanes = Math.max(1, Math.round(o.gateCount ?? 1))
      const laneW = w / lanes
      for (let i = 0; i <= lanes; i++) {
        const lx = -w / 2 + laneW * i
        const bw = 0.16
        const cab = new THREE.BoxGeometry(bw, Math.max(0.9, h), d * 0.9)
        cab.computeBoundsTree()
        const weight = o.gateWeights?.[Math.min(lanes - 1, Math.max(0, i - 1))] ?? o.weight
        const cabMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color().setHSL(0.58 - weight * 0.42, 0.62, 0.5),
          roughness: 0.38,
          metalness: 0.55,
        })
        const m = new THREE.Mesh(cab, cabMat)
        m.position.set(lx, Math.max(0.45, h / 2), 0)
        m.userData = { obstacleId: o.id }
        group.add(m)
        // 通道地板高亮
        if (i < lanes) {
          const laneGeo = new THREE.PlaneGeometry(laneW * 0.82, d * 1.4)
          laneGeo.rotateX(-Math.PI / 2)
          laneGeo.computeBoundsTree()
          const laneMat = new THREE.MeshBasicMaterial({
            color: new THREE.Color().setHSL(0.55 - weight * 0.5, 0.8, 0.6),
            transparent: true,
            opacity: 0.32,
            depthWrite: false,
          })
          const laneMesh = new THREE.Mesh(laneGeo, laneMat)
          laneMesh.position.set(lx + laneW * 0.5, 0.045, 0)
          laneMesh.userData = { obstacleId: o.id }
          laneMesh.renderOrder = 3
          group.add(laneMesh)
        }
      }
      group.position.set(o.center[0], 0, o.center[1])
      group.rotation.y = -o.rotation
      group.name = `obs-${o.id}`
      group.userData = { obstacleId: o.id }
      // 返回 group 作为可拾取对象, 类型放宽
      return group as unknown as THREE.Mesh
    }
    if (o.kind === 'column') {
      geo = new THREE.CylinderGeometry(w / 2, w / 2, h, 16)
      geo.translate(0, h / 2, 0)
      color = new THREE.Color('#c8cfda')
    } else if (o.kind === 'escalator') {
      geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(0, h / 2, 0)
      color = new THREE.Color('#6f7c8c')
    } else if (o.kind === 'shop') {
      geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(0, h / 2, 0)
      color = new THREE.Color('#5a636f')
    } else {
      geo = new THREE.BoxGeometry(w, h, d)
      geo.translate(0, h / 2, 0)
    }
    geo.computeBoundsTree()
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.62,
      metalness: 0.18,
      transparent: opacity < 1,
      opacity,
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.set(o.center[0], 0, o.center[1])
    mesh.rotation.y = -o.rotation
    mesh.name = `obs-${o.id}`
    mesh.userData = { obstacleId: o.id }
    return mesh
  }

  private buildHeatMesh(b: { minX: number; minY: number; maxX: number; maxY: number }) {
    if (this.heatMesh) {
      this.root.remove(this.heatMesh)
      this.heatMesh.geometry.dispose()
      ;(this.heatMesh.material as THREE.Material).dispose()
      this.heatMesh = null
    }
    if (this.heatTexture) {
      this.heatTexture.dispose()
      this.heatTexture = null
    }
    const S = this.heatSize
    const data = new Uint8Array(S * S * 4)
    for (let i = 0; i < S * S; i++) {
      data[i * 4 + 0] = 0
      data[i * 4 + 3] = 255
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType)
    tex.minFilter = THREE.LinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.wrapS = THREE.ClampToEdgeWrapping
    tex.wrapT = THREE.ClampToEdgeWrapping
    tex.generateMipmaps = false
    tex.needsUpdate = true
    this.heatTexture = tex

    const pad = 0.25
    this.heatBounds = {
      minX: b.minX - pad,
      minZ: b.minY - pad,
      w: b.maxX - b.minX + pad * 2,
      d: b.maxY - b.minY + pad * 2,
    }
    const geo = new THREE.BufferGeometry()
    const x0 = this.heatBounds.minX
    const z0 = this.heatBounds.minZ
    const x1 = x0 + this.heatBounds.w
    const z1 = z0 + this.heatBounds.d
    const pos = new Float32Array([x0, HEAT_Y, z0, x1, HEAT_Y, z0, x1, HEAT_Y, z1, x0, HEAT_Y, z1])
    const uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])
    const idx = new Uint16Array([0, 2, 1, 0, 3, 2])
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    geo.setIndex(new THREE.BufferAttribute(idx, 1))

    const band = (i: number) => new THREE.Vector3(...DENSITY_BANDS[i].color)
    void band
    const mat = new THREE.ShaderMaterial({
      vertexShader: heatVertexShader,
      fragmentShader: heatFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uDensity: { value: tex },
        uOpacity: { value: this.opts.heatOpacity },
        uMaxDensity: { value: 6 },
        uBand0: { value: new THREE.Vector3(...DENSITY_BANDS[0].color) },
        uBand1: { value: new THREE.Vector3(...DENSITY_BANDS[1].color) },
        uBand2: { value: new THREE.Vector3(...DENSITY_BANDS[2].color) },
        uBand3: { value: new THREE.Vector3(...DENSITY_BANDS[3].color) },
        uBand4: { value: new THREE.Vector3(...DENSITY_BANDS[4].color) },
        uOver: { value: new THREE.Vector3(...OVERLOAD_COLOR) },
        uThreshold: { value: 0.5 },
        uShowBands: { value: 1 },
      },
    })
    this.heatMaterial = mat
    const mesh = new THREE.Mesh(geo, mat)
    mesh.renderOrder = 5
    mesh.name = 'heat'
    mesh.visible = this.opts.showHeat
    this.heatMesh = mesh
    this.root.add(mesh)
  }

  /** 更新热力纹理: 输入 512x512 的 0..255 密度码 */
  setHeat(data: Uint8Array) {
    if (!this.heatTexture) return
    const S = this.heatSize
    const arr = this.heatTexture.image.data as Uint8Array
    for (let i = 0; i < S * S; i++) {
      arr[i * 4] = data[i]
    }
    this.heatTexture.needsUpdate = true
    if (this.heatMesh) this.heatMesh.visible = this.opts.showHeat && this.opts.showAgents !== undefined
  }

  setHeatOpacity(v: number) {
    this.opts.heatOpacity = v
    if (this.heatMaterial) this.heatMaterial.uniforms.uOpacity.value = v
  }

  setShowBands(v: boolean) {
    this.opts.showBands = v
    if (this.heatMaterial) this.heatMaterial.uniforms.uShowBands.value = v ? 1 : 0
  }

  // ---------- 行人实例 ----------
  private agentDummy = new THREE.Object3D()

  ensureAgents(capacity: number) {
    if (capacity <= this.agentCapacity && this.agentsMesh) return
    if (this.agentsMesh) {
      this.root.remove(this.agentsMesh)
      this.agentsMesh.geometry.dispose()
      ;(this.agentsMesh.material as THREE.Material).dispose()
      this.agentsMesh = null
    }
    const cap = Math.max(64, Math.ceil(capacity * 1.3))
    const geo = new THREE.CapsuleGeometry(0.19, 0.42, 3, 8)
    geo.translate(0, 0.5, 0)
    geo.computeBoundsTree()
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffd479',
      roughness: 0.55,
      metalness: 0.05,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, cap)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.renderOrder = 4
    mesh.name = 'agents'
    this.agentsMesh = mesh
    this.agentCapacity = cap
    this.root.add(mesh)
  }

  setAgents(a: AgentExport) {
    if (!this.opts.showAgents) {
      if (this.agentsMesh) this.agentsMesh.count = 0
      return
    }
    this.ensureAgents(a.count)
    const mesh = this.agentsMesh
    if (!mesh) return
    const dummy = this.agentDummy
    const count = Math.min(a.count, this.agentCapacity)
    const colors = mesh.instanceColor
    const c = new THREE.Color()
    for (let i = 0; i < count; i++) {
      const sp = 0.55 + (a.phase[i] % 1) * 0.45
      dummy.position.set(a.x[i], 0.02, a.z[i])
      dummy.rotation.set(0, -a.heading[i] + Math.PI / 2, 0)
      dummy.scale.set(1, 1 + Math.sin(a.phase[i] * Math.PI * 2) * 0.06, 1)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      // 按状态略作配色: 正常=暖黄, 排队=橙
      const t = 0.5 + 0.5 * Math.sin(a.phase[i] * Math.PI * 2)
      c.setHSL(0.11 - a.state[i] * 0.03, 0.72, 0.52 + t * 0.1)
      if (colors) {
        colors.setXYZ(i, c.r, c.g, c.b)
      }
      void sp
    }
    mesh.count = count
    mesh.instanceMatrix.needsUpdate = true
    if (colors) colors.needsUpdate = true
  }

  // ---------- 拾取 ----------
  private updatePointer(ev: { clientX: number; clientY: number }) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    const cam = this.activeCamera
    if (cam instanceof THREE.PerspectiveCamera) {
      this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    } else {
      this.pointer.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    }
    this.raycaster.setFromCamera(this.pointer, cam)
    return rect
  }

  /** 屏幕坐标 -> 地平面 (x, z) */
  groundPoint(ev: { clientX: number; clientY: number }): Vec2 | null {
    this.updatePointer(ev)
    const hit = new THREE.Vector3()
    const ok = this.raycaster.ray.intersectPlane(this.groundPlane, hit)
    if (!ok) return null
    return [hit.x, hit.z]
  }

  /** 拾取: 障碍物 (BVH 加速) -> 区块 -> 地面 */
  pick(ev: { clientX: number; clientY: number }): PickResult | null {
    this.updatePointer(ev)
    // 障碍物
    const pickables: THREE.Object3D[] = []
    this.obstacleGroup.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.userData.obstacleId) pickables.push(o)
    })
    if (this.opts.showObstacles && pickables.length) {
      const hits = this.raycaster.intersectObjects(pickables, false)
      if (hits.length) {
        const h = hits[0]
        const id = findObstacleId(h.object)
        if (id) {
          const p = this.groundPoint(ev)
          return { kind: 'obstacle', id, point: p ?? [h.point.x, h.point.z], height: h.point.y }
        }
      }
    }
    // 区块: 用地面点做多边形判定 (比三角面拾取更稳)
    const gp = this.groundPoint(ev)
    if (!gp || !this.doc) return null
    for (let i = this.doc.zones.length - 1; i >= 0; i--) {
      const z = this.doc.zones[i]
      if (z.polygon.length >= 3 && pointInPolygon(gp[0], gp[1], z.polygon)) {
        return { kind: 'zone', id: z.id, point: gp }
      }
    }
    return { kind: 'ground', point: gp }
  }

  // ---------- 辅助显示 ----------
  showSelection(obstacleId: string | null, zoneId: string | null) {
    if (this.selectionHelper) {
      this.root.remove(this.selectionHelper)
      this.selectionHelper.geometry.dispose()
      ;(this.selectionHelper.material as THREE.Material).dispose()
      this.selectionHelper = null
    }
    const doc = this.doc
    if (!doc) return
    let pts: THREE.Vector3[] | null = null
    if (obstacleId) {
      const o = doc.obstacles.find((x) => x.id === obstacleId)
      if (o) {
        const c = obstacleCorners(o)
        const y = Math.max(0.12, o.height + 0.1)
        pts = [...c.map(([x, z]) => new THREE.Vector3(x, y, z)), new THREE.Vector3(c[0][0], y, c[0][1])]
        const base = c.map(([x, z]) => new THREE.Vector3(x, 0.06, z))
        pts = [...pts, ...base, base[0]]
      }
    } else if (zoneId) {
      const z = doc.zones.find((x) => x.id === zoneId)
      if (z) {
        const p = z.polygon.map(([x, zz]) => new THREE.Vector3(x, 0.14, zz))
        pts = [...p, p[0]]
      }
    }
    if (!pts) return
    const geo = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({ color: '#67e8f9', depthTest: false, transparent: true })
    const line = new THREE.Line(geo, mat)
    line.renderOrder = 20
    this.selectionHelper = line
    this.root.add(line)
  }

  showDraft(points: Vec2[], cursor: Vec2 | null) {
    if (this.draftHelper) {
      this.root.remove(this.draftHelper)
      this.draftHelper.geometry.dispose()
      ;(this.draftHelper.material as THREE.Material).dispose()
      this.draftHelper = null
    }
    if (this.draftDots) {
      this.root.remove(this.draftDots)
      this.draftDots.geometry.dispose()
      ;(this.draftDots.material as THREE.Material).dispose()
      this.draftDots = null
    }
    const all = cursor ? [...points, cursor] : points
    if (all.length >= 2) {
      const p = all.map(([x, z]) => new THREE.Vector3(x, 0.2, z))
      if (all.length >= 3) p.push(p[0])
      const geo = new THREE.BufferGeometry().setFromPoints(p)
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#fbbf24', depthTest: false }))
      line.renderOrder = 21
      this.draftHelper = line
      this.root.add(line)
    }
    if (points.length) {
      const pos = new Float32Array(points.length * 3)
      points.forEach(([x, z], i) => {
        pos[i * 3] = x
        pos[i * 3 + 1] = 0.22
        pos[i * 3 + 2] = z
      })
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: '#fbbf24', size: 8, sizeAttenuation: false, depthTest: false }),
      )
      pts.renderOrder = 22
      this.draftDots = pts
      this.root.add(pts)
    }
  }

  showHover(points: Vec2[] | null) {
    if (this.hoverHelper) {
      this.root.remove(this.hoverHelper)
      this.hoverHelper.geometry.dispose()
      ;(this.hoverHelper.material as THREE.Material).dispose()
      this.hoverHelper = null
    }
    if (!points || points.length < 2) return
    const p = points.map(([x, z]) => new THREE.Vector3(x, 0.18, z))
    p.push(p[0])
    const geo = new THREE.BufferGeometry().setFromPoints(p)
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#94a3b8', transparent: true, opacity: 0.8 }))
    line.renderOrder = 19
    this.hoverHelper = line
    this.root.add(line)
  }

  applyOptions() {
    if (this.gridHelper) this.gridHelper.visible = this.opts.showGrid
    this.obstacleGroup.visible = this.opts.showObstacles
    this.stationGroup.visible = true
    if (this.heatMesh) this.heatMesh.visible = this.opts.showHeat
    if (this.agentsMesh) this.agentsMesh.visible = this.opts.showAgents
    for (const m of this.zoneMeshes) m.visible = this.opts.showZones
    if (this.heatMaterial) this.heatMaterial.uniforms.uOpacity.value = this.opts.heatOpacity
  }

  setOptions(patch: Partial<ViewOptions>) {
    Object.assign(this.opts, patch)
    if (this.heatMaterial) {
      this.heatMaterial.uniforms.uOpacity.value = this.opts.heatOpacity
      this.heatMaterial.uniforms.uShowBands.value = this.opts.showBands ? 1 : 0
    }
    this.applyOptions()
    if (patch.cameraMode) {
      this.setCameraMode(patch.cameraMode)
      this.controls.enabled = patch.cameraMode !== 'top'
    }
  }

  zoomTop(factor: number) {
    this.orthoSpan = Math.max(6, Math.min(200, this.orthoSpan * factor))
    this.resize()
  }

  panTop(dx: number, dz: number) {
    // 正交相机朝下看 (-Y), up 为 -Z: 屏幕 x 对应世界 x, 屏幕 y 对应世界 z
    this.orthoCamera.position.x += dx
    this.orthoCamera.position.z += dz
    const t = this.controls.target
    t.x += dx
    t.z += dz
    this.orthoCamera.lookAt(this.orthoCamera.position.x, 0, this.orthoCamera.position.z)
  }

  private clock = new THREE.Clock()

  private animate = () => {
    if (this.disposed) return
    this.animId = requestAnimationFrame(this.animate)
    const dt = this.clock.getDelta()
    if (this.opts.cameraMode === 'orbit') this.controls.update()
    this.renderer.render(this.scene, this.activeCamera)
    this.onFrame?.(dt)
  }

  /** 生成缩略图 (导出/分享用) */
  snapshotImage(width = 960): string {
    const prevSize = new THREE.Vector2()
    this.renderer.getSize(prevSize)
    this.renderer.setSize(width, Math.round((width * prevSize.y) / Math.max(1, prevSize.x)), false)
    this.renderer.render(this.scene, this.activeCamera)
    const url = this.renderer.domElement.toDataURL('image/png')
    this.renderer.setSize(prevSize.x, prevSize.y, false)
    return url
  }

  getHeatBounds() {
    return this.heatBounds
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.animId)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.disposeGroup(this.root)
    this.scene.clear()
    this.renderer.dispose()
    this.renderer.domElement.remove()
    this.heatTexture?.dispose()
  }
}

function findObstacleId(obj: THREE.Object3D): string | null {
  let o: THREE.Object3D | null = obj
  while (o) {
    if (typeof o.userData?.obstacleId === 'string') return o.userData.obstacleId
    o = o.parent
  }
  return null
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry) m.geometry.dispose()
    if (m.material) {
      const mats = Array.isArray(m.material) ? m.material : [m.material]
      for (const mat of mats) mat.dispose()
    }
  })
}

export { MeshBVH }
export type { Obstacle }
export const OBSTACLE_LABEL = OBSTACLE_LABELS
