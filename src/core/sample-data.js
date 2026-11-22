// 生成 24 个时刻的台风中心气压/风速层级示例数据
// 数据 schema (typhoon-profile-v1):
// {
//   meta: { name, schema, unit: {distance:'km', pressure:'hPa', wind:'m/s', altitude:'m'} },
//   levels: number[9],                       // 高度层(m), 自低到高
//   steps: [{
//     t, time, name,
//     center: {lon, lat},                    // 台风中心经纬度(路径)
//     centralPressure: number,               // 地面中心气压 hPa
//     maxSustainedWind: number,              // 近中心最大风速 m/s (10m)
//     rmw: number,                           // 最大风速半径 km
//     radiusOuter: number,                   // 外围环流半径 km
//     pressureProfile: number[9],            // 各高度层台风中心气压 hPa
//     windProfile: number[9],                // 各高度层近中心最大风速 m/s
//     heading: number                        // 移动方向(度, 气象 convention)
//   }]
// }
import { DATA_SCHEMA } from './constants.js';
import { stdPressureHPa } from './util.js';

const LEVELS = [0, 500, 1500, 3000, 5500, 7500, 10000, 13000, 16000];

// 垂直折减: 风速先随高度增强(低空急流)后在高层减弱
const WIND_VERT = [1.0, 1.08, 1.12, 1.05, 0.92, 0.78, 0.6, 0.42, 0.28];

export function generateSampleData() {
  const N = 24;
  const steps = [];

  for (let i = 0; i < N; i++) {
    const t = i; // 每 3 小时一个时刻
    // 生命史: 发展 -> 成熟 -> 减弱
    const life = Math.sin((Math.PI * i) / (N - 1)); // 0..1..0
    const centralPressure = 985 - 42 * life + 3 * Math.sin(i * 0.9); // 最低 ~943 hPa
    const vmax10 = 28 + 34 * life + 1.5 * Math.cos(i * 0.7); // 最大 ~62 m/s
    const rmw = 52 - 20 * life + 4 * Math.cos(i * 0.45); // 增强时风圈收缩
    const radiusOuter = 180 + 60 * life + 6 * Math.sin(i * 0.4);

    // 路径: 西北行后转向东北(抛物线型), 经纬度
    const lon = 132 - 0.55 * i + 0.028 * i * i;
    const lat = 12 + 0.42 * i - 0.006 * i * i;
    const heading =
      i === 0
        ? 300
        : (Math.atan2(
            132 - 0.55 * i + 0.028 * i * i - (132 - 0.55 * (i - 1) + 0.028 * (i - 1) * (i - 1)),
            12 + 0.42 * i - 0.006 * i * i - (12 + 0.42 * (i - 1) - 0.006 * (i - 1) * (i - 1))
          ) *
            180) /
          Math.PI;

    // 中心气压随高度趋于标准大气, 低压扰动在高层逐渐消失
    const pressureProfile = LEVELS.map((z, k) => {
      const std = stdPressureHPa(z);
      const deficitFrac = Math.exp(-z / 9000); // 中心低压偏差的垂直衰减
      const p = std - (stdPressureHPa(0) - centralPressure) * deficitFrac;
      return Math.round(p * 10) / 10;
    });

    const windProfile = LEVELS.map((z, k) => {
      const v = vmax10 * WIND_VERT[k];
      return Math.round(v * 10) / 10;
    });

    steps.push({
      t,
      time: `T+${String(i * 3).padStart(2, '0')}h`,
      name: `T${String(i).padStart(2, '0')}`,
      center: { lon: Math.round(lon * 100) / 100, lat: Math.round(lat * 100) / 100 },
      centralPressure: Math.round(centralPressure * 10) / 10,
      maxSustainedWind: Math.round(vmax10 * 10) / 10,
      rmw: Math.round(rmw * 10) / 10,
      radiusOuter: Math.round(radiusOuter * 10) / 10,
      pressureProfile: pressureProfile,
      windProfile: windProfile,
      heading: Math.round(heading),
    });
  }

  return {
    meta: {
      name: '示例台风 TY-DEMO (合成数据)',
      schema: DATA_SCHEMA,
      generatedBy: 'typhoon-viz sample generator',
      unit: { distance: 'km', pressure: 'hPa', wind: 'm/s', altitude: 'm' },
    },
    levels: [...LEVELS],
    steps,
  };
}
