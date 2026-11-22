// 确定性伪随机与数值工具(同一数据每次生成结果一致)
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 高斯分布(Box-Muller)
export function gaussian(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// 标准大气: 高度(m) -> 气压(hPa)
export function stdPressureHPa(altM) {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * altM, 5.25588);
}

// 线性插值
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 限定范围
export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

// 在分层数组中插值取值; levels 升序, target 为查询高度(m)
export function interpProfile(levels, values, target) {
  if (target <= levels[0]) return values[0];
  const n = levels.length;
  if (target >= levels[n - 1]) return values[n - 1];
  let i = 0;
  while (i < n - 2 && target > levels[i + 1]) i++;
  const t = (target - levels[i]) / (levels[i + 1] - levels[i]);
  return lerp(values[i], values[i + 1], t);
}

// 分位数: arr 已填充的前 count 项, q in (0,1)
export function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

// 格式化
export function fmt(v, digits = 1) {
  return Number.isFinite(v) ? v.toFixed(digits) : '--';
}
