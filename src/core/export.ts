// 导出/导入: 站点参数 + 热力序列 + 行人快照 + 统计打包为 zip
import { zipSync, unzipSync, strToU8, strFromU8, type Zippable } from 'fflate'
import type { StationDoc } from './types.ts'
import { DENSITY_BANDS } from './format.ts'
import type { FrameStats } from '../sim/engine.ts'
import type { AgentExport } from '../sim/engine.ts'

export const EXPORT_FORMAT = 'platform-heat-sim'
export const EXPORT_VERSION = 1

export interface ExportManifest {
  format: string
  version: number
  createdAt: string
  app: string
  station: { name: string; line: string; note: string; id: string }
  frameCount: number
  frameStart: number
  snapshotIntervalMs: number
  gridSize: number
  densityMax: number
  duration: number
  params: StationDoc['params']
  agentsEvery: number
  files: Record<string, string>
  notes: string[]
  bands?: { min: number; max: number; color: number[]; label: string }[]
  gateEventCount?: number
  geometry?: {
    outlinePoints: number
    zones: unknown[]
    obstacles: unknown[]
  }
}

export interface ExportInput {
  doc: StationDoc
  frames: { time: number; compressed: Uint8Array; stats: FrameStats }[]
  agentsSnapshots: { time: number; agents: AgentExport }[]
  frameStart: number
  gateEvents?: { time: number; obstacleId: string; label: string; changes: string }[]
}

function pad(n: number, w = 6): string {
  return String(n).padStart(w, '0')
}

export function serializeAgents(a: AgentExport): Uint8Array {
  const header = 8
  const stride = 4 * 4 + 1
  const out = new Uint8Array(header + a.count * stride)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, a.count, true)
  dv.setUint32(4, 0, true)
  let o = header
  for (let i = 0; i < a.count; i++) {
    dv.setFloat32(o, a.x[i], true)
    dv.setFloat32(o + 4, a.z[i], true)
    dv.setFloat32(o + 8, a.heading[i], true)
    dv.setFloat32(o + 12, a.phase[i], true)
    out[o + 16] = a.state[i]
    o += stride
  }
  return out
}

export function deserializeAgents(buf: Uint8Array): AgentExport {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const count = dv.getUint32(0, true)
  const stride = 4 * 4 + 1
  const a: AgentExport = {
    count,
    x: new Float32Array(count),
    z: new Float32Array(count),
    heading: new Float32Array(count),
    phase: new Float32Array(count),
    state: new Uint8Array(count),
  }
  let o = 8
  for (let i = 0; i < count; i++) {
    a.x[i] = dv.getFloat32(o, true)
    a.z[i] = dv.getFloat32(o + 4, true)
    a.heading[i] = dv.getFloat32(o + 8, true)
    a.phase[i] = dv.getFloat32(o + 12, true)
    a.state[i] = buf[o + 16]
    o += stride
  }
  return a
}

export function buildExportZip(input: ExportInput): Uint8Array {
  const { doc, frames, agentsSnapshots, frameStart, gateEvents } = input
  const files: Zippable = {}
  const fileIndex: Record<string, string> = {}

  files['station.json'] = strToU8(JSON.stringify(doc, null, 2))
  fileIndex['station.json'] = '站台文档 (轮廓/区块/障碍物/到达曲线/参数)'

  const statsRows: (FrameStats & { file: string })[] = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const name = `frames/f${pad(frameStart + i)}.bin`
    files[name] = f.compressed
    fileIndex[name] = `4bit 量化 + zlib 压缩的 ${doc.params.gridSize}×${doc.params.gridSize} 密度帧`
    statsRows.push({ ...f.stats, file: name })
  }
  files['stats.json'] = strToU8(JSON.stringify(statsRows, null, 1))
  fileIndex['stats.json'] = '逐帧统计 (人数/均速/最大密度/五档像素数/通过人数)'

  if (agentsSnapshots.length) {
    for (const snap of agentsSnapshots) {
      const name = `agents/a${pad(Math.round(snap.time * 1000))}.bin`
      files[name] = serializeAgents(snap.agents)
      fileIndex[name] = '行人快照: u32 count + (x,z,heading,phase f32, state u8)'
    }
  }

  // 到达曲线 CSV, 便于 excel 复核
  const csv: string[] = ['curve_id,curve_name,t_seconds,rate_per_second']
  for (const curve of doc.curves) {
    for (let t = 0; t <= doc.params.duration; t += 5) {
      const pts = curve.points
      let rate = 0
      if (t <= pts[0][0]) rate = pts[0][1]
      else if (t >= pts[pts.length - 1][0]) rate = pts[pts.length - 1][1]
      else {
        for (let i = 1; i < pts.length; i++) {
          if (t <= pts[i][0]) {
            const [t0, v0] = pts[i - 1]
            const [t1, v1] = pts[i]
            rate = v0 + ((v1 - v0) * (t - t0)) / Math.max(1e-6, t1 - t0)
            break
          }
        }
      }
      csv.push(`${curve.id},${curve.name},${t},${rate.toFixed(3)}`)
    }
  }
  files['curves.csv'] = strToU8(csv.join('\n'))
  fileIndex['curves.csv'] = '到达曲线采样 (每 5 秒)'

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    createdAt: new Date().toISOString(),
    app: '站台客流热力仿真工具',
    station: { ...doc.meta, id: doc.id },
    frameCount: frames.length,
    frameStart,
    snapshotIntervalMs: doc.params.snapshotIntervalMs,
    gridSize: doc.params.gridSize,
    densityMax: doc.params.densityMax,
    duration: doc.params.duration,
    params: doc.params,
    agentsEvery: 10,
    files: fileIndex,
    bands: DENSITY_BANDS.map((b) => ({ min: b.min, max: b.max, color: b.color, label: b.label })),
    gateEventCount: gateEvents?.length ?? 0,
    geometry: {
      outlinePoints: doc.outline.outer.length,
      zones: doc.zones.map((z) => ({ id: z.id, name: z.name, kind: z.kind, isSource: !!z.isSource, isSink: !!z.isSink, serviceRate: z.serviceRate ?? null, vertexCount: z.polygon.length })),
      obstacles: doc.obstacles.map((o) => ({ id: o.id, kind: o.kind, name: o.name, center: o.center, rotation: o.rotation, size: o.size, height: o.height, weight: o.weight, capacity: o.capacity, gateCount: o.gateCount ?? null, gateWeights: o.gateWeights ?? null, gateCapacities: o.gateCapacities ?? null, solid: o.solid })),
    },
    notes: [
      '密度帧为 512×512 网格的 4bit 量化值, 每格密度 = q/15 × 16 人/m², 即步长 1.067 人/m²',
      '解压: inflate 后每字节低半字节为偶数格, 高半字节为奇数格',
      '帧时间 = (frameStart + index) × snapshotIntervalMs / 1000 秒',
      '四邻域插值即可还原两帧之间的过渡',
    ],
  }
  files['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2))
  files['README.txt'] = strToU8(
    [
      '站台客流热力仿真导出包',
      '========================',
      `站台: ${doc.meta.name}  ${doc.meta.line}`,
      `导出时间: ${manifest.createdAt}`,
      `帧数: ${frames.length} (每帧 ${doc.params.snapshotIntervalMs} ms)`,
      '',
      '目录说明:',
      ...Object.entries(fileIndex).map(([k, v]) => `  ${k}: ${v}`),
      '',
      '校验: 所有 .bin 为 zlib(deflate) 流, 可用任意 zlib 实现解压.',
    ].join('\n'),
  )

  return zipSync(files, { level: 6 })
}

export interface ImportedRun {
  doc: StationDoc
  manifest: ExportManifest
  frames: { time: number; compressed: Uint8Array; stats: FrameStats }[]
  agentsSnapshots: { time: number; agents: AgentExport }[]
  gateEvents: { time: number; obstacleId: string; label: string; changes: string }[]
}

export function parseExportZip(data: Uint8Array): ImportedRun {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch {
    throw new Error('无法解压: 文件不是有效的 zip, 或已损坏')
  }
  const manifestRaw = entries['manifest.json']
  if (!manifestRaw) throw new Error('压缩包缺少 manifest.json, 不是本工具导出的仿真包')
  let manifest: ExportManifest
  try {
    manifest = JSON.parse(strFromU8(manifestRaw)) as ExportManifest
  } catch {
    throw new Error('manifest.json 解析失败')
  }
  if (manifest.format !== EXPORT_FORMAT) throw new Error(`未知文件格式: ${manifest.format}`)
  if (manifest.version > EXPORT_VERSION) throw new Error(`导出包版本 ${manifest.version} 高于当前程序支持的 ${EXPORT_VERSION}, 请更新工具`)
  if (!manifest.station || typeof manifest.station.name !== 'string') throw new Error('manifest 缺少站点信息')
  const stationRaw = entries['station.json']
  if (!stationRaw) throw new Error('压缩包缺少 station.json')
  let doc: StationDoc
  try {
    doc = JSON.parse(strFromU8(stationRaw)) as StationDoc
  } catch {
    throw new Error('station.json 解析失败')
  }
  if (!doc.outline || !Array.isArray(doc.outline.outer) || doc.outline.outer.length < 3) {
    throw new Error('站点文档缺少有效的站台轮廓')
  }
  if (!Array.isArray(doc.zones) || !Array.isArray(doc.obstacles) || !Array.isArray(doc.curves)) {
    throw new Error('站点文档结构不完整 (zones/obstacles/curves)')
  }
  const stats = entries['stats.json'] ? (JSON.parse(strFromU8(entries['stats.json'])) as (FrameStats & { file: string })[]) : []
  const statsByFile = new Map(stats.map((s) => [s.file, s]))
  const frames: ImportedRun['frames'] = []
  const iv = (manifest.snapshotIntervalMs || 200) / 1000
  for (const [name, buf] of Object.entries(entries)) {
    if (!name.startsWith('frames/') || !name.endsWith('.bin')) continue
    const idx = Number(name.slice(7, -4).replace(/^f/, ''))
    const st = statsByFile.get(name)
    frames.push({
      time: idx * iv,
      compressed: buf,
      stats:
        st ??
        ({
          time: idx * iv,
          occupancy: 0,
          meanSpeed: 0,
          maxDensity: 0,
          bandCounts: [0, 0, 0, 0, 0, 0],
          served: 0,
          waitingAtGates: 0,
          spill: 0,
          meanDensity: 0,
        } as FrameStats),
    })
  }
  frames.sort((a, b) => a.time - b.time)
  if (frames.length === 0) throw new Error('仿真包中没有任何密度帧')
  const agentsSnapshots: ImportedRun['agentsSnapshots'] = []
  for (const [name, buf] of Object.entries(entries)) {
    if (!name.startsWith('agents/') || !name.endsWith('.bin')) continue
    const ms = Number(name.slice(7, -4).replace(/^a/, ''))
    agentsSnapshots.push({ time: ms / 1000, agents: deserializeAgents(buf) })
  }
  agentsSnapshots.sort((a, b) => a.time - b.time)
  const gateEvents = entries['gate-events.json']
    ? (JSON.parse(strFromU8(entries['gate-events.json'])) as ImportedRun['gateEvents'])
    : []
  return { doc, manifest, frames, agentsSnapshots, gateEvents }
}
