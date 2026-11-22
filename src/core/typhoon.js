// 台风物理场: 关键帧插值、风场/气压场、涡旋角动量积分
import { lerp, interpProfile, clamp } from './util.js';

// 两个时刻间插值出连续态
export function interpolateState(data, f) {
  const n = data.steps.length;
  const fi = clamp(f, 0, n - 1 - 1e-6);
  const i = Math.floor(fi);
  const t = fi - i;
  const a = data.steps[i];
  const b = data.steps[Math.min(i + 1, n - 1)];
  const mixNum = (k) => lerp(a[k], b[k], t);
  const mixArr = (k) => a[k].map((v, j) => lerp(v, b[k][j], t));
  return {
    f: fi,
    i,
    t,
    time: t < 0.5 ? a.time : b.time,
    center: { lon: lerp(a.center.lon, b.center.lon, t), lat: lerp(a.center.lat, b.center.lat, t) },
    centralPressure: mixNum('centralPressure'),
    maxSustainedWind: mixNum('maxSustainedWind'),
    rmw: mixNum('rmw'),
    radiusOuter: mixNum('radiusOuter'),
    pressureProfile: mixArr('pressureProfile'),
    windProfile: mixArr('windProfile'),
  };
}

// 指定高度的最大风速(用数据廓线插值)
export function windAtLevel(state, levels, z) {
  return interpProfile(levels, state.windProfile, z);
}

// 指定高度的中心气压
export function pressureAtLevel(state, levels, z) {
  return interpProfile(levels, state.pressureProfile, z);
}

// Rankine 涡旋切向风速: r 距中心 km, R 最大风速半径 km, Vmax 该高度最大风速
export function tangentialWind(r, R, Vmax) {
  if (r < 1e-3) return 0;
  const x = r / R;
  // 眼区内线性增长, 眼壁外按 x^-0.6 衰减
  return x < 1 ? Vmax * x : Vmax * Math.pow(x, -0.6);
}

// 改进 Holland 型气压场: 距中心 r(km) 处气压 hPa
export function pressureAt(r, R, pCenter, pEnv) {
  const B = 1.3; // 形状参数
  const x = r / R;
  return pEnv - (pEnv - pCenter) * Math.exp(-Math.pow(x, -B));
}

// 预计算每个关键帧在参考高度(3000m)的累计眼壁转角 I(rad)。
// I = ∫ (vmax·3.6 / R) dt, 与粒子自身半径无关;
// 粒子方位角修正: r<=R 时直接用 I(刚体式同角速度),
// r>R 时用 I·(R/r)^0.6, 对应 Rankine 外流区角速度衰减。
export function buildRotationTable(data, levels) {
  const zRef = 3000;
  const table = new Array(data.steps.length);
  let I = 0;
  table[0] = 0;
  for (let k = 1; k < data.steps.length; k++) {
    const s0 = data.steps[k - 1];
    const s1 = data.steps[k];
    const v0 = interpProfile(levels, s0.windProfile, zRef);
    const v1 = interpProfile(levels, s1.windProfile, zRef);
    const w0 = (v0 * 3.6) / s0.rmw;
    const w1 = (v1 * 3.6) / s1.rmw;
    I += 0.5 * (w0 + w1) * 3; // 每帧间隔 3 小时
    table[k] = I;
  }
  return table;
}

// 插值累计转角
export function rotationAt(table, f) {
  const n = table.length;
  const fi = clamp(f, 0, n - 1 - 1e-6);
  const i = Math.floor(fi);
  const t = fi - i;
  return lerp(table[i], table[Math.min(i + 1, n - 1)], t);
}

// 单个粒子在给定累计转角下的方位角修正量
export function particleSweep(I, rNorm) {
  // rNorm = r/R; 眼内同角速度, 眼外角速度按 x^-0.6 衰减
  return rNorm <= 1 ? I : I * Math.pow(rNorm, -0.6);
}
