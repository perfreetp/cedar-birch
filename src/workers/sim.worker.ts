/// <reference lib="webworker" />
// 仿真 Worker
//
// 模型: 主线程推"播放头", Worker 按需生成 200ms 一帧的密度帧并尽量跑在播放头前 (预取).
// 帧缓存按帧号索引, 引擎定期打检查点, 因此:
//   - 拖动回放: 命中缓存直接取帧; 未命中则回退到最近检查点, 分块补算到目标帧
//   - 联动重算: 修改闸机权重后, 从当前帧回退重算并覆盖后续帧 (带进度)
//   - 导出: 打包全部压缩帧
import { SimEngine } from '../sim/engine.ts'
import type { AgentExport, Checkpoint } from '../sim/engine.ts'
import { encodeFrame } from '../core/format.ts'
import type { MainToWorker, WorkerToMain, WorkerFrame, WorkerInfo, ExportPayload } from './protocol.ts'

interface CachedFrame {
  frame: number
  time: number
  compressed: Uint8Array
  stats: WorkerFrame['stats']
  agents?: AgentExport
}

let engine: SimEngine | null = null
let cache: CachedFrame[] = []
let frameStart = 0
let frameEnd = 0
let playheadFrame = 0
let speed = 1
let prefetching = false
let timer: ReturnType<typeof setTimeout> | null = null
let lastStatusAt = 0
/** 联动重算的结束帧; <0 表示没有重算任务 */
let recomputeTarget = -1
/** 待执行的跳转帧; <0 表示无 */
let pendingSeek = -1
/** 正在进行的分块回退任务 */
interface RewindJob {
  targetFrame: number
  /** 从哪个检查点重算 */
  cp: Checkpoint
  /** 目标: 填到 targetFrame 为止 */
  reason: 'seek' | 'gateWeights' | 'restore'
  /** 重算时广播帧 (联动重算时前端需要看到新帧) */
  broadcast: boolean
  /** 预置的状态 */
  startTime: number
}
let rewindJob: RewindJob | null = null
let includeAgentsEvery = 8
let maxFrames = 9000
const AGENTS_CAP = 5000
let importedRun = false
/** 导入回放的行人快照, 用于在该时间点之后续算 */
let importedAgents: { time: number; agents: AgentExport }[] = []

const ctx = self as unknown as DedicatedWorkerGlobalScope

function post(msg: WorkerToMain, transfer?: Transferable[]) {
  ctx.postMessage(msg, transfer ?? [])
}

function interval(): number {
  return (engine?.doc.params.snapshotIntervalMs ?? 200) / 1000
}

function info(e: SimEngine): WorkerInfo {
  const nav = e.nav
  const walkable = nav.blocked.reduce((a, b) => a + (b ? 0 : 1), 0)
  let maxRate = 0
  for (let t = 0; t < e.doc.params.duration; t += 2) maxRate = Math.max(maxRate, e.totalRate(t))
  return {
    cols: nav.cols,
    rows: nav.rows,
    cell: nav.cell,
    walkableCells: walkable,
    sources: nav.sources.length,
    sinks: nav.sinks.length,
    lanes: nav.lanes.length,
    totalArea: walkable * nav.cell * nav.cell,
    spawnRate: maxRate,
    steadyEstimate: e.estimateSteadyOccupancy(),
  }
}

function makeFrame(e: SimEngine, frame: number): CachedFrame {
  const t = frame * interval()
  e.time = t
  e.frame = frame
  const { density, maxDensity, bandCounts } = e.rasterize()
  const compressed = encodeFrame(density)
  const cf: CachedFrame = { frame, time: t, compressed, stats: e.stats(maxDensity, bandCounts) }
  if (frame % includeAgentsEvery === 0) cf.agents = e.exportAgents(AGENTS_CAP)
  return cf
}

function toWire(f: CachedFrame): { frame: WorkerFrame; transfer: Transferable[] } {
  const wf: WorkerFrame = { frame: f.frame, time: f.time, compressed: f.compressed.slice(), stats: f.stats }
  const transfer: Transferable[] = [wf.compressed.buffer]
  if (f.agents) {
    wf.agents = cloneAgents(f.agents)
    transfer.push(wf.agents.x.buffer, wf.agents.z.buffer, wf.agents.heading.buffer, wf.agents.phase.buffer, wf.agents.state.buffer)
  }
  return { frame: wf, transfer }
}

function cloneAgents(a: AgentExport): AgentExport {
  return {
    count: a.count,
    x: a.x.slice(),
    z: a.z.slice(),
    heading: a.heading.slice(),
    phase: a.phase.slice(),
    state: a.state.slice(),
  }
}

function emitStatus(force = false) {
  const e = engine
  if (!e) return
  const now = performance.now()
  if (!force && now - lastStatusAt < 200) return
  lastStatusAt = now
  post({
    type: 'status',
    running: prefetching,
    time: playheadFrame * interval(),
    frame: playheadFrame,
    frameStart,
    frameEnd,
    agentCount: e.n,
    duration: e.doc.params.duration,
    recomputing: recomputeTarget >= 0,
    recomputeTarget,
    intervalMs: e.doc.params.snapshotIntervalMs,
  })
}

function broadcast(frames: CachedFrame[]) {
  if (!frames.length) return
  const wire = frames.map(toWire)
  post({ type: 'frameBatch', frames: wire.map((w) => w.frame) }, wire.flatMap((w) => w.transfer))
}

/** 生成下一帧 (连续推进) */
function produceNextFrame(e: SimEngine): CachedFrame {
  const iv = interval()
  const dt = e.doc.params.dt
  const targetT = frameEnd * iv
  const maxSteps = Math.ceil((iv * 6) / dt) + 8
  let steps = 0
  while (e.time < targetT - 1e-9 && steps++ < maxSteps) e.step(dt)
  e.time = targetT
  e.frame = frameEnd
  const cf = makeFrame(e, frameEnd)
  cache.push(cf)
  frameEnd++
  if (cache.length > maxFrames) {
    const drop = Math.floor(maxFrames * 0.2)
    cache.splice(0, drop)
    frameStart += drop
  }
  return cf
}

/** 丢弃 frame 之后的缓存 */
function truncateCache(frame: number) {
  const keepCount = Math.max(0, frame - frameStart)
  if (cache.length > keepCount) cache.splice(keepCount)
  frameEnd = frameStart + cache.length
  if (frame < frameStart) {
    // 需要更早的帧: 清空
    cache = []
    frameStart = frame
    frameEnd = frame
  }
}

/** 启动一次分块回退 */
function startRewind(targetFrame: number, reason: RewindJob['reason'], broadcastFrames: boolean) {
  const e = engine
  if (!e) return
  if (importedRun) {
    // 导入的回放没有历史仿真: 只能从第 0 帧重放
    e.reset(e.seed)
    cache = []
    frameStart = 0
    frameEnd = 0
  }
  const iv = interval()
  const targetTime = targetFrame * iv
  const cp = e.checkpointFor(targetTime)
  e.restoreCheckpoint(cp)
  const cpFrame = Math.round(cp.time / iv)
  truncateCache(cpFrame)
  // 引擎已在 cp 时间; 若缓存缺失 cpFrame 帧, 补上
  if (cache.length > 0) {
    frameEnd = frameStart + cache.length
  }
  if (cpFrame > frameEnd - 1) {
    // 缓存里没有检查点帧本身: 直接以引擎状态为准
    frameStart = cpFrame
    frameEnd = cpFrame
    cache = []
  }
  e.time = cp.time
  e.frame = cp.frame
  rewindJob = {
    targetFrame,
    cp,
    reason,
    broadcast: broadcastFrames,
    startTime: cp.time,
  }
  playheadFrame = Math.min(targetFrame, playheadFrame)
  post({
    type: 'progress',
    phase: reason === 'gateWeights' ? '联动重算' : '跳转',
    done: 0,
    total: Math.max(1, targetFrame - cpFrame + 1),
  })
}

/** 分块执行回退任务; 返回是否完成 */
function stepRewind(budgetMs: number): boolean {
  const e = engine
  const job = rewindJob
  if (!e || !job) return true
  const t0 = performance.now()
  const iv = interval()
  const produced: CachedFrame[] = []
  while (frameEnd <= job.targetFrame) {
    const cf = produceNextFrame(e)
    if (cf.frame >= frameStart) produced.push(cf)
    if (performance.now() - t0 > budgetMs) break
    if (frameEnd > Math.max(job.targetFrame, Math.floor(e.doc.params.duration / iv))) break
  }
  if (job.broadcast) broadcast(produced)
  const total = Math.max(1, job.targetFrame - Math.round(job.startTime / iv) + 1)
  post({
    type: 'progress',
    phase: job.reason === 'gateWeights' ? '联动重算' : '跳转',
    done: Math.min(total, Math.max(0, frameEnd - Math.round(job.startTime / iv))),
    total,
  })
  if (frameEnd > job.targetFrame) {
    // 回退完成: 对齐时间
    e.time = job.targetFrame * iv
    e.frame = job.targetFrame
    rewindJob = null
    post({ type: 'rewound', fromTime: job.targetFrame * iv, reason: job.reason === 'restore' ? 'seek' : job.reason })
    return true
  }
  return false
}

/** 工作循环 */
function work() {
  timer = null
  const e = engine
  if (!e) return
  const t0 = performance.now()

  // 1) 回退任务优先
  if (rewindJob) {
    const done = stepRewind(24)
    emitStatus()
    if (!done) {
      timer = setTimeout(work, 0)
      return
    }
  }

  // 2) 待处理跳转: 若帧已在缓存内, 直接切时间
  if (pendingSeek >= 0) {
    const f = pendingSeek
    pendingSeek = -1
    if (f >= frameStart && f < frameEnd) {
      e.time = f * interval()
      e.frame = f
      playheadFrame = f
      emitStatus(true)
    } else {
      startRewind(f, 'seek', true)
      timer = setTimeout(work, 0)
      return
    }
  }

  // 3) 联动重算: 继续向后覆盖到 recomputeTarget
  if (recomputeTarget >= 0) {
    const batch: CachedFrame[] = []
    while (frameEnd <= recomputeTarget && performance.now() - t0 < 26) {
      if (frameEnd * interval() >= e.doc.params.duration - 1e-9) break
      batch.push(produceNextFrame(e))
    }
    broadcast(batch)
    const base = Math.round(rewindJob ? rewindJob.startTime / interval() : frameStart)
    post({
      type: 'progress',
      phase: '联动重算',
      done: Math.max(0, frameEnd - base),
      total: Math.max(1, recomputeTarget + 1 - base),
    })
    emitStatus()
    if (frameEnd > recomputeTarget) {
      recomputeTarget = -1
      post({ type: 'rewound', fromTime: playheadFrame * interval(), reason: 'gateWeights' })
    } else {
      timer = setTimeout(work, 0)
      return
    }
  }

  // 4) 预取
  if (prefetching) {
    const durationFrames = Math.floor(e.doc.params.duration / interval())
    const lead = Math.min(600, Math.max(60, Math.round((speed * 60) / interval())))
    const wanted = Math.min(playheadFrame + lead, durationFrames)
    const batch: CachedFrame[] = []
    while (frameEnd <= wanted && performance.now() - t0 < 22) {
      batch.push(produceNextFrame(e))
    }
    broadcast(batch)
    emitStatus()
    if (frameEnd <= wanted) timer = setTimeout(work, 0)
    return
  }

  // 5) 空闲: 补齐到播放头稍后
  const ahead = playheadFrame + 30
  if (frameEnd <= ahead && frameEnd * interval() < e.doc.params.duration - 1e-9) {
    const batch: CachedFrame[] = []
    while (frameEnd <= ahead && performance.now() - t0 < 12) {
      batch.push(produceNextFrame(e))
    }
    broadcast(batch)
    emitStatus()
    timer = setTimeout(work, 40)
  } else {
    emitStatus()
  }
}

function kick() {
  if (!timer) timer = setTimeout(work, 0)
}

function resetAll(e: SimEngine, seed: number) {
  e.reset(seed)
  cache = []
  frameStart = 0
  frameEnd = 0
  playheadFrame = 0
  recomputeTarget = -1
  pendingSeek = -1
  rewindJob = null
  prefetching = false
  importedAgents = []
  if (timer) clearTimeout(timer)
  timer = null
}

ctx.onmessage = (ev: MessageEvent<MainToWorker>) => {
  const msg = ev.data
  try {
    switch (msg.type) {
      case 'init': {
        engine = new SimEngine(msg.doc, msg.seed)
        resetAll(engine, msg.seed)
        importedRun = false
        post({ type: 'ready', info: info(engine) })
        const first = produceNextFrame(engine)
        broadcast([first])
        emitStatus(true)
        break
      }
      case 'doc': {
        if (!engine) return
        engine.doc = msg.doc
        engine.rebuild(msg.doc)
        resetAll(engine, engine.seed)
        importedRun = false
        const first = produceNextFrame(engine)
        post({ type: 'ready', info: info(engine) })
        broadcast([first])
        emitStatus(true)
        post({ type: 'docEcho', doc: engine.doc })
        break
      }
      case 'prefetch': {
        prefetching = msg.running
        speed = msg.speed
        if (prefetching) kick()
        emitStatus(true)
        break
      }
      case 'playhead': {
        // 不能覆盖引擎时间: 引擎时间由逐帧生成推进
        playheadFrame = Math.round(msg.playhead / interval())
        speed = msg.speed
        if (prefetching) kick()
        break
      }
      case 'seek': {
        // 导入回放只能落在已有帧范围内, 不触发重算
        const f = importedRun ? Math.max(frameStart, Math.min(frameEnd - 1, msg.frame)) : msg.frame
        pendingSeek = f
        prefetching = false
        kick()
        break
      }
      case 'reset': {
        if (!engine) return
        resetAll(engine, msg.seed)
        importedRun = false
        post({ type: 'ready', info: info(engine) })
        const first = produceNextFrame(engine)
        broadcast([first])
        emitStatus(true)
        break
      }
      case 'gateWeights': {
        if (!engine) return
        engine.updateGateWeights(msg.changes)
        const frame = Math.round(msg.fromTime / interval())
        const oldEnd = frameEnd
        prefetching = false
        rewindJob = null
        recomputeTarget = -1
        if (importedRun) {
          // 导入回放没有仿真检查点: 用离目标最近的导出快照恢复状态, 再向后续算
          const t = frame * interval()
          let pick: { time: number; agents: AgentExport } | null = null
          for (const a of importedAgents) {
            if (!pick || Math.abs(a.time - t) < Math.abs(pick.time - t)) pick = a
          }
          if (pick) {
            engine.restoreFromAgents(pick.agents, pick.time, 1)
            const startFrame = Math.round(pick.time / interval())
            if (Math.abs(pick.time - t) > 1e-6) {
              // 从快照推进到目标帧
              let steps = 0
              while (engine.time < t - 1e-9 && steps++ < 4000) engine.step(engine.doc.params.dt)
            }
            cache = []
            frameStart = startFrame
            frameEnd = startFrame
            rewindJob = {
              targetFrame: frame,
              cp: engine.checkpoints[0],
              reason: 'gateWeights',
              broadcast: true,
              startTime: engine.time,
            }
            playheadFrame = frame
            emitStatus(true)
            kick()
            const durationFramesI = Math.floor(engine.doc.params.duration / interval())
            recomputeTarget = Math.min(durationFramesI, Math.max(oldEnd - 1, frame + 60))
            post({ type: 'progress', phase: '联动重算', done: 0, total: Math.max(1, recomputeTarget - startFrame + 1) })
            break
          }
          // 没有快照: 退回从 0 重放
          engine.reset(engine.seed)
          cache = []
          frameStart = 0
          frameEnd = 0
        }
        startRewind(frame, 'gateWeights', true)
        // 回退完成后继续向后重算足够多帧 (至少 60 帧, 或到原来的末尾)
        const durationFrames = Math.floor(engine.doc.params.duration / interval())
        recomputeTarget = Math.min(durationFrames, Math.max(oldEnd - 1, frame + 60))
        playheadFrame = frame
        emitStatus(true)
        kick()
        break
      }
      case 'fill': {
        if (!engine) return
        // 压力测试: 人数瞬间变化, 之前的帧不再适用, 直接从第 0 帧重新生成
        if (importedRun) {
          post({ type: 'error', message: '导入的回放包是只读的, 无法填充行人' })
          break
        }
        engine.fillTo(msg.count)
        engine.restartClock()
        cache = []
        frameStart = 0
        frameEnd = 0
        playheadFrame = 0
        pendingSeek = -1
        rewindJob = null
        recomputeTarget = -1
        prefetching = false
        if (timer) clearTimeout(timer)
        timer = null
        const first = produceNextFrame(engine)
        broadcast([first])
        post({ type: 'rewound', fromTime: 0, reason: 'seek' })
        emitStatus(true)
        break
      }
      case 'loadRun': {
        // 导入回放: 直接用外部帧填满缓存, 不重算
        engine = new SimEngine(msg.doc, 1)
        engine.reset(1)
        cache = msg.frames
          .slice()
          .sort((a, b) => a.frame - b.frame)
          .map((f) => ({ frame: f.frame, time: f.time, compressed: f.compressed, stats: f.stats }))
        frameStart = cache[0]?.frame ?? 0
        frameEnd = frameStart + cache.length
        const iv2 = interval()
        for (const snap of msg.agentsSnapshots) {
          const frame = Math.round(snap.time / iv2)
          const slot = cache[frame - frameStart]
          if (slot) slot.agents = snap.agents
        }
        playheadFrame = frameStart
        prefetching = false
        recomputeTarget = -1
        pendingSeek = -1
        rewindJob = null
        importedRun = true
        importedAgents = msg.agentsSnapshots.slice().sort((a, b) => a.time - b.time)
        // 回放时长以实际帧序列为准
        if (cache.length) {
          engine.doc.params.duration = cache[cache.length - 1].time
        }
        if (timer) clearTimeout(timer)
        timer = null
        post({ type: 'ready', info: info(engine) })
        broadcast(cache.slice(0, 12))
        emitStatus(true)
        break
      }
      case 'exportRequest': {
        if (!engine) return
        const payload: ExportPayload = {
          doc: engine.doc,
          gateEvents: engine.gateEvents.slice(),
          frames: cache.map((f) => ({ frame: f.frame, time: f.time, compressed: f.compressed.slice(), stats: f.stats })),
          agentsSnapshots: cache.filter((f) => f.agents).map((f) => ({ time: f.time, agents: cloneAgents(f.agents as AgentExport) })),
          checkpointCount: engine.checkpoints.length,
          duration: engine.doc.params.duration,
          snapshotIntervalMs: engine.doc.params.snapshotIntervalMs,
          gridSize: engine.doc.params.gridSize,
          frameStart,
        }
        const transfers: Transferable[] = []
        for (const f of payload.frames) transfers.push(f.compressed.buffer)
        for (const a of payload.agentsSnapshots) {
          transfers.push(a.agents.x.buffer, a.agents.z.buffer, a.agents.heading.buffer, a.agents.phase.buffer, a.agents.state.buffer)
        }
        post({ type: 'exportData', payload }, transfers)
        break
      }
      case 'dispose': {
        prefetching = false
        if (timer) clearTimeout(timer)
        timer = null
        engine = null
        cache = []
        break
      }
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) })
  }
}
