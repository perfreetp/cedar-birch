// 二维多边形工具: 凸多边形偏置(熔合边界)、Sutherland-Hodgman 裁剪、面积、圆离散
export interface Pt {
  x: number;
  y: number;
}

export function circlePolygon(cx: number, cy: number, r: number, segments = 72): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) * 0.5;
}

function lineIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x;
  const d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/**
 * 凸多边形等距偏置。poly 须为逆时针(CCW),d > 0 向外扩张。
 * 做法: 每条边沿外法线平移 d,相邻偏移线求交。
 */
export function offsetConvex(poly: Pt[], d: number): Pt[] {
  const n = poly.length;
  if (n < 3 || d === 0) return poly.map((p) => ({ ...p }));
  const lines: { nx: number; ny: number; c: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // CCW 多边形内部在边的左侧,外法线 = 右法线
    const nx = ey / len;
    const ny = -ex / len;
    lines.push({ nx, ny, c: nx * a.x + ny * a.y + d });
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = lines[(i - 1 + n) % n];
    const cur = lines[i];
    const denom = prev.nx * cur.ny - prev.ny * cur.nx;
    if (Math.abs(denom) < 1e-9) {
      // 平行边: 沿当前边外法线平移顶点
      out.push({ x: poly[i].x + cur.nx * d, y: poly[i].y + cur.ny * d });
    } else {
      out.push({
        x: (prev.c * cur.ny - cur.c * prev.ny) / denom,
        y: (prev.nx * cur.c - cur.nx * prev.c) / denom,
      });
    }
  }
  return out;
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Sutherland-Hodgman: 用 CCW 凸裁剪多边形裁 subject(任意凸多边形),返回 CCW 结果 */
export function clipConvex(subject: Pt[], clipPoly: Pt[]): Pt[] {
  let output = subject.slice();
  const n = clipPoly.length;
  for (let i = 0; i < n; i++) {
    if (output.length === 0) break;
    const a = clipPoly[i];
    const b = clipPoly[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      const curInside = cross(ex, ey, cur.x - a.x, cur.y - a.y) >= -1e-9;
      const prevInside = cross(ex, ey, prev.x - a.x, prev.y - a.y) >= -1e-9;
      if (curInside) {
        if (!prevInside) {
          const hit = lineIntersect(prev, cur, a, b);
          if (hit) output.push(hit);
        }
        output.push(cur);
      } else if (prevInside) {
        const hit = lineIntersect(prev, cur, a, b);
        if (hit) output.push(hit);
      }
    }
  }
  return output;
}
