// 仿真客户端
//  - 与 Worker 通信, 缓存压缩帧 (LRU), 按显示时间插值相邻帧
//  - 回放模式 (导入的导出包) 复用同一接口, 数据来自 IndexedDB / zip
//  - 播放头由 requestAnimationFrame 驱动, 支持 0.25x..8x
import type { StationDoc } from '../core/types.ts'
import type { FrameStats, AgentExport } from '../sim/engine.ts'
import { decodeFrameNibble, lerpNibbleFrames } from '../core/format.ts'
import type { MainToWorker, WorkerToMain, WorkerFrame, WorkerInfo, ExportPayload } from '../workers/protocol.ts'
import { useSim } from './store.ts'

export interface HeatFrame {
  data: Uint8Array
  size: number
  time: number
  stats: FrameStats | null
}

export interface PlaybackFrame {
  frame: number
  time: number
  compressed: Uint8Array
  stats: FrameStats
  agents?: AgentExport
}

type HeatListener = (f: HeatFrame) => void
type AgentListener = (a: AgentExport, time: number) => void

const GRID = 512

export class LiveClient {
  private worker: Worker
  private doc: StationDoc
  private seed: number
  private slots = new Map<number, PlaybackFrame>()
  private nibbles = new Map<number, Uint8Array>()
  private agentSlots = new Map<number, AgentExport>()
  private heatListeners = new Set<HeatListener>()
  private agentListeners = new Set<AgentListener>()
  private errorListeners = new Set<(m: string) => void>()
  private infoListeners = new Set<(i: WorkerInfo) => void>()
  private display = new Uint8Array(GRID * GRID)
  private pendingExport: ((p: ExportPayload) => void) | null = null
  private info: WorkerInfo | null = null
  private lastAgentFrame = -1
  private disposed = false
  private agentEvery = 8
  /** 导入回放的最后一帧时间 */
  private importedMax: number | null = null

  constructor(doc: StationDoc, seed = 20240501) {
    this.doc = doc
    this.seed = seed
    this.worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (ev: MessageEvent<WorkerToMain>) => this.onMessage(ev.data)
    this.worker.onerror = (e) => {
      this.emitError(e.message || '仿真 Worker 启动失败')
    }
    this.send({ type: 'init', doc, seed })
  }

  private send(msg: MainToWorker) {
    if (this.disposed) return
    this.worker.postMessage(msg)
  }

  private onMessage(msg: WorkerToMain) {
    switch (msg.type) {
      case 'ready':
        this.info = msg.info
        useSim.setState({ info: msg.info })
        for (const l of this.infoListeners) l(msg.info)
        break
      case 'frameBatch': {
        for (const f of msg.frames) this.accept(f)
        break
      }
      case 'status': {
        const ps = useSim.getState()
        useSim.setState({
          running: msg.running,
          frameStart: msg.frameStart,
          frameEnd: msg.frameEnd,
          framesAvailable: Math.max(0, msg.frameEnd - msg.frameStart),
          agentCount: msg.agentCount,
          recomputing: msg.recomputing,
          duration: msg.duration || ps.duration,
          displayFrame: Math.round(ps.playhead / Math.max(0.05, msg.intervalMs / 1000)),
        })
        break
      }
      case 'progress':
        useSim.setState({
          recomputing: true,
          recomputeProgress: msg.total ? msg.done / msg.total : 0,
          recomputePhase: msg.phase,
        })
        break
      case 'rewound':
        useSim.setState({ recomputing: false, recomputeProgress: 0, playhead: msg.fromTime })
        this.publish(msg.fromTime)
        break
      case 'exportData': {
        const cb = this.pendingExport
        this.pendingExport = null
        cb?.(msg.payload)
        break
      }
      case 'error':
        this.emitError(msg.message)
        break
    }
  }

  private accept(f: WorkerFrame) {
    // 修剪: 只保留播放头附近 ±600 帧
    this.slots.set(f.frame, { frame: f.frame, time: f.time, compressed: f.compressed, stats: f.stats })
    if (f.agents) {
      this.agentSlots.set(f.frame, f.agents)
      while (this.agentSlots.size > 20) {
        const first = this.agentSlots.keys().next().value
        if (first === undefined) break
        this.agentSlots.delete(first)
      }
    }
    if (this.slots.size > 1400) {
      const head = useSim.getState().displayFrame
      const keys = [...this.slots.keys()].sort((a, b) => a - b)
      for (const k of keys) {
        if (keys.length - this.slots.size < 0) break
        if (Math.abs(k - head) > 700) {
          this.slots.delete(k)
          this.nibbles.delete(k)
        }
      }
    }
    const ps = useSim.getState()
    if (ps.framesAvailable !== undefined) {
      // 只有帧号在可见范围内才更新可导出提示
    }
  }

  private nibble(slot: PlaybackFrame): Uint8Array {
    let n = this.nibbles.get(slot.frame)
    if (!n) {
      n = decodeFrameNibble(slot.compressed, GRID)
      this.nibbles.set(slot.frame, n)
      if (this.nibbles.size > 900) {
        const first = this.nibbles.keys().next().value
        if (first !== undefined) this.nibbles.delete(first)
      }
    }
    return n
  }

  // ---- 对外控制 ----
  play() {
    this.send({ type: 'prefetch', running: true, playhead: useSim.getState().playhead, speed: useSim.getState().speed })
    useSim.setState({ running: true })
  }
  pause() {
    this.send({ type: 'prefetch', running: false, playhead: useSim.getState().playhead, speed: useSim.getState().speed })
    useSim.setState({ running: false })
  }
  toggle() {
    if (useSim.getState().running) this.pause()
    else this.play()
  }
  setSpeed(s: number) {
    useSim.setState({ speed: s })
    this.send({ type: 'playhead', playhead: useSim.getState().playhead, speed: s })
  }
  /** 播放头推进 (由 rAF 调用) */
  setPlayhead(t: number) {
    const d = this.importedMax || useSim.getState().duration || this.doc.params.duration
    const clamped = Math.max(0, Math.min(d, t))
    useSim.setState({ playhead: clamped })
    this.send({ type: 'playhead', playhead: clamped, speed: useSim.getState().speed })
    this.publish(clamped)
  }
  seek(t: number) {
    const st = useSim.getState()
    const d = this.importedMax || st.duration || this.doc.params.duration
    const clamped = Math.max(0, Math.min(d, t))
    const iv = this.doc.params.snapshotIntervalMs / 1000
    const frame = Math.round(clamped / iv)
    useSim.setState({ playhead: clamped, scrubbing: true, running: false })
    if (this.importedMax !== null && !useSim.getState().recomputing) {
      // 导入回放: 本地直接取帧, 无需 Worker 往返
      const slot = this.slots.get(frame) ?? this.nearestSlot(frame)
      if (slot) {
        const stats = slot.stats
        useSim.setState({ stats })
      }
    } else {
      this.send({ type: 'seek', frame })
    }
    this.publish(clamped)
    setTimeout(() => useSim.setState({ scrubbing: false }), 80)
  }

  private nearestSlot(frame: number): PlaybackFrame | null {
    let best: PlaybackFrame | null = null
    let bestD = Infinity
    for (const s of this.slots.values()) {
      const d = Math.abs(s.frame - frame)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    return best
  }
  reset() {
    this.importedMax = null
    this.slots.clear()
    this.nibbles.clear()
    this.agentSlots.clear()
    this.lastAgentFrame = -1
    this.send({ type: 'reset', seed: this.seed })
    useSim.setState({ playhead: 0, frameStart: 0, frameEnd: 0, framesAvailable: 0, recomputing: false, recomputeProgress: 0 })
    this.publish(0)
  }
  updateDoc(doc: StationDoc) {
    this.importedMax = null
    this.doc = doc
    this.slots.clear()
    this.nibbles.clear()
    this.agentSlots.clear()
    this.lastAgentFrame = -1
    this.send({ type: 'doc', doc, rebuild: true })
    useSim.setState({ playhead: 0, frameStart: 0, frameEnd: 0, framesAvailable: 0, recomputing: false, recomputeProgress: 0 })
    this.publish(0)
  }
  /** 调整闸机: 从当前播放头向后联动重算 */
  setGateWeights(changes: { obstacleId: string; laneIndex?: number; weight?: number; capacity?: number }[]) {
    const fromTime = useSim.getState().playhead
    const iv = this.doc.params.snapshotIntervalMs / 1000
    const fromFrame = Math.round(fromTime / iv)
    // 丢弃该帧之后的本地缓存, 让重算结果覆盖
    for (const k of [...this.slots.keys()]) if (k > fromFrame) this.slots.delete(k)
    for (const k of [...this.nibbles.keys()]) if (k > fromFrame) this.nibbles.delete(k)
    this.send({ type: 'gateWeights', changes, fromTime })
    useSim.setState({ recomputing: true, recomputeProgress: 0, recomputePhase: '联动重算' })
  }
  /** 载入导入的仿真包 (回放) */
  loadRun(doc: StationDoc, frames: PlaybackFrame[], agentsSnapshots: { time: number; agents: AgentExport }[]) {
    this.doc = doc
    this.slots.clear()
    this.nibbles.clear()
    this.agentSlots.clear()
    this.lastAgentFrame = -1
    const transfers: Transferable[] = []
    const wireFrames: WorkerFrame[] = frames.map((f) => {
      const c = f.compressed.slice()
      transfers.push(c.buffer)
      return { frame: f.frame, time: f.time, compressed: c, stats: f.stats }
    })
    const snapCopies = agentsSnapshots.map((a) => {
      const ag: AgentExport = {
        count: a.agents.count,
        x: a.agents.x.slice(),
        z: a.agents.z.slice(),
        heading: a.agents.heading.slice(),
        phase: a.agents.phase.slice(),
        state: a.agents.state.slice(),
      }
      return { time: a.time, agents: ag }
    })
    // 主线程同时保留一份帧表: 导入回放是只读的, 直接本地插值/拖动最顺滑
    for (const f of frames) {
      this.slots.set(f.frame, { frame: f.frame, time: f.time, compressed: f.compressed, stats: f.stats })
      if (f.agents) this.agentSlots.set(f.frame, f.agents)
    }
    this.worker.postMessage({ type: 'loadRun', doc, frames: wireFrames, agentsSnapshots: snapCopies }, transfers)
    const lastTime = frames[frames.length - 1]?.time ?? 0
    this.importedMax = lastTime || null
    // 导入的回放时长以实际帧序列为准
    this.doc = { ...doc, params: { ...doc.params, duration: Math.max(0.2, lastTime) } }
    useSim.setState({
      playhead: frames[0]?.time ?? 0,
      imported: true,
      recomputing: false,
      running: false,
      duration: Math.max(0.2, lastTime),
      frameStart: frames[0]?.frame ?? 0,
      frameEnd: (frames[frames.length - 1]?.frame ?? 0) + 1,
      framesAvailable: frames.length,
    })
    this.publish(frames[0]?.time ?? 0)
  }

  /** 回放时长 (导入的包以实际帧序列为准) */
  getDuration(): number {
    return this.doc.params.duration
  }

  setImported(v: boolean, name?: string) {
    useSim.setState({ imported: v, importName: name ?? null })
  }

  fill(count: number) {
    this.send({ type: 'fill', count })
  }
  exportData(): Promise<ExportPayload> {
    return new Promise((resolve) => {
      this.pendingExport = resolve
      this.send({ type: 'exportRequest' })
    })
  }
  /** 只取当前已生成的帧 (导出用) */
  firstAvailableFrame(): number {
    return useSim.getState().frameStart
  }

  // ---- 渲染输出 ----
  publish(time: number) {
    const iv = this.doc.params.snapshotIntervalMs / 1000
    const fd = time / iv
    const f0 = Math.floor(fd + 1e-6)
    const lo = this.slots.get(f0) ?? this.slots.get(Math.round(fd))
    const hi = this.slots.get(f0 + 1)
    if (!lo) return
    const a = this.nibble(lo)
    const b = hi ? this.nibble(hi) : a
    const t = hi ? Math.max(0, Math.min(1, fd - f0)) : 0
    lerpNibbleFrames(a, b, t, this.display)
    const stats = t < 0.5 ? lo.stats : (hi?.stats ?? lo.stats)
    useSim.setState({ stats })
    for (const l of this.heatListeners) l({ data: this.display, size: GRID, time, stats })
    // 行人: 取最近的快照
    const af = Math.round(fd)
    const candidates = [af, af - 1, af - 2, af - 3, af + 1]
    let chosen = -1
    for (const c of candidates) if (this.agentSlots.has(c)) { chosen = c; break }
    if (chosen >= 0) {
      const ag = this.agentSlots.get(chosen)
      if (ag && chosen !== this.lastAgentFrame) {
        this.lastAgentFrame = chosen
        for (const l of this.agentListeners) l(ag, chosen * iv)
        useSim.setState({ agentSnapshotTime: chosen * iv, renderedAgents: ag.count })
      }
    } else if (this.lastAgentFrame >= 0) {
      // 没有快照则保留最后一帧行人
    }
  }

  onHeat(fn: HeatListener) {
    this.heatListeners.add(fn)
    return () => this.heatListeners.delete(fn)
  }
  onAgents(fn: AgentListener) {
    this.agentListeners.add(fn)
    return () => this.agentListeners.delete(fn)
  }
  onInfo(fn: (i: WorkerInfo) => void) {
    this.infoListeners.add(fn)
    if (this.info) fn(this.info)
    return () => this.infoListeners.delete(fn)
  }
  onError(fn: (m: string) => void) {
    this.errorListeners.add(fn)
    return () => this.errorListeners.delete(fn)
  }
  private emitError(m: string) {
    for (const l of this.errorListeners) l(m)
    useSim.setState({ workerError: m })
  }
  get agentFrameEvery() {
    return this.agentEvery
  }
  getDoc() {
    return this.doc
  }
  dispose() {
    this.disposed = true
    this.send({ type: 'dispose' })
    this.worker.terminate()
    this.heatListeners.clear()
    this.agentListeners.clear()
  }
}
