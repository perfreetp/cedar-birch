import type { CapacityTier } from '../types'

/**
 * 剩余起重量五档：100t -> 10t
 * 边界按 (100-10)/5 = 18t 等差划分：82 / 64 / 46 / 28 / 10
 */
export const CAPACITY_TIERS: CapacityTier[] = [
  { minT: 82, color: [0.18, 0.89, 0.9], label: '≥82t (5/5)' },
  { minT: 64, color: [0.24, 0.86, 0.52], label: '64–82t (4/5)' },
  { minT: 46, color: [1.0, 0.82, 0.25], label: '46–64t (3/5)' },
  { minT: 28, color: [1.0, 0.62, 0.11], label: '28–46t (2/5)' },
  { minT: 10, color: [1.0, 0.36, 0.36], label: '10–28t (1/5)' }
]

/** 不满足起重量 / 缺口告警红 */
export const INSUFFICIENT_COLOR: [number, number, number] = [1.0, 0.09, 0.27]
/** 协同吊装交叠区紫 */
export const COOP_COLOR: [number, number, number] = [0.7, 0.53, 1.0]
/** 阻挡碰撞提示琥珀色 */
export const COLLISION_COLOR: [number, number, number] = [1.0, 0.72, 0.0]

export function tierColor(capacityT: number): [number, number, number] {
  for (const tier of CAPACITY_TIERS) {
    if (capacityT >= tier.minT) return tier.color
  }
  // 低于 10t 的几何可达区域：使用最低档但压暗
  return [0.55, 0.16, 0.16]
}

export function tierIndex(capacityT: number): number {
  for (let i = 0; i < CAPACITY_TIERS.length; i++) {
    if (capacityT >= CAPACITY_TIERS[i].minT) return i
  }
  return CAPACITY_TIERS.length - 1
}
