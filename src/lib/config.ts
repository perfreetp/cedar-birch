import type { WingConfig, PanelConfig, HingeConfig } from './types'

export const STORAGE_KEY = 'solar-wing-deploy:config:v1'

let seq = 0
/** 生成可读且不依赖随机数的唯一 id */
export function uid(prefix: string): string {
  seq += 1
  return `${prefix}-${Date.now().toString(36)}-${seq}`
}

export function makePanel(): PanelConfig {
  return {
    id: uid('panel'),
    length: 2.4,
    width: 1.6,
    thickness: 0.06
  }
}

export function makeHinge(index: number): HingeConfig {
  return {
    id: uid('hinge'),
    // 依次延后 1.2s 启动，速率 60°/s（3s 转完 180°）；round 消除浮点累加误差
    delay: Math.round(index * 1.2 * 1000) / 1000,
    rate: 60
  }
}

/** 出厂默认构型：基板 + 4 块翼板 + 4 节铰链 */
export function defaultConfig(): WingConfig {
  const panels = Array.from({ length: 4 }, () => makePanel())
  const hinges = Array.from({ length: 4 }, (_, i) => makeHinge(i))
  return {
    base: { length: 1.8, width: 1.6, thickness: 0.1 },
    panels,
    hinges,
    gridDensity: 4
  }
}

/** 深拷贝构型（同时用于“恢复默认”与导出） */
export function cloneConfig(cfg: WingConfig): WingConfig {
  return JSON.parse(JSON.stringify(cfg)) as WingConfig
}

/**
 * 增删翼板后对铰链列表做对齐，保持一一对应。
 * 新增的铰链追加在末尾并获得默认时序。
 */
export function reconcileHinges(cfg: WingConfig): WingConfig {
  const hinges = cfg.panels.map((_, i) => cfg.hinges[i] ?? makeHinge(i))
  return { ...cfg, hinges }
}
