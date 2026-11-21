import { writable, derived, get } from 'svelte/store'
import type { AngleState, WingConfig } from './types'
import { loadConfig, saveConfig } from './storage'
import { anglesAt, deployDuration, snapSlider } from './deploy'
import {
  cloneConfig,
  defaultConfig,
  reconcileHinges
} from './config'

export type PlayMode = 'manual' | 'playing' | 'paused'

export interface PlayState {
  mode: PlayMode
  /** 时间轴上的仿真时间（秒） */
  simTime: number
  /** 手动模式下统一施加给所有铰链的展开角（度，已吸附 45° 档） */
  manualAngle: number
  /** 播放倍速 */
  speed: number
}

const initialPlay: PlayState = {
  mode: 'manual',
  simTime: 0,
  manualAngle: 0,
  speed: 1
}

/**
 * 从 URL 查询参数读取初始播放状态，便于通过链接分享特定姿态：
 * - ?angle=0..180：手动模式初始展开角（自动吸附 45° 档）
 * - ?time=秒：以时间轴寻址方式定位到该仿真时刻
 */
function initialPlayState(): PlayState {
  const state: PlayState = { ...initialPlay }
  try {
    const params = new URLSearchParams(window.location.search)
    const angle = params.get('angle')
    const time = params.get('time')
    if (time !== null) {
      state.mode = 'paused'
      state.simTime = Math.max(0, Number(time) || 0)
    } else if (angle !== null) {
      state.mode = 'manual'
      state.manualAngle = snapSlider(Number(angle) || 0)
    }
  } catch {
    /* 忽略非法 URL 参数 */
  }
  return state
}

/** 构型数据 store（自动持久化到 localStorage） */
export const configStore = writable<WingConfig>(loadConfig())
/** 播放状态 store */
export const playStore = writable<PlayState>(initialPlayState())

configStore.subscribe((cfg) => saveConfig(cfg))

/** 展开全程所需时间（秒） */
export const durationStore = derived(configStore, (cfg) => deployDuration(cfg))

/** 当前各铰链展开角（度） */
export const currentAngles = derived(
  [configStore, playStore],
  ([$cfg, $p]): AngleState =>
    $p.mode === 'manual'
      ? $cfg.hinges.map(() => $p.manualAngle)
      : anglesAt($cfg, $p.simTime)
)

/* ---------------- 构型编辑动作 ---------------- */

/** 以可变草稿方式更新构型，并保证铰链数量与翼板对齐 */
export function mutateConfig(fn: (draft: WingConfig) => void): void {
  configStore.update((cfg) => {
    const draft = cloneConfig(cfg)
    fn(draft)
    return reconcileHinges(draft)
  })
}

export function restoreDefaults(): void {
  configStore.set(reconcileHinges(defaultConfig()))
  playStore.set({ ...initialPlay })
}

export function importConfig(cfg: WingConfig): void {
  const reconciled = reconcileHinges(cloneConfig(cfg))
  configStore.set(reconciled)
  playStore.set({ ...initialPlay })
}

/* ---------------- 播放 / 时序动作 ---------------- */

/** 手动模式：滑杆设定统一展开角（自动吸附 5 档） */
export function setManualAngle(angle: number): void {
  playStore.update((s) => ({ ...s, mode: 'manual', manualAngle: snapSlider(angle) }))
}

/** 一键折叠收拢 */
export function foldAll(): void {
  playStore.update((s) => ({ ...s, mode: 'manual', manualAngle: 0, simTime: 0 }))
}

/** 一键全展开 */
export function deployAll(): void {
  playStore.update((s) => ({ ...s, mode: 'manual', manualAngle: 180 }))
}

/** 开始播放：手动/暂停 → 从当前时间走时序；已播完则重头开始 */
export function play(): void {
  playStore.update((s) => {
    const total = deployDuration(get(configStore))
    if (s.mode === 'manual') {
      return { ...s, mode: 'playing', simTime: 0 }
    }
    const simTime = s.simTime >= total ? 0 : s.simTime
    return { ...s, mode: 'playing', simTime }
  })
}

export function pause(): void {
  playStore.update((s) => (s.mode === 'playing' ? { ...s, mode: 'paused' } : s))
}

export function togglePlay(): void {
  const s = get(playStore)
  if (s.mode === 'playing') pause()
  else play()
}

/** 时间轴拖动寻址 */
export function seek(t: number): void {
  const total = deployDuration(get(configStore))
  const simTime = Math.min(total, Math.max(0, t))
  playStore.update((s) => ({ ...s, mode: 'paused', simTime }))
}

export function setSpeed(speed: number): void {
  playStore.update((s) => ({ ...s, speed }))
}

/**
 * 每帧推进仿真时间，由 Babylon 渲染循环驱动。
 * 到达总时长后自动转为暂停态。
 */
export function tick(dtSeconds: number): void {
  const s = get(playStore)
  if (s.mode !== 'playing') return
  const total = deployDuration(get(configStore))
  const simTime = Math.min(total, s.simTime + dtSeconds * s.speed)
  playStore.set({ ...s, simTime, mode: simTime >= total ? 'paused' : 'playing' })
}
