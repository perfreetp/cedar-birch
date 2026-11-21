// 全局领域类型定义
export type CraneKind = 'gantry' | 'portal'

export interface CraneBase {
  id: string
  name: string
  kind: CraneKind
  x: number // 坞区平面坐标（米）
  z: number
  /** 额定最大起重量（吨） */
  capacityT: number
  /** 最大起升高度（米），可达域体顶高 */
  liftHeight: number
  enabled: boolean
}

/** 龙门吊：沿轨道方向移动的门式起重机，可达域为长方体 */
export interface GantryCrane extends CraneBase {
  kind: 'gantry'
  /** 轨道长度（沿 spanAxis 方向的覆盖长度，米） */
  railLength: number
  /** 跨距（垂直轨道方向的门架宽度，米） */
  span: number
  /** 轨道方向角度（弧度，世界 X 轴起算） */
  railAngle: number
  /** 吊钩小车在跨距方向可到达的域宽相对两端折减（米），通常 0 */
  margin: number
  /** 远端（沿轨道长度方向末端）剩余起重量折减系数 0~1 */
  endFactor: number
}

/** 门座吊：回转 + 变幅臂架，可达域为扇形环柱体 */
export interface PortalCrane extends CraneBase {
  kind: 'portal'
  /** 臂长（米） */
  boomLength: number
  /** 最小作业半径（米） */
  minRadius: number
  /** 臂架俯角（弧度，与水平面夹角），决定最大半径与最大钩高 */
  boomAngle: number
  /** 回转起始角（弧度，世界 X 轴起算） */
  slewStart: number
  /** 回转扫过角度（弧度，<= 2π） */
  slewRange: number
}

export type Crane = GantryCrane | PortalCrane

/** 待吊装分段 */
export interface DockSegment {
  id: string
  name: string
  x: number
  z: number
  /** 绕 Y 轴旋转（弧度） */
  rotationY: number
  length: number
  width: number
  height: number
  /** 分段重量（吨） */
  weightT: number
  /** 吊装顺序序号（从 1 开始），未排入序列为 0 */
  sequence: number
  /** 是否已吊装移走 */
  removed: boolean
}

/** 网格单元评估结果（每台吊车 × 每个单元） */
export interface CellCoverage {
  craneId: string
  reachable: boolean
  /** 该位置吊车剩余起重量（吨），不可达为 0 */
  capacity: number
  /** 被未移走的分段阻挡 */
  blocked: boolean
  /** 满足当前分段重量要求 */
  sufficient: boolean
}

export type CellStatus =
  | 'empty' // 无任何吊车可达
  | 'covered' // 可达且满足重量
  | 'insufficient' // 可达但单机不满足重量
  | 'blocked' // 被障碍物阻挡产生缺口
  | 'coop' // 多机交叠、可协同吊装

export interface GridCellResult {
  ix: number
  iz: number
  cx: number
  cz: number
  status: CellStatus
  /** 覆盖该单元的吊车 id */
  craneIds: string[]
  /** 单机最大剩余起重量 */
  maxCapacity: number
  /** 交叠吊车数量 */
  overlapCount: number
}

/** 可达域五档颜色（剩余起重量从高到低） */
export interface CapacityTier {
  minT: number
  color: [number, number, number]
  label: string
}

export interface DockLayout {
  version: 1
  dockWidth: number
  dockLength: number
  gridSize: number
  cranes: Crane[]
  segments: DockSegment[]
  exportedAt: string
}
