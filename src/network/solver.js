/**
 * 火炬管网水力求解器
 *
 * 物理模型（相对阻力标定，用于流向/流速/充满度可视化）：
 *  - 管段：Δp = R·Q·|Q|，R = k·f·(L/D)·ρ/(2A²)（达西-魏斯巴赫，Pa/(m³/s)²）
 *  - 水封罐：按 0.45 倍水柱静压对应设计流量标定通气阻力，用于判断是否越过水封高度
 *  - 排放源按分流比注入泄放支管，火炬头为定压 0 Pa
 *  - 节点法：F(h) = ΣQ(h) - b = 0，牛顿迭代 + 稠密 Cholesky 解线性化系统
 *
 * 性能：先把“串联管段”压缩为超边（串联流量相同，R 相加是精确的），
 * 200 段管网压缩后通常只剩几十个节点，牛顿步在 0.1 ms 量级，
 * 整网重算可在一帧内完成；结果再展开回每一段原始管段。
 */

import {
  GAS_DENSITY,
  WATER_DENSITY,
  GRAVITY,
  designCapacity,
  pipeArea,
  velocityOf,
  fillPercentOf,
  flowTierIndex,
} from './constants.js';

const FRICTION = 0.03;
const PIPE_SCALE = 95; // 全局阻力标定系数，使总管压降落在 kPa 量级
const SEAL_LOAD = 0.45; // 设计流量下水封压差 / 水柱静压
const MAX_NEWTON = 30;

/** 预处理静态拓扑（与工况无关） */
export function buildModel(config) {
  const nodes = config.nodes;
  const idx = new Map();
  const keyIdx = new Map();
  nodes.forEach((n, i) => {
    idx.set(n.id, i);
    if (n.key) keyIdx.set(n.key, i);
  });
  const resolve = (idOrKey) => {
    const i = idx.get(idOrKey);
    return i !== undefined ? i : keyIdx.get(idOrKey);
  };

  const segments = config.segments.map((s) => {
    const fromIdx = resolve(s.from);
    const toIdx = resolve(s.to);
    if (fromIdx === undefined || toIdx === undefined) {
      throw new Error(`管段 ${s.id} 端点不存在`);
    }
    const area = pipeArea(s.dn);
    const dM = s.dn / 1000;
    const Rpipe =
      PIPE_SCALE *
      (s.k || 1) *
      FRICTION *
      (Math.max(s.length, 1) / dM) *
      GAS_DENSITY /
      (2 * area * area);
    return {
      ...s,
      fromIdx,
      toIdx,
      area,
      Rpipe,
      capacity: designCapacity(s.dn),
      fromNode: nodes[fromIdx],
      toNode: nodes[toIdx],
    };
  });

  // 水封罐 → 筒体管段
  const seals = [];
  for (const e of config.equipment) {
    if (e.type !== 'waterseal') continue;
    const sealNodeIdx = resolve(e.nodeKey);
    const seg = segments.find(
      (s) => s.kind === 'vessel' && (s.fromIdx === sealNodeIdx || s.toIdx === sealNodeIdx),
    );
    if (!seg) {
      console.warn('水封罐缺少筒体管段', e.id);
      continue;
    }
    const qRef = Math.max(e.designFlow || 0, 200) / 3600; // m³/s
    // 通气阻力按设计流量下的固定压降标定（0.45 倍标定水柱），
    // 与实际水封高度解耦，这样调整水封高度只改变“是否越过水封”的判据。
    const headPa = (e.sealHeightMm / 1000) * WATER_DENSITY * GRAVITY;
    const Rseal = (SEAL_LOAD * headPa) / (qRef * qRef);
    seg.Rseal = Rseal;
    seg.isSeal = true;
    seg.sealId = e.id;
    seg.sealHeadPa = headPa;
    seals.push({ equipment: e, segId: seg.id, qRef, Rseal });
  }

  const flareTopIdx = [];
  for (const e of config.equipment) {
    if (e.type === 'flare') {
      const i = resolve(e.nodeKey);
      if (i !== undefined) flareTopIdx.push(i);
    }
  }
  if (flareTopIdx.length === 0) {
    nodes.forEach((n, i) => {
      if (n.kind === 'flarebase') flareTopIdx.push(i);
    });
  }
  const flareSet = new Set(flareTopIdx);

  const adj = nodes.map(() => []);
  segments.forEach((s, si) => {
    adj[s.fromIdx].push({ si, other: s.toIdx, dir: 1 });
    adj[s.toIdx].push({ si, other: s.fromIdx, dir: -1 });
  });

  const sourceInjection = config.sources.map((src) => {
    const points = [];
    if (Array.isArray(src.subNodeKeys) && src.subNodeKeys.length) {
      const split = src.split || [0.5, 0.5];
      src.subNodeKeys.forEach((k, i) => {
        const ni = resolve(k);
        if (ni !== undefined) points.push({ nodeIdx: ni, ratio: split[i] ?? 1 / src.subNodeKeys.length });
      });
    }
    if (points.length === 0) {
      const ni = resolve(src.nodeKey);
      if (ni !== undefined) points.push({ nodeIdx: ni, ratio: 1 });
    }
    return { id: src.id, points };
  });

  return {
    config,
    nodes,
    idx,
    keyIdx,
    resolve,
    segments,
    adj,
    flareTopIdx,
    flareSet,
    seals,
    equipmentById: new Map(config.equipment.map((e) => [e.id, e])),
    branchIds: [...new Set(config.segments.map((s) => s.branchId))],
    n: nodes.length,
    sourceInjection,
    sourceById: new Map(config.sources.map((s) => [s.id, s])),
    segIndexById: new Map(segments.map((s, i) => [s.id, i])),
  };
}

/** 工况关闭规则匹配 */
export function isSegmentClosed(seg, closedList) {
  if (!closedList || closedList.length === 0) return false;
  for (const rule of closedList) {
    if (!rule) continue;
    if (rule === 'all') return true;
    if (rule.startsWith('branch:')) {
      if (seg.branchId === rule.slice(7)) return true;
    } else if (rule.startsWith('line:')) {
      const parts = rule.split(':');
      const srcId = parts[1];
      const lineName = parts.slice(2).join(':');
      if (seg.branchId === srcId && seg.line === lineName) return true;
    } else if (rule.startsWith('seg:')) {
      if (seg.id === rule.slice(4)) return true;
    } else if (seg.branchId === rule) {
      return true;
    }
  }
  return false;
}

function segResistance(seg, branchK) {
  if (seg.isSeal) return seg.Rseal;
  const mult = branchK ? branchK[seg.branchId] ?? 1 : 1;
  return seg.Rpipe * (mult > 0 ? mult : 1);
}

/* ────────────────────────── 串联压缩 ────────────────────────── */

/**
 * 把度为 2 的节点压缩成超边。串联管段流量相同，R 相加是精确的，
 * 因此压缩不引入任何近似，只是把未知量从 ~190 降到几十个。
 */
function buildReducedGraph(model, R, active, b, fixed, strandedComps, comp) {
  const { segments, n } = model;
  const ns = segments.length;
  const activeAdj = Array.from({ length: n }, () => []);
  const alive = new Uint8Array(ns);
  for (let i = 0; i < ns; i++) {
    if (!active[i]) continue;
    if (strandedComps[comp[segments[i].fromIdx]]) continue;
    if (strandedComps[comp[segments[i].toIdx]]) continue;
    alive[i] = 1;
    activeAdj[segments[i].fromIdx].push(i);
    activeAdj[segments[i].toIdx].push(i);
  }

  const locked = new Uint8Array(n);
  for (const fi of model.flareTopIdx) locked[fi] = 1;
  for (const s of model.seals) {
    const si = model.segIndexById.get(s.segId);
    if (si === undefined) continue;
    locked[segments[si].fromIdx] = 1;
    locked[segments[si].toIdx] = 1;
  }
  for (let i = 0; i < n; i++) {
    if (b[i] !== 0) locked[i] = 1;
    if (alive[0] !== undefined && activeAdj[i].length !== 2) locked[i] = 1;
  }

  const isJunction = (v) => locked[v] || activeAdj[v].length !== 2;

  const used = new Uint8Array(ns);
  const redNodes = []; // 原始节点索引
  const redIndexOf = new Int32Array(n).fill(-1);
  const redEdges = [];

  function ensureRed(v) {
    if (redIndexOf[v] === -1) {
      redIndexOf[v] = redNodes.length;
      redNodes.push(v);
    }
    return redIndexOf[v];
  }

  // 先登记所有 junction 节点
  for (let v = 0; v < n; v++) if (isJunction(v) && activeAdj[v].length > 0) ensureRed(v);

  for (let v = 0; v < n; v++) {
    if (!isJunction(v)) continue;
    for (const si of activeAdj[v]) {
      if (used[si]) continue;
      used[si] = 1;
      const members = [];
      let Rsum = R[si];
      let cur = segments[si].fromIdx === v ? segments[si].toIdx : segments[si].fromIdx;
      const sign0 = segments[si].fromIdx === v ? 1 : -1;
      members.push({ si, sign: sign0 });
      let prev = si;
      let guard = 0;
      while (!isJunction(cur) && guard++ < ns) {
        const list = activeAdj[cur];
        let nextSi = -1;
        for (const cand of list) if (cand !== prev) nextSi = cand;
        if (nextSi < 0) break;
        const sg = segments[nextSi];
        const movingFrom = sg.fromIdx === cur ? sg.fromIdx : sg.toIdx;
        const movingTo = sg.fromIdx === cur ? sg.toIdx : sg.fromIdx;
        const sign = sg.fromIdx === movingFrom && sg.toIdx === movingTo ? 1 : -1;
        used[nextSi] = 1;
        members.push({ si: nextSi, sign });
        Rsum += R[nextSi];
        cur = movingTo;
        prev = nextSi;
      }
      redEdges.push({ a: ensureRed(v), b: ensureRed(cur), R: Rsum, members });
    }
  }

  // 纯度为 2 的闭环（无 junction）单独处理
  for (let si = 0; si < ns; si++) {
    if (!alive[si] || used[si]) continue;
    const s = segments[si];
    used[si] = 1;
    const members = [{ si, sign: 1 }];
    let Rsum = R[si];
    let cur = s.toIdx;
    let prev = si;
    let guard = 0;
    while (cur !== s.fromIdx && guard++ < ns) {
      const list = activeAdj[cur];
      let nextSi = -1;
      for (const cand of list) if (cand !== prev) nextSi = cand;
      if (nextSi < 0) break;
      const sg = segments[nextSi];
      const sign = sg.fromIdx === cur ? 1 : -1;
      used[nextSi] = 1;
      members.push({ si: nextSi, sign });
      Rsum += R[nextSi];
      cur = sg.fromIdx === cur ? sg.toIdx : sg.fromIdx;
      prev = nextSi;
    }
    redEdges.push({ a: ensureRed(s.fromIdx), b: ensureRed(cur), R: Rsum, members });
  }

  const m = redNodes.length;
  const redDeg = new Int32Array(m);
  for (const e of redEdges) {
    redDeg[e.a]++;
    redDeg[e.b]++;
  }
  const redFixed = new Uint8Array(m);
  const redB = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    redB[i] = b[redNodes[i]];
    if (fixed[redNodes[i]]) redFixed[i] = 1;
  }

  return { redNodes, redIndexOf, redEdges, redFixed, redB, m };
}

/* ────────────────────────── 稠密 Cholesky ────────────────────────── */

function choleskySolve(A, x, rhs, m) {
  // A: m×m 行主序，就地分解
  for (let i = 0; i < m; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * m + j];
      for (let k = 0; k < j; k++) sum -= A[i * m + k] * A[j * m + k];
      if (i === j) {
        A[i * m + j] = Math.sqrt(Math.max(sum, 1e-300));
      } else {
        A[i * m + j] = sum / A[j * m + j];
      }
    }
  }
  for (let i = 0; i < m; i++) {
    let sum = rhs[i];
    for (let k = 0; k < i; k++) sum -= A[i * m + k] * x[k];
    x[i] = sum / A[i * m + i];
  }
  for (let i = m - 1; i >= 0; i--) {
    let sum = x[i];
    for (let k = i + 1; k < m; k++) sum -= A[k * m + i] * x[k];
    x[i] = sum / A[i * m + i];
  }
}

/* ────────────────────────── 求解主入口 ────────────────────────── */

/**
 * @param {ReturnType<typeof buildModel>} model
 * @param {{flows?:Record<string,number>, closed?:string[], branchK?:Record<string,number>, warmStart?:Float64Array}} opts
 */
export function solveNetwork(model, opts = {}) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { segments, adj, n } = model;
  const { flows = {}, closed = [], branchK = {} } = opts;
  const ns = segments.length;

  const R = new Float64Array(ns);
  const active = new Uint8Array(ns);
  for (let i = 0; i < ns; i++) {
    const s = segments[i];
    R[i] = segResistance(s, branchK);
    active[i] = isSegmentClosed(s, closed) ? 0 : 1;
  }

  const b = new Float64Array(n);
  for (const src of model.sourceInjection) {
    const v = (Number(flows[src.id]) || 0) / 3600;
    if (!v) continue;
    for (const p of src.points) b[p.nodeIdx] += v * p.ratio;
  }
  const totalInjection = Math.max(
    Object.values(flows).reduce((a, v) => a + Math.abs(Number(v) || 0), 0) / 3600,
    1e-9,
  );

  const fixed = new Uint8Array(n);
  for (const fi of model.flareTopIdx) fixed[fi] = 1;

  // 连通分量：识别“有注入但无火炬头出口”的憋压段
  const comp = new Int32Array(n).fill(-1);
  const compHasFixed = [];
  let compCount = 0;
  const stack = [];
  for (let start = 0; start < n; start++) {
    if (comp[start] !== -1) continue;
    comp[start] = compCount;
    stack.length = 0;
    stack.push(start);
    let hasFixed = false;
    while (stack.length) {
      const u = stack.pop();
      if (fixed[u]) hasFixed = true;
      for (const e of adj[u]) {
        if (!active[e.si]) continue;
        const v = e.other;
        if (comp[v] === -1) {
          comp[v] = compCount;
          stack.push(v);
        }
      }
    }
    compHasFixed.push(hasFixed);
    compCount++;
  }
  const strandedComps = new Uint8Array(compCount);
  let strandedCount = 0;
  for (let c = 0; c < compCount; c++) {
    if (compHasFixed[c]) continue;
    for (let i = 0; i < n; i++) {
      if (comp[i] === c && Math.abs(b[i]) > 1e-12) {
        strandedComps[c] = 1;
        strandedCount++;
        break;
      }
    }
  }

  const red = buildReducedGraph(model, R, active, b, fixed, strandedComps, comp);
  const { redNodes, redEdges, redFixed, redB, m } = red;

  const head = new Float64Array(n);
  const redHead = new Float64Array(m);
  if (opts.warmStart && opts.warmStart.length === n) {
    for (let i = 0; i < m; i++) redHead[i] = opts.warmStart[redNodes[i]];
  }
  for (let i = 0; i < m; i++) if (redFixed[i]) redHead[i] = 0;

  const A = new Float64Array(m * m);
  const rhs = new Float64Array(m);
  const dx = new Float64Array(m);

  // 初始压力：以“线性阻力”近似解一次，作为牛顿法的起点
  {
    A.fill(0);
    rhs.fill(0);
    const qRef = Math.max(totalInjection / Math.max(4, redEdges.length / 6), 1e-5);
    for (const e of redEdges) {
      const w = 1 / (e.R * qRef);
      if (!redFixed[e.a]) A[e.a * m + e.a] += w;
      if (!redFixed[e.b]) A[e.b * m + e.b] += w;
      if (!redFixed[e.a] && !redFixed[e.b]) {
        A[e.a * m + e.b] -= w;
        A[e.b * m + e.a] -= w;
      }
    }
    for (let i = 0; i < m; i++) {
      if (redFixed[i]) { A[i * m + i] = 1; rhs[i] = 0; }
      else rhs[i] = redB[i];
    }
    const sol = new Float64Array(m);
    choleskySolve(A, sol, rhs, m);
    for (let i = 0; i < m; i++) if (!redFixed[i]) redHead[i] = sol[i];
  }

  // 流量 / 残差评估
  const redQ = new Float64Array(redEdges.length);
  const F = new Float64Array(m);
  const weights = new Float64Array(redEdges.length);
  const EPS = 1e-6;

  function evalRed() {
    F.fill(0);
    for (let i = 0; i < m; i++) F[i] = -redB[i];
    for (let e = 0; e < redEdges.length; e++) {
      const edge = redEdges[e];
      const dh = redHead[edge.a] - redHead[edge.b];
      const z = Math.abs(dh);
      const q = dh / Math.sqrt(edge.R * (z + EPS));
      redQ[e] = q;
      F[edge.a] += q;
      F[edge.b] -= q;
      weights[e] = (0.5 * z + EPS) / (Math.sqrt(edge.R) * Math.pow(z + EPS, 1.5));
    }
    let maxRes = 0;
    for (let i = 0; i < m; i++) {
      if (redFixed[i]) continue;
      const v = Math.abs(F[i]);
      if (v > maxRes) maxRes = v;
    }
    return maxRes;
  }

  function buildSolve() {
    A.fill(0);
    rhs.fill(0);
    for (let k = 0; k < redEdges.length; k++) {
      const e = redEdges[k];
      const w = weights[k];
      if (!redFixed[e.a]) { A[e.a * m + e.a] += w; }
      if (!redFixed[e.b]) { A[e.b * m + e.b] += w; }
      if (!redFixed[e.a] && !redFixed[e.b]) {
        A[e.a * m + e.b] -= w;
        A[e.b * m + e.a] -= w;
      }
    }
    for (let i = 0; i < m; i++) {
      if (redFixed[i]) { A[i * m + i] = 1; rhs[i] = 0; }
      else rhs[i] = -F[i];
    }
    dx.fill(0);
    choleskySolve(A, dx, rhs, m);
  }

  const targetTol = Math.max(totalInjection * 1e-8, 1e-13);
  let residual = evalRed();
  let outer = 0;
  for (; outer < MAX_NEWTON; outer++) {
    if (residual < targetTol) break;
    buildSolve();
    let maxStep = 0;
    for (let i = 0; i < m; i++) maxStep = Math.max(maxStep, Math.abs(dx[i]));
    if (!(maxStep > 1e-12)) break;
    // 回溯线搜索
    let step = 1;
    let accepted = false;
    const before = redHead.slice();
    for (let trial = 0; trial < 12; trial++) {
      for (let i = 0; i < m; i++) if (!redFixed[i]) redHead[i] = before[i] + step * dx[i];
      const tr = evalRed();
      if (tr < residual || (tr < targetTol)) {
        residual = tr;
        accepted = true;
        break;
      }
      step *= 0.35;
      if (step < 1e-4) break;
    }
    if (!accepted) {
      for (let i = 0; i < m; i++) redHead[i] = before[i];
      evalRed();
      break;
    }
  }

  // 展开：节点压力与每段流量
  for (let i = 0; i < m; i++) head[redNodes[i]] = redHead[i];
  const q = new Float64Array(ns);
  for (let k = 0; k < redEdges.length; k++) {
    const e = redEdges[k];
    const Q = redQ[k];
    for (const mb of e.members) q[mb.si] = mb.sign * Q;
  }

  // 串联链上中间节点的压力
  for (let k = 0; k < redEdges.length; k++) {
    const e = redEdges[k];
    if (e.members.length < 2) continue;
    const Q = redQ[k];
    let cur = redNodes[e.a];
    const hQ = Q * Math.abs(Q);
    for (const mb of e.members) {
      const seg = segments[mb.si];
      const next = seg.fromIdx === cur ? seg.toIdx : seg.fromIdx;
      head[next] = head[cur] - mb.sign * R[mb.si] * hQ;
      cur = next;
    }
  }

  const segResults = new Array(ns);
  let maxPressure = 0;
  let totalToFlare = 0;
  for (let i = 0; i < ns; i++) {
    const s = segments[i];
    const flowM3h = q[i] * 3600;
    const vel = velocityOf(flowM3h, s.dn);
    const fill = fillPercentOf(flowM3h, s.dn);
    const dp = Math.abs(head[s.fromIdx] - head[s.toIdx]);
    const isActive = !!active[i];
    const stranded = isActive && strandedComps[comp[s.fromIdx]];
    segResults[i] = {
      id: s.id,
      flow: isActive && !stranded ? flowM3h : 0,
      velocity: isActive && !stranded ? vel : 0,
      fill: isActive && !stranded ? fill : 0,
      tier: flowTierIndex(isActive && !stranded ? fill : 0),
      active: isActive,
      connected: isActive && !stranded,
      stranded,
      pressureDrop: dp,
      absFlow: isActive && !stranded ? Math.abs(flowM3h) : 0,
    };
    maxPressure = Math.max(maxPressure, Math.abs(head[s.fromIdx]), Math.abs(head[s.toIdx]));
    if (model.flareSet.has(s.toIdx)) totalToFlare += Math.abs(q[i]);
  }

  const sealResults = model.seals.map(({ equipment, segId }) => {
    const si = model.segIndexById.get(segId);
    const seg = segments[si];
    const qs = Math.abs(q[si] || 0);
    const dp = qs * qs * R[si];
    // 水封高度可在运行时修改，超限比按当前高度实时计算
    const headPa = (equipment.sealHeightMm / 1000) * WATER_DENSITY * GRAVITY;
    const ratio = headPa > 0 ? dp / headPa : 0;
    const isActive = !!active[si];
    const stranded = isActive && strandedComps[comp[seg.fromIdx]];
    return {
      id: equipment.id,
      name: equipment.name,
      segId,
      sealHeightMm: equipment.sealHeightMm,
      designFlow: equipment.designFlow,
      differentialPa: dp,
      ratio,
      exceeded: ratio > 1,
      flow: qs * 3600,
      levelMm: Math.min(equipment.sealHeightMm * 1.75, ratio * equipment.sealHeightMm),
      pressurePa: Math.max(0, head[seg.fromIdx]),
      stranded,
      active: isActive,
    };
  });

  const maxRes = residual;
  const converged = maxRes < Math.max(totalInjection * 1e-5, 1e-9);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  const nodePressures = new Array(n);
  for (let i = 0; i < n; i++) {
    nodePressures[i] = {
      id: model.nodes[i].id,
      key: model.nodes[i].key,
      pressure: head[i],
      stranded: !!strandedComps[comp[i]],
    };
  }

  return {
    segResults,
    segById: Object.fromEntries(segResults.map((rr) => [rr.id, rr])),
    nodePressures,
    head,
    seals: sealResults,
    iterations: outer,
    residual: maxRes,
    converged,
    solveMs: t1 - t0,
    maxPressure,
    totalToFlare,
    strandedCount,
    reducedNodes: m,
    active,
    closed,
  };
}

/** 支路汇总 */
export function branchSummary(model, solveResult) {
  const map = new Map();
  for (const seg of model.segments) {
    const id = seg.branchId;
    if (!map.has(id)) {
      map.set(id, { id, flow: 0, maxFill: 0, maxVel: 0, count: 0, closedCount: 0, dn: 0, totalLen: 0 });
    }
    const b = map.get(id);
    const r = solveResult.segById[seg.id];
    b.count++;
    b.flow = Math.max(b.flow, r.absFlow);
    b.maxFill = Math.max(b.maxFill, r.fill);
    b.maxVel = Math.max(b.maxVel, r.velocity);
    b.dn = Math.max(b.dn, seg.dn);
    b.totalLen += seg.length;
    if (!r.active) b.closedCount++;
  }
  for (const b of map.values()) b.active = b.closedCount < b.count;
  return map;
}

/** 沿流动方向 BFS 到火炬头 */
export function findFlowPath(model, solveResult, startNodeIdx, opts = {}) {
  const { segments, adj, nodes } = model;
  const minFlow = opts.minFlow ?? 0.2;
  const directed = opts.directed !== false;
  const prev = new Int32Array(nodes.length).fill(-1);
  const prevSeg = new Int32Array(nodes.length).fill(-1);
  const seen = new Uint8Array(nodes.length);
  const queue = [startNodeIdx];
  seen[startNodeIdx] = 1;
  let found = -1;
  while (queue.length) {
    const u = queue.shift();
    if (model.flareSet.has(u)) { found = u; break; }
    for (const e of adj[u]) {
      const seg = segments[e.si];
      const r = solveResult.segById[seg.id];
      if (!r.active) continue;
      if (directed) {
        if (r.absFlow < minFlow) continue;
        const dir = r.flow >= 0 ? 1 : -1;
        if (dir !== e.dir) continue;
      }
      const v = e.other;
      if (seen[v]) continue;
      seen[v] = 1;
      prev[v] = u;
      prevSeg[v] = e.si;
      queue.push(v);
    }
  }
  if (found < 0) return null;
  const path = [];
  let cur = found;
  while (cur !== startNodeIdx) {
    const si = prevSeg[cur];
    if (si < 0) return null;
    path.push(segments[si].id);
    cur = prev[cur];
  }
  path.reverse();
  return { segIds: path, endNodeIdx: found };
}

/** 从某管段出发，沿主流方向到火炬头的完整路径 */
export function pathForSegment(model, solveResult, segId, opts = {}) {
  const seg = model.segments.find((s) => s.id === segId);
  if (!seg) return null;
  const r = solveResult.segById[segId];
  const forward = r.flow >= 0;
  const start = forward ? seg.fromIdx : seg.toIdx;
  const p = findFlowPath(model, solveResult, start, opts);
  if (!p) return { segIds: [segId], endNodeIdx: -1 };
  if (!p.segIds.includes(segId)) p.segIds.unshift(segId);
  return p;
}
