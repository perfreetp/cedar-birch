// 传输函数 → 256 项 RGBA 查找表
import type { ColorStop, OpacityStop, TransferFunction } from '../types'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

function sampleColor(stops: ColorStop[], t: number): [number, number, number] {
  if (stops.length === 0) return [1, 1, 1]
  if (t <= stops[0].t) return hexToRgb(stops[0].color)
  const last = stops[stops.length - 1]
  if (t >= last.t) return hexToRgb(last.color)
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
      const ca = hexToRgb(a.color)
      const cb = hexToRgb(b.color)
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]
    }
  }
  return [1, 1, 1]
}

function sampleOpacity(stops: OpacityStop[], t: number): number {
  if (stops.length === 0) return 1
  if (t <= stops[0].t) return stops[0].v
  const last = stops[stops.length - 1]
  if (t >= last.t) return last.v
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]
    const b = stops[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
      return a.v + (b.v - a.v) * f
    }
  }
  return 1
}

/** 生成 256×4 的 RGBA LUT(0..255) */
export function computeLUT(tf: TransferFunction): Uint8Array {
  const out = new Uint8Array(256 * 4)
  const cs = [...tf.colorStops].sort((a, b) => a.t - b.t)
  const os = [...tf.opacityStops].sort((a, b) => a.t - b.t)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    const [r, g, b] = sampleColor(cs, t)
    const a = sampleOpacity(os, t)
    out[i * 4] = Math.round(r * 255)
    out[i * 4 + 1] = Math.round(g * 255)
    out[i * 4 + 2] = Math.round(b * 255)
    out[i * 4 + 3] = Math.round(a * 255)
  }
  return out
}
