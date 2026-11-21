// 轻量断言测试 (node --test)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDemoStation } from '../src/core/defaults.ts'
import { buildNav } from '../src/sim/nav.ts'
import { SimEngine } from '../src/sim/engine.ts'
import { encodeFrame, decodeFrame, quantize, dequantize, bandIndex, DENSITY_BANDS } from '../src/core/format.ts'
import { buildExportZip, parseExportZip } from '../src/core/export.ts'
import { zipSync } from 'fflate'
import { polygonArea, pointInPolygon, sampleCurve, closestPointOnObstacle } from '../src/core/geometry.ts'
import { obstacleCorners } from '../src/core/geometry.ts'

test('polygon area & containment', () => {
  const sq: [number, number][] = [[0, 0], [4, 0], [4, 2], [0, 2]]
  assert.equal(Math.abs(polygonArea(sq)), 8)
  assert.ok(pointInPolygon(2, 1, sq))
  assert.ok(!pointInPolygon(5, 1, sq))
})

test('sampleCurve piecewise linear', () => {
  const pts: [number, number][] = [[0, 0], [10, 20], [20, 0]]
  assert.equal(sampleCurve(pts, 5), 10)
  assert.equal(sampleCurve(pts, 15), 10)
  assert.equal(sampleCurve(pts, -1), 0)
})

test('nav grid built with sources/sinks', () => {
  const doc = createDemoStation()
  const nav = buildNav(doc)
  assert.ok(nav.cols > 100)
  assert.equal(nav.sources.length, 2)
  assert.equal(nav.sinks.length, 6)
  assert.ok(nav.lanes.length >= 10)
  // 所有可走格都能到达最近汇点
  for (let i = 0; i < nav.sinks.length; i++) {
    let unreachable = 0
    for (let k = 0; k < nav.blocked.length; k++) if (!nav.blocked[k] && !isFinite(nav.sinkDist[i][k])) unreachable++
    assert.equal(unreachable, 0, `sink ${i} 有不可达格子`)
  }
})

test('density band boundaries', () => {
  assert.equal(bandIndex(0.49), -1)
  assert.equal(bandIndex(0.5), 0)
  assert.equal(bandIndex(1.5), 1)
  assert.equal(bandIndex(5.9), 4)
  assert.equal(bandIndex(6.1), DENSITY_BANDS.length)
  for (const b of DENSITY_BANDS) {
    const q = quantize(b.min)
    assert.ok(Math.abs(dequantize(q) - b.min) < 1.2)
  }
})

test('frame encode/decode roundtrip', () => {
  const S = 64
  const d = new Uint8Array(S * S)
  for (let i = 0; i < d.length; i++) d[i] = (i * 7) & 255
  const enc = encodeFrame(d)
  const dec = decodeFrame(enc, S)
  for (let i = 0; i < d.length; i++) assert.ok(Math.abs(dec[i] - d[i]) <= 16, `像素 ${i} 误差过大`)
  assert.ok(enc.length < d.length * 0.6)
})

test('obstacle closest point', () => {
  const o = {
    id: 'o', kind: 'column' as const, name: 'c', center: [0, 0] as [number, number], rotation: 0,
    size: [2, 2] as [number, number], height: 1, weight: 0.5, capacity: 10, enabled: true, solid: true,
  }
  const cp = closestPointOnObstacle(o, 3, 0)
  assert.ok(Math.abs(cp.x - 1) < 1e-6)
  assert.ok(Math.abs(cp.dist - 2) < 1e-6)
  assert.equal(obstacleCorners(o).length, 4)
})

test('simulation: deterministic & checkpoint replay', () => {
  const doc = createDemoStation()
  const a = new SimEngine(JSON.parse(JSON.stringify(doc)), 99)
  const b = new SimEngine(JSON.parse(JSON.stringify(doc)), 99)
  a.fillTo(1500)
  b.fillTo(1500)
  for (let i = 0; i < 60; i++) {
    a.step(0.1)
    b.step(0.1)
  }
  assert.equal(a.n, b.n)
  for (let i = 0; i < a.n; i++) {
    assert.equal(a.x[i], b.x[i])
    assert.equal(a.z[i], b.z[i])
  }
  const cp = a.checkpoints[a.checkpoints.length - 1]
  for (let i = 0; i < 40; i++) a.step(0.1)
  const target = { n: a.n, x: a.x.slice(0, a.n), z: a.z.slice(0, a.n), served: a.served, time: a.time }
  a.restoreCheckpoint(cp)
  while (a.time < target.time - 1e-9) a.step(0.1)
  assert.equal(a.n, target.n)
  assert.equal(a.served, target.served)
  for (let i = 0; i < a.n; i++) assert.equal(a.x[i], target.x[i])
})

test('crowd can evacuate through gates (no deadlock)', () => {
  const doc = createDemoStation()
  for (const c of doc.curves) c.points = [[0, 0], [10000, 0]]
  const e = new SimEngine(doc, 7)
  for (let k = 0; k < 200; k++) e.pushAgent(-54 + (k % 10) * 0.7, -7 + Math.floor(k / 10) * 0.7, 1.25, 0)
  for (let s = 0; s < 1800; s++) e.step(0.1)
  assert.equal(e.n, 0, `仍有 ${e.n} 人未疏散`)
  assert.equal(e.served, 200)
})

test('gate weight change rewires flow field', () => {
  const doc = createDemoStation()
  const e = new SimEngine(doc, 1)
  const gate = doc.obstacles.find((o) => o.kind === 'gate')!
  const laneIdx = e.nav.lanes.findIndex((l) => l.obstacleId === gate.id)
  const before = e.nav.cost[e.nav.lanes[laneIdx] ? 0 : 0]
  void before
  const lane = e.nav.lanes[laneIdx]
  const cell = Math.floor((lane.z - e.nav.originZ) / e.nav.cell) * e.nav.cols + Math.floor((lane.x - e.nav.originX) / e.nav.cell)
  const costBefore = e.nav.cost[cell]
  e.updateGateWeights([{ obstacleId: gate.id, laneIndex: lane.index, weight: 1 }])
  const costAfter = e.nav.cost[cell]
  assert.ok(costAfter <= costBefore, '权重提高后通行代价应下降')
  assert.equal(e.gateEvents.length, 1)
})

test('export zip roundtrip', () => {
  const doc = createDemoStation()
  const e = new SimEngine(doc, 3)
  for (let s = 0; s < 40; s++) e.step(0.1)
  const snap = e.makeSnapshot(20)
  const zip = buildExportZip({
    doc,
    frames: [{ time: snap.time, compressed: encodeFrame(snap.density), stats: snap.stats }],
    agentsSnapshots: [{ time: snap.time, agents: snap.agents }],
    frameStart: 20,
    gateEvents: [],
  })
  const run = parseExportZip(zip)
  assert.equal(run.manifest.format, 'platform-heat-sim')
  assert.equal(run.frames.length, 1)
  assert.equal(run.frames[0].time, snap.time)
  assert.equal(run.agentsSnapshots.length, 1)
  assert.equal(run.doc.meta.name, doc.meta.name)
  assert.ok(run.manifest.geometry && (run.manifest.geometry.zones as unknown[]).length > 0)
})

test('corrupt / foreign zip rejected with clear error', () => {
  const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  assert.throws(() => parseExportZip(junk), /无法解压|不是有效的 zip/)
  // 合法的 zip 但不是本工具的包
  const zip = zipSync({ 'hello.txt': new Uint8Array([104, 105]) })
  assert.throws(() => parseExportZip(zip), /缺少 manifest/)
})

test('gate weight change recorded as timeline event', () => {
  const doc = createDemoStation()
  const e = new SimEngine(doc, 5)
  for (let s = 0; s < 20; s++) e.step(0.1)
  const gate = doc.obstacles.find((o) => o.kind === 'gate')!
  // 让引擎时间与事件时间一致 (worker 中 fromTime 来自播放头)
  e.updateGateWeights([{ obstacleId: gate.id, laneIndex: 0, weight: 0.1 }])
  e.updateGateWeights([{ obstacleId: gate.id, weight: 1 }])
  assert.equal(e.gateEvents.length, 2)
  assert.equal(e.gateEvents[0].time, e.time)
  assert.match(e.gateEvents[0].changes, /权重/)
})
