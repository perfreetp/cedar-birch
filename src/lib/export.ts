import type { CurveSample, ExportPayload, WingConfig, AngleState } from './types'

/** 浏览器端下载一个 Data URL */
export function downloadDataURL(filename: string, url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 浏览器端下载文本内容 */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  downloadDataURL(filename, url)
  // 延迟回收，确保下载已发起
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function timestamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

/** 组装完整导出载荷：构型 + 当前姿态 + 角度曲线 */
export function buildPayload(
  cfg: WingConfig,
  time: number,
  angles: AngleState,
  curve: CurveSample[]
): ExportPayload {
  return {
    format: 'solar-wing-deploy',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: JSON.parse(JSON.stringify(cfg)) as WingConfig,
    time,
    angles: [...angles],
    curve
  }
}

/** 导出综合 JSON（姿态 + 曲线 + 构型） */
export function exportJson(payload: ExportPayload): void {
  downloadText(
    `solar-wing-${timestamp()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json'
  )
}

/** 导出角度曲线 CSV（首行表头，每行一个采样点） */
export function exportCsv(curve: CurveSample[]): void {
  if (curve.length === 0) return
  const n = curve[0].angles.length
  const header = ['time_s', ...Array.from({ length: n }, (_, i) => `hinge${i + 1}_deg`)].join(',')
  const rows = curve.map((s) => [s.t.toFixed(4), ...s.angles.map((a) => a.toFixed(3))].join(','))
  downloadText(`solar-wing-curve-${timestamp()}.csv`, [header, ...rows].join('\n'), 'text/csv')
}

/** 导出 Canvas 画面为 PNG */
export function exportCanvasPng(canvas: HTMLCanvasElement, name: string): void {
  downloadDataURL(`${name}-${timestamp()}.png`, canvas.toDataURL('image/png'))
}
