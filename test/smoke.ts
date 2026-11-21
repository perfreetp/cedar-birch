// 仿真核心冒烟测试：node 环境运行（不依赖 three）
import { world } from '../src/sim/world';
import { parseImport, normalizeNetwork } from '../src/sim/exchange';

let failures = 0;
const check = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++;
    console.error('FAIL:', msg);
  } else {
    console.log('ok:', msg);
  }
};

world.generateDemo(1200, 3);
check(world.points.length === 1200, '生成 1200 点位');
check(world.schedules.length === 3, '3 辆车调度');
check(world.orders.every((o) => o.length > 0), '每车均分到点位');
check(world.orders.flat().length === 1200, '点位全覆盖');

// 错峰出发
const departs = world.schedules.map((s) => s.departTime);
check(departs[1] - departs[0] === world.params.stagger && departs[2] - departs[1] === world.params.stagger, '错峰出发间隔正确');

// 调度段时间单调
for (const s of world.schedules) {
  let mono = true;
  for (let i = 1; i < s.segments.length; i++) {
    if (s.segments[i].t0 < s.segments[i - 1].t1 - 1e-9) mono = false;
  }
  check(mono, `车辆 ${s.vehicleId} 调度时间单调`);
  check(s.loadEvents.length > 0, `车辆 ${s.vehicleId} 有装载记录`);
}

// 阈值触发返程段插入
const hasReturn = world.schedules.some((s) => s.segments.some((g) => g.isReturn));
check(hasReturn, '存在返程段（阈值触发）');

// 时间轴解析求值：全天扫描不抛异常且装载有增长
let maxLoad = 0;
let moving = 0;
for (let t = 0; t <= world.dayLength; t += 3) {
  const tAbs = world.params.dayStart + t;
  for (let v = 0; v < 3; v++) {
    const st = world.positionAt(v, tAbs)!;
    if (!isFinite(st.x) || !isFinite(st.z)) {
      failures++;
      console.error('FAIL: 非法位置', v, tAbs);
    }
    maxLoad = Math.max(maxLoad, st.load);
    if (st.state === 'travel') moving++;
  }
}
check(maxLoad > 0, `装载量随时间增长（峰值 ${Math.round(maxLoad)}）`);
check(moving > 0, '存在行驶状态');

// 拖拽调序后重算
const before = world.orders[0].slice();
const reordered = [...before.slice(1), before[0]];
world.setOrder(0, reordered);
check(world.orders[0].join() === reordered.join(), '拖拽调序生效');
check(world.schedules[0].segments.length > 0, '调序后调度重算');

// 权重调整
const p0 = world.points[0];
const w0 = p0.weight;
world.applyWeight([p0.id], 2);
check(world.pointMap.get(p0.id)!.weight === w0 * 2, '批量权重调整生效');

// 导出/导入往返
const exported = JSON.stringify(world.export(123.4));
const data = parseImport(exported);
check(data.orders.flat().length === 1200, '导出包含全部路线');
check(data.loadRecords.length === 3 && data.loadRecords[0].events.length > 0, '导出包含装载记录');
world.import(data);
check(world.points.length === 1200 && world.orders.flat().length === 1200, '导入后点位与路线还原');
check(world.pointMap.get(p0.id)!.weight === w0 * 2, '导入后权重还原');
const st1 = world.positionAt(0, world.params.dayStart + 100)!;
check(isFinite(st1.x), '导入后调度可求值');

// 路网导入
const net = normalizeNetwork({
  nodes: [
    { id: 0, x: 0, z: 0 },
    { id: 1, x: 100, z: 0 },
    { id: 2, x: 100, z: 100 },
  ],
  edges: [
    { a: 0, b: 1, congestion: 0.8 },
    { a: 1, b: 2 },
  ],
});
check(net.edges.length === 2 && Math.abs(net.edges[0].length - 100) < 1e-6, '路网规范化（长度计算）');
world.setNetwork(net);
check(world.points.length >= 800 && world.schedules.length > 0, '导入路网后重新生成点位与调度');

// 性能：1200 点位下全天求值耗时
const t0 = performance.now();
for (let t = 0; t <= world.dayLength; t += 0.5) {
  for (let v = 0; v < world.vehicles.length; v++) world.positionAt(v, world.params.dayStart + t);
}
const ms = performance.now() - t0;
console.log(`全天 0.5min 步长求值耗时 ${ms.toFixed(1)}ms`);
check(ms < 500, '时间轴拖动求值性能达标');

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
