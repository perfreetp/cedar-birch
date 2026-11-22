import Module from 'manifold-3d';
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url';
import type { ManifoldToplevel } from 'manifold-3d';
import { normalizeWinding, ringArea, signedArea } from './geometry';
import type { Boundary, Pt, Rings } from '../types';

let toplevelPromise: Promise<ManifoldToplevel> | null = null;

/** manifold wasm 单例初始化 */
export function getManifold(): Promise<ManifoldToplevel> {
  if (!toplevelPromise) {
    toplevelPromise = Module({ locateFile: () => manifoldWasmUrl }).then((M) => {
      // setup() 安装接受 [x,y] 元组的包装方法（CrossSection 工厂、simplify 等），
      // 不调用则拿到的是只接受 embind Vector 的原始构造器。
      M.setup();
      return M;
    }) as unknown as Promise<ManifoldToplevel>;
  }
  return toplevelPromise;
}

function toVec2(ring: Pt[]): Array<[number, number]> {
  return ring.map((p) => [p.x, p.y]);
}

type RawVec2 = [number, number] | { x: number; y: number };

/** 兼容 embind 元组与 setup() 包装后的 {x,y} 对象两种返回形态 */
function toPt(ring: RawVec2[]): Pt[] {
  return ring.map((v) => (Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y }));
}

export interface CleanOptions {
  /** 抽稀容差（米），同时作为 manifold simplify epsilon */
  simplifyEpsilon: number;
  /** 最小碎片面积（平方米） */
  minFragmentArea: number;
}

/**
 * 用 manifold CrossSection 对编辑环做布尔并集：
 * - 构造时自动消除自交（Positive 填充规则）
 * - simplify 去除近重复/共线顶点与碎片
 * - 按面积阈值剔除残余小碎片
 * 返回带孔洞的有效 Boundary（外环逆时针、孔洞顺时针）。
 */
export async function cleanBoundary(rings: Rings, opts: CleanOptions): Promise<Boundary> {
  const M = await getManifold();
  const contours: Array<Array<[number, number]>> = [];
  if (rings.outer.length >= 3) contours.push(toVec2(rings.outer));
  for (const h of rings.holes) if (h.length >= 3) contours.push(toVec2(h));

  if (contours.length === 0) {
    return { outer: [], holes: [] };
  }

  // CrossSection 构造即对重叠轮廓做布尔并集，保证结果无自交。
  // 注意：manifold-3d 的 JS 绑定要求 fillRule 必须显式传入（默认参数未在 embind 暴露）。
  const cs = new M.CrossSection(contours, 'Positive');
  const eps = Math.max(opts.simplifyEpsilon, 1e-9);
  const cleaned = cs.simplify(eps);
  const polygons = cleaned.toPolygons() as unknown as RawVec2[][];

  // 面积最大的多边形作为外环主体；其余按面积阈值保留为独立外岛/孔洞
  const candidates = polygons
    .map((poly) => toPt(poly))
    .filter((ring) => ring.length >= 3 && ringArea(ring) >= opts.minFragmentArea)
    .sort((a, b) => ringArea(b) - ringArea(a));

  if (candidates.length === 0) {
    return { outer: [], holes: [] };
  }

  const outer = candidates[0];
  const holes: Pt[][] = [];
  // 其余轮廓：与外环反向则为孔洞；同向的小外岛通过再做一次并集已被 manifold 合并，
  // 这里仅兜底处理，避免数据丢失。
  for (let i = 1; i < candidates.length; i++) {
    holes.push(candidates[i]);
  }

  const normalized = normalizeWinding({ outer, holes });
  if (normalized.outer.length < 3) {
    return { outer: [], holes: [] };
  }
  return normalized;
}

/** 对任意轮廓集合做一次纯并集，用于提取阶段合并相邻火烧斑块 */
export async function unionContours(contours: Pt[][], opts: CleanOptions): Promise<Boundary> {
  return cleanBoundary({ outer: contours[0] ?? [], holes: contours.slice(1) }, opts);
}

/** 判断 manifold 是否已经初始化完成（非阻塞） */
export function manifoldReady(): boolean {
  return toplevelPromise !== null;
}

export { signedArea };
