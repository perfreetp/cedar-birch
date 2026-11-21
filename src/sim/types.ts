// 核心数据类型定义
export interface RoadNode {
  id: number;
  x: number;
  z: number;
}

export interface RoadEdge {
  id: number;
  a: number; // 节点 id
  b: number;
  length: number; // 米
  congestion: number; // 0..1 车流密度
  width: number; // 路面宽度 米
}

export interface RoadNetwork {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface Building {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

export interface CollectionPoint {
  id: number;
  x: number;
  z: number;
  edgeId: number;
  node: number; // 最近路网节点 id（用于路径规划）
  amount: number; // 垃圾产生量
  weight: number; // 权重（框选批量调整）
}

export interface VehicleConfig {
  id: number;
  name: string;
  color: number;
  capacity: number;
}

/** 一条行驶折线（xz 平面） */
export interface PathSeg {
  coords: Float32Array; // [x0,z0,x1,z1,...]
  cum: Float32Array; // 累计里程
  length: number;
}

export interface ScheduleSegment {
  kind: 'travel' | 'service' | 'unload';
  t0: number; // 分钟（自当日 0 点）
  t1: number;
  path?: PathSeg; // travel 段
  x: number; // 段终点/驻留位置
  z: number;
  pointId?: number;
  isReturn?: boolean; // 返程段（回场卸载）
  loadStart: number;
  loadEnd: number;
}

export interface LoadEvent {
  t: number;
  load: number;
  pointId?: number;
}

export interface VehicleSchedule {
  vehicleId: number;
  segments: ScheduleSegment[];
  departTime: number;
  endTime: number;
  totalDist: number; // 米
  loadEvents: LoadEvent[];
}

export interface SimParams {
  capacity: number; // 车辆额定装载
  threshold: number; // 触发返程的装载比例 0..1
  baseSpeed: number; // 米/分钟
  stagger: number; // 多车错峰出发间隔（分钟）
  serviceTime: number; // 单点作业时间（分钟）
  unloadTime: number; // 回场卸载时间（分钟）
  dayStart: number; // 一天开始（分钟）
  dayEnd: number;
}

export interface ExportData {
  version: 1;
  network: RoadNetwork;
  buildings: Building[];
  points: CollectionPoint[];
  vehicles: VehicleConfig[];
  orders: number[][]; // 每辆车的点位顺序（路线状态）
  depot: { x: number; z: number; node: number };
  params: SimParams;
  simTime: number;
  loadRecords: { vehicleId: number; events: LoadEvent[] }[];
}
