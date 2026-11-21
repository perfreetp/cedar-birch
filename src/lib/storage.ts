import type { WingConfig } from './types'
import { STORAGE_KEY, defaultConfig } from './config'

/** 从 localStorage 读取构型；损坏或缺失时回落到默认构型 */
export function loadConfig(): WingConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultConfig()
    const parsed = JSON.parse(raw) as WingConfig
    if (!parsed || !Array.isArray(parsed.panels) || !Array.isArray(parsed.hinges)) {
      return defaultConfig()
    }
    return parsed
  } catch {
    return defaultConfig()
  }
}

/** 保存构型到浏览器本地存储 */
export function saveConfig(cfg: WingConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch (err) {
    // 隐私模式或配额超限时给出明确提示，不影响仿真
    console.warn('构型本地保存失败：', err)
  }
}

export function clearConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}
