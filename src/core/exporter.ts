import type { DatasetMeta } from '../types'
import { extractExtentRings, ringArea } from './analysis'
import { DEPTH_THRESHOLD } from '../types'

function download(filename: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 导出某时刻水深栅格为 ESRI ASCII Grid */
export function exportDepthASC(frame: Float32Array, meta: DatasetMeta, frameIndex: number): void {
  const { width, height, originX, originY, cellSize } = meta
  const xll = originX
  const yll = originY - height * cellSize
  const lines: string[] = [
    `ncols ${width}`,
    `nrows ${height}`,
    `xllcorner ${xll}`,
    `yllcorner ${yll}`,
    `cellsize ${cellSize}`,
    'NODATA_value -9999',
  ]
  for (let r = 0; r < height; r++) {
    const row: string[] = []
    for (let c = 0; c < width; c++) {
      const v = frame[r * width + c]
      row.push(!Number.isFinite(v) || v < DEPTH_THRESHOLD ? '-9999' : v.toFixed(3))
    }
    lines.push(row.join(' '))
  }
  download(`depth_t${String(frameIndex).padStart(3, '0')}.asc`, lines.join('\n'))
}

/** 导出某时刻淹没范围为 GeoJSON 多边形 */
export function exportExtentGeoJSON(frame: Float32Array, meta: DatasetMeta, frameIndex: number): void {
  const rings = extractExtentRings(frame, meta.width, meta.height, meta.originX, meta.originY, meta.cellSize)
  // 外环逆时针(面积>0),内环(岛洞)顺时针
  const outers = rings.filter((r) => ringArea(r) > 0)
  const holes = rings.filter((r) => ringArea(r) < 0)
  const polygons = outers.map((outer) => {
    // 简单归属:洞的首点在外环内则挂到该外环
    const inner = holes.filter((h) => pointInRing(h[0], outer))
    return [outer, ...inner]
  })
  const geojson = {
    type: 'FeatureCollection',
    name: `inundation_extent_t${frameIndex}`,
    features: [
      {
        type: 'Feature',
        properties: {
          frame: frameIndex,
          time_sec: meta.times[frameIndex],
          threshold_m: DEPTH_THRESHOLD,
        },
        geometry: polygons.length === 1 ? { type: 'Polygon', coordinates: polygons[0] } : { type: 'MultiPolygon', coordinates: polygons.map((p) => p) },
      },
    ],
  }
  download(`extent_t${String(frameIndex).padStart(3, '0')}.geojson`, JSON.stringify(geojson), 'application/geo+json')
}

function pointInRing(p: number[], ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
