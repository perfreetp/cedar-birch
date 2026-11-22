/**
 * 生成炼化火炬管网配置：节点坐标、管段（约 200 段）、设备、三种工况的默认参数。
 * 运行：npm run gen
 * 输出：src/data/network.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../src/data/network.json');

const Y = 6; // 管廊/集合管标高 m
const H1Z = -22;
const H2Z = 22;

const nodes = [];
const nodeMap = new Map();
const segments = [];
const equipment = [];
const sources = [];

let nodeSeq = 0;
let segSeq = 0;

function addNode(key, name, kind, pos, extra = {}) {
  if (nodeMap.has(key)) {
    throw new Error('重复节点 ' + key);
  }
  const n = {
    id: `N${String(++nodeSeq).padStart(3, '0')}`,
    key,
    name,
    kind,
    pos: pos.map((v) => Math.round(v * 100) / 100),
    ...extra,
  };
  nodes.push(n);
  nodeMap.set(key, n);
  return n;
}

function node(key) {
  const n = nodeMap.get(key);
  if (!n) throw new Error('缺少节点 ' + key);
  return n;
}

function roundDn(dn) {
  const list = [150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200];
  let best = list[0];
  let bestDiff = Infinity;
  for (const v of list) {
    const d = Math.abs(v - dn);
    if (d < bestDiff) {
      bestDiff = d;
      best = v;
    }
  }
  return best;
}

function addSeg(fromKey, toKey, dn, opts = {}) {
  const a = node(fromKey);
  const b = node(toKey);
  const dx = b.pos[0] - a.pos[0];
  const dy = b.pos[1] - a.pos[1];
  const dz = b.pos[2] - a.pos[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const seg = {
    id: `P${String(++segSeq).padStart(3, '0')}`,
    name: opts.name || `管段 ${segSeq}`,
    from: a.id,
    to: b.id,
    dn: roundDn(dn),
    length: Math.round(len * 10) / 10,
    k: opts.k ?? 1.0,
    branchId: opts.branchId || 'MAIN',
    line: opts.line || 'main',
    kind: opts.kind || 'pipe',
  };
  segments.push(seg);
  return seg;
}

/** 折线路径；中间节点自动创建 */
function route(prefix, points, dn, opts = {}) {
  let prevKey = opts.startKey;
  if (!prevKey) throw new Error('route 需要 startKey');
  const out = [];
  let idx = 0;
  for (const p of points) {
    const key = `${prefix}#${++idx}`;
    addNode(key, `${opts.branchLabel || prefix} 转角${idx}`, opts.nodeKind || 'elbow', p);
    out.push(addSeg(prevKey, key, dn, { ...opts, name: `${opts.branchLabel || prefix} 管段${idx}` }));
    prevKey = key;
  }
  return out;
}

// ── 集合管 ───────────────────────────────────────────────
function buildHeader(tag, z, sourceXs, dnFn) {
  const xs = [];
  for (let x = -104; x <= 64; x += 12) xs.push(x);
  xs.push(70);
  for (const sx of sourceXs) if (!xs.includes(sx)) xs.push(sx);
  xs.sort((a, b) => a - b);
  xs.forEach((x) => {
    if (!nodeMap.has(`${tag}@${x}`)) {
      addNode(`${tag}@${x}`, `${tag} 集合管节点 ${x}m`, 'header', [x, Y, z]);
    }
  });
  for (let i = 0; i < xs.length - 1; i++) {
    const x = xs[i];
    addSeg(`${tag}@${x}`, `${tag}@${xs[i + 1]}`, dnFn(x), {
      name: `${tag === 'H1' ? '1#' : '2#'} 火炬总管 ${x}m→${xs[i + 1]}m`,
      branchId: tag,
      kind: 'main',
      k: 1.05,
    });
  }
  return xs;
}

const SOURCE_DEFS = [
  { id: 'S1', name: '常减压装置', short: '常减压', en: 'CDU', header: 'H1', x: -92, dn: 500, flows: { normal: 1800, emergency: 7200, maintenance: 0 }, split: 0.55, designFactor: 1.9 },
  { id: 'S2', name: '催化裂化装置', short: '催化裂化', en: 'FCC', header: 'H1', x: -68, dn: 600, flows: { normal: 2600, emergency: 9500, maintenance: 1600 }, split: 0.6, designFactor: 1.25 },
  { id: 'S3', name: '加氢裂化装置', short: '加氢裂化', en: 'HCU', header: 'H1', x: -44, dn: 500, flows: { normal: 1500, emergency: 6000, maintenance: 0 }, split: 0.5, designFactor: 2.2 },
  { id: 'S4', name: '延迟焦化装置', short: '延迟焦化', en: 'DCU', header: 'H1', x: -20, dn: 450, flows: { normal: 1200, emergency: 5200, maintenance: 0 }, split: 0.55, designFactor: 1.6 },
  { id: 'S5', name: '连续重整装置', short: '连续重整', en: 'CCR', header: 'H1', x: 4, dn: 400, flows: { normal: 900, emergency: 3800, maintenance: 700 }, split: 0.5, designFactor: 2.4 },
  { id: 'S6', name: '罐区', short: '罐区', en: 'TANK', header: 'H1', x: 28, dn: 350, flows: { normal: 500, emergency: 2400, maintenance: 350 }, split: 0.6, designFactor: 3.2 },
  { id: 'S7', name: '乙烯裂解装置', short: '乙烯裂解', en: 'ETHY', header: 'H2', x: -80, dn: 600, flows: { normal: 2400, emergency: 9000, maintenance: 2200 }, split: 0.55, designFactor: 1.3 },
  { id: 'S8', name: '硫磺回收装置', short: '硫磺回收', en: 'SRU', header: 'H2', x: -56, dn: 350, flows: { normal: 600, emergency: 2200, maintenance: 400 }, split: 0.5, designFactor: 2.9 },
  { id: 'S9', name: '芳烃联合装置', short: '芳烃联合', en: 'AROM', header: 'H2', x: -32, dn: 450, flows: { normal: 1300, emergency: 5000, maintenance: 1100 }, split: 0.55, designFactor: 1.7 },
  { id: 'S10', name: '气体分馏装置', short: '气体分馏', en: 'GFU', header: 'H2', x: -8, dn: 400, flows: { normal: 800, emergency: 3200, maintenance: 600 }, split: 0.6, designFactor: 2.1 },
  { id: 'S11', name: '污水处理场', short: '污水处理', en: 'WWTP', header: 'H2', x: 16, dn: 300, flows: { normal: 300, emergency: 1100, maintenance: 250 }, split: 0.5, designFactor: 4.0 },
  { id: 'S12', name: '火炬气回收单元', short: '气回收', en: 'FGR', header: 'H2', x: 40, dn: 500, flows: { normal: 1400, emergency: 4600, maintenance: 1200 }, split: 0.55, designFactor: 1.5 },
];

const h1Ties = SOURCE_DEFS.filter((s) => s.header === 'H1').map((s) => s.x);
const h2Ties = SOURCE_DEFS.filter((s) => s.header === 'H2').map((s) => s.x);

buildHeader('H1', H1Z, h1Ties, (x) => (x < -56 ? 600 : x < 0 ? 900 : 1000));
buildHeader('H2', H2Z, h2Ties, (x) => (x < -68 ? 500 : x < -8 ? 800 : 1000));

// ── 各装置排放支路 ──────────────────────────────────────
for (const s of SOURCE_DEFS) {
  const sign = s.header === 'H1' ? -1 : 1;
  const z = (v) => v * sign;
  const x = s.x;
  const tieKey = `${s.header}@${x}`;
  const k = `S.${s.id}`;
  addNode(`${k}.SUB1`, `${s.name} · 低压泄放`, 'subsource', [x - 8, 3, z(84)]);
  addNode(`${k}.SUB2`, `${s.name} · 高压泄放`, 'subsource', [x + 8, 3, z(84)]);
  addNode(`${k}.MAN`, `${s.name} 集气总管`, 'source', [x, 3, z(78)], { sourceId: s.id });
  addNode(`${k}.RISER`, `${s.name} 立管顶`, 'elbow', [x, Y, z(78)]);
  addNode(`${k}.SPLIT`, `${s.name} 支路三通`, 'split', [x, Y, z(70)]);
  addNode(`${k}.A1`, `${s.name} 支路A转角`, 'elbow', [x - 5, Y, z(58)]);
  addNode(`${k}.B1`, `${s.name} 支路B转角`, 'elbow', [x + 5, Y, z(58)]);
  addNode(`${k}.MERGE`, `${s.name} 支路汇合`, 'merge', [x, Y, z(40)]);
  addNode(`${k}.WSIN`, `${s.name} 水封罐入口`, 'waterseal', [x, Y, z(36)]);
  addNode(`${k}.WSOUT`, `${s.name} 水封罐出口`, 'waterseal', [x, Y, z(32)]);

  const dnA = s.dn - 100;
  const dn = s.dn;

  addSeg(`${k}.SUB1`, `${k}.MAN`, dnA, { name: `${s.name} 泄放支管 1`, branchId: s.id, line: 'in', kind: 'sub', k: 1.25 });
  addSeg(`${k}.SUB2`, `${k}.MAN`, dnA, { name: `${s.name} 泄放支管 2`, branchId: s.id, line: 'in', kind: 'sub', k: 1.25 });
  addSeg(`${k}.MAN`, `${k}.RISER`, dn, { name: `${s.name} 集气立管`, branchId: s.id, line: 'in', kind: 'riser', k: 1.45 });
  addSeg(`${k}.RISER`, `${k}.SPLIT`, dn, { name: `${s.name} 支管总管`, branchId: s.id, line: 'in', kind: 'branch', k: 1.1 });
  addSeg(`${k}.SPLIT`, `${k}.A1`, dnA, { name: `${s.name} 支路A 1`, branchId: s.id, line: 'A', kind: 'branch', k: 1.15 });
  addSeg(`${k}.A1`, `${k}.MERGE`, dnA, { name: `${s.name} 支路A 2`, branchId: s.id, line: 'A', kind: 'branch', k: 1.15 });
  addSeg(`${k}.SPLIT`, `${k}.B1`, dn, { name: `${s.name} 支路B 1`, branchId: s.id, line: 'B', kind: 'branch', k: 1.15 });
  addSeg(`${k}.B1`, `${k}.MERGE`, dn, { name: `${s.name} 支路B 2`, branchId: s.id, line: 'B', kind: 'branch', k: 1.15 });
  addSeg(`${k}.MERGE`, `${k}.WSIN`, dn, { name: `${s.name} 水封入口管`, branchId: s.id, line: 'main', kind: 'branch', k: 1.3 });
  addSeg(`${k}.WSIN`, `${k}.WSOUT`, dn, { name: `${s.name} 水封罐筒体`, branchId: s.id, line: 'vessel', kind: 'vessel', k: 2.4 });
  addSeg(`${k}.WSOUT`, tieKey, dn, { name: `${s.name} 水封出口管`, branchId: s.id, line: 'out', kind: 'branch', k: 1.6 });

  equipment.push({
    id: `WS-${s.id}`,
    type: 'waterseal',
    name: `${s.id} 水封罐`,
    overview: `${s.name} 支管水封，防止回火与串气。`,
    nodeKey: `${k}.WSIN`,
    pos: [x, 3.6, z(34)],
    dn,
    radius: 1.5,
    height: 7.2,
    sealHeightMm: 1200,
    designFlow: Math.round(s.flows.normal * (s.designFactor ?? 1.35)),
  });

  equipment.push({
    id: s.id,
    type: 'source',
    name: `${s.id} ${s.name}`,
    overview: `装置泄放气经水封罐并入 ${s.header === 'H1' ? '1#' : '2#'} 火炬总管。`,
    nodeKey: `${k}.MAN`,
    pos: [x, 3, z(78)],
    dn: s.dn,
    subNodes: [`${k}.SUB1`, `${k}.SUB2`],
    split: [s.split, 1 - s.split],
  });

  sources.push({
    id: s.id,
    name: s.name,
    shortName: s.short,
    en: s.en,
    header: s.header,
    nodeKey: `${k}.MAN`,
    subNodeKeys: [`${k}.SUB1`, `${k}.SUB2`],
    split: [s.split, 1 - s.split],
    tieNodeKey: tieKey,
    dn: s.dn,
    defaultFlows: s.flows,
  });
}

// ── 火炬端：分液罐、水封、立管、火炬头 ─────────────────
addNode('T1', '1#/2# 总管分流三通', 'split', [70, Y, H1Z]);
addNode('T2', '2# 总管末端三通', 'split', [70, Y, H2Z]);
addSeg('H1@70', 'T1', 1000, { name: '1# 总管末端立管', branchId: 'H1', kind: 'main', k: 1.3 });
addSeg('H2@70', 'T2', 1000, { name: '2# 总管末端立管', branchId: 'H2', kind: 'main', k: 1.3 });
addNode('KO1.IN', '1# 分液罐入口', 'header', [94, Y, -6]);
addNode('KO1.OUT', '1# 分液罐出口', 'header', [106, Y, -6]);
addNode('KO2.IN', '2# 分液罐入口', 'header', [94, Y, 26]);
addNode('KO2.OUT', '2# 分液罐出口', 'header', [106, Y, 26]);
addNode('M1', '总管汇合点', 'merge', [114, Y, 4]);
addNode('WSM.IN', '主水封罐入口', 'waterseal', [114, Y, 4]);
addNode('WSM.OUT', '主水封罐出口', 'waterseal', [122, Y, 4]);
addNode('T3', '火炬立管分流三通', 'split', [130, Y, 4]);
addNode('F1.BASE', '1# 火炬立管底部', 'flarebase', [150, Y, -20]);
addNode('F2.BASE', '2# 火炬立管底部', 'flarebase', [150, Y, 40]);

route('KO1', [[78, Y, -22], [84, Y, -19], [90, Y, -12]], 900, {
  startKey: 'T1',
  branchId: 'MAIN',
  branchLabel: '1# 火炬总管东段',
  kind: 'trunk',
  k: 1.1,
});
// 上一条 route 的末端接到分液罐入口
// route 会创建 KO1#1..#3，最后一段需要 KO1#3 → KO1.IN
addSeg('KO1#3', 'KO1.IN', 900, { name: '1# 分液罐入口管', branchId: 'MAIN', kind: 'trunk', k: 1.6 });
addSeg('KO1.IN', 'KO1.OUT', 900, { name: '1# 分液罐筒体', branchId: 'MAIN', kind: 'vessel', k: 2.2 });

route('XO', [[78, Y, 8], [86, Y, 18]], 700, {
  startKey: 'T1',
  branchId: 'XO',
  branchLabel: '1#→2# 跨线',
  kind: 'crossover',
  k: 1.35,
});
addSeg('XO#2', 'KO2.IN', 700, { name: '跨线至 2# 分液罐', branchId: 'XO', kind: 'crossover', k: 1.35 });

route('H2E', [[82, Y, H2Z], [88, Y, 24]], 1000, {
  startKey: 'T2',
  branchId: 'H2',
  branchLabel: '2# 总管东段',
  kind: 'main',
  k: 1.15,
});
addSeg('H2E#2', 'KO2.IN', 1000, { name: '2# 分液罐入口管', branchId: 'H2', kind: 'trunk', k: 1.6 });
addSeg('KO2.IN', 'KO2.OUT', 1000, { name: '2# 分液罐筒体', branchId: 'H2', kind: 'vessel', k: 2.2 });

route('M1A', [[110, Y, -2]], 900, {
  startKey: 'KO1.OUT',
  branchId: 'MAIN',
  branchLabel: '1# 分液罐出口管',
  kind: 'trunk',
  k: 1.4,
});
addSeg('M1A#1', 'M1', 900, { name: '1# 分液罐出口管 2', branchId: 'MAIN', kind: 'trunk', k: 1.4 });
route('M1B', [[110, Y, 16]], 1000, {
  startKey: 'KO2.OUT',
  branchId: 'H2',
  branchLabel: '2# 分液罐出口管',
  kind: 'trunk',
  k: 1.4,
});
addSeg('M1B#1', 'M1', 1000, { name: '2# 分液罐出口管 2', branchId: 'H2', kind: 'trunk', k: 1.4 });

addSeg('M1', 'WSM.IN', 1200, { name: '主水封入口管', branchId: 'MAIN', kind: 'trunk', k: 1.3 });
addSeg('WSM.IN', 'WSM.OUT', 1200, { name: '主水封罐筒体', branchId: 'MAIN', kind: 'vessel', k: 2.6 });
addSeg('WSM.OUT', 'T3', 1200, { name: '主水封出口管', branchId: 'MAIN', kind: 'trunk', k: 1.2 });

route('R1', [[136, Y, 0], [142, Y, -6], [147, Y, -14]], 1200, {
  startKey: 'T3',
  branchId: 'R1',
  branchLabel: '1# 火炬立管底管',
  kind: 'riser',
  k: 1.2,
});
addSeg('R1#3', 'F1.BASE', 1200, { name: '1# 火炬立管底管 4', branchId: 'R1', kind: 'riser', k: 1.2 });

const f1Ys = [20, 34, 48, 62, 76, 90];
let prev = 'F1.BASE';
f1Ys.forEach((y, i) => {
  const key = `F1.Y${y}`;
  addNode(key, `1# 火炬立管 ${y}m`, 'flarebody', [150, y, -20]);
  addSeg(prev, key, 1200, { name: `1# 火炬立管 ${y}m`, branchId: 'R1', kind: 'riser', k: 1.0 });
  prev = key;
});

route('R2', [[136, Y, 12], [144, Y, 26], [149, Y, 36]], 1000, {
  startKey: 'T3',
  branchId: 'R2',
  branchLabel: '2# 火炬立管底管',
  kind: 'riser',
  k: 1.2,
});
addSeg('R2#3', 'F2.BASE', 1000, { name: '2# 火炬立管底管 4', branchId: 'R2', kind: 'riser', k: 1.2 });

const f2Ys = [18, 30, 42, 54, 66];
prev = 'F2.BASE';
f2Ys.forEach((y) => {
  const key = `F2.Y${y}`;
  addNode(key, `2# 火炬立管 ${y}m`, 'flarebody', [150, y, 40]);
  addSeg(prev, key, 1000, { name: `2# 火炬立管 ${y}m`, branchId: 'R2', kind: 'riser', k: 1.0 });
  prev = key;
});

equipment.push({
  id: 'KO-1',
  type: 'knockout',
  name: '1# 分液罐',
  overview: '卧式分液罐，脱除火炬气中的凝液后再进入主水封。',
  nodeKey: 'KO1.IN',
  pos: [100, 4.6, -6],
  dn: 900,
  radius: 2.8,
  length: 12,
});
equipment.push({
  id: 'KO-2',
  type: 'knockout',
  name: '2# 分液罐',
  overview: '2# 系统卧式分液罐，事故工况与跨线来气均经此脱液。',
  nodeKey: 'KO2.IN',
  pos: [100, 4.6, 26],
  dn: 1000,
  radius: 2.8,
  length: 12,
});
equipment.push({
  id: 'WS-MAIN',
  type: 'waterseal',
  name: '主水封罐',
  overview: '全厂火炬总管的最终水封，防止回火至管网。',
  nodeKey: 'WSM.IN',
  pos: [118, 3.75, 4],
  dn: 1200,
  radius: 2.0,
  height: 7.8,
  sealHeightMm: 1500,
  designFlow: Math.round(SOURCE_DEFS.reduce((a, s) => a + s.flows.normal, 0) * 1.15),
});
equipment.push({
  id: 'F1',
  type: 'flare',
  name: '1# 火炬',
  overview: '主火炬，高 90 m，正常与事故工况投用。',
  nodeKey: 'F1.Y90',
  pos: [150, 90, -20],
  base: [150, 0, -20],
  height: 90,
  dn: 1200,
});
equipment.push({
  id: 'F2',
  type: 'flare',
  name: '2# 火炬',
  overview: '辅助火炬，高 66 m，事故工况与 1# 火炬并行，检修时单独承担排放。',
  nodeKey: 'F2.Y66',
  pos: [150, 66, 40],
  base: [150, 0, 40],
  height: 66,
  dn: 1000,
});

// ── 工况 ────────────────────────────────────────────────
const flowsFor = (key) =>
  Object.fromEntries(SOURCE_DEFS.map((s) => [s.id, s.flows[key]]));

const conditions = {
  normal: {
    label: '正常排放',
    description: '装置正常运行，各排放源按设计泄放量排放；1# 火炬投用，2# 火炬及跨线切断阀关闭。',
    flows: flowsFor('normal'),
    closed: ['branch:R2', 'branch:XO'],
  },
  emergency: {
    label: '事故排放',
    description: '全厂事故泄放，全部排放源按事故泄放量排放；1#、2# 火炬同时投用，跨线打开。',
    flows: flowsFor('emergency'),
    closed: [],
  },
  maintenance: {
    label: '检修',
    description: '1# 火炬及加氢裂化、延迟焦化支路切出检修；乙烯裂解 B 支路隔离，排放由 2# 火炬承担。',
    flows: flowsFor('maintenance'),
    closed: ['branch:R1', 'branch:S3', 'branch:S4', 'line:S7:B'],
  },
};

const branchFactors = {};
['MAIN', 'R1', 'R2', 'H1', 'H2', 'XO', ...SOURCE_DEFS.map((s) => s.id)].forEach((b) => {
  branchFactors[b] = 1.0;
});

const params = {
  branchResistance: branchFactors,
  sealHeightMm: Object.fromEntries(equipment.filter((e) => e.type === 'waterseal').map((e) => [e.id, e.sealHeightMm])),
  sourceSplit: Object.fromEntries(SOURCE_DEFS.map((s) => [s.id, [s.split, 1 - s.split]])),
  stripeSpeed: 1.0,
  pipeScale: 1.0,
};

const config = {
  schema: 'flare-network/1',
  meta: {
    name: '炼化火炬管网 · 1#/2# 火炬系统',
    site: '某炼化一体化项目',
    version: 1,
    units: { flow: 'm³/h', velocity: 'm/s', length: 'm', dn: 'mm' },
    note: '流量分配采用支路阻力等压降模型，迭代收敛后得到各管段流量。',
  },
  nodes,
  segments,
  equipment,
  sources,
  conditions,
  params,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(config, null, 2), 'utf8');

const byBranch = {};
for (const s of segments) byBranch[s.branchId] = (byBranch[s.branchId] || 0) + 1;
console.log(`节点 ${nodes.length}，管段 ${segments.length}`);
console.log('按支路统计:', byBranch);
console.log('输出:', OUT);
