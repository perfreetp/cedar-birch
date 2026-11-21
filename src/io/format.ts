// .lcf 自定义二进制格式:
//   [0..3]   magic "LCF1"
//   [4..7]   uint32 LE,JSON 头长度 H
//   [8..8+H) JSON 头(DatasetHeader)
//   [8+H..)  Float32 LE payload,通道主序:u[nvox] v[nvox] w[nvox] t[nvox],x 最快
import type { DatasetHeader } from '../types'

export const MAGIC = 0x3146434c // "LCF1" little-endian
export const HEADER_OFFSET = 8

export interface ParsedFile {
  header: DatasetHeader
  /** 通道主序 float32 payload 在 buffer 中的字节偏移 */
  payloadOffset: number
  buffer: ArrayBuffer
}

export function parseLcfFile(buffer: ArrayBuffer): ParsedFile {
  if (buffer.byteLength < HEADER_OFFSET) throw new Error('文件太小,不是有效的 .lcf 文件')
  const dv = new DataView(buffer)
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('magic 不匹配,不是 .lcf 文件')
  const hLen = dv.getUint32(4, true)
  const headerBytes = new Uint8Array(buffer, HEADER_OFFSET, hLen)
  const header = JSON.parse(new TextDecoder().decode(headerBytes)) as DatasetHeader
  const [nx, ny, nz] = header.dims
  const nvox = nx * ny * nz
  const payloadOffset = HEADER_OFFSET + hLen
  const expect = payloadOffset + nvox * 4 * 4
  if (buffer.byteLength < expect)
    throw new Error(`文件不完整:期望 ${expect} 字节,实际 ${buffer.byteLength}`)
  if (!header.channels || header.channels.join() !== 'u,v,w,t')
    throw new Error('通道表必须是 ["u","v","w","t"]')
  return { header, payloadOffset, buffer }
}

/** 从通道主序 payload 中拷贝一个块(含 halo)到连续缓冲,供 Worker 使用 */
export function extractChunkPayload(
  pf: ParsedFile,
  origin: [number, number, number], // 体素坐标(可含 -1 halo)
  size: [number, number, number],
): Float32Array {
  const { header, payloadOffset, buffer } = pf
  const [nx, ny, nz] = header.dims
  const nvox = nx * ny * nz
  // JSON 头长度不保证 4 字节对齐,未对齐时拷贝一份
  const f32 =
    payloadOffset % 4 === 0
      ? new Float32Array(buffer, payloadOffset)
      : new Float32Array(buffer.slice(payloadOffset))
  const [sx, sy, sz] = size
  const out = new Float32Array(4 * sx * sy * sz)
  for (let c = 0; c < 4; c++) {
    const cbase = c * nvox
    const obase = c * sx * sy * sz
    for (let z = 0; z < sz; z++) {
      const gz = clampI(origin[2] + z, 0, nz - 1)
      for (let y = 0; y < sy; y++) {
        const gy = clampI(origin[1] + y, 0, ny - 1)
        const rowBase = cbase + gz * ny * nx + gy * nx
        const orow = obase + z * sy * sx + y * sx
        for (let x = 0; x < sx; x++) {
          const gx = clampI(origin[0] + x, 0, nx - 1)
          out[orow + x] = f32[rowBase + gx]
        }
      }
    }
  }
  return out
}

function clampI(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v
}
