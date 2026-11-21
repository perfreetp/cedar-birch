import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3
} from '@babylonjs/core'
import type { WingConfig } from '../types'
import { DEG, FULL_ANGLE, clamp } from '../deploy'
import { createPanelTexture } from './gridTexture'

/** 翼板配色（循环使用），深色底保证白色网格清晰 */
const PANEL_COLORS: Color3[] = [
  new Color3(0.16, 0.32, 0.56),
  new Color3(0.13, 0.47, 0.48),
  new Color3(0.55, 0.34, 0.15),
  new Color3(0.42, 0.24, 0.52),
  new Color3(0.55, 0.22, 0.28),
  new Color3(0.2, 0.4, 0.25)
]

/**
 * 铰链层级堆叠间距（米）：每节铰链沿 +Y 抬升的距离，
 * 对应真实铰链夹头高度，使折叠态各翼板分层堆叠。
 */
const HINGE_STACK = 0.05

interface HingeRig {
  pivot: TransformNode
}

/**
 * 太阳翼 Babylon 场景：
 * 负责装配体构建（基板-铰链-翼板的父子层级）、角度驱动与画面导出。
 */
export class WingScene {
  readonly engine: Engine
  readonly scene: Scene
  private readonly camera: ArcRotateCamera
  private readonly shadow: ShadowGenerator
  private root: TransformNode
  private rigs: HingeRig[] = []
  private groundLevel = 0
  /** 动态取景的平滑目标与上次更新时间 */
  private desiredRadius = 12
  private desiredTarget = new Vector3(0, 0.4, 0)
  private lastFrameAt = 0
  private cfg: WingConfig | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true
    }, true)
    this.scene = new Scene(this.engine)
    // 背景色（深空蓝灰）
    this.scene.clearColor = Color3.FromHexString('#1b2430').toColor4(1)

    // 相机：可环绕、缩放、平移观察展开全过程
    this.camera = new ArcRotateCamera(
      'cam',
      -Math.PI / 2.15,
      Math.PI / 3,
      12,
      new Vector3(0, 0.4, 0),
      this.scene
    )
    this.camera.attachControl(canvas, true)
    this.camera.wheelPrecision = 8
    this.camera.lowerRadiusLimit = 1.5
    this.camera.upperRadiusLimit = 60
    this.camera.panningSensibility = 60
    this.camera.minZ = 0.01
    this.camera.useAutoRotationBehavior = false

    // 灯光：环境光 + 带阴影的平行光
    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.3), this.scene)
    hemi.intensity = 0.55
    const dir = new DirectionalLight('dir', new Vector3(-0.5, -1, -0.35), this.scene)
    dir.position = new Vector3(10, 16, 8)
    dir.intensity = 1.05
    this.shadow = new ShadowGenerator(2048, dir)
    this.shadow.useExponentialShadowMap = true
    this.shadow.darkness = 0.32

    // 仅承接阴影的暗色地面（低反射 StandardMaterial）
    const ground = MeshBuilder.CreateGround('ground', { width: 60, height: 60 }, this.scene)
    const gmat = new StandardMaterial('groundMat', this.scene)
    gmat.diffuseColor = Color3.FromHexString('#202c3b')
    gmat.specularColor = Color3.Black()
    ground.material = gmat
    ground.receiveShadows = true
    ground.position.y = -0.002

    this.root = new TransformNode('root', this.scene)
  }

  /** 依据构型重建整个装配体，并在计算包围盒前施加当前铰链角度 */
  rebuild(cfg: WingConfig, angles: number[] = []): void {
    this.root.dispose(false, true)
    // 外层 root：仅负责把全展开包络的对称中心平移到原点，不参与旋转
    this.root = new TransformNode('root', this.scene)
    // 内层 assembly：承载基板-铰链-翼板的完整父子层级
    const assembly = new TransformNode('assembly', this.scene)
    assembly.parent = this.root
    this.rigs = []

    const baseMat = new StandardMaterial('baseMat', this.scene)
    baseMat.diffuseColor = new Color3(0.32, 0.34, 0.38)
    baseMat.specularColor = new Color3(0.08, 0.08, 0.08)

    // 基板（固定端），顶面落在 y=0
    const base = MeshBuilder.CreateBox(
      'base',
      { width: cfg.base.length, height: cfg.base.thickness, depth: cfg.base.width },
      this.scene
    )
    base.parent = assembly
    base.position = new Vector3(cfg.base.length / 2, -cfg.base.thickness / 2, 0)
    base.material = baseMat
    base.enableEdgesRendering()
    base.edgesWidth = 1.5
    base.edgesColor = Color3.FromHexString('#9fb2c8').toColor4(0.9)
    this.castShadow(base)

    let hingeX = cfg.base.length
    let parent: TransformNode = assembly

    cfg.panels.forEach((p, i) => {
      const h = cfg.hinges[i]
      void h
      // 铰链枢轴：位于上级构件末端，逐节抬升一个夹头高度
      const pivot = new TransformNode(`hinge-${i + 1}`, this.scene)
      pivot.parent = parent
      pivot.position = new Vector3(hingeX, HINGE_STACK, 0)
      this.buildHingeVisual(pivot, i, p.width)

      // 翼板：局部 +X 方向伸出，顶面与枢轴同高
      const panel = this.buildPanel(p, i, cfg.gridDensity)
      panel.parent = pivot
      panel.position = new Vector3(p.length / 2, 0, 0)

      this.rigs.push({ pivot })
      hingeX = p.length
      parent = pivot
    })

    // 全展开时整翼沿 +X 从 0 延伸到 totalLen，对称中心即 totalLen/2。
    // 该中心是铰链运动的不动点，故外层偏移对折叠/展开任意姿态都成立。
    const totalLen =
      cfg.base.length + cfg.panels.reduce((sum, p) => sum + p.length, 0)
    this.root.position.x = -totalLen / 2

    // 施加当前角度后，按真实姿态统计垂直包围盒，用于目标点与地面定位
    this.applyAngles(angles)
    this.scene.updateTransformMatrix(true)
    let minY = Infinity
    let maxY = -Infinity
    this.root.getChildMeshes().forEach((m) => {
      m.computeWorldMatrix(true)
      const b = m.getBoundingInfo().boundingBox
      minY = Math.min(minY, b.minimumWorld.y)
      maxY = Math.max(maxY, b.maximumWorld.y)
    })
    this.groundLevel = minY
    this.cfg = cfg
    this.frameCamera(totalLen, cfg, (minY + maxY) / 2, maxY - minY)
    // applyAngles → updateFraming 已按当前姿态算出 desiredRadius/desiredTarget，
    // 直接对齐，使首帧即正确取景，后续姿态变化再由 frameEase 平滑过渡。
    this.camera.radius = this.desiredRadius
    this.camera.target = this.desiredTarget.clone()
  }

  /** 铰链可视化：固定销轴 + 随枢轴转动的拨杆，便于观察转角 */
  private buildHingeVisual(pivot: TransformNode, index: number, panelWidth: number): void {
    const radius = clamp(panelWidth * 0.09, 0.05, 0.12)

    const pinMat = new StandardMaterial(`pinMat-${index}`, this.scene)
    pinMat.diffuseColor = new Color3(0.72, 0.75, 0.8)
    pinMat.specularColor = new Color3(0.4, 0.4, 0.4)

    const pin = MeshBuilder.CreateCylinder(
      `pin-${index}`,
      { height: panelWidth * 1.06, diameter: radius * 2 },
      this.scene
    )
    pin.parent = pivot
    pin.rotation.x = Math.PI / 2 // 圆柱默认沿 Y，旋转后沿铰链轴 Z
    pin.material = pinMat
    this.castShadow(pin)

    const leverMat = new StandardMaterial(`leverMat-${index}`, this.scene)
    leverMat.diffuseColor = Color3.FromHexString('#ff9800')
    leverMat.emissiveColor = Color3.FromHexString('#5a3500')

    const lever = MeshBuilder.CreateBox(
      `lever-${index}`,
      { width: radius * 1.4, height: HINGE_STACK * 1.1, depth: panelWidth * 0.45 },
      this.scene
    )
    lever.parent = pivot
    lever.position = new Vector3(0, HINGE_STACK / 2, 0)
    lever.material = leverMat
    this.castShadow(lever)
  }

  private buildPanel(
    p: { id: string; length: number; width: number; thickness: number },
    index: number,
    gridDensity: number
  ): Mesh {
    const label = `翼板${index + 1}`
    const mesh = MeshBuilder.CreateBox(
      p.id,
      { width: p.length, height: p.thickness, depth: p.width },
      this.scene
    )
    // Box 中心在厚度中点，使顶面与 y=0 齐平
    mesh.position.y = -p.thickness / 2

    const color = PANEL_COLORS[index % PANEL_COLORS.length]
    const mat = new StandardMaterial(`panelMat-${index}`, this.scene)
    const tex = createPanelTexture(label, p.length, p.width, gridDensity, color)
    mat.diffuseTexture = tex
    mat.diffuseColor = Color3.White()
    mat.specularColor = new Color3(0.12, 0.12, 0.12)
    mat.backFaceCulling = false // 翻转后背面仍需可见，保持板面法线表现正确
    // 逐层深度偏移，避免折叠态共面闪烁
    mat.zOffset = -(index + 1)
    mesh.material = mat
    mesh.enableEdgesRendering()
    mesh.edgesWidth = 1.2
    mesh.edgesColor = Color3.FromHexString('#dfe8f5').toColor4(0.6)
    this.castShadow(mesh)
    return mesh
  }

  private castShadow(mesh: Mesh): void {
    this.shadow.addShadowCaster(mesh, true)
  }

  /**
   * 根据全展开包络设定相机距离与目标点。
   * 全展开是整翼的最大水平跨度，以此取景可保证折叠→展开全过程都在画面内。
   * 主导约束是水平半长在俯视投影下的覆盖，再为右侧 400px 面板预留边距。
   */
  private frameCamera(
    totalLen: number,
    cfg: WingConfig,
    centerY: number,
    foldedHeight: number
  ): void {
    const maxWidth = Math.max(cfg.base.width, ...cfg.panels.map((p) => p.width))
    const beta = Math.PI / 3.0
    const sinBeta = Math.sin(beta)
    const cosBeta = Math.cos(beta)
    // 水平半长需要 radius*sin(beta) 覆盖；1.75 倍为透视收敛 + 侧栏 + 两端安全边距
    const byLength = (totalLen / 2 / Math.max(0.25, sinBeta)) * 1.75
    // 纵深方向需要 radius*cos(beta) 覆盖板宽的一半
    const byWidth = ((maxWidth / 2) / Math.max(0.25, cosBeta)) * 1.4
    const radius = clamp(Math.max(byLength, byWidth), 7, 72)
    this.camera.radius = radius
    this.camera.beta = beta
    // 目标点对齐装配体垂直中心并略上移，避免视觉下沉
    const targetY = clamp(centerY + foldedHeight * 0.25 + 0.2, 0.2, 5)
    this.camera.target = new Vector3(0, targetY, 0)
    this.camera.lowerRadiusLimit = Math.max(0.5, radius * 0.12)
    this.camera.upperRadiusLimit = radius * 5

    // 地面落在模型最低点下方
    const ground = this.scene.getMeshByName('ground')
    if (ground) ground.position.y = this.groundLevel - 0.02
  }

  /**
   * 按当前各铰链展开角驱动层级变换。
   * 枢轴局部转角 = 180° - 展开角，绕局部 Z 轴（铰链轴）旋转；
   * 子翼板与下级铰链经世界矩阵继承全部上级转角，板面法线随变换自然翻转。
   */
  applyAngles(angles: number[]): void {
    this.rigs.forEach((rig, i) => {
      const beta = clamp(angles[i] ?? 0, 0, FULL_ANGLE)
      rig.pivot.rotation.z = (FULL_ANGLE - beta) * DEG
    })
    this.updateFraming()
  }

  /**
   * 依据当前姿态的真实包围盒动态调整相机半径与目标点，
   * 使折叠（紧凑）与全展开（细长）等任意姿态都能舒适入画。
   * 仅修改 radius/target，保留用户的环绕方位角 alpha/beta，并做平滑插值。
   */
  private updateFraming(): void {
    if (!this.cfg || this.rigs.length === 0) return
    this.scene.updateTransformMatrix(true)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    this.root.getChildMeshes().forEach((m) => {
      m.computeWorldMatrix(true)
      const b = m.getBoundingInfo().boundingBox
      minX = Math.min(minX, b.minimumWorld.x)
      maxX = Math.max(maxX, b.maximumWorld.x)
      minY = Math.min(minY, b.minimumWorld.y)
      maxY = Math.max(maxY, b.maximumWorld.y)
      minZ = Math.min(minZ, b.minimumWorld.z)
      maxZ = Math.max(maxZ, b.maximumWorld.z)
    })
    if (!Number.isFinite(minX)) return

    const halfX = Math.max(0.2, (maxX - minX) / 2)
    const halfZ = Math.max(0.2, (maxZ - minZ) / 2)
    const centerY = (minY + maxY) / 2
    const beta = this.camera.beta
    const sinB = Math.max(0.25, Math.sin(beta))
    const cosB = Math.max(0.25, Math.cos(beta))
    // 按当前包围盒反推所需半径，1.5 倍预留透视与侧栏边距
    const needX = (halfX / sinB) * 1.5
    const needZ = (halfZ / cosB) * 1.4
    this.desiredRadius = clamp(Math.max(needX, needZ, 3), 3, 72)
    this.desiredTarget = new Vector3(0, clamp(centerY + 0.2, 0.1, 5), 0)
    // 动态水平居中：世界包围盒已包含 root 位移，将 root 平移当前中心的相反数即可。
    // 平移后下一帧包围盒中心即归零；收敛前每帧持续修正，折叠/展开任意姿态均居中。
    this.root.position.x -= (minX + maxX) / 2
    this.groundLevel = minY
    const ground = this.scene.getMeshByName('ground')
    if (ground) ground.position.y = minY - 0.02
  }

  /** 渲染循环中调用：以帧率无关的阻尼平滑趋近取景目标 */
  frameEase(nowMs: number): void {
    if (this.lastFrameAt === 0) this.lastFrameAt = nowMs
    const dt = Math.min(0.05, (nowMs - this.lastFrameAt) / 1000)
    this.lastFrameAt = nowMs
    const k = 1 - Math.exp(-dt * 6) // 平滑系数
    this.camera.radius += (this.desiredRadius - this.camera.radius) * k
    this.camera.target = Vector3.Lerp(
      this.camera.target,
      this.desiredTarget,
      k
    )
  }

  /** 导出当前 3D 姿态为 PNG Data URL */
  capture(): string {
    this.scene.render()
    return this.engine.getRenderingCanvas()?.toDataURL('image/png') ?? ''
  }

  get renderingCanvas(): HTMLCanvasElement | null {
    return this.engine.getRenderingCanvas()
  }

  dispose(): void {
    this.engine.stopRenderLoop()
    this.scene.dispose()
    this.engine.dispose()
  }
}
