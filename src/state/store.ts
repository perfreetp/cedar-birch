import { create } from 'zustand'
import type {
  CameraState,
  Channel,
  DatasetMeta,
  LightState,
  Progress,
  SlicesState,
  TransferFunction,
} from '../types'

export const DEFAULT_TEMP_TF: TransferFunction = {
  colorStops: [
    { t: 0, color: '#1a2b8f' },
    { t: 0.25, color: '#1f9ede' },
    { t: 0.5, color: '#3fd68f' },
    { t: 0.75, color: '#f2e14c' },
    { t: 1, color: '#e33d2e' },
  ],
  opacityStops: [
    { t: 0, v: 0 },
    { t: 0.35, v: 0.05 },
    { t: 0.7, v: 0.35 },
    { t: 1, v: 0.9 },
  ],
}

export const DEFAULT_SPEED_TF: TransferFunction = {
  colorStops: [
    { t: 0, color: '#0d0d2b' },
    { t: 0.3, color: '#5a2d91' },
    { t: 0.6, color: '#c94f8a' },
    { t: 0.85, color: '#ffb347' },
    { t: 1, color: '#fff5e0' },
  ],
  opacityStops: [
    { t: 0, v: 0 },
    { t: 0.4, v: 0.08 },
    { t: 0.75, v: 0.4 },
    { t: 1, v: 0.85 },
  ],
}

interface AppState {
  meta: DatasetMeta | null
  histograms: { temp: number[]; speed: number[] } | null
  progress: Progress
  fps: number
  tf: { temp: TransferFunction; speed: TransferFunction }
  activeChannel: Channel
  /** 体渲染当前使用哪套传输函数 */
  volumeChannel: Channel
  slices: SlicesState
  light: LightState
  /** 视口中 TransformControls 的编辑目标 */
  editTarget: 'light' | 'slice' | null
  /** TransformControls 模式(切面编辑时用) */
  tcMode: 'translate' | 'rotate'
  /** 全局消光系数缩放 */
  density: number
  bloom: number

  setMeta: (m: DatasetMeta | null) => void
  setHistograms: (h: AppState['histograms']) => void
  setProgress: (p: Progress) => void
  setFps: (f: number) => void
  setTF: (ch: Channel, tf: TransferFunction) => void
  setActiveChannel: (c: Channel) => void
  setVolumeChannel: (c: Channel) => void
  setSlices: (s: SlicesState) => void
  setLight: (l: LightState) => void
  setEditTarget: (t: AppState['editTarget']) => void
  setTcMode: (m: 'translate' | 'rotate') => void
  setDensity: (d: number) => void
  setBloom: (b: number) => void
}

export const useStore = create<AppState>((set) => ({
  meta: null,
  histograms: null,
  progress: { phase: 'idle', done: 0, total: 0 },
  fps: 0,
  tf: { temp: DEFAULT_TEMP_TF, speed: DEFAULT_SPEED_TF },
  activeChannel: 'temp',
  volumeChannel: 'temp',
  slices: {
    x: { enabled: false, pos: 0.5 },
    y: { enabled: false, pos: 0.5 },
    z: { enabled: false, pos: 0.5 },
    free: { enabled: false, theta: 45, phi: 60, offset: 0 },
  },
  light: { pos: [2.5, 2.5, 2.5], intensity: 1.6, ambient: 0.25 },
  editTarget: null,
  tcMode: 'translate',
  density: 8,
  bloom: 0,

  setMeta: (meta) => set({ meta }),
  setHistograms: (histograms) => set({ histograms }),
  setProgress: (progress) => set({ progress }),
  setFps: (fps) => set({ fps }),
  setTF: (ch, tf) => set((s) => ({ tf: { ...s.tf, [ch]: tf } })),
  setActiveChannel: (activeChannel) => set({ activeChannel }),
  setVolumeChannel: (volumeChannel) => set({ volumeChannel }),
  setSlices: (slices) => set({ slices }),
  setLight: (light) => set({ light }),
  setEditTarget: (editTarget) => set({ editTarget }),
  setTcMode: (tcMode) => set({ tcMode }),
  setDensity: (density) => set({ density }),
  setBloom: (bloom) => set({ bloom }),
}))

/** 供设置导出使用的相机状态存取(由 Stage 注册) */
export const cameraBridge: {
  get: (() => CameraState) | null
  set: ((c: CameraState) => void) | null
} = { get: null, set: null }
