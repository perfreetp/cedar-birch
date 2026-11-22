// 道间(层间)温度模型与五档温度着色,叠加在剖面焊道区域上
import { Bead } from '../types';
import { ThermalBin } from '../types';
import { seededRand } from './layout';

/** 五档温度区间 (°C) 与颜色(低温蓝 -> 高温红) */
export const THERMAL_BINS: ThermalBin[] = [
  { index: 0, min: -Infinity, max: 100, color: 0x2f6fed, css: '#2f6fed', label: '< 100°C' },
  { index: 1, min: 100, max: 150, color: 0x18b8a6, css: '#18b8a6', label: '100–150°C' },
  { index: 2, min: 150, max: 200, color: 0x9bcf3d, css: '#9bcf3d', label: '150–200°C' },
  { index: 3, min: 200, max: 250, color: 0xf0a020, css: '#f0a020', label: '200–250°C' },
  { index: 4, min: 250, max: Infinity, color: 0xd63b2f, css: '#d63b2f', label: '≥ 250°C' },
];

export function thermalBinOf(temp: number): ThermalBin {
  for (const b of THERMAL_BINS) if (temp < b.max) return b;
  return THERMAL_BINS[THERMAL_BINS.length - 1];
}

/**
 * 道间温度模型:
 * 根部热积累最强、温度最高,向盖面逐层降低;同层内后焊道温度略高于先焊道。
 * 仅用于工艺可视化,不替代真实热模拟。
 */
export function interpassTemperature(bead: Bead, layerCount: number, passesInLayer: number): number {
  const tFromRoot = bead.layer / Math.max(1, layerCount - 1); // 0 根部 -> 1 盖面
  const base = 95 + 155 * Math.exp(-2.1 * tFromRoot);
  const passFactor = passesInLayer > 1 ? bead.pass / (passesInLayer - 1) : 0;
  const jitter = (seededRand(bead.order + 77) - 0.5) * 14;
  return Math.max(40, base + passFactor * 12 + jitter);
}

export function computeThermalMap(
  beads: Bead[],
  passesPerLayer: number[],
  layerCount: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of beads) {
    map.set(b.id, interpassTemperature(b, layerCount, passesPerLayer[b.layer] ?? 1));
  }
  return map;
}
