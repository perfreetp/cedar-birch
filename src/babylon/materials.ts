import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import type { Scene } from '@babylonjs/core/scene'
import { INSUFFICIENT_COLOR, COLLISION_COLOR, COOP_COLOR } from '../domain/tiers'

export interface TransparentMaterialOptions {
  alpha: number
  wireframe?: boolean
  emissiveBoost?: number
}

/**
 * 透明体素材质：
 * - disableDepthWrite + 专用深度预处理网格 -> 多体交叠时按深度正确排序
 * - BACKWARDS 双面 -> 相机进入域体内部时内壁依然可见、不产生剔除错乱
 */
export function makeVolumeMaterial(scene: Scene, name: string, opts: TransparentMaterialOptions): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.specularColor = new Color3(0.05, 0.05, 0.05)
  mat.emissiveColor = new Color3(0.25, 0.25, 0.25).scale(opts.emissiveBoost ?? 1)
  mat.alpha = opts.alpha
  mat.backFaceCulling = false
  mat.wireframe = opts.wireframe ?? false
  mat.disableDepthWrite = true
  mat.alphaMode = 2 // ALPHA_COMBINE
  mat.separateCullingPass = true
  mat.zOffset = -2
  return mat
}

/** 与透明体配套的只写深度预处理材质，保证相机穿入域体内部时深度关系正确 */
export function makeDepthPrepassMaterial(scene: Scene, name: string): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.alpha = 1
  mat.disableColorWrite = true
  mat.specularColor = Color3.Black()
  mat.emissiveColor = Color3.Black()
  mat.backFaceCulling = false
  return mat
}

export function makeSolidMaterial(scene: Scene, name: string, color: Color3, emissive = 0.15): StandardMaterial {
  const mat = new StandardMaterial(name, scene)
  mat.diffuseColor = color
  mat.emissiveColor = color.scale(emissive)
  mat.specularColor = new Color3(0.3, 0.3, 0.3)
  return mat
}

export const COLORS = {
  insufficient: Color3.FromArray(INSUFFICIENT_COLOR),
  collision: Color3.FromArray(COLLISION_COLOR),
  coop: Color3.FromArray(COOP_COLOR),
  gantry: new Color3(0.95, 0.55, 0.12),
  portal: new Color3(0.35, 0.75, 0.95),
  segment: new Color3(0.72, 0.78, 0.88),
  removed: new Color3(0.3, 0.3, 0.34),
  select: new Color3(1.0, 0.92, 0.35)
}

export function clearColor(): Color4 {
  return new Color4(0.055, 0.07, 0.09, 1)
}
