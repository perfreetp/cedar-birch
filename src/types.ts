import type * as THREE from 'three';

/** 弹道关键帧：位置/速度单位为米、米/秒，坐标系 Y 轴向上，发射点位于原点 */
export interface TrajectoryKeyframe {
  t: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** 俯仰角（度，相对水平面），可选；缺省时由速度方向推算 */
  pitch?: number;
  /** 航向角（度，相对 +X 轴），可选 */
  heading?: number;
  /** 油门 / 推力系数 0..1，缺省为 1 */
  throttle?: number;
}

export interface TrajectoryData {
  name: string;
  unit: 'metric';
  keyframes: TrajectoryKeyframe[];
}

export interface SimState {
  time: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  altitude: number;
  throttle: number;
  quaternion: THREE.Quaternion;
}

export type CameraMode = 'follow' | 'ground';

export interface RendererSettings {
  cameraMode: CameraMode;
  playing: boolean;
  speed: 1 | 0.5;
  time: number;
  showMach: boolean;
  showSmoke: boolean;
  bloom: boolean;
  /** 风场速度（米/秒），沿 +X 方向 */
  wind: number;
}

export const DEFAULT_SETTINGS: RendererSettings = {
  cameraMode: 'follow',
  playing: false,
  speed: 1,
  time: 0,
  showMach: true,
  showSmoke: true,
  bloom: true,
  wind: 12,
};

/** 按高度划分的三档粒子数量配置 */
export interface ParticleTier {
  /** 该档适用的最低高度（米） */
  minAltitude: number;
  label: string;
  flame: number;
  smoke: number;
}

export const PARTICLE_TIERS: ParticleTier[] = [
  { minAltitude: 0, label: '低空 · 高密度', flame: 12000, smoke: 4000 },
  { minAltitude: 8000, label: '中空 · 中密度', flame: 6000, smoke: 1500 },
  { minAltitude: 25000, label: '高空 · 低密度', flame: 2500, smoke: 400 },
];

export const MAX_FLAME_PARTICLES = 12000;
export const MAX_SMOKE_PARTICLES = 4000;
