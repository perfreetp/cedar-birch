import {
  CollectionPoint,
  LoadEvent,
  PathSeg,
  RoadNetwork,
  ScheduleSegment,
  SimParams,
  VehicleConfig,
  VehicleSchedule,
} from './types';
import { buildPath } from './network';

/** 调度器所需的上下文（由 SimWorld 实现，避免循环依赖） */
export interface ScheduleContext {
  network: RoadNetwork;
  pointMap: Map<number, CollectionPoint>;
  orders: number[][];
  vehicles: VehicleConfig[];
  depot: { x: number; z: number; node: number };
  params: SimParams;
}

function toPathSeg(coords: Float32Array): PathSeg {
  const n = coords.length / 2;
  const cum = new Float32Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(coords[2 * i] - coords[2 * i - 2], coords[2 * i + 1] - coords[2 * i - 1]);
    cum[i] = acc;
  }
  return { coords, cum, length: acc };
}

/**
 * 为一辆车生成全天作业调度：
 * 错峰出发 → 依次访问点位（装载增长）→ 超过阈值自动插入返程卸载段 → 最终回场。
 * 结果是时间的纯函数，时间轴拖动时可直接求值，保证千级点位的流畅预览。
 */
export function buildSchedule(ctx: ScheduleContext, vid: number): VehicleSchedule {
  const { params } = ctx;
  const veh = ctx.vehicles[vid];
  const order = ctx.orders[vid] || [];
  const depart = params.dayStart + vid * params.stagger; // 时间片错峰出发
  const segs: ScheduleSegment[] = [];
  const loadEvents: LoadEvent[] = [];
  let t = depart;
  let load = 0;
  let totalDist = 0;
  let cur = { x: ctx.depot.x, z: ctx.depot.z, node: ctx.depot.node };
  const threshold = params.threshold * veh.capacity;

  const travelTo = (to: { x: number; z: number; node: number }, isReturn: boolean) => {
    const p = buildPath(ctx.network, cur, to, params.baseSpeed);
    segs.push({
      kind: 'travel',
      t0: t,
      t1: t + p.time,
      path: toPathSeg(p.coords),
      x: to.x,
      z: to.z,
      isReturn,
      loadStart: load,
      loadEnd: load,
    });
    t += p.time;
    totalDist += p.length;
    cur = to;
  };

  order.forEach((pid, idx) => {
    const pt = ctx.pointMap.get(pid);
    if (!pt) return;
    travelTo({ x: pt.x, z: pt.z, node: pt.node }, false);
    const eff = pt.amount * pt.weight;
    segs.push({
      kind: 'service',
      t0: t,
      t1: t + params.serviceTime,
      x: pt.x,
      z: pt.z,
      pointId: pid,
      loadStart: load,
      loadEnd: load + eff,
    });
    t += params.serviceTime;
    load += eff;
    loadEvents.push({ t, load, pointId: pid });
    // 装载超过阈值 → 插入返程段，回场卸载后空载继续
    if (load >= threshold && idx < order.length - 1) {
      travelTo(ctx.depot, true);
      segs.push({
        kind: 'unload',
        t0: t,
        t1: t + params.unloadTime,
        x: ctx.depot.x,
        z: ctx.depot.z,
        loadStart: load,
        loadEnd: 0,
      });
      t += params.unloadTime;
      load = 0;
      loadEvents.push({ t, load: 0 });
    }
  });
  travelTo(ctx.depot, true); // 全天作业结束回场
  return { vehicleId: vid, segments: segs, departTime: depart, endTime: t, totalDist, loadEvents };
}

export interface EvalResult {
  x: number;
  z: number;
  angle: number | null; // 行驶朝向（弧度），静止时为 null
  load: number;
  state: 'parked' | 'travel' | 'service' | 'unload' | 'done';
}

/** 求某时刻车辆的位置/朝向/装载量（解析求值，O(log n)） */
export function evalSchedule(
  sched: VehicleSchedule,
  t: number,
  depot: { x: number; z: number },
): EvalResult {
  const segs = sched.segments;
  if (t < sched.departTime || segs.length === 0) {
    return { x: depot.x, z: depot.z, angle: null, load: 0, state: 'parked' };
  }
  if (t >= sched.endTime) {
    return { x: depot.x, z: depot.z, angle: null, load: 0, state: 'done' };
  }
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].t1 < t) lo = mid + 1;
    else hi = mid;
  }
  const seg = segs[lo];
  const frac = seg.t1 > seg.t0 ? Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0))) : 1;
  const load = seg.loadStart + (seg.loadEnd - seg.loadStart) * frac;

  if (seg.kind === 'travel' && seg.path && seg.path.length > 1e-6) {
    const d = frac * seg.path.length;
    const { coords, cum } = seg.path;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const span = cum[i] - cum[i - 1];
    const f = span > 1e-9 ? (d - cum[i - 1]) / span : 0;
    const x0 = coords[2 * (i - 1)];
    const z0 = coords[2 * (i - 1) + 1];
    const x1 = coords[2 * i];
    const z1 = coords[2 * i + 1];
    return {
      x: x0 + (x1 - x0) * f,
      z: z0 + (z1 - z0) * f,
      angle: Math.atan2(x1 - x0, z1 - z0),
      load,
      state: 'travel',
    };
  }
  return { x: seg.x, z: seg.z, angle: null, load, state: seg.kind };
}
