import { ExportData, RoadNetwork } from './types';
import { generateDemoNetwork } from './demo';
import { SimWorld } from './world';

function downloadJSON(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 导出收运路线与装载记录为 JSON 文件 */
export function exportToFile(world: SimWorld, simTime: number): void {
  downloadJSON(world.export(simTime), 'waste-route-sim.json');
}

/** 解析并校验存档文件 */
export function parseImport(json: string): ExportData {
  const d = JSON.parse(json);
  if (!d || d.version !== 1) throw new Error('存档版本不支持');
  if (!Array.isArray(d.points) || !Array.isArray(d.orders) || !Array.isArray(d.vehicles)) {
    throw new Error('存档缺少必要字段（points/orders/vehicles）');
  }
  if (!d.network || !Array.isArray(d.network.nodes) || !Array.isArray(d.network.edges)) {
    throw new Error('存档缺少路网数据');
  }
  return d as ExportData;
}

/** 校验并规范化外部路网数据 {nodes:[{id,x,z}], edges:[{a,b,congestion?,width?}]} */
export function normalizeNetwork(raw: unknown): RoadNetwork {
  const r = raw as { nodes?: unknown[]; edges?: unknown[] };
  if (!r || !Array.isArray(r.nodes) || !Array.isArray(r.edges)) {
    throw new Error('路网格式错误：需要 { nodes: [...], edges: [...] }');
  }
  const nodes = r.nodes.map((n: unknown, i: number) => {
    const o = n as { id?: number; x?: number; z?: number };
    if (typeof o.x !== 'number' || typeof o.z !== 'number') {
      throw new Error(`节点 ${i} 缺少数值坐标 x/z`);
    }
    return { id: typeof o.id === 'number' ? o.id : i, x: o.x, z: o.z };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = r.edges.map((e: unknown, i: number) => {
    const o = e as { id?: number; a?: number; b?: number; from?: number; to?: number; congestion?: number; width?: number };
    const a = o.a ?? o.from;
    const b = o.b ?? o.to;
    if (a === undefined || b === undefined || !ids.has(a) || !ids.has(b)) {
      throw new Error(`边 ${i} 引用了不存在的节点`);
    }
    const na = byId.get(a)!;
    const nb = byId.get(b)!;
    const c = typeof o.congestion === 'number' ? o.congestion : 0.3;
    return {
      id: typeof o.id === 'number' ? o.id : i,
      a,
      b,
      length: Math.hypot(nb.x - na.x, nb.z - na.z),
      congestion: Math.min(1, Math.max(0, c)),
      width: typeof o.width === 'number' ? o.width : 7,
    };
  });
  if (edges.length === 0) throw new Error('路网至少需要一条边');
  return { nodes, edges };
}

/** 下载示例路网文件，展示导入格式 */
export function downloadSampleNetwork(): void {
  const { network } = generateDemoNetwork(10, 70);
  downloadJSON(
    {
      nodes: network.nodes,
      edges: network.edges.map((e) => ({
        id: e.id,
        a: e.a,
        b: e.b,
        congestion: Math.round(e.congestion * 100) / 100,
        width: e.width,
      })),
    },
    'sample-road-network.json',
  );
}
