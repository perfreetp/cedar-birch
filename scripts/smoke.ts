// 冒烟测试:解析样例 .lcf → 分块提取 → LUT 计算
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseLcfFile, extractChunkPayload } from '../src/io/format'
import { computeLUT } from '../src/volume/lut'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample-data', 'cabinet.lcf')
const buf = readFileSync(file)
const pf = parseLcfFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
console.log('header:', JSON.stringify(pf.header))

const [nx, ny, nz] = pf.header.dims
if (nx !== 128 || ny !== 96 || nz !== 160) throw new Error('dims 不符')

// 提取一个块并核对内容:与直接读 payload 比对
const chunk = extractChunkPayload(pf, [64, 32, 64], [64, 64, 64])
const nvox = nx * ny * nz
const f32 = new Float32Array(buf.buffer, buf.byteOffset + pf.payloadOffset)
// chunk 内 (0,0,0) 对应全局 (64,32,64),通道 t 的索引
const gi = 3 * nvox + 64 * ny * nx + 32 * nx + 64
const got = chunk[3 * 64 * 64 * 64 + 0]
if (got !== f32[gi]) throw new Error(`块提取错位: got ${got}, expect ${f32[gi]}`)
console.log('块提取校验通过,样本温度 =', got.toFixed(3))

const lut = computeLUT({
  colorStops: [
    { t: 0, color: '#000000' },
    { t: 1, color: '#ffffff' },
  ],
  opacityStops: [
    { t: 0, v: 0 },
    { t: 1, v: 1 },
  ],
})
if (lut[0] !== 0 || lut[255 * 4] !== 255 || lut[255 * 4 + 3] !== 255 || lut[3] !== 0)
  throw new Error('LUT 端点错误')
const mid = lut[128 * 4]
if (mid < 120 || mid > 135) throw new Error(`LUT 中点异常: ${mid}`)
console.log('LUT 校验通过,中点 =', mid)
console.log('SMOKE OK')
