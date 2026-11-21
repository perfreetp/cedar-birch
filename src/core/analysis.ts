import { DEPTH_THRESHOLD } from '../types'

/** 计算每帧淹没面积(m²)与全场最大水深 */
export function computeStats(frames: Float32Array[], cellSize: number): { areas: number[]; maxDepth: number } {
  const cellArea = cellSize * cellSize
  const areas: number[] = new Array(frames.length)
  let maxDepth = 0
  for (let t = 0; t < frames.length; t++) {
    const f = frames[t]
    let n = 0
    for (let i = 0; i < f.length; i++) {
      const d = f[i]
      if (d >= DEPTH_THRESHOLD) n++
      if (d > maxDepth) maxDepth = d
    }
    areas[t] = n * cellArea
  }
  return { areas, maxDepth }
}

/** 到达时间栅格:每格首次水深超过阈值的物理时间(秒),未淹没为 -1 */
export function computeArrivalTime(frames: Float32Array[], times: number[]): Float32Array {
  const n = frames[0].length
  const arrival = new Float32Array(n).fill(-1)
  for (let t = 0; t < frames.length; t++) {
    const f = frames[t]
    for (let i = 0; i < n; i++) {
      if (arrival[i] < 0 && f[i] >= DEPTH_THRESHOLD) arrival[i] = times[t]
    }
  }
  return arrival
}

/**
 * Marching Squares 提取淹没范围边界(阈值 DEPTH_THRESHOLD),
 * 返回闭合环(地理坐标),每个环为 [x,y][]。
 */
export function extractExtentRings(frame: Float32Array, width: number, height: number, originX: number, originY: number, cellSize: number, threshold = DEPTH_THRESHOLD): number[][][] {
  // 单元格(i,j)覆盖行 j..j+1、列 i..i+1 的节点;节点值为像元中心值。
  // 域外节点视为干(0),使触及计算域边界的淹没区也能闭合成环。
  const val = (c: number, r: number): number => {
    if (c < 0 || c >= width || r < 0 || r >= height) return 0
    const v = frame[r * width + c]
    return Number.isFinite(v) ? v : 0
  }
  const gx = (c: number) => originX + (c + 0.5) * cellSize
  const gy = (r: number) => originY - (r + 0.5) * cellSize

  // 边表:key = `${x},${y}` 节点;边用 "x1,y1|x2,y2"(小者在前)唯一标识
  type P = [number, number]
  const edges = new Map<string, [P, P]>()
  const addEdge = (a: P, b: P) => {
    const ka = `${a[0].toFixed(3)},${a[1].toFixed(3)}`
    const kb = `${b[0].toFixed(3)},${b[1].toFixed(3)}`
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    if (edges.has(key)) edges.delete(key) // 内部边出现两次,抵消
    else edges.set(key, [a, b])
  }
  const lerp = (p1: P, v1: number, p2: P, v2: number): P => {
    const t = (threshold - v1) / (v2 - v1 || 1e-9)
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]
  }

  for (let r = -1; r < height; r++) {
    for (let c = -1; c < width; c++) {
      const v = [val(c, r), val(c + 1, r), val(c + 1, r + 1), val(c, r + 1)] // TL TR BR BL
      let idx = 0
      for (let k = 0; k < 4; k++) if (v[k] >= threshold) idx |= 1 << k
      if (idx === 0 || idx === 15) continue
      const p: P[] = [
        [gx(c), gy(r)],
        [gx(c + 1), gy(r)],
        [gx(c + 1), gy(r + 1)],
        [gx(c), gy(r + 1)],
      ]
      // 各边中点插值点: 0=上 1=右 2=下 3=左
      const top = () => lerp(p[0], v[0], p[1], v[1])
      const right = () => lerp(p[1], v[1], p[2], v[2])
      const bottom = () => lerp(p[3], v[3], p[2], v[2])
      const left = () => lerp(p[0], v[0], p[3], v[3])
      const seg = (a: P, b: P) => addEdge(a, b)
      switch (idx) {
        case 1: case 14: seg(left(), top()); break
        case 2: case 13: seg(top(), right()); break
        case 3: case 12: seg(left(), right()); break
        case 4: case 11: seg(right(), bottom()); break
        case 5: seg(left(), top()); seg(right(), bottom()); break
        case 6: case 9: seg(top(), bottom()); break
        case 7: case 8: seg(left(), bottom()); break
        case 10: seg(top(), right()); seg(left(), bottom()); break
      }
    }
  }

  // 将散边连接成闭合环
  const rings: number[][][] = []
  const adj = new Map<string, P[]>()
  const keyOf = (p: P) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`
  for (const [a, b] of edges.values()) {
    const ka = keyOf(a)
    const kb = keyOf(b)
    if (!adj.has(ka)) adj.set(ka, [])
    if (!adj.has(kb)) adj.set(kb, [])
    adj.get(ka)!.push(b)
    adj.get(kb)!.push(a)
  }
  const visited = new Set<string>()
  for (const startKey of adj.keys()) {
    if (visited.has(startKey)) continue
    const ring: number[][] = []
    let curKey = startKey
    let prevKey: string | null = null
    const parse = (k: string): P => k.split(',').map(Number) as P
    while (true) {
      visited.add(curKey)
      const [x, y] = parse(curKey)
      ring.push([x, y])
      const next = (adj.get(curKey) ?? []).map(keyOf).find((k) => k !== prevKey && !visited.has(k))
      if (!next) break
      prevKey = curKey
      curKey = next
      if (curKey === startKey) break
    }
    if (ring.length >= 4) {
      ring.push(ring[0])
      rings.push(ring)
    }
  }
  return rings
}

/** 环面积(用于挑选外环,单位与坐标一致) */
export function ringArea(ring: number[][]): number {
  let a = 0
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  return a / 2
}
