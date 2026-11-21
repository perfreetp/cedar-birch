import { Color3, DynamicTexture, Texture } from '@babylonjs/core'

const PX_PER_M = 256

function px(worldMeters: number): number {
  return Math.max(128, Math.min(1024, Math.round(worldMeters * PX_PER_M)))
}

function cssColor(c: Color3): string {
  return `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`
}

/**
 * 为单块翼板生成可观察朝向的网格纹理：
 * - 细网格（按 gridDensity 分格/米）+ 每 1m 加粗主线
 * - 沿 +X（展开方向）的箭头与端面条纹，用于辨认板面朝向与翻转
 * - 中央标注构件名称
 */
export function createPanelTexture(
  label: string,
  length: number,
  width: number,
  density: number,
  faceColor: Color3
): DynamicTexture {
  const w = px(length)
  const h = px(width)
  const tex = new DynamicTexture(`tex-${label}`, { width: w, height: h }, null, false)
  const ctx = tex.getContext() as CanvasRenderingContext2D
  const scale = w / length // 像素 / 米（宽高同比例）
  const cell = 1 / Math.max(1, density) // 每格世界尺寸（米）

  // 底色
  ctx.fillStyle = cssColor(faceColor)
  ctx.fillRect(0, 0, w, h)

  // 细网格
  ctx.lineWidth = 1
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.beginPath()
  for (let x = cell; x < length; x += cell) {
    ctx.moveTo(x * scale, 0)
    ctx.lineTo(x * scale, h)
  }
  for (let y = cell; y < width; y += cell) {
    ctx.moveTo(0, y * scale)
    ctx.lineTo(w, y * scale)
  }
  ctx.stroke()

  // 1m 主线
  ctx.lineWidth = 2
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  for (let x = 1; x < length; x += 1) {
    ctx.moveTo(x * scale, 0)
    ctx.lineTo(x * scale, h)
  }
  for (let y = 1; y < width; y += 1) {
    ctx.moveTo(0, y * scale)
    ctx.lineTo(w, y * scale)
  }
  ctx.stroke()

  // 外边框
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.strokeRect(2, 2, w - 4, h - 4)

  // +X 端橙色条纹：展开方向的朝向标记
  ctx.fillStyle = 'rgba(255,152,0,0.9)'
  ctx.fillRect(w - 14, 0, 14, h)

  // 沿展开方向的箭头
  ctx.fillStyle = 'rgba(255,255,255,0.9)'
  const ax = w * 0.62
  const ay = h * 0.5
  const head = Math.min(w, h) * 0.09
  ctx.beginPath()
  ctx.moveTo(ax + head * 1.4, ay)
  ctx.lineTo(ax - head, ay - head)
  ctx.lineTo(ax - head, ay + head)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(ax - head * 2.2, ay - head * 0.28, head * 3.0, head * 0.56)

  // 构件名称
  ctx.font = `bold ${Math.max(16, Math.round(h * 0.11))}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.fillText(label, w * 0.32, h * 0.5)

  tex.update()
  tex.wrapU = Texture.CLAMP_ADDRESSMODE
  tex.wrapV = Texture.CLAMP_ADDRESSMODE
  tex.hasAlpha = false
  return tex
}
