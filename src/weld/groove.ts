// 坡口与基板几何定义。x 横向、y 竖直(板厚方向),所有 y 以板底为 0。
// 坡口凹槽多边形按顺时针(CW)给出,配合基板外形 CCW 形成带孔挤出。
import { Pt, offsetConvex } from './polygon2d';
import { GrooveConfig } from '../types';

export interface GrooveGeometry {
  /** 名义坡口内壁轮廓(凹槽),CW */
  nominal: Pt[];
  /** 带熔深余量的熔合边界轮廓(外扩),CW */
  fusion: Pt[];
  /** 基板外轮廓,CCW */
  plateOutline: Pt[];
  /** 盖面金属底部轮廓(= 坡口顶部开口线段),CCW */
  capPoly: Pt[];
  /** 坡口在高度 y 处的名义半宽(用于层宽估计),越界返回 null */
  halfWidthAt: (y: number) => number | null;
}

const ARC_SEGMENTS = 14;

function vGroove(cfg: GrooveConfig): Pt[] {
  const { thickness: T, topWidth, rootGap, rootLand } = cfg;
  const halfTop = topWidth / 2;
  const halfRoot = rootGap / 2;
  const yTop = T;
  const yShoulder = T - rootLand;
  // CW: 左上顶口 -> 左下根部 -> 钝边底左 -> 钝边底右 -> 右上
  return [
    { x: -halfTop, y: yTop },
    { x: -halfRoot, y: yShoulder },
    { x: -halfRoot, y: 0 },
    { x: halfRoot, y: 0 },
    { x: halfRoot, y: yShoulder },
    { x: halfTop, y: yTop },
  ];
}

function uGroove(cfg: GrooveConfig): Pt[] {
  const { thickness: T, topWidth, rootGap, rootLand, uRadius: R } = cfg;
  const halfTop = topWidth / 2;
  const halfRoot = rootGap / 2;
  const yShoulder = T - rootLand;
  const arc: Pt[] = [];
  // 底部半圆弧: 从左根点 (-halfRoot, yShoulder) 经板底到右根点
  const arcTop = yShoulder;
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const theta = Math.PI - (i / ARC_SEGMENTS) * Math.PI; // PI -> 0
    arc.push({
      x: halfRoot + R * Math.cos(theta), // i=0 -> halfRoot-R = -halfRoot
      y: arcTop + R * Math.sin(theta) - R, // 最低点 y = arcTop-R
    });
  }
  const left: Pt[] = [{ x: -halfTop, y: T }];
  if (yShoulder < T - 1e-9) left.push({ x: -halfRoot, y: yShoulder });
  const right: Pt[] = [{ x: halfRoot, y: yShoulder }, { x: halfTop, y: T }];
  return [...left, ...arc, ...right];
}

/** 反转绕向: 轮廓工具内部统一使用 CCW */
function reverse(poly: Pt[]): Pt[] {
  return poly.slice().reverse();
}

export function buildGrooveGeometry(cfg: GrooveConfig, penetration: number): GrooveGeometry {
  const nominalCW = cfg.type === 'V' ? vGroove(cfg) : uGroove(cfg);
  const nominal = reverse(nominalCW); // CCW
  const fusionCCW = (() => {
    const expanded = offsetConvex(nominal, penetration);
    // 熔深不能越过板底
    const floorY = 0;
    return expanded.map((p) => (p.y < floorY ? { x: p.x, y: floorY } : p));
  })();
  const fusion = reverse(fusionCCW); // CW,供 Shape 孔洞使用

  const { plateWidth, thickness: T, topWidth } = cfg;
  const halfPlate = plateWidth / 2;
  const overhang = Math.max(4, topWidth * 0.15);
  const halfCap = topWidth / 2 + overhang;
  const capHeight = Math.max(3, T * 0.08);
  // 基板外轮廓 CCW,孔 = 名义坡口 CW
  const plateOutline: Pt[] = [
    { x: -halfPlate, y: 0 },
    { x: halfPlate, y: 0 },
    { x: halfPlate, y: T },
    { x: halfCap, y: T },
    { x: -halfCap, y: T },
  ];

  const capPoly: Pt[] = [
    { x: -halfCap, y: T },
    { x: halfCap, y: T },
    { x: halfCap, y: T + capHeight },
    { x: -halfCap, y: T + capHeight },
  ];

  const halfWidthAt = (y: number): number | null => {
    if (y < 0 || y > T) return null;
    let best = Infinity;
    for (let i = 0; i < nominalCW.length; i++) {
      const a = nominalCW[i];
      const b = nominalCW[(i + 1) % nominalCW.length];
      const ymin = Math.min(a.y, b.y);
      const ymax = Math.max(a.y, b.y);
      if (y < ymin - 1e-9 || y > ymax + 1e-9) continue;
      if (Math.abs(b.y - a.y) < 1e-9) {
        best = Math.min(best, Math.abs(a.x), Math.abs(b.x));
        continue;
      }
      const t = (y - a.y) / (b.y - a.y);
      const x = a.x + t * (b.x - a.x);
      best = Math.min(best, Math.abs(x));
    }
    return Number.isFinite(best) ? best : null;
  };

  return {
    nominal: nominalCW,
    fusion,
    plateOutline,
    capPoly,
    halfWidthAt,
  };
}
