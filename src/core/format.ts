// 热力密度场编解码与色带
import { deflateSync, inflateSync } from 'fflate'

/** 五档色带 (人/m²), 对应题面 0.5 -> 6 */
export interface BandDef {
  min: number
  max: number
  color: [number, number, number]
  label: string
}

export const DENSITY_BANDS: BandDef[] = [
  { min: 0.5, max: 1.5, color: [0.36, 0.85, 0.72], label: '0.5–1.5' },
  { min: 1.5, max: 2.6, color: [0.65, 0.93, 0.42], label: '1.5–2.6' },
  { min: 2.6, max: 3.8, color: [0.99, 0.86, 0.26], label: '2.6–3.8' },
  { min: 3.8, max: 4.9, color: [0.98, 0.56, 0.18], label: '3.8–4.9' },
  { min: 4.9, max: 6.0, color: [0.9, 0.21, 0.28], label: '4.9–6.0' },
]

export const OVERLOAD_COLOR: [number, number, number] = [0.62, 0.05, 0.32]

/** 密度编码上限 (人/m²) */
export const DENSITY_ENCODE_MAX = 16
/** 4bit 量化步长 */
export const QUANT_STEP = DENSITY_ENCODE_MAX / 15

/** 人/m² -> 0..15 量化值 */
export function quantize(d: number): number {
  const q = Math.round((d / DENSITY_ENCODE_MAX) * 15)
  return q < 0 ? 0 : q > 15 ? 15 : q
}

/** 0..15 -> 人/m² */
export function dequantize(q: number): number {
  return (q / 15) * DENSITY_ENCODE_MAX
}

/** 8bit 密度码 (0..255) -> 人/m² */
export function codeToDensity(c: number): number {
  return (c / 255) * DENSITY_ENCODE_MAX
}

export function densityToCode(d: number): number {
  const c = Math.round((d / DENSITY_ENCODE_MAX) * 255)
  return c < 0 ? 0 : c > 255 ? 255 : c
}

export function bandIndex(d: number): number {
  if (d < DENSITY_BANDS[0].min) return -1
  for (let i = 0; i < DENSITY_BANDS.length; i++) {
    if (d < DENSITY_BANDS[i].max) return i
  }
  return DENSITY_BANDS.length
}

export function bandRGB(d: number): [number, number, number] | null {
  const i = bandIndex(d)
  if (i < 0) return null
  return i >= DENSITY_BANDS.length ? OVERLOAD_COLOR : DENSITY_BANDS[i].color
}

export function bandColorCSS(d: number): string {
  const c = bandRGB(d)
  if (!c) return 'transparent'
  return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`
}

/** 两个 4bit 半字节打包成一字节 (低半字节为偶数位) */
export function pack4bit(nib: Uint8Array): Uint8Array {
  const n = nib.length >> 1
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (nib[i * 2] & 15) | ((nib[i * 2 + 1] & 15) << 4)
  return out
}

export function unpack4bit(packed: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size)
  const n = size >> 1
  for (let i = 0; i < n; i++) {
    const b = packed[i]
    out[i * 2] = b & 15
    out[i * 2 + 1] = (b >> 4) & 15
  }
  return out
}

/** 单帧压缩: 4bit 量化 + zlib */
export function encodeFrame(density8bit: Uint8Array): Uint8Array {
  const nib = new Uint8Array(density8bit.length)
  for (let i = 0; i < density8bit.length; i++) nib[i] = density8bit[i] >> 4
  return deflateSync(pack4bit(nib), { level: 3 })
}

/** 解压为 8bit 密度码, 便于直接上传为纹理 */
export function decodeFrame(data: Uint8Array, size: number): Uint8Array {
  const packed = inflateSync(data)
  const nib = unpack4bit(packed, size * size)
  const out = new Uint8Array(size * size)
  for (let i = 0; i < out.length; i++) out[i] = nib[i] * 17
  return out
}

/** 解压为量化值 0..15 */
export function decodeFrameNibble(data: Uint8Array, size: number): Uint8Array {
  const packed = inflateSync(data)
  return unpack4bit(packed, size * size)
}

/** 两帧量化值之间按 t 线性插值, 输出 8bit */
export function lerpNibbleFrames(a: Uint8Array, b: Uint8Array, t: number, out: Uint8Array): Uint8Array {
  const n = out.length
  if (t <= 0) {
    for (let i = 0; i < n; i++) out[i] = a[i] * 17
    return out
  }
  if (t >= 1) {
    for (let i = 0; i < n; i++) out[i] = b[i] * 17
    return out
  }
  const it = 1 - t
  for (let i = 0; i < n; i++) {
    out[i] = ((a[i] * it + b[i] * t) * 17 + 0.5) | 0
  }
  return out
}

/** 直接在 0..15 量化域做插值 (预览用, 不乘 17) */
export function lerpNibbleRaw(a: Uint8Array, b: Uint8Array, t: number, out: Uint8Array): Uint8Array {
  const n = out.length
  const it = 1 - t
  for (let i = 0; i < n; i++) out[i] = (a[i] * it + b[i] * t + 0.5) | 0
  return out
}
