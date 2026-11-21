import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { GantryCrane, PortalCrane } from '../types'
import { portalMaxRadius, portalPedestal } from '../domain/geometry'
import { COLORS, makeSolidMaterial } from './materials'

/** 可拖拽实体统一接口：根节点 position 即坞区平面 x/z */
export interface PlacementView {
  id: string
  root: AbstractMesh
  pickMeshes: AbstractMesh[]
  setSelected(selected: boolean): void
  dispose(): void
}

function mat(scene: Scene, name: string, color: Color3): StandardMaterial {
  return makeSolidMaterial(scene, name, color, 0.18)
}

function box(
  scene: Scene,
  name: string,
  w: number,
  h: number,
  d: number,
  material: StandardMaterial,
  parent: AbstractMesh
): Mesh {
  const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene)
  m.material = material
  m.parent = parent
  return m
}

/* ---------------- 龙门吊 ---------------- */

export class GantryView implements PlacementView {
  readonly pickMeshes: AbstractMesh[] = []
  private readonly frameMat: StandardMaterial
  private readonly legMat: StandardMaterial

  constructor(readonly id: string, private crane: GantryCrane, scene: Scene) {
    this.root = new Mesh(`gantry-${id}`, scene)
    this.frameMat = mat(scene, `gantry-frame-${id}`, COLORS.gantry)
    this.legMat = mat(scene, `gantry-leg-${id}`, COLORS.gantry.scale(0.7))
    this.rebuild(scene)
    this.root.position = new Vector3(crane.x, 0, crane.z)
    this.root.rotation.y = crane.railAngle
  }

  readonly root: AbstractMesh

  private rebuild(scene: Scene) {
    // 清掉旧子节点
    this.root.getChildMeshes().forEach((m) => m.dispose())
    this.pickMeshes.length = 0
    const c = this.crane
    const L = c.railLength
    const W = c.span
    const H = c.liftHeight
    const leg = 0.9

    // 四根支腿（沿轨道 u 两端 × 跨距 v 两端）
    for (const u of [-L / 2, L / 2]) {
      for (const v of [-W / 2, W / 2]) {
        const legMesh = box(scene, 'leg', leg, H, leg, this.legMat, this.root)
        legMesh.position = new Vector3(u, H / 2, v)
        this.pickMeshes.push(legMesh)
      }
    }
    // 顶部主梁（沿轨道方向，两侧各一根）
    for (const v of [-W / 2, W / 2]) {
      const beam = box(scene, 'main-beam', L + 1.2, 1.1, 1.1, this.frameMat, this.root)
      beam.position = new Vector3(0, H + 0.5, v)
      this.pickMeshes.push(beam)
    }
    // 跨距端梁
    for (const u of [-L / 2, L / 2]) {
      const cross = box(scene, 'cross-beam', 1.1, 1.1, W + 1.2, this.frameMat, this.root)
      cross.position = new Vector3(u, H + 0.5, 0)
    }
    // 吊钩小车（位于主梁中点，可视化）
    const trolley = box(scene, 'trolley', 2, 1, 2, this.frameMat, this.root)
    trolley.position = new Vector3(0, H - 0.8, 0)
    const hook = box(scene, 'hook', 0.5, H * 0.45, 0.5, this.legMat, this.root)
    hook.position = new Vector3(0, H * 0.65, 0)
    // 地面轨道
    for (const v of [-W / 2, W / 2]) {
      const rail = box(scene, 'rail', L + 2, 0.18, 0.35, this.legMat, this.root)
      rail.position = new Vector3(0, 0.09, v)
      this.pickMeshes.push(rail)
    }
  }

  update(crane: GantryCrane, scene: Scene) {
    const shapeChanged =
      crane.railLength !== this.crane.railLength ||
      crane.span !== this.crane.span ||
      crane.liftHeight !== this.crane.liftHeight
    this.crane = crane
    if (shapeChanged) this.rebuild(scene)
    this.root.position = new Vector3(crane.x, 0, crane.z)
    this.root.rotation.y = crane.railAngle
  }

  setSelected(selected: boolean) {
    const tint = selected ? COLORS.select : COLORS.gantry
    this.frameMat.emissiveColor = tint.scale(selected ? 0.45 : 0.18)
    this.frameMat.diffuseColor = tint
  }

  dispose() {
    this.root.dispose(false, true)
  }
}

/* ---------------- 门座吊 ---------------- */

export class PortalView implements PlacementView {
  readonly pickMeshes: AbstractMesh[] = []
  private readonly metalMat: StandardMaterial
  private readonly boomMat: StandardMaterial

  constructor(readonly id: string, private crane: PortalCrane, scene: Scene) {
    this.root = new Mesh(`portal-${id}`, scene)
    this.metalMat = mat(scene, `portal-metal-${id}`, COLORS.portal)
    this.boomMat = mat(scene, `portal-boom-${id}`, COLORS.portal.scale(1.15))
    this.rebuild(scene)
    this.root.position = new Vector3(crane.x, 0, crane.z)
  }

  readonly root: AbstractMesh

  private rebuild(scene: Scene) {
    this.root.getChildMeshes().forEach((m) => m.dispose())
    this.pickMeshes.length = 0
    const c = this.crane
    const pedestal = portalPedestal(c)

    const base = MeshBuilder.CreateCylinder('base', { height: pedestal, diameter: 3.2 }, scene)
    base.material = this.metalMat
    base.parent = this.root
    base.position = new Vector3(0, pedestal / 2, 0)
    this.pickMeshes.push(base)

    const cabin = box(scene, 'cabin', 3, 2.2, 3, this.metalMat, this.root)
    cabin.position = new Vector3(0, pedestal + 1.1, 0)
    this.pickMeshes.push(cabin)

    // 臂架：沿本地 +X 方向按俯角伸出，slew 由整体旋转表达
    const boom = MeshBuilder.CreateCylinder(
      'boom',
      { height: c.boomLength, diameter: 0.9 },
      scene
    )
    boom.material = this.boomMat
    boom.parent = this.root
    // 圆柱默认沿 Y，旋转 -90°+俯角后指向斜下方
    const midR = c.boomLength / 2
    boom.rotation.z = -Math.PI / 2 + c.boomAngle
    boom.position = new Vector3(midR * Math.cos(c.boomAngle), pedestal + midR * Math.sin(c.boomAngle), 0)
    this.pickMeshes.push(boom)

    // 臂尖吊钩
    const tipX = c.boomLength * Math.cos(c.boomAngle)
    const tipY = pedestal + c.boomLength * Math.sin(c.boomAngle)
    const hook = box(scene, 'p-hook', 0.5, Math.max(1, tipY - 1), 0.5, this.metalMat, this.root)
    hook.position = new Vector3(tipX, (tipY - 1) / 2 + 0.5, 0)

    // 地面可达半径参考环（最大/最小半径）
    const rMax = portalMaxRadius(c)
    const ring = MeshBuilder.CreateTorus(
      'radius-ring',
      { diameter: rMax * 2, thickness: 0.25, tessellation: 64 },
      scene
    )
    ring.material = this.metalMat
    ring.parent = this.root
    ring.position = new Vector3(0, 0.12, 0)

    const minRing = MeshBuilder.CreateTorus(
      'min-ring',
      { diameter: c.minRadius * 2, thickness: 0.18, tessellation: 48 },
      scene
    )
    minRing.material = this.metalMat
    minRing.parent = this.root
    minRing.position = new Vector3(0, 0.1, 0)

    // 回转扇区边界线（两根细柱表示 slewStart / 边界）
    for (const a of [c.slewStart, c.slewStart + c.slewRange]) {
      const marker = box(scene, 'slew-marker', rMax, 0.12, 0.12, this.metalMat, this.root)
      marker.position = new Vector3(Math.cos(a) * rMax * 0.5, 0.15, Math.sin(a) * rMax * 0.5)
      marker.rotation.y = -a
    }
  }

  update(crane: PortalCrane, scene: Scene) {
    const shapeChanged =
      crane.boomLength !== this.crane.boomLength ||
      crane.boomAngle !== this.crane.boomAngle ||
      crane.minRadius !== this.crane.minRadius ||
      crane.liftHeight !== this.crane.liftHeight
    this.crane = crane
    if (shapeChanged) this.rebuild(scene)
    this.root.position = new Vector3(crane.x, 0, crane.z)
    // 臂架本地 +X 对应世界 slewStart 方向
    this.root.rotation.y = -crane.slewStart
  }

  setSelected(selected: boolean) {
    const tint = selected ? COLORS.select : COLORS.portal
    this.metalMat.emissiveColor = tint.scale(selected ? 0.45 : 0.18)
    this.metalMat.diffuseColor = tint
    this.boomMat.emissiveColor = tint.scale(selected ? 0.5 : 0.2)
    this.boomMat.diffuseColor = tint
  }

  dispose() {
    this.root.dispose(false, true)
  }
}
