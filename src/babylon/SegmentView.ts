import { Color3 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Scene } from '@babylonjs/core/scene'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { DockSegment } from '../types'
import { COLORS, makeSolidMaterial } from './materials'
import type { PlacementView } from './CraneViews'

export class SegmentView implements PlacementView {
  readonly pickMeshes: AbstractMesh[] = []
  private bodyMat: StandardMaterial
  readonly root: Mesh
  private body: Mesh

  constructor(readonly id: string, private seg: DockSegment, scene: Scene) {
    this.root = new Mesh(`segment-${id}`, scene)
    this.bodyMat = makeSolidMaterial(scene, `seg-mat-${id}`, COLORS.segment, 0.12)
    this.body = MeshBuilder.CreateBox(
      `seg-body-${id}`,
      { width: seg.length, height: seg.height, depth: seg.width },
      scene
    )
    this.body.material = this.bodyMat
    this.body.parent = this.root
    this.pickMeshes.push(this.body)
    this.sync()
  }

  private sync() {
    this.root.position = new Vector3(this.seg.x, this.seg.height / 2, this.seg.z)
    this.root.rotation.y = this.seg.rotationY
    const removed = this.seg.removed
    this.bodyMat.alpha = removed ? 0.22 : 1
    const tint = removed ? COLORS.removed : COLORS.segment
    this.bodyMat.diffuseColor = tint
    this.bodyMat.emissiveColor = tint.scale(removed ? 0.05 : 0.12)
  }

  update(seg: DockSegment) {
    this.seg = seg
    this.sync()
  }

  setSelected(selected: boolean) {
    this.bodyMat.emissiveColor = (selected ? COLORS.select : COLORS.segment).scale(
      selected ? 0.5 : 0.12
    )
    if (selected) this.bodyMat.diffuseColor = COLORS.select
    else if (!this.seg.removed) this.bodyMat.diffuseColor = COLORS.segment
  }

  get position(): Vector3 {
    return this.root.position
  }

  dispose() {
    this.root.dispose(false, true)
  }
}
