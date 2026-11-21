import {
  Building,
  CollectionPoint,
  ExportData,
  RoadNetwork,
  SimParams,
  VehicleConfig,
  VehicleSchedule,
} from './types';
import { generateDemoNetwork, generatePoints, pickDepot } from './demo';
import { buildSchedule, evalSchedule, EvalResult, ScheduleContext } from './scheduler';
import { tspOrder } from './tsp';

export const VEHICLE_COLORS = [0x4fc3f7, 0xffb74d, 0x81c784, 0xba68c8, 0xf06292, 0xfff176, 0x4db6ac, 0xff8a65];

export class SimWorld implements ScheduleContext {
  network: RoadNetwork = { nodes: [], edges: [] };
  buildings: Building[] = [];
  points: CollectionPoint[] = [];
  pointMap = new Map<number, CollectionPoint>();
  vehicles: VehicleConfig[] = [];
  orders: number[][] = [];
  schedules: VehicleSchedule[] = [];
  depot = { x: 0, z: 0, node: 0 };
  params: SimParams = {
    capacity: 6000,
    threshold: 0.85,
    baseSpeed: 500,
    stagger: 15,
    serviceTime: 0.5,
    unloadTime: 6,
    dayStart: 360, // 06:00
    dayEnd: 1080, // 18:00
  };

  /** 时间轴长度（分钟）：覆盖全天与最晚收车时间 */
  get dayLength(): number {
    let end = this.params.dayEnd;
    for (const s of this.schedules) end = Math.max(end, s.endTime);
    return Math.max(60, end - this.params.dayStart);
  }

  eff(p: CollectionPoint): number {
    return p.amount * p.weight;
  }

  generateDemo(pointCount = 1200, vehicleCount = 3): void {
    const { network, buildings } = generateDemoNetwork();
    this.network = network;
    this.buildings = buildings;
    this.points = generatePoints(network, pointCount);
    this.depot = pickDepot(network);
    this.makeVehicles(vehicleCount);
    this.afterPointsChanged(true);
  }

  makeVehicles(n: number): void {
    this.vehicles = Array.from({ length: n }, (_, i) => ({
      id: i,
      name: `车辆 ${i + 1}`,
      color: VEHICLE_COLORS[i % VEHICLE_COLORS.length],
      capacity: this.params.capacity,
    }));
  }

  private afterPointsChanged(reassign: boolean): void {
    this.pointMap = new Map(this.points.map((p) => [p.id, p]));
    if (reassign) this.assign();
    this.recomputeSchedules();
  }

  /** 按场站极角分区 + TSP 排序，把点位分配给各车 */
  private assign(): void {
    const sorted = [...this.points].sort(
      (a, b) =>
        Math.atan2(a.z - this.depot.z, a.x - this.depot.x) -
        Math.atan2(b.z - this.depot.z, b.x - this.depot.x),
    );
    const total = sorted.reduce((s, p) => s + this.eff(p), 0);
    const k = Math.max(1, this.vehicles.length);
    this.orders = Array.from({ length: k }, () => []);
    let v = 0;
    let acc = 0;
    const target = total / k;
    for (const p of sorted) {
      this.orders[v].push(p.id);
      acc += this.eff(p);
      if (acc >= target && v < k - 1) {
        v++;
        acc = 0;
      }
    }
    this.orders = this.orders.map((o) => this.optimizeOrder(o));
  }

  private optimizeOrder(order: number[]): number[] {
    const pts = order.map((id) => this.pointMap.get(id)!).filter(Boolean);
    if (pts.length !== order.length) return order;
    const perm = tspOrder(pts, this.depot);
    return perm.map((i) => order[i]);
  }

  /** 重新计算最短收运路径（TSP 优化点位顺序） */
  optimize(vid?: number): void {
    if (vid === undefined) this.orders = this.orders.map((o) => this.optimizeOrder(o));
    else if (this.orders[vid]) this.orders[vid] = this.optimizeOrder(this.orders[vid]);
    this.recomputeSchedules();
  }

  /** 拖拽调整点位顺序后调用：按新顺序重算路径与调度 */
  setOrder(vid: number, order: number[]): void {
    this.orders[vid] = order;
    this.recomputeSchedules();
  }

  /** 框选后批量调整权重 */
  applyWeight(ids: number[], factor: number): void {
    for (const id of ids) {
      const p = this.pointMap.get(id);
      if (p) p.weight = Math.round(p.weight * factor * 100) / 100;
    }
    this.recomputeSchedules();
  }

  recomputeSchedules(): void {
    this.schedules = this.vehicles.map((_, i) => buildSchedule(this, i));
  }

  positionAt(vid: number, tAbs: number): EvalResult | null {
    const s = this.schedules[vid];
    if (!s) return null;
    return evalSchedule(s, tAbs, this.depot);
  }

  setNetwork(net: RoadNetwork, buildings: Building[] = []): void {
    this.network = net;
    this.buildings = buildings;
    const count = Math.max(this.points.length, 800);
    this.points = generatePoints(net, count);
    this.depot = pickDepot(net);
    if (this.vehicles.length === 0) this.makeVehicles(3);
    this.afterPointsChanged(true);
  }

  export(simTime: number): ExportData {
    return {
      version: 1,
      network: this.network,
      buildings: this.buildings,
      points: this.points,
      vehicles: this.vehicles,
      orders: this.orders,
      depot: this.depot,
      params: this.params,
      simTime,
      loadRecords: this.schedules.map((s) => ({ vehicleId: s.vehicleId, events: s.loadEvents })),
    };
  }

  import(d: ExportData): void {
    this.network = d.network;
    this.buildings = d.buildings ?? [];
    this.points = d.points;
    this.vehicles = d.vehicles;
    this.orders = d.orders;
    this.depot = d.depot;
    this.params = { ...this.params, ...d.params };
    this.pointMap = new Map(this.points.map((p) => [p.id, p]));
    this.recomputeSchedules();
  }
}

export const world = new SimWorld();
