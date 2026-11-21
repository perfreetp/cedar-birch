// 沙尘浓度颜色映射表（256 级）
// 设计目标：低浓度即呈现可见的暖色，高浓度趋近亮金白，整体明度高、与暗褐地形拉开
const STOPS = [
  { t: 0.00, c: [110, 72, 42] },
  { t: 0.15, c: [168, 104, 54] },
  { t: 0.34, c: [214, 142, 64] },
  { t: 0.55, c: [240, 178, 84] },
  { t: 0.74, c: [248, 206, 118] },
  { t: 0.90, c: [252, 224, 150] },
  { t: 1.00, c: [255, 236, 178] },
];

function lerp(a, b, f) { return a + (b - a) * f; }

export function buildDustLUT(size = 256) {
  const lut = new Uint8ClampedArray(size * 4);
  let s = 0;
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    while (s < STOPS.length - 2 && t > STOPS[s + 1].t) s++;
    const a = STOPS[s], b = STOPS[s + 1];
    const f = Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t || 1)));
    lut[i * 4] = lerp(a.c[0], b.c[0], f);
    lut[i * 4 + 1] = lerp(a.c[1], b.c[1], f);
    lut[i * 4 + 2] = lerp(a.c[2], b.c[2], f);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

// 五级阈值（归一化浓度），L0 最宽松、L4 最严格
export const THRESHOLD_LEVELS = [
  { level: 0, norm: 0.02, label: 'L0 极低', desc: '显示全部可检测浓度，云团轮廓最完整' },
  { level: 1, norm: 0.08, label: 'L1 低', desc: '剔除背景级弱信号，保留外围扩散区' },
  { level: 2, norm: 0.18, label: 'L2 中', desc: '默认等级，聚焦主体沙尘浓度场' },
  { level: 3, norm: 0.35, label: 'L3 高', desc: '仅保留高浓度输沙带与核心区' },
  { level: 4, norm: 0.55, label: 'L4 极高', desc: '只显示近源强浓度核心' },
];
