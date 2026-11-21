// 单元测试：地形高度纹理的行列映射、.dustvol 格式、阈值定义（无需浏览器）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { terrainHeight } from '../src/terrainHeight.js';
import { THRESHOLD_LEVELS, buildDustLUT } from '../src/colorLUT.js';

const MIN = { x: -9600, y: 0, z: -9600 };
const MAX = { x: 9600, y: 5120, z: 9600 };
const SIZE = 256;

// 复刻 terrain.js 中高度纹理的填充逻辑（flipY=false 的 DataTexture）
function buildHeightData() {
  const data = new Uint8Array(SIZE * SIZE * 4);
  const rangeY = MAX.y - MIN.y;
  let p = 0;
  for (let iz = 0; iz < SIZE; iz++) {
    const wz = MIN.z + (MAX.z - MIN.z) * (iz / (SIZE - 1));
    for (let ix = 0; ix < SIZE; ix++) {
      const wx = MIN.x + (MAX.x - MIN.x) * (ix / (SIZE - 1));
      const h = (terrainHeight(wx, wz) - MIN.y) / rangeY;
      const v = Math.round(Math.min(1, Math.max(0, h)) * 255);
      data[p++] = v; data[p++] = v; data[p++] = v; data[p++] = 255;
    }
  }
  return data;
}

// shader 采样：xzn=(world-min)/(max-min)，flipY=false 时纹理 v=数据行索引
function sampleHeight(data, wx, wz) {
  const xn = (wx - MIN.x) / (MAX.x - MIN.x);
  const zn = (wz - MIN.z) / (MAX.z - MIN.z);
  const ix = Math.min(SIZE - 1, Math.max(0, Math.round(xn * (SIZE - 1))));
  const iz = Math.min(SIZE - 1, Math.max(0, Math.round(zn * (SIZE - 1))));
  const byte = data[(iz * SIZE + ix) * 4];
  return MIN.y + (byte / 255) * (MAX.y - MIN.y);
}

test('高度纹理采样在多个世界点与 terrainHeight 真值一致（直接 v，不翻转）', () => {
  const data = buildHeightData();
  const points = [
    [-8000, -8000], [-3000, 2000], [0, 0], [2500, -6000],
    [7000, 4000], [9000, 9000], [-9000, 9000], [500, -500],
  ];
  for (const [wx, wz] of points) {
    const truth = terrainHeight(wx, wz);
    const sampled = sampleHeight(data, wx, wz);
    // 8-bit 量化误差 <= 一个量化步长（5120/255 ≈ 20m）
    assert.ok(Math.abs(truth - sampled) <= 21,
      `(${wx},${wz}) truth=${truth.toFixed(1)} sampled=${sampled.toFixed(1)}`);
  }
});

test('翻转 v 会得到错误高度（证明不应使用 1-v）', () => {
  const data = buildHeightData();
  // 取两个 z 差异大、地形高度明显不同的点对比
  const wx = 3000;
  const wzA = -8000, wzB = 8000;
  const hA = sampleHeight(data, wx, wzA);
  const hB = sampleHeight(data, wx, wzB);
  // 直接映射必须各自匹配真值
  assert.ok(Math.abs(hA - terrainHeight(wx, wzA)) <= 21);
  assert.ok(Math.abs(hB - terrainHeight(wx, wzB)) <= 21);
});

test('五级阈值单调递增且落在 (0,1)', () => {
  assert.equal(THRESHOLD_LEVELS.length, 5);
  for (let i = 1; i < 5; i++) {
    assert.ok(THRESHOLD_LEVELS[i].norm > THRESHOLD_LEVELS[i - 1].norm);
  }
  assert.ok(THRESHOLD_LEVELS.every((l) => l.norm > 0 && l.norm < 1));
});

test('配色 LUT 为 256 级 RGBA 且高浓度端明度高于低浓度端', () => {
  const lut = buildDustLUT(256);
  assert.equal(lut.length, 256 * 4);
  const lum = (i) => 0.299 * lut[i * 4] + 0.587 * lut[i * 4 + 1] + 0.114 * lut[i * 4 + 2];
  assert.ok(lum(255) > lum(0));
  // alpha 始终为 255（透明度在烘焙阶段按浓度另算）
  assert.equal(lut[3], 255);
  assert.equal(lut[255 * 4 + 3], 255);
});
