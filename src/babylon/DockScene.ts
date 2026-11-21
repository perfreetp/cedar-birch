import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { Engine } from '@babylonjs/core/Engines/engine'
import { Scene } from '@babylonjs/core/scene'
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera'
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight'
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { PointerEventTypes } from '@babylonjs/core/Events/pointerEvents'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Crane, DockSegment } from '../types'
import { store } from '../state/store'
import { clearColor } from './materials'
import { VoxelVolumeLayer } from './VoxelVolumeLayer'
import { GantryView, PortalView, type PlacementView } from './CraneViews'
import { SegmentView } from './SegmentView'

export interface ScreenLabel {
  id: string
  text: string
  x: number
  y: number
  visible: boolean
  kind: 'crane' | 'segment' | 'warn'
}

type EngineT = WebGPUEngine | Engine

export class DockScene {
  private engine!: EngineT
  private scene!: Scene
  private camera!: ArcRotateCamera
  private volume!: VoxelVolumeLayer
  private ground!: AbstractMesh

  private craneViews = new Map<string, PlacementView>()
  private segmentViews = new Map<string, SegmentView>()
  private pickables: AbstractMesh[] = []

  private labels: ScreenLabel[] = []
  private labelListeners = new Set<(labels: ScreenLabel[]) => void>()
  private dragging: { kind: 'crane' | 'segment'; id: string; offsetX: number; offsetZ: number } | null = null
  private engineKind: 'webgpu' | 'webgl2' = 'webgl2'
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {}

  async init(): Promise<'webgpu' | 'webgl2'> {
    const webgpuSupported = await WebGPUEngine.IsSupportedAsync
    if (webgpuSupported) {
      try {
        const engine = new WebGPUEngine(this.canvas, {
          antialias: true,
          stencil: true,
          adaptToDeviceRatio: true
        })
        await engine.initAsync()
        this.engine = engine
        this.engineKind = 'webgpu'
      } catch {
        this.engine = new Engine(this.canvas, true, { stencil: true }, true)
        this.engineKind = 'webgl2'
      }
    } else {
      this.engine = new Engine(this.canvas, true, { stencil: true }, true)
      this.engineKind = 'webgl2'
    }

    this.scene = new Scene(this.engine)
    this.scene.clearColor = clearColor()
    this.scene.fogMode = Scene.FOGMODE_EXP2
    this.scene.fogColor = new Color3(0.055, 0.07, 0.09)
    this.scene.fogDensity = 0.006

    this.camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2.4,
      Math.PI / 3.2,
      95,
      new Vector3(0, 0, 0),
      this.scene
    )
    this.camera.attachControl(this.canvas, true)
    this.camera.lowerRadiusLimit = 8
    this.camera.upperRadiusLimit = 220
    this.camera.upperBetaLimit = Math.PI / 2.05
    this.camera.wheelDeltaPercentage = 0.01
    this.camera.minZ = 0.1
    this.camera.maxZ = 600
    // 拖拽实体时禁用相机平移
    this.camera.panningSensibility = 0

    const hemi = new HemisphericLight('hemi', new Vector3(0.3, 1, 0.2), this.scene)
    hemi.intensity = 0.85
    const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.4), this.scene)
    dir.intensity = 0.55

    this.buildDock()
    this.volume = new VoxelVolumeLayer(this.scene, store.gridSize)
    this.bindPointer()
    this.syncAll()

    this.engine.runRenderLoop(() => {
      if (this.disposed) return
      this.scene.render()
      this.updateLabels()
    })

    const onResize = () => this.engine.resize()
    window.addEventListener('resize', onResize)
    this.scene.onDisposeObservable.add(() => window.removeEventListener('resize', onResize))

    return this.engineKind
  }

  getScene(): Scene {
    return this.scene
  }

  getEngineKind(): 'webgpu' | 'webgl2' {
    return this.engineKind
  }

  /** 测试/调试：把相机移动到指定观察点 */
  debugSetCamera(radius: number, alpha: number, beta: number, tx: number, ty: number, tz: number) {
    this.camera.detachControl()
    this.camera.lowerRadiusLimit = Math.min(0.5, radius * 0.5)
    // 先设目标点（会触发 rebuildAnglesAndRadius 反算半径），再覆盖角度/半径
    this.camera.setTarget(new Vector3(tx, ty, tz))
    this.camera.alpha = alpha
    this.camera.beta = beta
    this.camera.radius = radius
    this.camera.inertialRadiusOffset = 0
    this.camera.getViewMatrix(true)
  }

  /** 测试/调试：恢复用户相机控制 */
  debugRestoreCamera() {
    this.camera.lowerRadiusLimit = 8
    this.camera.attachControl(this.canvas, true)
  }

  onLabels(fn: (labels: ScreenLabel[]) => void): () => void {
    this.labelListeners.add(fn)
    return () => this.labelListeners.delete(fn)
  }

  /* ---------------- 场景搭建 ---------------- */

  private buildDock() {
    const { dockWidth: w, dockLength: l } = store
    const groundMat = new StandardMaterial('dock-ground', this.scene)
    groundMat.diffuseColor = new Color3(0.11, 0.13, 0.16)
    groundMat.specularColor = new Color3(0.04, 0.04, 0.04)
    this.ground = MeshBuilder.CreateGround('dock', { width: w, height: l, subdivisions: 1 }, this.scene)
    this.ground.material = groundMat
    this.ground.metadata = { type: 'ground' }

    // 网格线（每 5 米一条）
    const grid = MeshBuilder.CreateGround(
      'dock-grid',
      { width: w, height: l, subdivisions: Math.max(w, l) / 5 },
      this.scene
    )
    grid.position.y = 0.02
    const gridMat = new StandardMaterial('grid-mat', this.scene)
    gridMat.wireframe = true
    gridMat.emissiveColor = new Color3(0.22, 0.28, 0.34)
    gridMat.disableLighting = true
    gridMat.alpha = 0.5
    grid.material = gridMat

    // 坞区边界框
    const border = MeshBuilder.CreateBox(
      'dock-border',
      { width: w, height: 0.25, depth: l },
      this.scene
    )
    const borderMat = new StandardMaterial('border-mat', this.scene)
    borderMat.emissiveColor = new Color3(0.35, 0.55, 0.7)
    borderMat.diffuseColor = new Color3(0.1, 0.15, 0.2)
    borderMat.alpha = 0.35
    borderMat.alphaMode = 2
    border.material = borderMat
    border.position.y = -0.12
  }

  /* ---------------- 状态同步 ---------------- */

  /** 全量重建/同步，store.refresh 后调用 */
  syncAll() {
    this.syncCranes(store.cranes)
    this.syncSegments(store.segments)
    if (this.volume && store.lastEvaluation) {
      this.volume.update(store.lastEvaluation, store.cranes, store.gridSize)
    }
    this.rebuildPickables()
    this.refreshSelection()
    this.publishDebug()
  }

  /** 调试/自动化冒烟测试钩子 */
  private publishDebug() {
    const w = window as unknown as Record<string, unknown>
    w.__dockDebug = {
      engine: this.engineKind,
      evalVersion: store.evalVersion,
      cranes: store.cranes.length,
      segments: store.segments.length,
      meshes: this.scene.meshes.length,
      cells: store.lastEvaluation?.cells.length ?? 0,
      insufficient: store.lastEvaluation?.insufficientCells.length ?? 0,
      blocked: store.lastEvaluation?.blockedCells.length ?? 0,
      coop: store.lastEvaluation?.cells.filter((c) => c.status === 'coop').length ?? 0,
      collisions: store.collisions.length,
      reports: store.segmentReports.map((r) => ({
        id: r.segmentId,
        feasible: r.feasible,
        coop: r.coopCapable
      }))
    }
  }

  private syncCranes(cranes: Crane[]) {
    const seen = new Set<string>()
    for (const crane of cranes) {
      seen.add(crane.id)
      let view = this.craneViews.get(crane.id)
      if (!view) {
        view =
          crane.kind === 'gantry'
            ? new GantryView(crane.id, crane, this.scene)
            : new PortalView(crane.id, crane, this.scene)
        view.root.metadata = { type: 'crane', id: crane.id }
        this.craneViews.set(crane.id, view)
      } else if (crane.kind === 'gantry') {
        ;(view as GantryView).update(crane, this.scene)
      } else {
        ;(view as PortalView).update(crane, this.scene)
      }
      view.root.setEnabled(crane.enabled)
    }
    for (const [id, view] of this.craneViews) {
      if (!seen.has(id)) {
        view.dispose()
        this.craneViews.delete(id)
      }
    }
  }

  private syncSegments(segments: DockSegment[]) {
    const seen = new Set<string>()
    for (const seg of segments) {
      seen.add(seg.id)
      let view = this.segmentViews.get(seg.id)
      if (!view) {
        view = new SegmentView(seg.id, seg, this.scene)
        view.root.metadata = { type: 'segment', id: seg.id }
        this.segmentViews.set(seg.id, view)
      } else {
        view.update(seg)
      }
    }
    for (const [id, view] of this.segmentViews) {
      if (!seen.has(id)) {
        view.dispose()
        this.segmentViews.delete(id)
      }
    }
  }

  private rebuildPickables() {
    this.pickMeshes = []
    this.pickables = [this.ground]
    for (const view of this.craneViews.values()) {
      if (!view.root.isEnabled()) continue
      for (const m of view.pickMeshes) {
        m.metadata = view.root.metadata
        this.pickables.push(m)
      }
    }
    for (const view of this.segmentViews.values()) {
      if (!view.root.isEnabled()) continue
      for (const m of view.pickMeshes) {
        m.metadata = view.root.metadata
        this.pickables.push(m)
      }
    }
  }

  private refreshSelection() {
    for (const [id, view] of this.craneViews) {
      view.setSelected(id === store.selectedCraneId)
    }
    for (const [id, view] of this.segmentViews) {
      view.setSelected(id === store.selectedSegmentId)
    }
  }

  /* ---------------- 拾取与拖拽 ---------------- */

  private pickMeshes: AbstractMesh[] = []

  private bindPointer() {
    this.scene.onPointerObservable.add((info) => {
      if (info.type === PointerEventTypes.POINTERDOWN) {
        const picked = this.scene.pick(this.scene.pointerX, this.scene.pointerY, (m) =>
          this.pickables.includes(m)
        )
        if (!picked?.hit || !picked.pickedMesh?.metadata) return
        const meta = picked.pickedMesh.metadata as { type: string; id: string }
        if (meta.type === 'crane') {
          store.selectCrane(meta.id)
          this.refreshSelection()
          const crane = store.cranes.find((c) => c.id === meta.id)
          if (crane) {
            const p = this.groundPoint()
            this.dragging = {
              kind: 'crane',
              id: meta.id,
              offsetX: crane.x - p.x,
              offsetZ: crane.z - p.z
            }
          }
        } else if (meta.type === 'segment') {
          store.selectSegment(meta.id)
          this.refreshSelection()
          const seg = store.segments.find((s) => s.id === meta.id)
          if (seg && !seg.removed) {
            const p = this.groundPoint()
            this.dragging = {
              kind: 'segment',
              id: meta.id,
              offsetX: seg.x - p.x,
              offsetZ: seg.z - p.z
            }
          }
        } else if (meta.type === 'ground') {
          store.selectCrane(null)
          store.selectSegment(null)
          this.refreshSelection()
        }
      } else if (info.type === PointerEventTypes.POINTERMOVE && this.dragging) {
        const p = this.groundPoint()
        const nx = this.clampToDock(p.x + this.dragging.offsetX, true)
        const nz = this.clampToDock(p.z + this.dragging.offsetZ, false)
        if (this.dragging.kind === 'crane') {
          store.updateCrane(this.dragging.id, { x: nx, z: nz })
        } else {
          store.updateSegment(this.dragging.id, { x: nx, z: nz })
        }
      } else if (info.type === PointerEventTypes.POINTERUP) {
        this.dragging = null
      }
    })
  }

  private clampToDock(v: number, isX: boolean): number {
    const half = (isX ? store.dockWidth : store.dockLength) / 2 - 1
    return Math.max(-half, Math.min(half, v))
  }

  private groundPoint(): Vector3 {
    const ray = this.scene.createPickingRay(
      this.scene.pointerX,
      this.scene.pointerY,
      null,
      this.camera
    )
    const hit = ray.intersectsMesh(this.ground as AbstractMesh)
    if (hit.hit && hit.pickedPoint) return hit.pickedPoint
    // 兜底：射线与 y=0 平面求交
    const t = -ray.origin.y / ray.direction.y
    return ray.origin.add(ray.direction.scale(t))
  }

  /* ---------------- HTML 投影标签 ---------------- */

  private updateLabels() {
    const next: ScreenLabel[] = []
    const project = (pos: Vector3): { x: number; y: number; visible: boolean } => {
      const screen = Vector3.Project(
        pos,
        Matrix.Identity(),
        this.scene.getTransformMatrix(),
        this.camera.viewport.toGlobal(this.engine.getRenderWidth(), this.engine.getRenderHeight())
      )
      const visible = screen.z >= 0 && screen.z <= 1
      return { x: screen.x, y: screen.y, visible }
    }

    for (const crane of store.cranes) {
      const view = this.craneViews.get(crane.id)
      if (!view || !crane.enabled) continue
      const pos = view.root.position.add(new Vector3(0, crane.liftHeight + 3, 0))
      const pr = project(pos)
      next.push({ id: crane.id, text: crane.name, x: pr.x, y: pr.y, visible: pr.visible, kind: 'crane' })
    }
    for (const seg of store.segments) {
      const view = this.segmentViews.get(seg.id)
      if (!view) continue
      const pos = view.position.add(new Vector3(0, seg.height + 2, 0))
      const pr = project(pos)
      const report = store.segmentReports.find((r) => r.segmentId === seg.id)
      const suffix = seg.removed ? ' [已吊走]' : report && !report.feasible ? ' ⚠' : ''
      next.push({
        id: seg.id,
        text: `${seg.name}${suffix}`,
        x: pr.x,
        y: pr.y,
        visible: pr.visible,
        kind: seg.removed ? 'segment' : report && !report.feasible ? 'warn' : 'segment'
      })
    }

    // 浅比较，避免无意义刷新
    const changed =
      next.length !== this.labels.length ||
      next.some((l, i) => {
        const old = this.labels[i]
        return !old || old.id !== l.id || Math.abs(old.x - l.x) > 0.5 || Math.abs(old.y - l.y) > 0.5 || old.visible !== l.visible || old.text !== l.text
      })
    if (changed) {
      this.labels = next
      this.labelListeners.forEach((fn) => fn(next))
    }
  }

  dispose() {
    this.disposed = true
    this.scene?.dispose()
    this.engine?.dispose()
  }
}
