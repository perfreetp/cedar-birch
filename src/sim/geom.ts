/** 圆角矩形环线（XZ 平面）的几何工具，供自动路线、路线显示与污渍散布共用。 */

export interface PathPoint {
  x: number;
  z: number;
  /** 单位切线（行驶方向） */
  tx: number;
  tz: number;
}

export interface RingSpec {
  /** 中心线半宽（X 方向） */
  hx: number;
  /** 中心线半长（Z 方向） */
  hz: number;
  /** 圆角半径 */
  r: number;
  /** 路面带宽（米） */
  band: number;
}

export const RING: RingSpec = { hx: 80, hz: 80, r: 25, band: 15 };

export function ringPerimeter(spec: RingSpec = RING): number {
  return 4 * 2 * (spec.hx - spec.r) + 2 * Math.PI * spec.r;
}

export function ringRoadArea(spec: RingSpec = RING): number {
  return ringPerimeter(spec) * spec.band;
}

/** 按弧长 s（米）取环线中心线上的点与切线，方向为固定绕行方向。 */
export function roundedRectPoint(s: number, spec: RingSpec = RING): PathPoint {
  const { hx, hz, r } = spec;
  const straightX = 2 * (hx - r);
  const straightZ = 2 * (hz - r);
  const arc = (Math.PI * r) / 2;
  const total = 2 * straightX + 2 * straightZ + 4 * arc;
  s = ((s % total) + total) % total;

  // 1. 顶边：z = +hz，x 由 -(hx-r) → +(hx-r)
  if (s < straightX) return { x: -(hx - r) + s, z: hz, tx: 1, tz: 0 };
  s -= straightX;
  // 2. 右上角：圆心 (hx-r, hz-r)
  if (s < arc) {
    const a = s / r;
    return {
      x: hx - r + r * Math.sin(a),
      z: hz - r + r * Math.cos(a),
      tx: Math.cos(a),
      tz: -Math.sin(a),
    };
  }
  s -= arc;
  // 3. 右边：x = +hx，z 由 (hz-r) → -(hz-r)
  if (s < straightZ) return { x: hx, z: hz - r - s, tx: 0, tz: -1 };
  s -= straightZ;
  // 4. 右下角：圆心 (hx-r, -(hz-r))
  if (s < arc) {
    const a = s / r;
    return {
      x: hx - r + r * Math.cos(a),
      z: -(hz - r) - r * Math.sin(a),
      tx: -Math.sin(a),
      tz: -Math.cos(a),
    };
  }
  s -= arc;
  // 5. 底边：z = -hz，x 由 +(hx-r) → -(hx-r)
  if (s < straightX) return { x: hx - r - s, z: -hz, tx: -1, tz: 0 };
  s -= straightX;
  // 6. 左下角：圆心 (-(hx-r), -(hz-r))
  if (s < arc) {
    const a = s / r;
    return {
      x: -(hx - r) - r * Math.sin(a),
      z: -(hz - r) + r * Math.cos(a),
      tx: -Math.cos(a),
      tz: -Math.sin(a),
    };
  }
  s -= arc;
  // 7. 左边：x = -hx，z 由 -(hz-r) → +(hz-r)
  if (s < straightZ) return { x: -hx, z: -(hz - r) + s, tx: 0, tz: 1 };
  s -= straightZ;
  // 8. 左上角：圆心 (-(hx-r), hz-r)
  const a = s / r;
  return {
    x: -(hx - r) - r * Math.cos(a),
    z: hz - r + r * Math.sin(a),
    tx: Math.sin(a),
    tz: Math.cos(a),
  };
}
