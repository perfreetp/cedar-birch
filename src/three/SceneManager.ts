import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { world } from '../sim/world';
import { useStore } from '../state/store';
import {
  buildBandMesh,
  buildBuildingsMesh,
  buildDepotMesh,
  buildRoadMesh,
  buildRouteGroup,
  loadColor,
  tierColor,
} from './builders';

// three-mesh-bvh：为拾取与遮挡判断挂上 BVH 加速
(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: typeof computeBoundsTree }).computeBoundsTree =
  computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: typeof disposeBoundsTree }).disposeBoundsTree =
  disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

interface TruckVis {
  group: THREE.Group;
  loadBox: THREE.Mesh;
  loadMat: THREE.MeshLambertMaterial;
  cargoMat: THREE.MeshLambertMaterial;
  baseColor: THREE.Color;
  lastAngle: number;
}

const RED = new THREE.Color(0xe23b3b);
const CYAN = new THREE.Color(0x00e5ff);
const WHITE = new THREE.Color(0xffffff);

function makeTruck(colorHex: number): TruckVis {
  const g = new THREE.Group();
  const baseColor = new THREE.Color(colorHex);
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.5, 4.4),
    new THREE.MeshLambertMaterial({ color: 0x22262c }),
  );
  chassis.position.y = 0.55;
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 1.0, 1.3),
    new THREE.MeshLambertMaterial({ color: baseColor.clone().multiplyScalar(0.85) }),
  );
  cab.position.set(0, 1.3, 1.45);
  // 半透明车厢：depthWrite 关闭、renderOrder 靠后，保证与不透明垃圾桶的正确前后遮挡
  const cargoMat = new THREE.MeshLambertMaterial({
    color: colorHex,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.15, 1.7, 2.8), cargoMat);
  cargo.position.set(0, 1.55, -0.55);
  cargo.renderOrder = 10;
  // 车斗内垃圾（不透明，随装载量升高）
  const loadMat = new THREE.MeshLambertMaterial({ color: 0x37d67a });
  const loadBox = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.4, 2.45), loadMat);
  loadBox.position.set(0, 0.73, -0.55);
  loadBox.scale.y = 0.03;
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111317 });
  for (const [x, z] of [
    [-1.05, 1.5],
    [1.05, 1.5],
    [-1.05, -1.4],
    [1.05, -1.4],
  ]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(x, 0.42, z);
    g.add(w);
  }
  g.add(chassis, cab, cargo, loadBox);
  return { group: g, loadBox, loadMat, cargoMat, baseColor, lastAngle: 0 };
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private canvas: HTMLCanvasElement;
  private raycaster = new THREE.Raycaster();
  private roadGroup = new THREE.Group();
  private routesGroup = new THREE.Group();
  private trucksGroup = new THREE.Group();
  private pointsMesh: THREE.InstancedMesh | null = null;
  private pointColors: THREE.Color[] = [];
  private buildingsMesh: THREE.Mesh | null = null;
  private trucks: TruckVis[] = [];
  private hovered = -1;
  private lastHover = 0;
  private center = new THREE.Vector3();
  private extent = 200;
  private raf = 0;
  private lastTs = 0;
  private unsub: () => void;
  private ro: ResizeObserver;
  private prevMode: string = '';
  private tmpV = new THREE.Vector3();
  private tmpDir = new THREE.Vector3();
  private camTargetPos = new THREE.Vector3();
  private camLookAt = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 8000);
    this.camera.position.set(0, 500, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.1;
    this.raycaster.firstHitOnly = true;

    this.scene.background = new THREE.Color(0x0d1117);
    this.scene.fog = new THREE.Fog(0x0d1117, 1500, 5000);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30281e, 1.0));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(300, 600, 200);
    this.scene.add(dir);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshLambertMaterial({ color: 0x131a23 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.scene.add(ground);
    this.scene.add(this.roadGroup, this.routesGroup, this.trucksGroup);

    this.rebuildAll();

    this.unsub = useStore.subscribe((s, prev) => {
      if (s.networkVersion !== prev.networkVersion) {
        this.rebuildAll();
      } else {
        if (s.pointsVersion !== prev.pointsVersion) this.rebuildPoints();
        if (s.routesVersion !== prev.routesVersion) this.rebuildRoutes();
      }
      if (s.selectedIds !== prev.selectedIds) this.updateSelectionColors();
    });

    canvas.addEventListener('pointermove', this.onHover);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement!);
    this.resize();
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      this.tick(ts);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unsub();
    this.ro.disconnect();
    this.canvas.removeEventListener('pointermove', this.onHover);
    this.controls.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) {
        (mesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
        mesh.geometry.dispose();
      }
      const mat = (mesh as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.renderer.dispose();
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- 场景重建 ----------

  private rebuildAll(): void {
    this.computeBounds();
    this.clearGroup(this.roadGroup);
    if (world.network.edges.length > 0) {
      const roads = buildRoadMesh(world.network);
      (roads.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
      this.roadGroup.add(roads);
      this.roadGroup.add(buildBandMesh(world.network));
      this.roadGroup.add(buildDepotMesh(world.depot.x, world.depot.z));
    }
    this.buildingsMesh = buildBuildingsMesh(world.buildings);
    if (this.buildingsMesh) {
      (this.buildingsMesh.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
      this.roadGroup.add(this.buildingsMesh);
    }
    this.rebuildPoints();
    this.rebuildRoutes();
    this.rebuildTrucks();
    this.prevMode = '';
  }

  private computeBounds(): void {
    const ns = world.network.nodes;
    if (ns.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const n of ns) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minZ = Math.min(minZ, n.z);
      maxZ = Math.max(maxZ, n.z);
    }
    this.center.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    this.extent = Math.max(100, maxX - minX, maxZ - minZ);
  }

  private rebuildPoints(): void {
    if (this.pointsMesh) {
      this.roadGroup.remove(this.pointsMesh);
      this.pointsMesh.geometry.dispose();
      (this.pointsMesh.material as THREE.Material).dispose();
      this.pointsMesh = null;
    }
    const n = world.points.length;
    if (n === 0) return;
    // 大量点位：实例化渲染，单次绘制调用
    const geo = new THREE.CylinderGeometry(0.9, 0.75, 2.0, 10);
    (geo as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4();
    this.pointColors = [];
    world.points.forEach((p, i) => {
      const eff = world.eff(p);
      const s = 0.8 + Math.min(1.2, eff / 80);
      m.makeScale(s, s, s).setPosition(p.x, 1.0 * s, p.z);
      mesh.setMatrixAt(i, m);
      const c = tierColor(eff).clone();
      this.pointColors.push(c);
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.name = 'points';
    this.pointsMesh = mesh;
    this.roadGroup.add(mesh);
    this.hovered = -1;
    this.updateSelectionColors();
  }

  private rebuildRoutes(): void {
    this.clearGroup(this.routesGroup);
    world.schedules.forEach((sched, i) => {
      this.routesGroup.add(buildRouteGroup(sched, world.vehicles[i].color));
    });
  }

  private rebuildTrucks(): void {
    this.clearGroup(this.trucksGroup);
    this.trucks = world.vehicles.map((v) => {
      const t = makeTruck(v.color);
      this.trucksGroup.add(t.group);
      return t;
    });
  }

  private clearGroup(g: THREE.Group): void {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) {
          (mesh.geometry as unknown as { disposeBoundsTree?: () => void }).disposeBoundsTree?.();
          mesh.geometry.dispose();
        }
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose();
      });
    }
  }

  // ---------- 每帧更新 ----------

  private tick(ts: number): void {
    const dt = Math.min(0.1, (ts - this.lastTs) / 1000);
    this.lastTs = ts;
    const s = useStore.getState();
    if (s.playing) {
      const dayLen = world.dayLength;
      let t = s.simTime + dt * s.playSpeed;
      if (t >= dayLen) {
        t = dayLen;
        useStore.setState({ playing: false });
      }
      useStore.setState({ simTime: t });
    }
    const tAbs = world.params.dayStart + useStore.getState().simTime;
    this.updateTrucks(tAbs);
    this.updateCamera(tAbs);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private updateTrucks(tAbs: number): void {
    const n = world.vehicles.length;
    for (let i = 0; i < this.trucks.length; i++) {
      const truck = this.trucks[i];
      const st = world.positionAt(i, tAbs);
      if (!st) continue;
      let { x, z } = st;
      if (st.state === 'parked' || st.state === 'done') {
        // 在场站内错位停放
        x += (i - (n - 1) / 2) * 4.5;
        z -= 6;
      }
      truck.group.position.set(x, 0, z);
      if (st.angle !== null) truck.lastAngle = st.angle;
      truck.group.rotation.y = truck.lastAngle;
      const cap = world.vehicles[i].capacity;
      const frac = Math.min(1, st.load / cap);
      // 车斗装载量实时增长
      truck.loadBox.scale.y = Math.max(0.03, frac);
      truck.loadBox.position.y = 0.7 + 0.7 * frac;
      truck.loadMat.color.copy(loadColor(frac));
      // 装载超过阈值：车厢颜色渐变警示
      const th = world.params.threshold;
      if (frac > th) {
        const k = Math.min(1, (frac - th) / Math.max(1e-6, 1 - th));
        truck.cargoMat.color.copy(truck.baseColor).lerp(RED, k);
        truck.cargoMat.opacity = 0.35 + 0.3 * k;
      } else {
        truck.cargoMat.color.copy(truck.baseColor);
        truck.cargoMat.opacity = 0.35;
      }
    }
  }

  private updateCamera(tAbs: number): void {
    const s = useStore.getState();
    if (s.cameraMode !== this.prevMode) {
      this.prevMode = s.cameraMode;
      if (s.cameraMode === 'top') {
        this.camera.position.set(this.center.x, this.extent * 1.15, this.center.z + 0.01);
        this.controls.target.copy(this.center);
      }
    }
    if (s.cameraMode === 'follow') {
      const vid = Math.min(s.followVehicle, world.vehicles.length - 1);
      const st = world.positionAt(vid, tAbs);
      if (st) {
        const ang = this.trucks[vid]?.lastAngle ?? 0;
        const fx = Math.sin(ang);
        const fz = Math.cos(ang);
        this.camTargetPos.set(st.x - fx * 13, 6.5, st.z - fz * 13);
        this.camLookAt.set(st.x + fx * 5, 1.5, st.z + fz * 5);
        this.camera.position.lerp(this.camTargetPos, 0.08);
        const cur = this.controls.target;
        cur.lerp(this.camLookAt, 0.12);
        this.camera.lookAt(cur);
      }
      this.controls.enabled = false;
    } else {
      this.controls.enabled = !s.selectMode;
    }
  }

  // ---------- 拾取 / 框选 / 遮挡 ----------

  private onHover = (e: PointerEvent): void => {
    if (useStore.getState().selectMode) return;
    const now = performance.now();
    if (now - this.lastHover < 50) return;
    this.lastHover = now;
    const id = this.raycastPoints(e.clientX, e.clientY);
    const idx = id ?? -1;
    if (idx !== this.hovered) {
      this.hovered = idx;
      this.canvas.style.cursor = idx >= 0 ? 'pointer' : '';
      this.updateSelectionColors();
    }
  };

  private raycastPoints(clientX: number, clientY: number): number | null {
    if (!this.pointsMesh) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.pointsMesh);
    if (hits.length === 0) return null;
    // 遮挡判断：被建筑挡住的点位不响应
    if (this.occluded(hits[0].point)) return null;
    return hits[0].instanceId ?? null;
  }

  /** BVH 加速的遮挡判断：相机到目标点之间是否被建筑阻挡 */
  private occluded(target: THREE.Vector3): boolean {
    if (!this.buildingsMesh) return false;
    this.tmpDir.copy(target).sub(this.camera.position);
    const dist = this.tmpDir.length();
    this.tmpDir.normalize();
    this.raycaster.set(this.camera.position, this.tmpDir);
    this.raycaster.far = dist - 1.5;
    const hits = this.raycaster.intersectObject(this.buildingsMesh);
    this.raycaster.far = Infinity;
    return hits.length > 0;
  }

  /** 点击拾取点位，返回点位 id */
  pick(clientX: number, clientY: number): number | null {
    const idx = this.raycastPoints(clientX, clientY);
    if (idx === null) return null;
    return world.points[idx]?.id ?? null;
  }

  /** 框选：屏幕矩形内的点位（投影到 NDC 判定） */
  boxSelect(r: { x0: number; y0: number; x1: number; y1: number }): number[] {
    const rect = this.canvas.getBoundingClientRect();
    const ids: number[] = [];
    const v = this.tmpV;
    for (const p of world.points) {
      v.set(p.x, 1, p.z).project(this.camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width;
      const sy = (-v.y * 0.5 + 0.5) * rect.height;
      if (sx >= r.x0 && sx <= r.x1 && sy >= r.y0 && sy <= r.y1) ids.push(p.id);
    }
    return ids;
  }

  private updateSelectionColors(): void {
    if (!this.pointsMesh) return;
    const selected = new Set(useStore.getState().selectedIds);
    const c = new THREE.Color();
    world.points.forEach((p, i) => {
      c.copy(this.pointColors[i]);
      if (selected.has(p.id)) c.lerp(CYAN, 0.8);
      else if (i === this.hovered) c.lerp(WHITE, 0.6);
      this.pointsMesh!.setColorAt(i, c);
    });
    if (this.pointsMesh.instanceColor) this.pointsMesh.instanceColor.needsUpdate = true;
  }
}
