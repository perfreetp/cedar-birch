/* 核心逻辑冒烟测试(不经过浏览器) */
import { makeDemoTerrain, makeDemoFloodSeries, parseASC } from '../src/core/raster'
import { computeStats, computeArrivalTime, extractExtentRings, ringArea } from '../src/core/analysis'
import { DEPTH_THRESHOLD } from '../src/types'

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) console.log(`  ok  ${name} ${extra}`)
  else {
    failures++
    console.error(`FAIL  ${name} ${extra}`)
  }
}

// 1. 地形
const terrain = makeDemoTerrain(128, 128, 20)
check('terrain size', terrain.data.length === 128 * 128)
let mn = Infinity
let mx = -Infinity
for (const v of terrain.data) {
  if (v < mn) mn = v
  if (v > mx) mx = v
}
check('terrain elevation sane', mn >= 0 && mx < 500, `min=${mn.toFixed(1)} max=${mx.toFixed(1)}`)

// 2. 洪水序列:前锋应随时间向下游推进
const frames = makeDemoFloodSeries(terrain, 24, 600)
check('frame count', frames.length === 24)
const { areas, maxDepth } = computeStats(frames, terrain.cellSize)
check('areas increasing early', areas[2] < areas[8] && areas[8] < areas[16] || areas[16] > 0, `areas[2]=${areas[2]} areas[16]=${areas[16]}`)
check('maxDepth plausible', maxDepth > 1 && maxDepth <= 12, `maxDepth=${maxDepth.toFixed(2)}`)
check('first frame has some water', areas[0] >= 0)
check('later frames inundated', areas[20] > 0, `areas[20]=${areas[20]}`)

// 3. 到达时间
const times = frames.map((_, i) => i * 600)
const arrival = computeArrivalTime(frames, times)
let arrived = 0
let never = 0
for (const v of arrival) v >= 0 ? arrived++ : never++
check('some cells arrived', arrived > 0, `arrived=${arrived}`)
check('some cells never wet', never > 0, `never=${never}`)

// 4. 淹没范围提取
const rings = extractExtentRings(frames[18], terrain.width, terrain.height, terrain.originX, terrain.originY, terrain.cellSize)
check('rings extracted', rings.length > 0, `rings=${rings.length}`)
const totalRingArea = rings.reduce((s, r) => s + Math.abs(ringArea(r)), 0)
const cellArea = terrain.cellSize * terrain.cellSize
let wetCells = 0
for (const v of frames[18]) if (v >= DEPTH_THRESHOLD) wetCells++
check('ring area ~ wet cell area', Math.abs(totalRingArea - wetCells * cellArea) / (wetCells * cellArea) < 0.3, `ring=${totalRingArea.toFixed(0)} cells=${wetCells * cellArea}`)

// 5. ASC 解析
const asc = ['ncols 3', 'nrows 2', 'xllcorner 100', 'yllcorner 200', 'cellsize 10', 'NODATA_value -9999', '1 2 3', '4 -9999 6'].join('\n')
const g = parseASC(asc)
check('asc dims', g.width === 3 && g.height === 2)
check('asc origin', g.originX === 100 && g.originY === 200 + 2 * 10, `originY=${g.originY}`)
check('asc nodata', Number.isNaN(g.data[4]))
check('asc values', g.data[0] === 1 && g.data[5] === 6)

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
