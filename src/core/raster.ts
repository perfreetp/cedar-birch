import type { RasterGrid } from '../types'

/** 解析 ESRI ASCII Grid (.asc) */
export function parseASC(text: string): RasterGrid {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  const header: Record<string, number> = {}
  let i = 0
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([A-Za-z_]+)\s+(-?[\d.eE+]+)$/)
    if (!m) break
    header[m[1].toLowerCase()] = parseFloat(m[2])
  }
  const ncols = header['ncols']
  const nrows = header['nrows']
  const cellSize = header['cellsize']
  if (!ncols || !nrows || !cellSize) throw new Error('ASC 文件头缺少 ncols/nrows/cellsize')
  const xll = header['xllcorner'] ?? header['xllcenter'] ?? 0
  const yll = header['yllcorner'] ?? header['yllcenter'] ?? 0
  const nodata = header['nodata_value']
  const data = new Float32Array(ncols * nrows)
  let k = 0
  for (; i < lines.length && k < ncols * nrows; i++) {
    const parts = lines[i].trim().split(/\s+/)
    for (const p of parts) {
      if (p === '') continue
      let v = parseFloat(p)
      if (nodata !== undefined && v === nodata) v = NaN
      if (k < ncols * nrows) data[k++] = v
    }
  }
  if (k < ncols * nrows) throw new Error(`ASC 数据不足:期望 ${ncols * nrows} 个像元,实际 ${k}`)
  return {
    width: ncols,
    height: nrows,
    originX: xll,
    originY: yll + nrows * cellSize, // 左上角 Y
    cellSize,
    data,
    nodata,
  }
}

/** 读取 GeoTIFF 首个波段 */
export async function parseGeoTIFF(buf: ArrayBuffer): Promise<RasterGrid> {
  const { fromArrayBuffer } = await import('geotiff')
  const tiff = await fromArrayBuffer(buf)
  const img = await tiff.getImage()
  const width = img.getWidth()
  const height = img.getHeight()
  const raster = (await img.readRasters({ samples: [0] }))[0] as Float32Array | Float64Array | Int16Array
  const data = new Float32Array(width * height)
  const nodata = img.getGDALNoData()
  for (let i = 0; i < data.length; i++) {
    const v = raster[i]
    data[i] = nodata !== null && v === nodata ? NaN : v
  }
  const [ox, oy] = img.getOrigin()
  const [rx, ry] = img.getResolution()
  return {
    width,
    height,
    originX: ox,
    originY: oy,
    cellSize: Math.abs(rx || ry || 1),
    data,
    nodata: nodata ?? undefined,
  }
}

export async function parseRasterFile(file: File): Promise<RasterGrid> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.tif') || name.endsWith('.tiff')) {
    return parseGeoTIFF(await file.arrayBuffer())
  }
  if (name.endsWith('.asc') || name.endsWith('.txt')) {
    return parseASC(await file.text())
  }
  throw new Error(`不支持的文件格式:${file.name}(支持 .asc / .tif)`)
}

/* ---------------- 演示数据:峡谷地形 + 溃坝洪水过程 ---------------- */

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 生成 V 形河谷地形:上游窄谷、下游开阔,整体向北(行 0)倾斜 */
export function makeDemoTerrain(width = 256, height = 256, cellSize = 20): RasterGrid {
  const rand = mulberry32(42)
  const noise = new Float32Array(width * height)
  for (let i = 0; i < noise.length; i++) noise[i] = rand()
  // 简单平滑噪声
  const smooth = new Float32Array(width * height)
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      let s = 0
      let n = 0
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr >= 0 && rr < height && cc >= 0 && cc < width) {
            s += noise[rr * width + cc]
            n++
          }
        }
      }
      smooth[r * width + c] = s / n
    }
  }
  const data = new Float32Array(width * height)
  const cx = width / 2
  for (let r = 0; r < height; r++) {
    const v = r / (height - 1) // 0(北/上游坝址) → 1(南/下游)
    // 河道中心线左右蜿蜒
    const meander = Math.sin(v * Math.PI * 2.2) * width * 0.1
    const center = cx + meander
    // 谷宽:上游窄,下游渐宽
    const valleyW = width * (0.06 + v * 0.16)
    for (let c = 0; c < width; c++) {
      const d = Math.abs(c - center) / valleyW // 距河道中心的归一化距离
      const valley = Math.min(d * d, 4) * 55 // 谷坡抬升
      const slope = (1 - v) * 120 // 整体北高南低
      // 谷底噪声小(保证水面平滑)、坡面噪声大
      const h = slope + valley + smooth[r * width + c] * (1.2 + Math.min(d * d, 4) * 3.5)
      data[r * width + c] = h
    }
  }
  return { width, height, originX: 0, originY: height * cellSize, cellSize, data }
}

/**
 * 生成多时刻水深序列:洪峰自北向南推进,前锋后水深衰减,洼地壅水。
 * @returns frames[t] = 水深栅格
 */
export function makeDemoFloodSeries(terrain: RasterGrid, frameCount = 48, intervalSec = 600): Float32Array[] {
  const { width, height, data: elev } = terrain
  const frames: Float32Array[] = []
  const cx = width / 2
  // 每格沿程距离(近似:行号 + 蜿蜒修正)
  const s = new Float32Array(width * height)
  for (let r = 0; r < height; r++) {
    const v = r / (height - 1)
    const meander = Math.sin(v * Math.PI * 2.2) * width * 0.1
    const center = cx + meander
    for (let c = 0; c < width; c++) {
      const latDist = Math.abs(c - center) / (width * 0.12) // 横向距离惩罚
      s[r * width + c] = r + latDist * latDist * 30
    }
  }
  const waveSpeed = height / (frameCount * 0.8) // 前锋速度(格/帧)
  const peakDepth = 9 // 洪峰最大水深(米)
  for (let t = 0; t < frameCount; t++) {
    const front = waveSpeed * (t + 1) * 1.2 - 10
    const frame = new Float32Array(width * height)
    for (let i = 0; i < frame.length; i++) {
      const behind = front - s[i] // >0 表示洪水已到达
      if (behind <= 0) continue
      // 前锋后按指数衰减的波剖面
      const profile = peakDepth * Math.exp(-behind / 28)
      // 与上游水面衔接:洼地壅水(用上游 6 行水面高程推算)
      let depth = profile
      const r = Math.floor(i / width)
      const lookback = Math.min(r, 6)
      for (let k = 1; k <= lookback; k++) {
        const j = i - k * width
        const bj = front - s[j]
        if (bj > 0) {
          const wl = elev[j] + peakDepth * Math.exp(-bj / 28)
          const d = wl - elev[i]
          if (d > depth) depth = d
        }
      }
      if (depth > 0) frame[i] = Math.min(depth, 12)
    }
    frames.push(frame)
  }
  return frames
}
