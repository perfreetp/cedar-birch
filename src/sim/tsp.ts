// TSP 启发式：最近邻构造初始解 + 2-opt 改进
interface XY {
  x: number;
  z: number;
}

/**
 * 求访问 pts 的近似最短巡回顺序（从 start 出发并返回 start）。
 * 返回 pts 下标的排列。
 */
export function tspOrder(pts: XY[], start: XY): number[] {
  const n = pts.length;
  if (n <= 2) return pts.map((_, i) => i);

  // 距离矩阵（含出发点，下标 0 = 场站）
  const m = n + 1;
  const D = new Float64Array(m * m);
  const dxz = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 0; i < n; i++) {
    D[0 * m + (i + 1)] = D[(i + 1) * m + 0] = dxz(start, pts[i]);
    for (let j = i + 1; j < n; j++) {
      const d = dxz(pts[i], pts[j]);
      D[(i + 1) * m + (j + 1)] = D[(j + 1) * m + (i + 1)] = d;
    }
  }

  // 最近邻
  const used = new Array<boolean>(m).fill(false);
  used[0] = true;
  const tour: number[] = [0];
  let cur = 0;
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bd = Infinity;
    for (let j = 1; j < m; j++) {
      if (used[j]) continue;
      const d = D[cur * m + j];
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    used[best] = true;
    tour.push(best);
    cur = best;
  }

  // 2-opt（tour[0] 固定为场站，隐含返回场站）
  const dOf = (u: number, v: number) => D[u * m + v];
  let improved = true;
  let passes = 0;
  while (improved && passes < 10) {
    improved = false;
    passes++;
    for (let i = 1; i < m - 1; i++) {
      const a = tour[i - 1];
      const b = tour[i];
      const dab = dOf(a, b);
      for (let j = i + 1; j < m; j++) {
        const c = tour[j];
        const e = j + 1 < m ? tour[j + 1] : 0; // 末尾回到场站
        const delta = dOf(a, c) + dOf(b, e) - dab - dOf(c, e);
        if (delta < -1e-9) {
          // 反转 tour[i..j]
          let lo = i;
          let hi = j;
          while (lo < hi) {
            const tmp = tour[lo];
            tour[lo] = tour[hi];
            tour[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }

  return tour.slice(1).map((v) => v - 1);
}
