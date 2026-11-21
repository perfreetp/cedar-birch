// .dustvol 二进制格式（小端）
// 偏移  类型            字段
// 0     char[8]         magic "DUSTVOL1"
// 8     uint16          version
// 10    uint16          nx, ny, nz（三个连续 uint16）
// 16    uint16          frameCount
// 18    uint16          reserved
// 20    float32[3]      originX, originY, originZ   体数据原点（世界坐标，米）
// 32    float32[3]      voxelX, voxelY, voxelZ      体素尺寸（米）
// 44    float32         cMin（归一化 0 对应物理浓度）
// 48    float32         cMax（归一化 1 对应物理浓度）
// 52    char[12]        concentrationUnit
// 64    float64         startTime（毫秒时间戳）
// 72    float32         frameIntervalSec
// 76    char[52]        reserved2
// 128   uint16[frameCount * nx * ny * nz]  体数据，帧优先，帧内 x 最快、z 最慢
//
// 单帧索引：(z * ny + y) * nx + x   （x 最快）

export const MAGIC = 'DUSTVOL1';
export const HEADER_SIZE = 128;

export function frameVoxelCount(header) {
  return header.nx * header.ny * header.nz;
}

export function voxelIndex(header, x, y, z) {
  return (z * header.ny + y) * header.nx + x;
}

// 解码浓度：Uint16 归一化值 -> 物理浓度
export function decodeConcentration(header, u16) {
  const t = u16 / 65535;
  return header.cMin + t * (header.cMax - header.cMin);
}

// 反归一化
export function normalizedToPhysical(header, t) {
  return header.cMin + t * (header.cMax - header.cMin);
}

export async function parseDustVol(arrayBuffer, onProgress) {
  if (arrayBuffer.byteLength < HEADER_SIZE) {
    throw new Error('文件过小，不是有效的 .dustvol 文件');
  }
  const head = new DataView(arrayBuffer, 0, HEADER_SIZE);
  let magic = '';
  for (let i = 0; i < 8; i++) magic += String.fromCharCode(head.getUint8(i));
  if (magic !== MAGIC) throw new Error('魔数不匹配，文件格式不是 DUSTVOL1');

  const version = head.getUint16(8, true);
  const nx = head.getUint16(10, true);
  const ny = head.getUint16(12, true);
  const nz = head.getUint16(14, true);
  const frameCount = head.getUint16(16, true);
  const origin = [head.getFloat32(20, true), head.getFloat32(24, true), head.getFloat32(28, true)];
  const voxel = [head.getFloat32(32, true), head.getFloat32(36, true), head.getFloat32(40, true)];
  const cMin = head.getFloat32(44, true);
  const cMax = head.getFloat32(48, true);
  // 单位字段为 UTF-8 字节，遇首字节 0 截断
  const unitBytes = new Uint8Array(arrayBuffer, 52, 12);
  let unitLen = 0;
  while (unitLen < 12 && unitBytes[unitLen] !== 0) unitLen++;
  const unit = new TextDecoder('utf-8').decode(unitBytes.subarray(0, unitLen));
  const startTime = head.getFloat64(64, true);
  const frameIntervalSec = head.getFloat32(72, true);

  const expected = HEADER_SIZE + frameCount * nx * ny * nz * 2;
  if (arrayBuffer.byteLength !== expected) {
    throw new Error(`文件长度异常：期望 ${expected} 字节，实际 ${arrayBuffer.byteLength} 字节`);
  }

  const header = {
    version, nx, ny, nz, frameCount, origin, voxel,
    cMin, cMax, unit: unit.trim() || 'ug/m3',
    startTime, frameIntervalSec,
  };

  // 切片为帧引用，避免复制大数组
  const dataOffset = HEADER_SIZE;
  const frameVoxels = nx * ny * nz;
  const frames = [];
  const step = Math.max(1, Math.floor(frameCount / 6));
  for (let f = 0; f < frameCount; f++) {
    const begin = dataOffset + f * frameVoxels * 2;
    frames.push(new Uint16Array(arrayBuffer, begin, frameVoxels));
    if (onProgress && f % step === 0) onProgress((f + 1) / frameCount);
  }
  onProgress?.(1);
  return { header, frames };
}
