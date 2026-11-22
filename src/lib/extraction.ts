import type { Pt, RasterImage } from '../types';
import { readImageData } from './raster';
import { ringArea, simplifyRing } from './geometry';

export interface BurnIndexResult {
  /** 降采样后的火烧指数网格（0..1，行优先） */
  grid: Float32Array;
  cols: number;
  rows: number;
  /** 网格单元对应原始像素尺寸（米） */
  cellSize: number;
  origin: Pt;
  otsu: number;
  mean: number;
}

/** 降采样步长（原始像素），控制提取性能 */
const SAMPLE_STEP = 2;

/**
 * 火烧指数：以参考颜色（焦黑土色）为基准的归一化 RGB 距离。
 * 同时做 gamma 预处理并按 95 分位拉伸，使阈值在不同曝光影像下保持稳定。
 * 若提供灾前影像，则改为两期影像的归一化差值（植被差值思路）。
 */
export function computeBurnIndex(
  imagery: RasterImage,
  reference: [number, number, number],
  pre?: RasterImage | null,
): BurnIndexResult {
  const postData = readImageData(imagery.image as ImageBitmap);
  const preData = pre ? readImageData(pre.image as ImageBitmap) : null;
  const step = SAMPLE_STEP;
  const cols = Math.ceil(imagery.width / step);
  const rows = Math.ceil(imagery.height / step);
  const grid = new Float32Array(cols * rows);
  const ref = reference.map((v) => (v / 255) ** 2.2) as [number, number, number];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.min(imagery.width - 1, c * step);
      const y = Math.min(imagery.height - 1, r * step);
      const k = (y * imagery.width + x) * 4;
      const pr = (postData.data[k] / 255) ** 2.2;
      const pg = (postData.data[k + 1] / 255) ** 2.2;
      const pb = (postData.data[k + 2] / 255) ** 2.2;

      let index: number;
      if (preData) {
        // 两期差值：灾前越绿、灾后越暗，指数越高
        const er = (preData.data[k] / 255) ** 2.2;
        const eg = (preData.data[k + 1] / 255) ** 2.2;
        const eb = (preData.data[k + 2] / 255) ** 2.2;
        const preVeg = eg - 0.5 * (er + eb);
        const postVeg = pg - 0.5 * (pr + pb);
        index = 0.5 + 2.0 * (preVeg - postVeg);
      } else {
        const d = Math.hypot(pr - ref[0], pg - ref[1], pb - ref[2]);
        index = 1 - d / Math.sqrt(3);
      }
      grid[r * cols + c] = Math.max(0, Math.min(1, index));
    }
  }

  // 95 分位鲁棒拉伸
  const sorted = Float32Array.from(grid).sort();
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const p5 = sorted[Math.floor(sorted.length * 0.05)] || 0;
  const span = Math.max(1e-6, p95 - p5);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.max(0, Math.min(1, (grid[i] - p5) / span));
  }

  return {
    grid,
    cols,
    rows,
    cellSize: imagery.pixelSize * step,
    origin: imagery.origin,
    otsu: otsu(grid),
    mean: grid.reduce((s, v) => s + v, 0) / grid.length,
  };
}

/** 大津法自动阈值（256 桶直方图） */
export function otsu(values: Float32Array): number {
  const bins = new Uint32Array(256);
  for (const v of values) bins[Math.min(255, Math.floor(v * 256))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * bins[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let i = 0; i < 256; i++) {
    wB += bins[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * bins[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > maxVar) {
      maxVar = between;
      threshold = i;
    }
  }
  return threshold / 256;
}

/** 在指定网格点采样火烧指数（边界外返回 0） */
export function sampleBurnIndex(b: BurnIndexResult, col: number, row: number): number {
  if (col < 0 || row < 0 || col >= b.cols || row >= b.rows) return 0;
  return b.grid[row * b.cols + col];
}

/**
 * Marching Squares 提取阈值等值线，返回世界坐标闭合环集合。
 * 网格角点值由单元值近似（单元 i 即角点 i），等值点采用线性插值。
 * 等值点以稳定整数 ID 标识：kind(2bit) + 行/列索引，邻接关系全部基于 ID。
 */
export function marchingSquares(b: BurnIndexResult, threshold: number): Pt[][] {
  const { grid, cols, rows, cellSize, origin } = b;
  const val = (c: number, r: number): number => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return 0;
    return grid[r * cols + c];
  };

  // 物理边的全局 ID（相邻单元格的共享边必须得到相同 ID）：
  // 水平边 H(r,c)：第 r 行网格线上、列 c 与 c+1 角点之间；
  // 垂直边 V(c,r)：第 c 列网格线上、行 r 与 r+1 角点之间。
  // 最高位区分命名空间，行列各占 14 位。
  const H = (r: number, c: number): number => (0 << 29) | (r << 14) | c;
  const V = (c: number, r: number): number => (1 << 29) | (c << 14) | r;

  // ID → 网格坐标点（浮点 col/row）
  const nodePt = new Map<number, Pt>();
  const interp = (v0: number, v1: number, p0: Pt, p1: Pt): Pt => {
    const t = (threshold - v0) / Math.max(1e-9, v1 - v0);
    const tt = Math.max(0, Math.min(1, t));
    return { x: p0.x + (p1.x - p0.x) * tt, y: p0.y + (p1.y - p0.y) * tt };
  };
  // 上边 = 水平边 H(r, c)
  const topId = (c: number, r: number): number => {
    const id = H(r, c);
    if (!nodePt.has(id)) {
      nodePt.set(id, interp(val(c, r), val(c + 1, r), { x: c, y: r }, { x: c + 1, y: r }));
    }
    return id;
  };
  // 右边 = 垂直边 V(c+1, r)
  const rightId = (c: number, r: number): number => {
    const id = V(c + 1, r);
    if (!nodePt.has(id)) {
      nodePt.set(id, interp(val(c + 1, r), val(c + 1, r + 1), { x: c + 1, y: r }, { x: c + 1, y: r + 1 }));
    }
    return id;
  };
  // 下边 = 水平边 H(r+1, c)
  const bottomId = (c: number, r: number): number => {
    const id = H(r + 1, c);
    if (!nodePt.has(id)) {
      nodePt.set(id, interp(val(c, r + 1), val(c + 1, r + 1), { x: c, y: r + 1 }, { x: c + 1, y: r + 1 }));
    }
    return id;
  };
  // 左边 = 垂直边 V(c, r)
  const leftId = (c: number, r: number): number => {
    const id = V(c, r);
    if (!nodePt.has(id)) {
      nodePt.set(id, interp(val(c, r), val(c, r + 1), { x: c, y: r }, { x: c, y: r + 1 }));
    }
    return id;
  };

  // 邻接表（ID → ID 列表）
  const adj = new Map<number, number[]>();
  const link = (a: number, c: number): void => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(c)) adj.set(c, []);
    adj.get(a)!.push(c);
    adj.get(c)!.push(a);
  };

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = val(c, r);
      const tr = val(c + 1, r);
      const br = val(c + 1, r + 1);
      const bl = val(c, r + 1);
      let caseIndex = 0;
      if (tl >= threshold) caseIndex |= 8;
      if (tr >= threshold) caseIndex |= 4;
      if (br >= threshold) caseIndex |= 2;
      if (bl >= threshold) caseIndex |= 1;
      if (caseIndex === 0 || caseIndex === 15) continue;

      const top = () => topId(c, r);
      const right = () => rightId(c, r);
      const bottom = () => bottomId(c, r);
      const left = () => leftId(c, r);

      switch (caseIndex) {
        case 1: link(left(), bottom()); break;
        case 2: link(bottom(), right()); break;
        case 3: link(left(), right()); break;
        case 4: link(top(), right()); break;
        case 5: link(top(), left()); link(bottom(), right()); break;
        case 6: link(top(), bottom()); break;
        case 7: link(top(), left()); break;
        case 8: link(top(), left()); break;
        case 9: link(top(), bottom()); break;
        case 10: link(top(), right()); link(left(), bottom()); break;
        case 11: link(top(), right()); break;
        case 12: link(left(), right()); break;
        case 13: link(bottom(), right()); break;
        case 14: link(left(), bottom()); break;
      }
    }
  }

  // 沿邻接表追踪闭合环（基于整数 ID，无对象引用问题）
  const rings: Pt[][] = [];
  const visited = new Set<number>();
  for (const startId of adj.keys()) {
    if (visited.has(startId)) continue;
    const ringIds: number[] = [];
    let prev = -1;
    let cur = startId;
    while (!visited.has(cur)) {
      visited.add(cur);
      ringIds.push(cur);
      const nexts = adj.get(cur)!;
      const next = nexts.find((id) => id !== prev) ?? nexts[0];
      prev = cur;
      cur = next;
      if (cur === startId || cur === undefined) break;
    }
    if (ringIds.length >= 3) {
      rings.push(ringIds.map((id) => nodePt.get(id)!));
    }
  }

  // 网格坐标 → 世界坐标（米）
  return rings.map((ring) =>
    ring.map((p) => ({
      x: origin.x + p.x * cellSize,
      y: origin.y + p.y * cellSize,
    })),
  );
}

export interface ExtractOptions {
  threshold: number;
  minFragmentArea: number;
  simplifyTolerance: number;
}

/** 完整提取：marching squares + 碎片剔除 + 抽稀，返回候选环（世界坐标，米） */
export function extractContours(b: BurnIndexResult, opts: ExtractOptions): Pt[][] {
  const raw = marchingSquares(b, opts.threshold);
  const out: Pt[][] = [];
  for (const ring of raw) {
    const worldArea = ringArea(ring);
    if (worldArea < opts.minFragmentArea) continue;
    const simplified = simplifyRing(ring, opts.simplifyTolerance);
    if (ringArea(simplified) >= opts.minFragmentArea && simplified.length >= 3) {
      out.push(simplified);
    }
  }
  return out.sort((a, c) => ringArea(c) - ringArea(a));
}
