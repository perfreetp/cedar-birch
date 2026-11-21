import {
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  FreeCamera,
  HemisphericLight,
  LinesMesh,
  MeshBuilder,
  Scene,
  Vector3,
  WebGPUEngine,
} from "@babylonjs/core";
import { CoverageLayer } from "./coverage";
import { AutoPilot, InputController } from "./drive";
import { ringRoadArea, roundedRectPoint } from "./geom";
import { Truck } from "./truck";
import { buildWorld, setHeatMode, updateDecals, type WorldRefs } from "./world";

export interface SimParams {
  driveMode: "manual" | "auto";
  /** 车速档位 0..3 */
  speedGear: number;
  /** 扫刷宽度档位 1..3 */
  brushGear: number;
  /** 扫刷偏角（度） */
  brushAngleDeg: number;
  water: boolean;
  night: boolean;
  topView: boolean;
  heatView: boolean;
}

export interface SimStats {
  engine: string;
  fps: number;
  speedKmh: number;
  coveragePct: number;
  areaM2: number;
  dirtLeft: number;
  x: number;
  z: number;
}

const WORLD_SIZE = 240;
const WORLD_HALF = WORLD_SIZE / 2 - 6;
const RING_AREA = ringRoadArea();
const PIXEL_AREA = (WORLD_SIZE / 1024) ** 2;

export class Simulation {
  private engine!: Engine | WebGPUEngine;
  private scene!: Scene;
  private camera!: FreeCamera;
  private hemi!: HemisphericLight;
  private sun!: DirectionalLight;
  private coverage!: CoverageLayer;
  private world!: WorldRefs;
  private truck!: Truck;
  private autopilot!: AutoPilot;
  private input!: InputController;

  private params!: SimParams;
  private onStats!: (s: SimStats) => void;
  private engineLabel = "WebGL2";

  private trajectory: [number, number][] = [];
  private trajLine: LinesMesh | null = null;

  private lastBrushStamp = [{ x: 1e9, z: 1e9 }, { x: 1e9, z: 1e9 }];
  private decalTimer = 0;
  private trajTimer = 0;
  private statsTimer = 0;
  private dirtLeft = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  async init(params: SimParams, onStats: (s: SimStats) => void): Promise<void> {
    this.params = params;
    this.onStats = onStats;

    // WebGPU 优先，失败回退 WebGL2
    let engine: Engine | WebGPUEngine;
    try {
      if (await WebGPUEngine.IsSupportedAsync) {
        const gpu = new WebGPUEngine(this.canvas, { antialias: true, adaptToDeviceRatio: true });
        await gpu.initAsync();
        engine = gpu;
        this.engineLabel = "WebGPU";
      } else {
        engine = new Engine(this.canvas, true, { adaptToDeviceRatio: true });
      }
    } catch {
      engine = new Engine(this.canvas, true, { adaptToDeviceRatio: true });
    }
    this.engine = engine;

    const scene = (this.scene = new Scene(engine));
    scene.clearColor = new Color4(0.52, 0.66, 0.82, 1);

    this.hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.1), scene);
    this.hemi.intensity = 0.85;
    this.hemi.groundColor = new Color3(0.3, 0.3, 0.32);
    this.sun = new DirectionalLight("sun", new Vector3(-0.4, -1, 0.35), scene);
    this.sun.intensity = 0.75;

    this.camera = new FreeCamera("cam", new Vector3(-30, 28, 55), scene);
    this.camera.fov = 0.85;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 800;
    this.camera.setTarget(Vector3.Zero());

    this.coverage = new CoverageLayer(scene, WORLD_SIZE, 1024);
    this.world = buildWorld(scene, this.coverage, WORLD_SIZE);
    this.dirtLeft = this.world.decals.length;

    // 车辆初始位置：环线上某点，朝切线方向
    const start = roundedRectPoint(0);
    const heading = Math.atan2(start.tx, start.tz);
    this.truck = new Truck(scene, start.x, start.z, heading);

    this.autopilot = new AutoPilot();
    this.input = new InputController();
    this.input.attach();

    engine.runRenderLoop(() => {
      const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
      this.tick(dt);
      scene.render();
    });
    window.addEventListener("resize", this.onResize);
  }

  private onResize = () => this.engine.resize();

  private tick(dt: number): void {
    const p = this.params;
    const truck = this.truck;

    // ---- 驾驶 ----
    const gearMax = Truck.SPEED_GEARS[Math.min(3, Math.max(0, p.speedGear))];
    let targetSpeed = 0;
    let steerTarget = 0;
    if (p.driveMode === "auto") {
      targetSpeed = gearMax;
      steerTarget = this.autopilot.steer(
        truck.root.position.x,
        truck.root.position.z,
        truck.heading,
        9,
        truck.wheelbase
      );
    } else {
      if (this.input.forward) targetSpeed = gearMax;
      else if (this.input.back) targetSpeed = -2;
      if (this.input.left) steerTarget = 0.55;
      else if (this.input.right) steerTarget = -0.55;
    }
    truck.update(dt, targetSpeed, steerTarget, WORLD_HALF);

    // ---- 作业参数 ----
    truck.setBrushGear(p.brushGear);
    truck.setBrushAngle(p.brushAngleDeg);
    truck.setWater(p.water);
    truck.setNight(p.night);
    this.coverage.stampRadius = truck.brushRadius;

    // ---- 覆盖戳记（移动足够距离才盖新戳，避免低速过饱和） ----
    const moving = Math.abs(truck.speed) > 0.15;
    if (moving) {
      const brushes = truck.brushPositions();
      for (let i = 0; i < brushes.length; i++) {
        const b = brushes[i];
        const last = this.lastBrushStamp[i];
        const dx = b.x - last.x;
        const dz = b.z - last.z;
        if (dx * dx + dz * dz > 0.06) {
          this.coverage.stamp(b.x, b.z);
          last.x = b.x;
          last.z = b.z;
        }
      }
      if (p.water) {
        for (const n of truck.nozzlePositions()) this.coverage.stampWet(n.x, n.z, 0.9);
      }
    }
    this.coverage.update(dt);

    // ---- 污渍淡出（限频，采样读回共享一次） ----
    this.decalTimer += dt;
    if (this.decalTimer >= 0.12) {
      this.decalTimer = 0;
      this.coverage.beginSampling();
      this.dirtLeft = updateDecals(this.world.decals, this.coverage);
    }

    // ---- 轨迹 ----
    this.trajTimer += dt;
    if (this.trajTimer >= 0.35 && moving) {
      this.trajTimer = 0;
      const tp = truck.root.position;
      const last = this.trajectory[this.trajectory.length - 1];
      if (!last || Math.hypot(tp.x - last[0], tp.z - last[1]) > 1.2) {
        this.trajectory.push([tp.x, tp.z]);
        if (this.trajectory.length > 20000) this.trajectory.shift();
        this.rebuildTrajLine();
      }
    }

    // ---- 昼夜 / 视图 ----
    this.hemi.intensity = p.night ? 0.12 : 0.85;
    this.sun.intensity = p.night ? 0.03 : 0.75;
    this.scene.clearColor = p.night ? new Color4(0.008, 0.01, 0.02, 1) : new Color4(0.52, 0.66, 0.82, 1);
    setHeatMode(this.world, this.coverage, p.heatView);

    // ---- 相机 ----
    const tp = truck.root.position;
    const fx = Math.sin(truck.heading);
    const fz = Math.cos(truck.heading);
    const k = 1 - Math.exp(-4 * dt);
    if (p.topView) {
      this.camera.upVector.set(0, 0, 1);
      const top = new Vector3(0, 175, 0.4);
      this.camera.position = Vector3.Lerp(this.camera.position, top, k);
      this.camera.setTarget(new Vector3(0, 0, 0.4));
    } else {
      this.camera.upVector.set(0, 1, 0);
      const chase = new Vector3(tp.x - fx * 13, 7.5, tp.z - fz * 13);
      this.camera.position = Vector3.Lerp(this.camera.position, chase, k);
      this.camera.setTarget(new Vector3(tp.x + fx * 7, 1.4, tp.z + fz * 7));
    }

    // ---- 统计 ----
    this.statsTimer += dt;
    if (this.statsTimer >= 0.25) {
      this.statsTimer = 0;
      this.coverage.beginSampling();
      const area = this.coverage.coveredPixels() * PIXEL_AREA;
      this.onStats({
        engine: this.engineLabel,
        fps: Math.round(this.engine.getFps()),
        speedKmh: Math.abs(truck.speed) * 3.6,
        coveragePct: Math.min(100, (area / RING_AREA) * 100),
        areaM2: area,
        dirtLeft: this.dirtLeft,
        x: tp.x,
        z: tp.z,
      });
    }
  }

  private rebuildTrajLine(): void {
    if (this.trajectory.length < 2) return;
    const pts = this.trajectory.map(([x, z]) => new Vector3(x, 0.14, z));
    if (this.trajLine) {
      this.trajLine = MeshBuilder.CreateLines("traj", { points: pts, instance: this.trajLine });
    } else {
      this.trajLine = MeshBuilder.CreateLines("traj", { points: pts, updatable: true }, this.scene);
      this.trajLine.color = new Color3(0.2, 0.95, 1);
      this.trajLine.alpha = 0.85;
      this.trajLine.renderingGroupId = 1;
      this.trajLine.alphaIndex = 3;
    }
  }

  /** 导出覆盖层 PNG + 车辆轨迹为 JSON 文件。 */
  exportRun(): void {
    const data = {
      type: "sweeper-run",
      version: 1,
      worldSize: WORLD_SIZE,
      exportedAt: new Date().toISOString(),
      coveragePng: this.coverage.toDataURL(),
      trajectory: this.trajectory,
    };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sweeper-run-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /** 载入历史作业文件：恢复覆盖层（之后继续行驶会继续叠加）与轨迹。 */
  async importRun(file: File): Promise<void> {
    const data = JSON.parse(await file.text());
    if (data?.type !== "sweeper-run" || typeof data.coveragePng !== "string") {
      throw new Error("不是有效的作业文件");
    }
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("覆盖层图片解码失败"));
      img.src = data.coveragePng;
    });
    this.coverage.loadImage(img);
    if (Array.isArray(data.trajectory)) {
      this.trajectory = data.trajectory.filter(
        (p: unknown) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number")
      );
      if (this.trajLine) {
        this.trajLine.dispose();
        this.trajLine = null;
      }
      this.rebuildTrajLine();
    }
  }

  clearCoverage(): void {
    this.coverage.clear();
  }

  dispose(): void {
    this.input?.dispose();
    window.removeEventListener("resize", this.onResize);
    this.scene?.dispose();
    this.engine?.dispose();
  }
}
