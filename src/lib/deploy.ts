import type { AngleState, CurveSample, HingeConfig, WingConfig } from './types'

export const DEG = Math.PI / 180
export const FULL_ANGLE = 180
/** 角度滑杆的 5 档步进：0 / 45 / 90 / 135 / 180 */
export const SLIDER_STEPS = [0, 45, 90, 135, 180]
export const SLIDER_STEP = 45

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const clamp180 = (v: number) => Math.min(FULL_ANGLE, Math.max(0, v))

/**
 * 单节铰链在时刻 t 的展开角度（度）。
 * β(t) = clamp((t - delay) * rate, 0, 180)
 * t < delay 时保持折叠，转满 180° 后保持全展开。
 */
export function hingeAngleAt(h: HingeConfig, t: number): number {
  if (t <= h.delay) return 0
  return clamp180((t - h.delay) * h.rate)
}

/** 整翼在时刻 t 的角度状态（各铰链展开角，单位度） */
export function anglesAt(cfg: WingConfig, t: number): AngleState {
  return cfg.hinges.map((h) => hingeAngleAt(h, t))
}

/**
 * 全翼展开完成所需总时长（秒）：
 * 最后一节铰链的启动延迟 + 其转动 180° 所需时间。
 */
export function deployDuration(cfg: WingConfig): number {
  if (cfg.hinges.length === 0) return 0
  return Math.max(...cfg.hinges.map((h) => h.delay + FULL_ANGLE / Math.max(h.rate, 1e-6)))
}

/** 全翼是否已在时刻 t 完全展开 */
export function isFullyDeployed(cfg: WingConfig, t: number): boolean {
  return t >= deployDuration(cfg)
}

/**
 * 对完整展开过程做等时间步采样，供角度曲线绘制与导出。
 * 末点强制为完整时长，保证曲线精确终止于 180°。
 */
export function sampleCurve(cfg: WingConfig, stepSeconds = 0.05): CurveSample[] {
  const total = deployDuration(cfg)
  if (total <= 0) return [{ t: 0, angles: [] }]
  const steps = Math.max(1, Math.ceil(total / stepSeconds))
  const out: CurveSample[] = []
  for (let i = 0; i <= steps; i++) {
    const t = Math.min(total, i * stepSeconds)
    out.push({ t, angles: anglesAt(cfg, t) })
  }
  // 消除浮点误差造成的重复末点
  const last = out[out.length - 1]
  if (last.t !== total) out.push({ t: total, angles: anglesAt(cfg, total) })
  return out
}

/**
 * 铰链局部转角（弧度）。
 * 展开角 β=0（折叠）时局部旋转 180°，β=180（展平）时旋转 0°，
 * 即书页式绕铰链轴（局部 Z 轴）翻转。
 */
export function hingeLocalRotationRad(deployAngleDeg: number): number {
  return (FULL_ANGLE - clamp180(deployAngleDeg)) * DEG
}

/** 滑杆值吸附到最近的 45° 档位 */
export function snapSlider(v: number): number {
  return clamp180(Math.round(v / SLIDER_STEP) * SLIDER_STEP)
}

/** 数值工具：限制范围 */
export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 限制 0..1，供进度条等使用 */
export function clampUnit(v: number): number {
  return clamp01(v)
}
