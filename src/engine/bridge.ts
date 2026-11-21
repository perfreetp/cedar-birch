import type { ParticleSystem } from './ParticleSystem'

/** 让 React 面板(第 4 页导出等)能拿到常驻的引擎实例 */
let engine: ParticleSystem | null = null

export function registerEngine(e: ParticleSystem | null): void {
  engine = e
}

export function getEngine(): ParticleSystem | null {
  return engine
}
