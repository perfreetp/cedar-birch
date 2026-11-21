/**
 * 示例弹道生成器：简化的两级火箭垂直发射 -> 重力转向 -> 级间分离 -> 滑行。
 * 输出 public/sample-trajectory.json，格式与用户导入的弹道文件一致。
 * 运行：npm run gen:sample
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/sample-trajectory.json');

// 简化物理：重力随高度衰减、大气密度指数模型、两级推力
const R_E = 6_371_000;
const g0 = 9.81;
const frames = [];

let t = 0;
let x = 0, y = 0, z = 0;
let vx = 0, vy = 0, vz = 0;
let mass = 120_000; // kg
const dt = 0.5;

// 阶段：[起始时间, 结束时间, 推力 N, 质量流量 kg/s, 最大俯仰偏转]
const stages = [
  { t0: 0, t1: 42, thrust: 2_400_000, mdot: 620, kick: 0.0 },
  { t0: 42, t1: 95, thrust: 780_000, mdot: 210, kick: 1.0 },
  { t0: 95, t1: 120, thrust: 0, mdot: 0, kick: 1.0 },
];

for (let i = 0; i <= 240; i++) {
  t = i * dt;
  const stage = stages.find((s) => t >= s.t0 && t < s.t1) ?? stages[2];
  const h = Math.max(y, 0);
  const g = g0 * Math.pow(R_E / (R_E + h), 2);
  const rho = 1.225 * Math.exp(-h / 8500);
  const speed = Math.hypot(vx, vy, vz);

  // 重力转向：推力方向沿当前速度，逐步压俯仰
  const horiz = Math.hypot(vx, vz);
  const pitch = speed > 1 ? Math.atan2(vy, horiz) : Math.PI / 2;
  const heading = 0.15; // 轻微航向偏移
  const tx = Math.cos(pitch) * Math.cos(heading);
  const ty = Math.sin(pitch);
  const tz = Math.cos(pitch) * Math.sin(heading);

  const drag = 0.5 * rho * speed * speed * 4.2 * (speed > 1 ? 1 : 0);
  const ax = (stage.thrust * tx - drag * (speed > 1 ? vx / speed : 0)) / mass;
  const ay = (stage.thrust * ty - drag * (speed > 1 ? vy / speed : 0)) / mass - g;
  const az = (stage.thrust * tz - drag * (speed > 1 ? vz / speed : 0)) / mass;

  vx += ax * dt; vy += ay * dt; vz += az * dt;
  x += vx * dt; y += vy * dt; z += vz * dt;
  if (y < 0) { y = 0; vy = Math.max(0, vy); }
  mass = Math.max(28_000, mass - stage.mdot * dt);

  frames.push({
    t: Number(t.toFixed(2)),
    x: Number(x.toFixed(2)),
    y: Number(Math.max(y, 0).toFixed(2)),
    z: Number(z.toFixed(2)),
    vx: Number(vx.toFixed(2)),
    vy: Number(vy.toFixed(2)),
    vz: Number(vz.toFixed(2)),
    pitch: Number((pitch * 180) / Math.PI).toFixed(2),
    heading: Number((heading * 180) / Math.PI).toFixed(2),
    throttle: stage.thrust > 0 ? (t < 42 ? 1 : 0.85) : 0,
  });
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({ name: '示例弹道 · 两级重力转向', unit: 'metric', keyframes: frames }, null, 2),
);
console.log(`已生成 ${frames.length} 帧 -> ${out}`);
