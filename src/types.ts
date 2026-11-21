/** 全局仿真参数（持久化到 localStorage） */
export interface SimParams {
  // —— 分离时序 ——
  /** 分离触发时刻（起飞后秒） */
  separationTime: number;
  /** 罩瓣绕铰链张开时长（秒） */
  openDuration: number;
  /** 罩瓣最终张开角（度） */
  openAngle: number;
  /** 抛离阶段时长（秒） */
  jettisonDuration: number;
  /** 抛离径向速度（m/s） */
  jettisonSpeed: number;
  /** 抛离轴向（向上）速度（m/s） */
  axialSpeed: number;

  // —— 碎片视效 ——
  particleCount: number;
  particleSpeed: number;
  particleSpread: number;
  dustCount: number;
  showParticles: boolean;

  // —— 装配预览 ——
  exploded: boolean;
  explodeAmount: number;
  showHingeHelper: boolean;

  // —— 相机 ——
  followMode: 'rocket' | 'fairing' | 'manual';
  autoRotate: boolean;
}

/** 单个罩瓣某一时刻的位姿数据 */
export interface FairingPoseSample {
  t: number;
  side: -1 | 1;
  position: [number, number, number];
  /** 绕铰链 Y 轴的张开角（弧度） */
  hingeAngle: number;
  quaternion: [number, number, number, number];
  state: 'closed' | 'opening' | 'jettison' | 'done';
}

/** 位姿数据导出结构 */
export interface PoseExport {
  tool: string;
  version: number;
  exportedAt: string;
  params: SimParams;
  sampleRateHz: number;
  poses: {
    left: FairingPoseSample[];
    right: FairingPoseSample[];
  };
}

export type SlowMotionRate = 1 | 0.5 | 0.25 | 0.1;

export type SimPhase = 'closed' | 'opening' | 'jettison' | 'done';

export interface CollisionEvent {
  t: number;
  kind: 'fairing-satellite' | 'fairing-rocket';
  side: -1 | 1;
}
