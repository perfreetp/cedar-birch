import type { SimParams, SimPhase } from '../types';
import { deg2rad, smootherstep } from './mathUtils';

/**
 * 分离轨迹：由参数生成“张开角 / 径向位移 / 轴向位移”三条关键帧通道，
 * 运行时用关键帧插值驱动两瓣罩体的位姿（转动 + 平动复合轨迹）。
 *
 * 时序：
 *   t < sep              罩体闭合
 *   sep ~ sep+open       绕铰链先张开（转动主导）
 *   sep+open ~ sep+open+jett  沿分离方向抛离（平动主导，转动继续缓慢增加）
 */
export interface TrajectoryTracks {
  /** 绕铰链张开角（弧度，正值，实际方向由侧别决定） */
  angle: { t: number; v: number }[];
  /** 径向（铰链侧 ±X）平移（米） */
  radial: { t: number; v: number }[];
  /** 轴向（+Y 向上）平移（米） */
  axial: { t: number; v: number }[];
}

export function buildTracks(p: SimParams): TrajectoryTracks {
  const t0 = p.separationTime;
  const t1 = t0 + p.openDuration;
  const t2 = t1 + p.jettisonDuration;
  const angleMax = deg2rad(p.openAngle);
  const radialEnd = p.jettisonSpeed * p.jettisonDuration;
  const axialEnd = p.axialSpeed * p.jettisonDuration;

  return {
    angle: [
      { t: 0, v: 0 },
      { t: t0, v: 0 },
      { t: t1, v: angleMax * 0.92 },
      { t: t2, v: angleMax },
    ],
    radial: [
      { t: 0, v: 0 },
      { t: t1, v: 0 },
      { t: t2, v: radialEnd },
    ],
    axial: [
      { t: 0, v: 0 },
      { t: t1, v: 0 },
      { t: t2, v: axialEnd },
    ],
  };
}

export function phaseAt(t: number, p: SimParams): SimPhase {
  if (t < p.separationTime) return 'closed';
  if (t < p.separationTime + p.openDuration) return 'opening';
  if (t < p.separationTime + p.openDuration + p.jettisonDuration) return 'jettison';
  return 'done';
}

export interface TrajectorySample {
  angle: number;
  radial: number;
  axial: number;
  /** 当前是否处于分离窗口（用于触发粒子等一次性事件） */
  separated: boolean;
}

function sampleChannel(frames: { t: number; v: number }[], t: number): number {
  if (t <= frames[0].t) return frames[0].v;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      // 用 smootherstep 柔化关键帧之间的插值
      const e = smootherstep(u);
      return a.v + (b.v - a.v) * e;
    }
  }
  return frames[frames.length - 1].v;
}

/** 按仿真时间采样复合轨迹 */
export function sampleTracks(tracks: TrajectoryTracks, t: number): TrajectorySample {
  return {
    angle: sampleChannel(tracks.angle, t),
    radial: sampleChannel(tracks.radial, t),
    axial: sampleChannel(tracks.axial, t),
    separated: t >= tracks.angle[1].t,
  };
}
