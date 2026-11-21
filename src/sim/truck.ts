import {
  Axis,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scene,
  Space,
  SpotLight,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { makeFlareTexture } from "./textures";

/** 扫刷宽度档位对应的扫刷半径（米） */
export const BRUSH_RADII = [0.75, 1.05, 1.35];

interface Brush {
  pivot: TransformNode;
  disc: Mesh;
  side: number;
}

export class Truck {
  readonly root: TransformNode;
  heading: number;
  speed = 0;
  steer = 0;
  readonly wheelbase = 2.9;
  brushRadius = BRUSH_RADII[1];

  private brushes: Brush[] = [];
  private nozzles: Mesh[] = [];
  private wheels: Mesh[] = [];
  private sprays: ParticleSystem[] = [];
  private spots: SpotLight[] = [];
  private cones: Mesh[] = [];
  private lampMat: StandardMaterial;

  constructor(private scene: Scene, startX: number, startZ: number, startHeading: number) {
    this.heading = startHeading;
    this.root = new TransformNode("truck", scene);
    this.root.position.set(startX, 0, startZ);
    this.root.rotation.y = startHeading;

    const bodyMat = new StandardMaterial("body", scene);
    bodyMat.diffuseColor = new Color3(0.92, 0.5, 0.08);
    bodyMat.specularColor = new Color3(0.2, 0.2, 0.2);
    const darkMat = new StandardMaterial("dark", scene);
    darkMat.diffuseColor = new Color3(0.16, 0.17, 0.19);
    const tankMat = new StandardMaterial("tank", scene);
    tankMat.diffuseColor = new Color3(0.72, 0.76, 0.8);
    tankMat.specularColor = new Color3(0.4, 0.4, 0.4);
    const brushMat = new StandardMaterial("brush", scene);
    brushMat.diffuseColor = new Color3(0.85, 0.4, 0.05);
    brushMat.emissiveColor = new Color3(0.12, 0.05, 0.0);
    this.lampMat = new StandardMaterial("lamp", scene);
    this.lampMat.diffuseColor = new Color3(0.6, 0.6, 0.55);
    this.lampMat.emissiveColor = new Color3(0.25, 0.23, 0.18);

    const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number, mat: StandardMaterial) => {
      const m = MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, scene);
      m.position.set(x, y, z);
      m.material = mat;
      m.parent = this.root;
      return m;
    };

    // 底盘 / 水箱 / 驾驶室
    box("chassis", 2.0, 0.5, 4.6, 0, 0.78, 0, darkMat);
    const tank = MeshBuilder.CreateCylinder("tank", { height: 2.4, diameter: 1.5, tessellation: 24 }, scene);
    tank.rotation.x = Math.PI / 2;
    tank.position.set(0, 1.6, -0.7);
    tank.material = tankMat;
    tank.parent = this.root;
    box("cab", 1.9, 1.15, 1.4, 0, 1.5, 1.55, bodyMat);
    box("cabGlass", 1.7, 0.5, 0.15, 0, 1.65, 2.22, darkMat);
    box("rear", 1.9, 0.9, 1.2, 0, 1.35, -1.9, bodyMat);

    // 车轮
    const wheelMat = new StandardMaterial("wheel", scene);
    wheelMat.diffuseColor = new Color3(0.08, 0.08, 0.09);
    for (const [wx, wz] of [
      [-0.98, 1.5],
      [0.98, 1.5],
      [-0.98, -1.5],
      [0.98, -1.5],
    ]) {
      const w = MeshBuilder.CreateCylinder("wheel", { height: 0.4, diameter: 0.9, tessellation: 18 }, scene);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.45, wz);
      w.material = wheelMat;
      w.parent = this.root;
      this.wheels.push(w);
    }

    // 左右扫刷：pivot 在车体前部内侧，刷盘偏心安装 —— 偏角转动 pivot 时覆盖带随之平移
    for (const side of [-1, 1]) {
      const pivot = new TransformNode(`brushPivot${side}`, scene);
      pivot.parent = this.root;
      pivot.position.set(side * 0.45, 0.3, 1.3);
      const disc = MeshBuilder.CreateCylinder(`brush${side}`, { height: 0.22, diameter: 2, tessellation: 28 }, scene);
      disc.parent = pivot;
      disc.position.set(side * 0.85, 0, 0.55);
      disc.rotation.z = side * 0.08;
      disc.material = brushMat;
      this.brushes.push({ pivot, disc, side });
    }
    this.setBrushGear(2);

    // 喷水嘴（隐形发射器网格）
    for (const side of [-1, 1]) {
      const nz = MeshBuilder.CreateBox(`nozzle${side}`, { size: 0.12 }, scene);
      nz.parent = this.root;
      nz.position.set(side * 0.8, 0.32, 2.3);
      nz.isVisible = false;
      this.nozzles.push(nz);
    }

    // 喷水粒子
    const flare = makeFlareTexture(scene);
    for (const nz of this.nozzles) {
      const ps = new ParticleSystem("spray", 240, scene);
      ps.particleTexture = flare;
      ps.emitter = nz;
      ps.isLocal = true;
      ps.minEmitBox = new Vector3(-0.05, 0, -0.05);
      ps.maxEmitBox = new Vector3(0.05, 0, 0.05);
      ps.direction1 = new Vector3(-0.5, -1, 0.5);
      ps.direction2 = new Vector3(0.5, -0.5, 1.3);
      ps.minEmitPower = 2.2;
      ps.maxEmitPower = 3.8;
      ps.minLifeTime = 0.25;
      ps.maxLifeTime = 0.5;
      ps.minSize = 0.05;
      ps.maxSize = 0.18;
      ps.emitRate = 150;
      ps.gravity = new Vector3(0, -5, 0);
      ps.color1 = new Color4(0.65, 0.78, 0.95, 0.5);
      ps.color2 = new Color4(0.55, 0.7, 0.9, 0.35);
      ps.colorDead = new Color4(0.5, 0.65, 0.85, 0);
      this.sprays.push(ps);
    }

    // 车灯：发光灯珠 + 聚光灯 + 可见光锥
    const coneMat = new StandardMaterial("cone", scene);
    coneMat.emissiveColor = new Color3(1, 0.86, 0.55);
    coneMat.alpha = 0.05;
    coneMat.disableLighting = true;
    coneMat.disableDepthWrite = true;
    for (const side of [-1, 1]) {
      const lamp = MeshBuilder.CreateSphere("lamp", { diameter: 0.22, segments: 10 }, scene);
      lamp.parent = this.root;
      lamp.position.set(side * 0.7, 1.1, 2.28);
      lamp.material = this.lampMat;

      const spot = new SpotLight(
        `headlight${side}`,
        new Vector3(side * 0.7, 1.1, 2.28),
        new Vector3(side * 0.06, -0.32, 1).normalize(),
        0.62,
        2,
        scene
      );
      spot.parent = this.root;
      spot.intensity = 0;
      spot.range = 70;
      spot.diffuse = new Color3(1, 0.92, 0.75);
      spot.specular = new Color3(1, 0.95, 0.8);
      this.spots.push(spot);

      // 可见锥形光束（夜间开启）：直径由 5 收拢到 0 的圆柱即圆锥
      const cone = MeshBuilder.CreateCylinder("beam", { height: 15, diameterBottom: 5, diameterTop: 0, tessellation: 24 }, scene);
      cone.position.y = -7.5; // 顶点移到局部原点
      cone.bakeCurrentTransformIntoVertices();
      cone.parent = this.root;
      cone.position.set(side * 0.7, 1.05, 2.3);
      cone.rotation.x = -1.32; // 锥体朝前下方张开
      cone.material = coneMat;
      cone.renderingGroupId = 1;
      cone.alphaIndex = 6;
      cone.setEnabled(false);
      this.cones.push(cone);
    }
  }

  /** 车速档位 0..3 → 目标速度 m/s */
  static readonly SPEED_GEARS = [0, 2.5, 5, 8];

  setBrushGear(gear: number): void {
    this.brushRadius = BRUSH_RADII[Math.min(2, Math.max(0, gear - 1))];
    for (const b of this.brushes) {
      b.disc.scaling.x = this.brushRadius;
      b.disc.scaling.z = this.brushRadius;
    }
  }

  /** 扫刷偏角（度）：左右 pivot 对称偏转，刷盘世界位置随之平移。 */
  setBrushAngle(deg: number): void {
    const rad = (deg * Math.PI) / 180;
    this.brushes[0].pivot.rotation.y = rad;
    this.brushes[1].pivot.rotation.y = -rad;
  }

  setWater(on: boolean): void {
    for (const ps of this.sprays) {
      if (on) ps.start();
      else ps.stop();
    }
  }

  setNight(night: boolean): void {
    for (const s of this.spots) s.intensity = night ? 3.4 : 0;
    for (const c of this.cones) c.setEnabled(night);
    this.lampMat.emissiveColor = night ? new Color3(1, 0.9, 0.6) : new Color3(0.25, 0.23, 0.18);
  }

  /** 运动学更新：目标速度 + 目标转角 → 位置/航向/滚轮/刷盘旋转。 */
  update(dt: number, targetSpeed: number, steerTarget: number, worldHalf: number): void {
    const accel = targetSpeed > this.speed ? 3.0 : 6.0;
    const dv = Math.max(-accel * dt, Math.min(accel * dt, targetSpeed - this.speed));
    this.speed += dv;
    const ds = Math.max(-2.4 * dt, Math.min(2.4 * dt, steerTarget - this.steer));
    this.steer += ds;

    if (Math.abs(this.speed) > 0.005) {
      this.heading += (this.speed / this.wheelbase) * Math.tan(this.steer) * dt;
      const fx = Math.sin(this.heading);
      const fz = Math.cos(this.heading);
      const p = this.root.position;
      p.x = Math.max(-worldHalf, Math.min(worldHalf, p.x + fx * this.speed * dt));
      p.z = Math.max(-worldHalf, Math.min(worldHalf, p.z + fz * this.speed * dt));
    }
    this.root.rotation.y = this.heading;

    const roll = (this.speed * dt) / 0.45;
    for (const w of this.wheels) w.rotate(Axis.Y, roll, Space.LOCAL);

    const spin = Math.abs(this.speed) > 0.1 ? (2.5 + Math.abs(this.speed) * 1.6) * dt : 0;
    if (spin > 0) for (const b of this.brushes) b.disc.rotate(Axis.Y, spin * b.side, Space.LOCAL);
  }

  /** 刷盘中心世界坐标（覆盖戳记位置）。 */
  brushPositions(): { x: number; z: number }[] {
    return this.brushes.map((b) => {
      const p = b.disc.getAbsolutePosition();
      return { x: p.x, z: p.z };
    });
  }

  nozzlePositions(): { x: number; z: number }[] {
    return this.nozzles.map((n) => {
      const p = n.getAbsolutePosition();
      return { x: p.x, z: p.z };
    });
  }
}
