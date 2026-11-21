// 共享类型定义

export type Vec3 = [number, number, number]

/** .lcf 文件头(JSON 部分) */
export interface DatasetHeader {
  dims: Vec3 // 体素维度 [nx, ny, nz]
  spacing: Vec3 // 体素物理间距
  origin: Vec3 // 网格原点
  channels: string[] // 固定为 ["u","v","w","t"]
}

export interface DatasetMeta {
  name: string
  header: DatasetHeader
  /** 归一化用的值域(统计得到) */
  ranges: { temp: [number, number]; speed: [number, number] }
  chunkGrid: Vec3 // 64^3 分块网格
  chunkSize: number
}

export interface ColorStop {
  t: number // 0..1
  color: string // #rrggbb
}

export interface OpacityStop {
  t: number // 0..1
  v: number // 0..1 不透明度
}

export interface TransferFunction {
  colorStops: ColorStop[]
  opacityStops: OpacityStop[]
}

export type Channel = 'temp' | 'speed'

export interface AxisSlice {
  enabled: boolean
  pos: number // 0..1 归一化位置
}

export interface FreeSlice {
  enabled: boolean
  theta: number // 法线球坐标(度)
  phi: number
  offset: number // 沿法线偏移,-1..1(相对包围盒对角线一半)
}

export interface SlicesState {
  x: AxisSlice
  y: AxisSlice
  z: AxisSlice
  free: FreeSlice
}

export interface LightState {
  pos: Vec3
  intensity: number
  ambient: number
}

export interface CameraState {
  position: Vec3
  target: Vec3
  up: Vec3
}

/** 导出/导入的设置文件结构 */
export interface SavedSettings {
  app: 'lcf-volume-viewer'
  version: 1
  tf: { temp: TransferFunction; speed: TransferFunction }
  activeChannel: Channel
  slices: SlicesState
  light: LightState
  camera: CameraState
}

export type LoadPhase =
  | 'idle'
  | 'parsing'
  | 'extract' // Worker 解析+统计
  | 'bake' // Worker 按传输函数烘焙
  | 'ready'

export interface Progress {
  phase: LoadPhase
  done: number
  total: number
}
