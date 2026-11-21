import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type {
  CollisionEvent,
  FairingPoseSample,
  PoseExport,
  SimParams,
  SimPhase,
  SlowMotionRate,
} from '../types';
import { FAIRING_DIMS } from './geometry';
import { createScene, type SceneRefs } from './sceneFactory';
import {
  fairingClosedPosition,
  fairingTargetPosition,
  hingeAngleSign,
} from './pose';
import { buildTracks, phaseAt, sampleTracks, type TrajectoryTracks } from '../lib/timeline';
import { DebrisSystem, DustSystem } from './particles';
import { meshesIntersect } from './bvh';
import { downloadBlob, stamp } from '../lib/config';
import { formatSimTime } from '../lib/mathUtils';

export interface EngineStats {
  t: number;
  phase: SimPhase;
  collisions: number;
  debris: number;
  dust: number;
  fps: number;
}

const MAX_T = 40;

export class SimulationEngine {
  private container: HTMLElement;
  private refs: SceneRefs;
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raf = 0;

  private params: SimParams;
  private tracks: TrajectoryTracks;

  private simT = 0;
  private playing = false;
  private rate: SlowMotionRate = 1;
  private debrisBursted = false;

  private debris: DebrisSystem;
  private dust: DustSystem;
  private collisions: CollisionEvent[] = [];

  private onStats?: (s: EngineStats) => void;
  private statAccum = 0;
  private frameCount = 0;
  private fpsTimer = 0;
  private fps = 0;

  private manualCam = false;

  constructor(container: HTMLElement, params: SimParams) {
    this.container = container;
    this.params = { ...params };
    this.tracks = buildTracks(this.params);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.refs = createScene();

    this.camera = new THREE.PerspectiveCamera(
      50,
      container.clientWidth / container.clientHeight,
      0.1,
      500,
    );
    // 3/4 侧视机位：既能看清绕 Z 向铰链的对称张开，又能同时覆盖两瓣斜向抛离
    this.camera.position.set(13.5, 7.5, 5);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 60;
    this.controls.minDistance = 2.5;
    this.controls.target.set(0, 6, 0);
    this.controls.addEventListener('start', () => {
      this.manualCam = true;
    });

    // 碰撞体：卫星核心 + 箭体（罩体在每帧动态检测中作为主动方）
    const blockers = [this.refs.satelliteCore, this.refs.rocketBody];
    this.debris = new DebrisSystem(600, blockers);
    this.dust = new DustSystem(800);
    this.refs.scene.add(this.debris.mesh);
    this.refs.scene.add(this.dust.points);

    window.addEventListener('resize', this.handleResize);
    this.applyParamsToScene();
    this.applyFairingPose(0);
    this.loop();
  }

  // —— 对外控制 ——

  setStatsHandler(fn: (s: EngineStats) => void): void {
    this.onStats = fn;
  }

  setParams(next: SimParams): void {
    this.params = { ...next };
    this.tracks = buildTracks(this.params);
    this.applyParamsToScene();
    this.ensureBurst();
    this.applyFairingPose(this.simT);
  }

  play(): void {
    this.playing = true;
    this.clock.getDelta();
  }

  pause(): void {
    this.playing = false;
  }

  reset(): void {
    this.playing = false;
    this.simT = 0;
    this.collisions = [];
    this.debrisBursted = false;
    this.debris.reset();
    this.dust.reset();
    this.applyFairingPose(0);
    this.manualCam = false;
    this.camera.position.set(13.5, 7.5, 5);
    this.controls.target.set(0, 6, 0);
    this.pushStats();
  }

  seek(t: number): void {
    const clamped = Math.max(0, Math.min(MAX_T, t));
    const backwards = clamped < this.simT;
    this.simT = clamped;
    if (backwards) {
      // 回退：清空一次性粒子，若仍在分离后则在新位置重新迸发
      this.debris.reset();
      this.dust.reset();
      this.debrisBursted = false;
    }
    this.ensureBurst();
    this.applyFairingPose(this.simT);
    // 粒子按当前时间快进重放到 simT
    if (this.debrisBursted) {
      const since = this.simT - this.params.separationTime;
      const steps = Math.min(40, Math.ceil(since / (1 / 30)));
      const dt = since / Math.max(1, steps);
      for (let i = 0; i < steps; i++) {
        this.debris.update(this.params.separationTime + dt * (i + 1), dt);
        this.dust.update(this.params.separationTime + dt * (i + 1), dt);
      }
    }
    this.pushStats();
  }

  setRate(rate: SlowMotionRate): void {
    this.rate = rate;
  }

  get time(): number {
    return this.simT;
  }

  get maxTime(): number {
    return MAX_T;
  }

  get collisionList(): CollisionEvent[] {
    return [...this.collisions];
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // —— 导出 ——

  /** 导出当前画面 PNG（保留分离瞬间画面） */
  exportSnapshot(): void {
    this.renderer.render(this.refs.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `fairing-snapshot-t${this.simT.toFixed(1)}-${stamp()}.png`);
    }, 'image/png');
  }

  /** 导出两瓣罩体位姿数据 JSON（关键帧插值采样） */
  exportPoseData(hz = 30): void {
    const p = this.params;
    const windowStart = Math.max(0, p.separationTime - 0.5);
    const windowEnd = Math.min(
      MAX_T,
      p.separationTime + p.openDuration + p.jettisonDuration + 1,
    );
    const dt = 1 / hz;
    const left: FairingPoseSample[] = [];
    const right: FairingPoseSample[] = [];
    const q = new THREE.Quaternion();
    for (let t = windowStart; t <= windowEnd + 1e-6; t += dt) {
      const s = sampleTracks(this.tracks, t);
      const phase = phaseAt(t, p);
      for (const side of [-1, 1] as const) {
        const hinge = this.refs.fairings.find((f) => f.side === side)!;
        const angle = hingeAngleSign(side) * s.angle;
        hinge.hinge.rotation.y = angle;
        hinge.hinge.position.copy(
          fairingTargetPosition(side, this.refs.baseFairingY, s.radial, s.axial),
        );
        hinge.hinge.updateWorldMatrix(true, false);
        hinge.mesh.getWorldQuaternion(q);
        const wp = new THREE.Vector3();
        hinge.mesh.getWorldPosition(wp);
        const sample: FairingPoseSample = {
          t: Number(t.toFixed(4)),
          side,
          position: [wp.x, wp.y, wp.z],
          hingeAngle: angle,
          quaternion: [q.x, q.y, q.z, q.w],
          state: phase,
        };
        (side === 1 ? right : left).push(sample);
      }
    }
    const payload: PoseExport = {
      tool: 'fairing-separation-vfx',
      version: 1,
      exportedAt: new Date().toISOString(),
      params: { ...p },
      sampleRateHz: hz,
      poses: { left, right },
    };
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      `fairing-poses-${stamp()}.json`,
    );
    this.applyFairingPose(this.simT);
  }

  // —— 内部实现 ——

  private applyParamsToScene(): void {
    const p = this.params;
    for (const f of this.refs.fairings) {
      f.hingeHelper.visible = p.showHingeHelper;
      // 装配预览：爆炸视图沿铰链背侧（±Z）脱壳分解，侧视机位下两瓣左右展开
      if (p.exploded) {
        f.hinge.userData.explodeOffset = new THREE.Vector3(
          0,
          0,
          f.side * p.explodeAmount,
        );
      } else {
        f.hinge.userData.explodeOffset = new THREE.Vector3();
      }
    }
    this.controls.autoRotate = p.autoRotate;
    this.controls.autoRotateSpeed = 1.2;
    this.debris.mesh.visible = p.showParticles;
    this.dust.points.visible = p.showParticles;
  }

  /** 爆炸视图开关：打开时回到闭合装配位姿 */
  setExploded(on: boolean): void {
    this.applyParamsToScene();
    if (on) this.seek(0);
  }

  private ensureBurst(): void {
    if (this.debrisBursted || this.simT < this.params.separationTime) return;
    const y0 = this.refs.baseFairingY + 0.3;
    const y1 = this.refs.baseFairingY + FAIRING_DIMS.H - 0.2;
    this.debris.burst(this.simT, this.params, y0, y1, FAIRING_DIMS.R);
    this.dust.burst(this.simT, this.params, y0, y1, FAIRING_DIMS.R);
    this.debrisBursted = true;
  }

  /** 关键帧插值驱动罩体位姿（转动 + 平动复合轨迹），含 BVH 防穿模回退 */
  private applyFairingPose(t: number): void {
    const p = this.params;
    const s = sampleTracks(this.tracks, t);

    for (const f of this.refs.fairings) {
      const off =
        (f.hinge.userData.explodeOffset as THREE.Vector3 | undefined) ??
        new THREE.Vector3();
      const offPOJO = { x: off.x, y: off.y, z: off.z };
      const closedPos = fairingClosedPosition(f.side, this.refs.baseFairingY, offPOJO);
      const targetAngle = hingeAngleSign(f.side) * s.angle;
      const targetPos = fairingTargetPosition(
        f.side,
        this.refs.baseFairingY,
        s.radial,
        s.axial,
        offPOJO,
      );
      f.hinge.rotation.y = targetAngle;
      f.hinge.position.copy(targetPos);
      f.hinge.updateWorldMatrix(true, false);

      // BVH 碰撞检测：罩体 vs 卫星、罩体 vs 箭体；碰撞则回退到上一安全位姿
      if (t < p.separationTime) continue;
      for (const blocker of [this.refs.satelliteCore, this.refs.rocketBody]) {
        if (!meshesIntersect(f.mesh, blocker)) continue;
        const kind = blocker === this.refs.satelliteCore
          ? 'fairing-satellite'
          : 'fairing-rocket';
        if (
          !this.collisions.some(
            (c) => c.kind === kind && c.side === f.side && Math.abs(c.t - t) < 0.25,
          )
        ) {
          this.collisions.push({ t, kind, side: f.side });
        }
        // 二分回退：在闭合位姿与目标位姿之间找最靠近目标的无碰撞位姿
        let lo = 0;
        let hi = 1;
        for (let i = 0; i < 6; i++) {
          const mid = (lo + hi) / 2;
          f.hinge.rotation.y = targetAngle * mid;
          f.hinge.position.copy(closedPos).lerp(targetPos, mid);
          f.hinge.updateWorldMatrix(true, false);
          if (meshesIntersect(f.mesh, blocker)) hi = mid;
          else lo = mid;
        }
        f.hinge.rotation.y = targetAngle * lo;
        f.hinge.position.copy(closedPos).lerp(targetPos, lo);
        f.hinge.updateWorldMatrix(true, false);
      }
    }
  }

  private updateCameraFollow(): void {
    const p = this.params;
    // 跟随模式下相机位姿锁定在分离事件中心，罩瓣抛离全程都在取景范围内；
    // 用户仍可用鼠标环绕/缩放（触发 manualCam 后本方法自动失效）
    if (p.followMode === 'manual' || this.manualCam) return;
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const wallDt = Math.min(this.clock.getDelta(), 0.1);

    if (this.playing) {
      const prevT = this.simT;
      this.simT = Math.min(MAX_T, this.simT + wallDt * this.rate);
      if (this.simT >= MAX_T) this.playing = false;
      this.ensureBurst();
      this.applyFairingPose(this.simT);
      const simDt = this.simT - prevT;
      this.debris.update(this.simT, simDt);
      this.dust.update(this.simT, simDt);
    }

    this.updateCameraFollow();
    this.controls.update();
    this.renderer.render(this.refs.scene, this.camera);

    // FPS 与节流上报
    this.frameCount++;
    this.fpsTimer += wallDt;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
    this.statAccum += wallDt;
    if (this.statAccum >= 0.1) {
      this.statAccum = 0;
      this.pushStats();
    }
  };

  private pushStats(): void {
    this.onStats?.({
      t: this.simT,
      phase: phaseAt(this.simT, this.params),
      collisions: this.collisions.length,
      debris: this.debris.activeCount,
      dust: this.dust.activeCount,
      fps: this.fps,
    });
  }

  private handleResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /** 供 UI 显示的格式化时间 */
  formatTime(t: number): string {
    return formatSimTime(t);
  }
}
