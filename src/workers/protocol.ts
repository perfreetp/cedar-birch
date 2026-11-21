// 仿真 Worker 协议
import type { StationDoc } from '../core/types.ts'
import type { AgentExport, FrameStats } from '../sim/engine.ts'

export type MainToWorker =
  | { type: 'init'; doc: StationDoc; seed: number }
  | { type: 'doc'; doc: StationDoc; rebuild: boolean }
  | { type: 'prefetch'; running: boolean; playhead: number; speed: number }
  | { type: 'playhead'; playhead: number; speed: number }
  | { type: 'seek'; frame: number }
  | { type: 'reset'; seed: number }
  | { type: 'gateWeights'; changes: { obstacleId: string; laneIndex?: number; weight?: number; capacity?: number }[]; fromTime: number }
  | { type: 'fill'; count: number }
  | { type: 'exportRequest' }
  | { type: 'loadRun'; doc: StationDoc; frames: { frame: number; time: number; compressed: Uint8Array; stats: FrameStats }[]; agentsSnapshots: { time: number; agents: AgentExport }[] }
  | { type: 'dispose' }

export interface WorkerFrame {
  frame: number
  time: number
  compressed: Uint8Array
  stats: FrameStats
  agents?: AgentExport
}

export type WorkerToMain =
  | { type: 'ready'; info: WorkerInfo }
  | { type: 'frameBatch'; frames: WorkerFrame[] }
  | {
      type: 'status'
      running: boolean
      time: number
      frame: number
      frameStart: number
      frameEnd: number
      agentCount: number
      duration: number
      recomputing: boolean
      recomputeTarget: number
      intervalMs: number
    }
  | { type: 'rewound'; fromTime: number; reason: 'gateWeights' | 'seek' | 'restore' }
  | { type: 'progress'; phase: string; done: number; total: number }
  | { type: 'exportData'; payload: ExportPayload }
  | { type: 'error'; message: string }
  | { type: 'docEcho'; doc: StationDoc }

export interface WorkerInfo {
  cols: number
  rows: number
  cell: number
  walkableCells: number
  sources: number
  sinks: number
  lanes: number
  totalArea: number
  spawnRate: number
  steadyEstimate: number
}

export interface ExportPayload {
  doc: StationDoc
  gateEvents: { time: number; obstacleId: string; label: string; changes: string }[]
  frames: { frame: number; time: number; compressed: Uint8Array; stats: FrameStats }[]
  agentsSnapshots: { time: number; agents: AgentExport }[]
  checkpointCount: number
  duration: number
  snapshotIntervalMs: number
  gridSize: number
  frameStart: number
}
