import * as THREE from 'three';

/** 档位数量：0-8mm 共 9 档 */
export const BIN_COUNT = 9;

/**
 * 9 档热力色（绿 -> 红），取自 ColorBrewer RdYlGn 反向，
 * index 0 = 间隙最小（绿），index 8 = 间隙最大（红）。
 */
export const DEFAULT_PALETTE_HEX = [
  '#1a9850',
  '#66bd63',
  '#a6d96a',
  '#d9ef8b',
  '#ffffbf',
  '#fee08b',
  '#fdae61',
  '#f46d43',
  '#d73027',
];

/** 把间隙值映射到 0..8 档位（>=8 全部归入第 8 档） */
export function gapToBin(gapMm: number): number {
  if (!Number.isFinite(gapMm) || gapMm <= 0) return 0;
  return Math.min(BIN_COUNT - 1, Math.floor(gapMm));
}

/** 档位展示标签 */
export function binLabel(index: number): string {
  if (index === BIN_COUNT - 1) return '≥8 mm';
  return `${index}–${index + 1} mm`;
}

const paletteColor = new THREE.Color();

/** 按档位取 THREE.Color（线性工作空间，由 renderer 统一做色彩管理） */
export function binColor(paletteHex: string[], index: number, target: THREE.Color): THREE.Color {
  const hex = paletteHex[Math.max(0, Math.min(BIN_COUNT - 1, index))];
  target.set(hex);
  return target;
}

export { paletteColor };
