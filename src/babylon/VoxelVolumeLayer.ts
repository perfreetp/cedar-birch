import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
// 副作用导入：给 Mesh 原型挂载 thinInstance* 方法
import '@babylonjs/core/Meshes/thinInstanceMesh'
import type { Scene } from '@babylonjs/core/scene'
import type { EvaluationResult } from '../domain/evaluation'
import { tierColor } from '../domain/tiers'
import { gantryReachable, portalReachable } from '../domain/geometry'
import type { Crane } from '../types'
import { makeDepthPrepassMaterial, makeVolumeMaterial } from './materials'

interface VoxelInstance {
  x: number
  y: number
  z: number
  sx: number
  sy: number
  sz: number
  color: Color3
}

const identityQuat = Quaternion.Identity()

/**
 * 体渲染层：
 * 每台吊车一个 thin-instance 立方体集合（颜色=该位置剩余起重量分档），
 * 另有协同层（紫色加深）、不足层（红色）、阻挡缺口层（琥珀线框）。
 * 全部走 disableDepthWrite 透明材质 + 深度预处理网格，
 * 保证多个半透明域体按深度排序、相机穿入内部不错乱。
 */
export class VoxelVolumeLayer {
  private root: Mesh
  private depthMesh: Mesh
  private craneMeshes = new Map<string, Mesh>()
  private overlayMesh: Mesh
  private blockedMesh: Mesh
  private voxel: number

  constructor(private scene: Scene, gridSize: number) {
    this.voxel = gridSize
    const template = MeshBuilder.CreateBox('voxel-template', { size: 1 }, scene)
    template.setEnabled(false)

    // 深度预处理：所有体素的合并深度网格
    this.depthMesh = MeshBuilder.CreateBox('depth-pre', { size: 1 }, scene)
    this.depthMesh.material = makeDepthPrepassMaterial(scene, 'depth-pre-mat')
    this.depthMesh.setEnabled(false) // 按需开启
    this.depthMesh.renderingGroupId = 0

    this.overlayMesh = this.createLayerMesh('overlay', 0.42, false)
    this.blockedMesh = this.createLayerMesh('blocked', 0.5, true)

    this.root = template
    this.root.name = 'voxel-root'
  }

  private createLayerMesh(name: string, alpha: number, wireframe: boolean): Mesh {
    const mesh = MeshBuilder.CreateBox(`voxel-${name}`, { size: 1 }, this.scene)
    mesh.material = makeVolumeMaterial(this.scene, `mat-${name}`, { alpha, wireframe })
    mesh.renderingGroupId = 1
    return mesh
  }

  /** 根据最新评估结果重建所有体素 */
  update(evaluation: EvaluationResult, cranes: Crane[], gridSize: number) {
    this.voxel = gridSize
    const { cells, perCrane, craneIds, insufficientCells, blockedCells } = evaluation

    // 1) 每台吊车的分档体素
    const depthInstances: { matrix: Matrix; color: Color3 }[] = []

    for (const crane of cranes) {
      if (!crane.enabled) continue
      const ci = craneIds.indexOf(crane.id)
      if (ci < 0) continue
      const list: VoxelInstance[] = []
      for (let idx = 0; idx < cells.length; idx++) {
        const cov = perCrane[ci][idx]
        if (!cov.reachable || cov.blocked) continue
        const cell = cells[idx]
        const [r, g, b] = tierColor(cov.capacity)
        let color = new Color3(r, g, b)
        // 交叠处加深：覆盖吊车越多颜色越深（最多压到 55%）
        if (cell.overlapCount > 1) {
          const darken = Math.max(0.55, 1 - 0.12 * (cell.overlapCount - 1))
          color = color.scale(darken)
        }
        const h = this.topHeight(crane, cell.cx, cell.cz)
        const voxel: VoxelInstance = {
          x: cell.cx,
          y: h / 2,
          z: cell.cz,
          sx: this.voxel * 0.96,
          sy: h,
          sz: this.voxel * 0.96,
          color
        }
        list.push(voxel)
        depthInstances.push({
          matrix: Matrix.Compose(
            new Vector3(voxel.sx, voxel.sy, voxel.sz),
            identityQuat,
            new Vector3(voxel.x, voxel.y, voxel.z)
          ),
          color
        })
      }
      this.applyInstances(this.getOrCreateCraneMesh(crane.id), list)
    }

    // 删除已移除吊车的网格
    for (const [id, mesh] of this.craneMeshes) {
      if (!craneIds.includes(id)) {
        mesh.dispose()
        this.craneMeshes.delete(id)
      }
    }

    // 2) 深度预处理网格（所有体素合一，仅写深度）
    this.rebuildDepthMesh(depthInstances)

    // 3) 协同 / 不足叠加层
    const overlay: VoxelInstance[] = []
    const insufficientSet = new Set(insufficientCells)
    for (let idx = 0; idx < cells.length; idx++) {
      const cell = cells[idx]
      if (insufficientSet.has(idx)) {
        // 红色缺口：取该处最高体素高度
        const h = this.maxHeightAt(cranes, cell.cx, cell.cz)
        overlay.push({
          x: cell.cx,
          y: h / 2,
          z: cell.cz,
          sx: this.voxel * 0.98,
          sy: h,
          sz: this.voxel * 0.98,
          color: Color3.FromArray([1.0, 0.09, 0.27])
        })
      } else if (cell.status === 'coop') {
        const h = this.maxHeightAt(cranes, cell.cx, cell.cz)
        overlay.push({
          x: cell.cx,
          y: h / 2 + 0.15,
          z: cell.cz,
          sx: this.voxel * 0.9,
          sy: h * 0.55,
          sz: this.voxel * 0.9,
          color: Color3.FromArray([0.7, 0.53, 1.0])
        })
      }
    }
    this.applyInstances(this.overlayMesh, overlay)

    // 4) 阻挡缺口线框
    const blocked: VoxelInstance[] = blockedCells.map((idx) => {
      const cell = cells[idx]
      return {
        x: cell.cx,
        y: 0.6,
        z: cell.cz,
        sx: this.voxel * 0.95,
        sy: 1.2,
        sz: this.voxel * 0.95,
        color: Color3.FromArray([1.0, 0.72, 0.0])
      }
    })
    this.applyInstances(this.blockedMesh, blocked)
  }

  setDepthPrepass(enabled: boolean) {
    this.depthMesh.setEnabled(enabled)
  }

  private getOrCreateCraneMesh(id: string): Mesh {
    let mesh = this.craneMeshes.get(id)
    if (!mesh) {
      mesh = MeshBuilder.CreateBox(`voxel-crane-${id}`, { size: 1 }, this.scene)
      mesh.material = makeVolumeMaterial(this.scene, `mat-crane-${id}`, { alpha: 0.3 })
      mesh.renderingGroupId = 1
      this.craneMeshes.set(id, mesh)
    }
    return mesh
  }

  private applyInstances(mesh: Mesh, instances: VoxelInstance[]) {
    if (instances.length === 0) {
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(0), 16, true)
      mesh.thinInstanceSetBuffer('color', new Float32Array(0), 4, true)
      mesh.thinInstanceCount = 0
      return
    }
    const matrices = new Float32Array(instances.length * 16)
    const colors = new Float32Array(instances.length * 4)
    const tmp = new Matrix()
    const scale = new Vector3()
    const pos = new Vector3()
    instances.forEach((v, i) => {
      scale.set(v.sx, v.sy, v.sz)
      pos.set(v.x, v.y, v.z)
      Matrix.ComposeToRef(scale, identityQuat, pos, tmp)
      tmp.copyToArray(matrices, i * 16)
      colors[i * 4] = v.color.r
      colors[i * 4 + 1] = v.color.g
      colors[i * 4 + 2] = v.color.b
      colors[i * 4 + 3] = 1
    })
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false)
    mesh.thinInstanceSetBuffer('color', colors, 4, false)
    mesh.thinInstanceCount = instances.length
  }

  private rebuildDepthMesh(instances: { matrix: Matrix; color: Color3 }[]) {
    if (instances.length === 0) {
      this.depthMesh.thinInstanceSetBuffer('matrix', new Float32Array(0), 16, true)
      this.depthMesh.thinInstanceCount = 0
      this.depthMesh.setEnabled(false)
      return
    }
    const matrices = new Float32Array(instances.length * 16)
    instances.forEach((v, i) => {
      v.matrix.copyToArray(matrices, i * 16)
    })
    this.depthMesh.thinInstanceSetBuffer('matrix', matrices, 16, false)
    this.depthMesh.thinInstanceCount = instances.length
    this.depthMesh.setEnabled(true)
  }

  private topHeight(crane: Crane, x: number, z: number): number {
    if (crane.kind === 'gantry') return crane.liftHeight
    // 门座吊：底座 + r*tan(angle)，反映臂架角度对域体形状的影响
    const r = Math.hypot(x - crane.x, z - crane.z)
    const pedestal = Math.max(2, Math.min(crane.liftHeight - 1, crane.liftHeight - crane.boomLength * Math.sin(crane.boomAngle)))
    return pedestal + r * Math.tan(crane.boomAngle)
  }

  private maxHeightAt(cranes: Crane[], x: number, z: number): number {
    let h = 1
    for (const crane of cranes) {
      if (!crane.enabled) continue
      const reachable =
        crane.kind === 'gantry' ? gantryReachable(crane, x, z) : portalReachable(crane, x, z)
      if (reachable) h = Math.max(h, this.topHeight(crane, x, z))
    }
    return h
  }

  dispose() {
    this.root.dispose()
    this.depthMesh.dispose()
    this.overlayMesh.dispose()
    this.blockedMesh.dispose()
    this.craneMeshes.forEach((m) => m.dispose())
    this.craneMeshes.clear()
  }
}
