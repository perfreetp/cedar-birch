// 切片纹理烘焙 Worker
// 职责：
//  1. 持有完整时间序列体数据（所有权转移到 worker，主线程不保留副本）
//  2. 按视线主轴把体数据重采样为紧排 2D 切片图集（双时刻 A/B，shader 内插值）
//  3. 浓度阈值在烘焙期剔除（低于阈值 alpha=0）
//  3. 射线采样与浓度分布统计
import { HEADER_SIZE } from './volumeFormat.js';

let header = null;
let frames = null;          // Uint16Array[]
let frameVoxels = 0;

// 轴 -> 切片平面的两个面内轴（对应纹理 u、v 方向）
const PLANE_AXES = [
  { u: 2, v: 1 },  // axis 0：沿 X 切，面内 (Z, Y)
  { u: 0, v: 2 },  // axis 1：沿 Y 切，面内 (X, Z)
  { u: 0, v: 1 },  // axis 2：沿 Z 切，面内 (X, Y)
];

function dims() { return [header.nx, header.ny, header.nz]; }

function voxelIndex(x, y, z) {
  return (z * header.ny + y) * header.nx + x;
}

function init(message) {
  const buf = message.buffer;
  header = message.header;
  frameVoxels = header.nx * header.ny * header.nz;
  frames = [];
  for (let f = 0; f < header.frameCount; f++) {
    frames.push(new Uint16Array(buf, HEADER_SIZE + f * frameVoxels * 2, frameVoxels));
  }
  self.postMessage({ type: 'ready', frameCount: header.frameCount });
}

// 计算紧排图集网格尺寸
function packGrid(sliceCount, pw, ph, maxTexSize) {
  let cols = Math.max(1, Math.ceil(Math.sqrt(sliceCount * (pw / ph))));
  while (cols * pw > maxTexSize) cols--;
  if (cols < 1) cols = 1;
  let rows = Math.ceil(sliceCount / cols);
  while (rows * ph > maxTexSize && cols < sliceCount) {
    cols++;
    rows = Math.ceil(sliceCount / cols);
  }
  return { cols, rows, width: cols * pw, height: rows * ph };
}

function bakeTexture(frameA, frameB, interp, axis, sliceCount, thresholdNorm, lut, maxTexSize) {
  const d = dims();
  const { u: ua, v: va } = PLANE_AXES[axis];
  const pw = d[ua], ph = d[va], nAxis = d[axis];
  const dataA = frames[frameA], dataB = frames[frameB];
  const grid = packGrid(sliceCount, pw, ph, maxTexSize);
  const out = new Uint8ClampedArray(grid.width * grid.height * 4);

  const idx3 = new Int32Array(3);
  for (let k = 0; k < sliceCount; k++) {
    const ia = Math.min(nAxis - 1, Math.floor(((k + 0.5) / sliceCount) * nAxis));
    const tileX = (k % grid.cols) * pw;
    const tileY = Math.floor(k / grid.cols) * ph;

    for (let iv = 0; iv < ph; iv++) {
      idx3[axis] = ia;
      idx3[va] = iv;
      let rowBase = (tileY + iv) * grid.width + tileX;
      for (let iu = 0; iu < pw; iu++) {
        idx3[ua] = iu;
        const vi = voxelIndex(idx3[0], idx3[1], idx3[2]);
        const na = dataA[vi] / 65535;
        const nb = dataB[vi] / 65535;
        const c = na + (nb - na) * interp;

        const o = rowBase * 4;
        if (c < thresholdNorm) {
          out[o] = 0; out[o + 1] = 0; out[o + 2] = 0; out[o + 3] = 0;
        } else {
          // 软边缘：阈值附近渐入，避免硬切口；浓度越高不透明度越强
          const f = (c - thresholdNorm) / (1 - thresholdNorm);
          const a = Math.min(1, 0.18 + Math.pow(f, 0.75) * 0.82);
          const li = Math.min(255, Math.round(c * 255)) * 4;
          out[o] = lut[li];
          out[o + 1] = lut[li + 1];
          out[o + 2] = lut[li + 2];
          out[o + 3] = Math.round(a * 255);
        }
        rowBase++;
      }
    }
  }
  return { image: new ImageData(new Uint8ClampedArray(out.buffer), grid.width, grid.height), grid };
}

async function handleBake(msg) {
  const { jobId, frameA, frameB, interp, axis, sliceCount, thresholdNorm, lut, maxTexSize } = msg;
  const t0 = performance.now();
  const bakedA = bakeTexture(frameA, frameA, 0, axis, sliceCount, thresholdNorm, lut, maxTexSize);
  const bakedB = bakeTexture(frameB, frameB, 0, axis, sliceCount, thresholdNorm, lut, maxTexSize);
  const [bitmapA, bitmapB] = await Promise.all([
    createImageBitmap(bakedA.image),
    createImageBitmap(bakedB.image),
  ]);
  self.postMessage({
    type: 'baked',
    jobId,
    bitmapA,
    bitmapB,
    grid: bakedA.grid,
    plane: { width: bakedA.image.width, height: bakedA.image.height },
    bakeMs: performance.now() - t0,
  }, [bitmapA, bitmapB]);
}

// 批量世界体素坐标采样（线性插值）
function handleSample(msg) {
  const { jobId, frameA, frameB, interp, points } = msg;
  const d = dims();
  const dataA = frames[frameA], dataB = frames[frameB];
  const values = new Float32Array(points.length);
  for (let i = 0; i < points.length; i++) {
    const fx = points[i * 3], fy = points[i * 3 + 1], fz = points[i * 3 + 2];
    if (fx < 0 || fy < 0 || fz < 0 || fx >= d[0] - 1 || fy >= d[1] - 1 || fz >= d[2] - 1) {
      values[i] = -1;
      continue;
    }
    const x0 = fx | 0, y0 = fy | 0, z0 = fz | 0;
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    let sum = 0;
    for (let dz = 0; dz <= 1; dz++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const w = (dx ? tx : 1 - tx) * (dy ? ty : 1 - ty) * (dz ? tz : 1 - tz);
          const vi = voxelIndex(x0 + dx, y0 + dy, z0 + dz);
          const c = (dataA[vi] / 65535) + ((dataB[vi] / 65535) - (dataA[vi] / 65535)) * interp;
          sum += w * c;
        }
      }
    }
    values[i] = sum;
  }
  self.postMessage({ type: 'sampled', jobId, values: values.buffer }, [values.buffer]);
}

// 当前时刻浓度分布统计
function handleStats(msg) {
  const { jobId, frameA, frameB, interp, thresholdNorm } = msg;
  const dataA = frames[frameA], dataB = frames[frameB];
  const BINS = 32;
  const hist = new Uint32Array(BINS);
  let min = 1, max = 0, sum = 0, count = 0, active = 0;
  let sx = 0, sy = 0, sz = 0;
  const d = dims();
  for (let z = 0; z < d[2]; z++) {
    for (let y = 0; y < d[1]; y++) {
      for (let x = 0; x < d[0]; x++) {
        const vi = voxelIndex(x, y, z);
        const c = (dataA[vi] / 65535) + ((dataB[vi] / 65535) - (dataA[vi] / 65535)) * interp;
        if (c <= 0) continue;
        count++;
        sum += c;
        if (c < min) min = c;
        if (c > max) max = c;
        hist[Math.min(BINS - 1, Math.floor(c * BINS))]++;
        if (c >= thresholdNorm) {
          active++;
          sx += x; sy += y; sz += z;
        }
      }
    }
  }
  self.postMessage({
    type: 'stats',
    jobId,
    stats: {
      bins: BINS,
      histogram: Array.from(hist),
      normalized: {
        min: count ? min : 0, max, mean: count ? sum / count : 0,
        activeVoxelCount: active,
        totalNonZeroVoxelCount: count,
        activeCentroidVoxel: active ? { x: sx / active, y: sy / active, z: sz / active } : null,
      },
    },
  });
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'init': init(msg); break;
      case 'bake': handleBake(msg); break;
      case 'sample': handleSample(msg); break;
      case 'stats': handleStats(msg); break;
    }
  } catch (err) {
    self.postMessage({ type: 'error', jobId: msg.jobId, message: String(err && err.message || err) });
  }
};
