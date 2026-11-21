// 演示数据生成器：模拟一个随风向扩散的沙尘烟羽（高斯烟羽 + 地面沉降 + 阵风扰动）
// 运行：node tools/generateSampleData.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { terrainHeight } from '../src/terrainHeight.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../public/demo-dust.dustvol');

// ---- 体网格参数 ----
const NX = 96, NY = 64, NZ = 96;
const FRAME_COUNT = 18;
const VOXEL = [200, 80, 200];            // 米
const ORIGIN = [-9600, 0, -9600];        // 世界坐标原点
const C_MIN = 0, C_MAX = 1200;           // μg/m³
const FRAME_INTERVAL = 600;              // 秒（10 分钟一帧，共 3 小时）

// ---- 确定性伪随机（保证每次生成结果一致）----
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261122);

// 体素中心世界坐标
function worldCenter(i, j, k) {
  return [
    ORIGIN[0] + (i + 0.5) * VOXEL[0],
    ORIGIN[1] + (j + 0.5) * (VOXEL[1]),
    ORIGIN[2] + (k + 0.5) * VOXEL[2],
  ];
}

// ---- 沙尘源参数 ----
const SOURCE = { x: -6200, y: 520, z: -1200, strength: 1.0 };
const WIND = { dx: 1.0, dz: 0.32 };          // 风向（未归一化，带风速增长）
const wl = Math.hypot(WIND.dx, WIND.dz);
WIND.dx /= wl; WIND.dz /= wl;

// 几个缓变的湍流涡
const EDDIES = Array.from({ length: 5 }, () => ({
  ax: (rand() - 0.5) * 6000,
  az: (rand() - 0.5) * 6000,
  px: rand() * Math.PI * 2,
  pz: rand() * Math.PI * 2,
  amp: 260 + rand() * 320,
}));

function gaussianPlume(frame) {
  const t = frame / (FRAME_COUNT - 1);                 // 0..1
  // 烟羽前沿从源头一路推进到域的远端
  const travel = 1200 + t * 16800;
  const cx = SOURCE.x + WIND.dx * travel;
  const cz = SOURCE.z + WIND.dz * travel;
  const sigmaY = 900 + t * 2600;                       // 横向扩散（适度，避免过度稀释）
  const sigmaZ = 420 + t * 1300;                       // 垂向扩散
  return { t, cx, cz, sigmaY, sigmaZ, travel };
}

function concentrationAt(wx, wy, wz, frame, plume) {
  const { t, travel, sigmaY, sigmaZ } = plume;

  // 沿风向 / 垂直风向的距离
  const rx = wx - SOURCE.x, rz = wz - SOURCE.z;
  const along = rx * WIND.dx + rz * WIND.dz;
  const across = -rx * WIND.dz + rz * WIND.dx;

  // 涡旋扰动：让烟羽中心线随时间摆动
  let wobble = 0;
  for (const e of EDDIES) {
    const phase = t * 4.2;
    wobble += e.amp * Math.sin(wx * 0.0005 + wz * 0.0004 + e.px + phase) *
      Math.exp(-((wx - e.ax) ** 2 + (wz - e.az) ** 2) / (2 * 5600 ** 2));
  }
  const ac = across - wobble;

  // 只在源与前沿之间有烟羽；前沿用平滑门限，源头到前沿主体保持连续
  if (along < -200 || along > travel + 1600) return 0;
  const frontGate = Math.exp(-(Math.max(0, along - travel + 500) ** 2) / (2 * 1700 ** 2));

  // 沿程浓度：近源最强，沿风向缓慢衰减（保持中远端仍有可观浓度）
  const alongDecay = 0.45 + 0.55 * Math.exp(-along / 14000);

  // 横向高斯包络
  const horiz = Math.exp(-(ac ** 2) / (2 * sigmaY ** 2));

  // 垂向：以源高为中心的高斯 + 地面镜像项，保证贴地有沉降、高空变稀薄
  const h = wy - SOURCE.y;
  const vert =
    Math.exp(-(h ** 2) / (2 * sigmaZ ** 2)) +
    0.6 * Math.exp(-((wy + SOURCE.y - 2 * 200) ** 2) / (2 * (sigmaZ * 1.1) ** 2));

  // 加一层缓慢的团块状湍流调制，让云团内部有浓淡结构而非均匀体
  const lump =
    0.82 +
    0.18 * Math.sin(wx * 0.0011 + t * 3.0) * Math.cos(wz * 0.0009 - t * 2.2) *
      Math.sin(wy * 0.0016 + t * 1.7);

  // 归一化浓度：核心区稳定在 0.6–1.0，外围平滑降到 0；不随时间整体塌缩
  let c = C_MAX * frontGate * alongDecay * Math.min(1.4, horiz * vert) * lump;

  // 地形以下无浓度
  if (wy < terrainHeight(wx, wz)) c = 0;
  return Math.max(0, Math.min(C_MAX, c));
}

function buildHeaderBuffer() {
  const buf = new ArrayBuffer(128);
  const dv = new DataView(buf);
  const magic = 'DUSTVOL1';
  for (let i = 0; i < 8; i++) dv.setUint8(i, magic.charCodeAt(i));
  dv.setUint16(8, 1, true);
  dv.setUint16(10, NX, true);
  dv.setUint16(12, NY, true);
  dv.setUint16(14, NZ, true);
  dv.setUint16(16, FRAME_COUNT, true);
  dv.setUint16(18, 0, true);
  dv.setFloat32(20, ORIGIN[0], true);
  dv.setFloat32(24, ORIGIN[1], true);
  dv.setFloat32(28, ORIGIN[2], true);
  dv.setFloat32(32, VOXEL[0], true);
  dv.setFloat32(36, VOXEL[1], true);
  dv.setFloat32(40, VOXEL[2], true);
  dv.setFloat32(44, C_MIN, true);
  dv.setFloat32(48, C_MAX, true);
  const unit = 'μg/m³';
  const unitBytes = new TextEncoder().encode(unit);
  for (let i = 0; i < unitBytes.length && i < 12; i++) dv.setUint8(52 + i, unitBytes[i]);
  dv.setFloat64(64, Date.UTC(2026, 2, 21, 0, 0, 0), true);
  dv.setFloat32(72, FRAME_INTERVAL, true);
  return Buffer.from(buf);
}

function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  const frameVoxels = NX * NY * NZ;
  const total = FRAME_COUNT * frameVoxels;
  const out = Buffer.alloc(128 + total * 2);
  buildHeaderBuffer().copy(out, 0);

  const started = Date.now();
  for (let f = 0; f < FRAME_COUNT; f++) {
    const plume = gaussianPlume(f);
    const frameBase = 128 + f * frameVoxels * 2;
    let offset = frameBase;
    for (let k = 0; k < NZ; k++) {
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const [wx, wy, wz] = worldCenter(i, j, k);
          const c = concentrationAt(wx, wy, wz, f, plume);
          const u16 = Math.round((c - C_MIN) / (C_MAX - C_MIN) * 65535);
          out.writeUInt16LE(Math.max(0, Math.min(65535, u16)), offset);
          offset += 2;
        }
      }
    }
    process.stdout.write(`\r帧 ${f + 1}/${FRAME_COUNT} 生成中…`);
  }
  writeFileSync(OUT, out);
  const mb = (out.length / 1048576).toFixed(1);
  console.log(`\n完成：${OUT}（${mb} MB，耗时 ${Date.now() - started} ms）`);
}

main();
