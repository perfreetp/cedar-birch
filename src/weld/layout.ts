// 多层多道焊道排布: 层优先自根部向上堆叠,每层道数按当前层高处坡口宽度自适应
import { GrooveConfig, WeldConfig, Bead, LayoutResult } from '../types';
import { Pt, circlePolygon, clipConvex, polygonArea, offsetConvex } from './polygon2d';
import { buildGrooveGeometry } from './groove';

function linspace(lo: number, hi: number, n: number): number[] {
  if (n === 1) return [(lo + hi) / 2];
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * (i / (n - 1)));
  return out;
}

/** 稳定的伪随机数(由施焊顺序播种),保证重排结果可复现 */
export function seededRand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function layoutBeads(grooveCfg: GrooveConfig, weld: WeldConfig): LayoutResult {
  const { thickness: T, rootGap } = grooveCfg;
  const penetration = weld.penetrationRatio; // 相对焊道直径的熔深比
  const geom = buildGrooveGeometry(grooveCfg, 0); // 取名义轮廓与宽度函数

  const N = Math.max(1, Math.round(weld.layerCount));
  const h = T / N; // 名义层厚
  const D = h * weld.layerOverlap; // 填充/盖面焊道名义直径
  const r = D / 2;
  // 打底焊道: 直径略大于根部间隙,保证根部熔透
  const rootDiameter = Math.min(D * 1.25, rootGap * 1.2 + 2);
  const rootR = rootDiameter / 2;

  const beads: Bead[] = [];
  const passesPerLayer: number[] = [];
  let order = 0;

  for (let layer = 0; layer < N; layer++) {
    const isRoot = layer === 0;
    const isCap = layer === N - 1;
    const beadR = isRoot ? rootR : r;
    const beadD = beadR * 2;
    const p = penetration * beadD; // 该层熔深绝对值

    // 该层中心高度
    let cy: number;
    if (isRoot) {
      cy = Math.max(h * 0.5, rootR);
    } else if (isCap && N > 1) {
      cy = T - r * 0.85; // 盖面略高出坡口,与盖面金属衔接
    } else {
      cy = h * (layer + 0.5);
    }
    cy = Math.min(cy, T - beadR * 0.35);

    // 该层高处的名义/熔合宽度
    const halfNominal = geom.halfWidthAt(Math.min(cy, T)) ?? beadR;
    // 用该层焊道的熔深重建熔合边界半宽: 名义半宽 + 水平方向熔深余量
    const halfFusion = halfNominal + p;
    const widthFusion = halfFusion * 2;

    // 道数
    let passes: number;
    if (isRoot) {
      passes = 1;
    } else if (weld.passMode === 'fixed') {
      const maxFit = Math.max(1, Math.floor((widthFusion + beadD * 0.2) / (beadD * 0.55)));
      passes = Math.min(weld.fixedPasses, maxFit);
    } else {
      passes = Math.max(1, Math.round(widthFusion / (beadD * weld.passOverlap)));
    }
    passesPerLayer.push(passes);

    // 道心横向位置: 边缘焊道与熔合壁相切
    const span = Math.max(0, widthFusion - beadD);
    const xs = linspace(-span / 2, span / 2, passes);

    // 该层专属熔合边界(按本层熔深偏置名义坡口)
    const fusionCCW: Pt[] = offsetConvex(geom.nominal.slice().reverse(), p);

    for (let pass = 0; pass < passes; pass++) {
      const cx = xs[pass];
      const circle = circlePolygon(cx, cy, beadR, 64);
      const clipped = clipConvex(circle, fusionCCW);
      const fusionArea = clipped.length >= 3 ? polygonArea(clipped) : Math.PI * beadR * beadR;
      beads.push({
        id: `L${String(layer + 1).padStart(2, '0')}-P${String(pass + 1).padStart(2, '0')}`,
        order: order++,
        layer,
        pass,
        cx,
        cy,
        r: beadR,
        nominalArea: Math.PI * beadR * beadR,
        fusionArea,
        penetrationDepth: p * (isRoot ? 1.2 : 1),
      });
    }
  }

  return {
    beads,
    passesPerLayer,
    beadDiameter: D,
    layerHeight: h,
    rootRadius: rootR,
  };
}

function hslToRgb(h: number, s: number, l: number): number {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (
    (Math.round(f(0) * 255) << 16) |
    (Math.round(f(8) * 255) << 8) |
    Math.round(f(4) * 255)
  );
}

/** 层颜色: 冷色(打底) -> 暖色(盖面)的 HSL 渐变,层间清晰区分 */
export function layerColor(layer: number, layerCount: number): number {
  const t = layerCount <= 1 ? 0 : layer / (layerCount - 1);
  return hslToRgb(210 - t * 210, 0.62, 0.55); // 210 蓝青 -> 0 红
}
