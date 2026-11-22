import type { BurnIndexResult } from './extraction';
import { classifySeverity, pointInBoundary, SEVERITY_LEVELS } from './geometry';
import type { Boundary, Pt, SeverityLevel, SeverityLevelInfo } from '../types';

export interface DamageGrid {
  burn: BurnIndexResult;
  /** 网格步长（米） */
  spacing: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** 采样点世界坐标 + 受损指数 + 等级；仅包含边界内的点 */
  cells: Array<{ p: Pt; index: number; level: SeverityLevel }>;
}

/** 任意世界点的受损指数（双线性采样 burn grid） */
export function sampleDamageAt(burn: BurnIndexResult, p: Pt): number {
  const fx = (p.x - burn.origin.x) / burn.cellSize;
  const fy = (p.y - burn.origin.y) / burn.cellSize;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const tx = fx - c0;
  const ty = fy - r0;
  const at = (c: number, r: number): number => {
    if (c < 0 || r < 0 || c >= burn.cols || r >= burn.rows) return 0;
    return burn.grid[r * burn.cols + c];
  };
  const v0 = at(c0, r0) * (1 - tx) + at(c0 + 1, r0) * tx;
  const v1 = at(c0, r0 + 1) * (1 - tx) + at(c0 + 1, r0 + 1) * tx;
  return Math.max(0, Math.min(1, v0 * (1 - ty) + v1 * ty));
}

/**
 * 在边界内按规则网格采样受损指数并分级。
 * spacing 按边界尺寸自适应，保证点数上限（性能保护）。
 */
export function buildDamageGrid(
  burn: BurnIndexResult,
  boundary: Boundary,
  cutoffs: readonly number[],
  maxCells = 9000,
): DamageGrid {
  const minX = Math.min(...boundary.outer.map((p) => p.x));
  const maxX = Math.max(...boundary.outer.map((p) => p.x));
  const minY = Math.min(...boundary.outer.map((p) => p.y));
  const maxY = Math.max(...boundary.outer.map((p) => p.y));
  const w = maxX - minX;
  const h = maxY - minY;
  const target = Math.sqrt(maxCells / Math.max(1e-9, (w * h) / (burn.cellSize * burn.cellSize)));
  const spacing = Math.max(burn.cellSize, burn.cellSize * Math.max(1, 1 / Math.max(0.05, target)));

  const cells: DamageGrid['cells'] = [];
  for (let y = minY + spacing / 2; y < maxY; y += spacing) {
    for (let x = minX + spacing / 2; x < maxX; x += spacing) {
      const p = { x, y };
      if (!pointInBoundary(p, boundary)) continue;
      const index = sampleDamageAt(burn, p);
      const info = classifySeverity(index, cutoffs);
      cells.push({ p, index, level: info.level });
    }
  }

  return { burn, spacing, bounds: { minX, minY, maxX, maxY }, cells };
}

/** 各等级平面面积（按采样点代表的方格面积累加） */
export function levelAreasFromGrid(grid: DamageGrid): [number, number, number, number, number] {
  const areas = [0, 0, 0, 0, 0] as [number, number, number, number, number];
  const cellArea = grid.spacing * grid.spacing;
  for (const c of grid.cells) areas[c.level] += cellArea;
  return areas;
}

export function severityInfo(level: SeverityLevel): SeverityLevelInfo {
  return SEVERITY_LEVELS[level];
}
