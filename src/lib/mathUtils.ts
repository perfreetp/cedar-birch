export const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/** smoothstep（缓入缓出），u 自动截断到 [0,1] */
export const smoothstep = (u: number): number => {
  const x = clamp(u, 0, 1);
  return x * x * (3 - 2 * x);
};

/** smootherstep（Ken Perlin 版本），零加加速度 */
export const smootherstep = (u: number): number => {
  const x = clamp(u, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
};

/** 关键帧采样：在已按时间升序排列的关键帧上线性插值 */
export function sampleKeyframes(
  frames: ReadonlyArray<{ t: number; v: number }>,
  t: number,
): number {
  if (frames.length === 0) return 0;
  if (t <= frames[0].t) return frames[0].v;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (t <= b.t) {
      const u = (t - a.t) / Math.max(1e-9, b.t - a.t);
      return lerp(a.v, b.v, u);
    }
  }
  return last.v;
}

/** 角度（度）转弧度 */
export const deg2rad = (deg: number): number => (deg * Math.PI) / 180;

/** 格式化仿真时间 mm:ss.s */
export function formatSimTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}
