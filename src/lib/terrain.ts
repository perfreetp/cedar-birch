import { densifyRing } from './geometry';
import type { Pt, RasterImage } from '../types';

/**
 * 地形采样器：基于 DEM 栅格做双线性高程插值与中心差分坡度计算。
 * 影像平面坐标：x = origin.x + col * pixelSize，y = origin.y + row * pixelSize（y 向下）。
 */
export class TerrainSampler {
  constructor(private readonly dem: RasterImage) {}

  get width(): number {
    return this.dem.width;
  }

  get height(): number {
    return this.dem.height;
  }

  get pixelSize(): number {
    return this.dem.pixelSize;
  }

  get origin(): Pt {
    return this.dem.origin;
  }

  get verticalScale(): number {
    return this.dem.verticalScale;
  }

  private toPixel(p: Pt): { c: number; r: number } {
    return {
      c: (p.x - this.dem.origin.x) / this.dem.pixelSize,
      r: (p.y - this.dem.origin.y) / this.dem.pixelSize,
    };
  }

  private rawAt(col: number, row: number): number {
    const c = Math.max(0, Math.min(this.dem.width - 1, Math.round(col)));
    const r = Math.max(0, Math.min(this.dem.height - 1, Math.round(row)));
    const v = this.dem.dem![r * this.dem.width + c];
    return isFinite(v) ? v : 0;
  }

  /** 双线性插值高程（米，未乘垂直倍率） */
  elevationAt(p: Pt): number {
    const { c, r } = this.toPixel(p);
    const c0 = Math.floor(c);
    const r0 = Math.floor(r);
    const c1 = c0 + 1;
    const r1 = r0 + 1;
    const tx = c - c0;
    const ty = r - r0;
    const h00 = this.rawAt(c0, r0);
    const h10 = this.rawAt(c1, r0);
    const h01 = this.rawAt(c0, r1);
    const h11 = this.rawAt(c1, r1);
    const h0 = h00 * (1 - tx) + h10 * tx;
    const h1 = h01 * (1 - tx) + h11 * tx;
    return h0 * (1 - ty) + h1 * ty;
  }

  /**
   * 坡度（弧度）：中心差分法。
   * dz/dx 与 dz/dy 均为“高程差 / 水平距离”，坡度 = atan(sqrt(dzdx² + dzdy²))。
   */
  slopeAt(p: Pt): number {
    const step = Math.max(1, this.dem.pixelSize);
    const hl = this.elevationAt({ x: p.x - step, y: p.y });
    const hr = this.elevationAt({ x: p.x + step, y: p.y });
    const hu = this.elevationAt({ x: p.x, y: p.y - step });
    const hd = this.elevationAt({ x: p.x, y: p.y + step });
    const dzdx = (hr - hl) / (2 * step);
    const dzdy = (hd - hu) / (2 * step);
    return Math.atan(Math.hypot(dzdx, dzdy));
  }

  /** 世界平面点投影到地形表面，z 已乘垂直倍率（three.js 渲染用） */
  project(p: Pt): { x: number; y: number; z: number; elevation: number; slope: number } {
    const elevation = this.elevationAt(p);
    const slope = this.slopeAt(p);
    return { x: p.x, y: p.y, z: elevation * this.dem.verticalScale, elevation, slope };
  }

  /** 按坡度加密环（2D 世界坐标） */
  densify(ring: Pt[], maxSpacing: number): Pt[] {
    return densifyRing(ring, maxSpacing, (p) => this.slopeAt(p));
  }

  /** 平均坡度（度），对环内规则采样点求均值 */
  meanSlopeInside(inside: (p: Pt) => boolean, bounds: { minX: number; minY: number; maxX: number; maxY: number }): number {
    const stepPx = 8;
    const step = stepPx * this.dem.pixelSize;
    let sum = 0;
    let count = 0;
    for (let y = bounds.minY; y <= bounds.maxY; y += step) {
      for (let x = bounds.minX; x <= bounds.maxX; x += step) {
        const p = { x, y };
        if (inside(p)) {
          sum += this.slopeAt(p);
          count++;
        }
      }
    }
    return count ? (sum / count) * 180 / Math.PI : 0;
  }
}

/** 无 DEM 时的平面采样器：高程与坡度恒为 0 */
export class FlatSampler {
  elevationAt(_p: Pt): number {
    return 0;
  }

  slopeAt(_p: Pt): number {
    return 0;
  }

  project(p: Pt) {
    return { x: p.x, y: p.y, z: 0, elevation: 0, slope: 0 };
  }

  densify(ring: Pt[], maxSpacing: number): Pt[] {
    return densifyRing(ring, maxSpacing);
  }

  meanSlopeInside(): number {
    return 0;
  }
}

export type Sampler = TerrainSampler | FlatSampler;
