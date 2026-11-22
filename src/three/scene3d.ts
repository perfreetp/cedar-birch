import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { ShapeUtils } from 'three/src/extras/ShapeUtils.js';
import { store } from '../store';
import type { Boundary, Pt, QueryInfo, Rings, RasterImage } from '../types';
import { FlatSampler, TerrainSampler, type Sampler } from '../lib/terrain';
import {
  classifySeverity,
  densifyRing,
  nearestOnBoundary,
  normalizeWinding,
  planarArea,
  pointInBoundary,
  ringBounds,
  ringPerimeter,
  SEVERITY_LEVELS,
} from '../lib/geometry';
import { rasterToCanvas } from '../lib/raster';
import { buildDamageGrid, levelAreasFromGrid, sampleDamageAt, type DamageGrid } from '../lib/severity';
import type { BurnIndexResult } from '../lib/extraction';

const HANDLE_COLOR = 0xffffff;
const HANDLE_ACTIVE = 0xff7a45;
const EDGE_LINE_COLOR = 0xffe08a;
const LIFT_MARKER = 0.05;

interface SceneHandle {
  ringIndex: number;
  vertexIndex: number;
  point: Pt;
}

/** 拖动用的平面世界点（射线与 z=0 或抬升平面求交） */
function rayToWorld(raycaster: THREE.Raycaster, z: number): Pt | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  const hit = new THREE.Vector3();
  return raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null;
}

export class SceneEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();

  private terrainGroup = new THREE.Group();
  private boundaryGroup = new THREE.Group();
  private handleGroup = new THREE.Group();
  private queryMarker: THREE.Mesh;

  private sampler: Sampler = new FlatSampler();
  private burn: BurnIndexResult | null = null;
  private damageGrid: DamageGrid | null = null;
  private handles: SceneHandle[] = [];
  private handleMeshes: THREE.Mesh[] = [];
  private activeHandle: SceneHandle | null = null;
  private dragMoved = false;
  private editMode = true;
  private extent = 100;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0b0f15);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 50000);
    this.camera.position.set(80, -220, 180);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(120, -180, 260);
    this.scene.add(dir);
    this.scene.add(this.terrainGroup, this.boundaryGroup, this.handleGroup);

    const markerGeo = new THREE.SphereGeometry(3, 16, 12);
    this.queryMarker = new THREE.Mesh(
      markerGeo,
      new THREE.MeshBasicMaterial({ color: 0x4da3ff }),
    );
    this.queryMarker.visible = false;
    this.scene.add(this.queryMarker);

    this.bindEvents();
    this.animate();
  }

  // ---------------- 数据装载 ----------------

  setTerrain(dem: RasterImage | null, imagery: RasterImage | null): void {
    this.disposeGroup(this.terrainGroup);
    this.sampler = dem ? new TerrainSampler(dem) : new FlatSampler();

    const base = dem ?? imagery;
    if (!base) {
      this.extent = 100;
      return;
    }
    this.extent = Math.max(base.width, base.height) * base.pixelSize;
    const w = base.width * base.pixelSize;
    const h = base.height * base.pixelSize;
    const segX = Math.min(base.width, 200);
    const segY = Math.min(base.height, 200);
    const geo = new THREE.PlaneGeometry(w, h, segX, segY);
    geo.rotateX(Math.PI / 2);
    geo.translate(base.origin.x + w / 2, base.origin.y + h / 2, 0);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = this.sampler instanceof TerrainSampler ? this.sampler.elevationAt({ x, y }) * base.verticalScale : 0;
      pos.setZ(i, z);
    }
    geo.computeVertexNormals();

    let material: THREE.Material;
    if (imagery) {
      const canvas = rasterToCanvas(imagery);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      material = new THREE.MeshLambertMaterial({ map: texture });
    } else if (dem) {
      material = new THREE.MeshLambertMaterial({ color: 0x6b7a52, wireframe: false });
    } else {
      material = new THREE.MeshLambertMaterial({ color: 0x2a3340 });
    }

    const mesh = new THREE.Mesh(geo, material);
    this.terrainGroup.add(mesh);
    this.frameExtent(w, h, base.origin);
  }

  private frameExtent(w: number, h: number, origin: Pt): void {
    const cx = origin.x + w / 2;
    const cy = origin.y + h / 2;
    const dist = Math.max(w, h) * 1.1;
    this.camera.position.set(cx + dist * 0.35, cy - dist * 0.85, dist * 0.75);
    this.controls.target.set(cx, cy, 0);
    this.controls.update();
  }

  setBurnIndex(burn: BurnIndexResult | null): void {
    this.burn = burn;
  }

  getSampler(): Sampler {
    return this.sampler;
  }

  setEditMode(on: boolean): void {
    this.editMode = on;
    this.handleGroup.visible = on;
    if (!on) this.clearHandles();
  }

  // ---------------- 边界渲染 ----------------

  /**
   * 重建边界场景：
   * 编辑态直接使用 store.rings（earcut 即时三角化）；
   * 稳定态使用 manifold 清理后的 boundary。
   */
  rebuildBoundary(rings: Rings | null): void {
    this.disposeGroup(this.boundaryGroup);
    this.clearHandles();
    this.damageGrid = null;
    store.setQuery(null);
    this.queryMarker.visible = false;
    if (!rings || rings.outer.length < 3) {
      store.setStats(null);
      return;
    }

    const normalized = normalizeWinding(rings);
    const { draped, liftHeight, densifySpacing, fillOpacity } = store.state.display;
    const lift = draped ? 0 : liftHeight;

    // 1. 坡度加密后的贴地/抬升环
    const denseOuter = this.sampler instanceof TerrainSampler
      ? this.sampler.densify(normalized.outer, densifySpacing)
      : densifyRing(normalized.outer, densifySpacing);
    const denseHoles = normalized.holes.map((hr) =>
      this.sampler instanceof TerrainSampler ? this.sampler.densify(hr, densifySpacing) : densifyRing(hr, densifySpacing),
    );

    const toVec3 = (p: Pt): THREE.Vector3 => {
      const s = this.sampler.project(p);
      return new THREE.Vector3(p.x, p.y, s.z + lift + LIFT_MARKER);
    };

    // 2. earcut 三角化（外环 + 孔洞）
    const contour = denseOuter.map(toVec3);
    const holeContours = denseHoles.map((hr) => hr.map(toVec3));
    const fillMesh = this.buildFillMesh(contour, holeContours, fillOpacity);
    if (fillMesh) this.boundaryGroup.add(fillMesh);

    // 3. 分级填色覆盖网格（贴地四边形）
    if (this.burn && store.state.boundary && store.state.boundary.outer.length >= 3) {
      const sevMesh = this.buildSeverityMesh(store.state.boundary, lift);
      if (sevMesh) this.boundaryGroup.add(sevMesh);
    }

    // 4. 边界线（外环高亮 + 孔洞）
    this.addBoundaryLine(contour, EDGE_LINE_COLOR, true);
    for (const hc of holeContours) this.addBoundaryLine(hc, 0xffb74d, false);

    // 5. 编辑顶点手柄（使用未加密的原始环，保证拖拽位置准确）
    if (this.editMode) this.buildHandles(normalized, lift);

    // 6. 统计
    this.updateStats(normalized, denseOuter, denseHoles);
  }

  private buildFillMesh(contour: THREE.Vector3[], holes: THREE.Vector3[][], opacity: number): THREE.Mesh | null {
    const all = [contour, ...holes];
    const triangles = ShapeUtils.triangulateShape(
      contour.map((v) => new THREE.Vector2(v.x, v.y)),
      holes.map((hr) => hr.map((v) => new THREE.Vector2(v.x, v.y))),
    );
    if (!triangles.length) return null;

    const vertices: number[] = [];
    for (const ring of all) for (const v of ring) vertices.push(v.x, v.y, v.z);
    const indices: number[] = [];
    let base = 0;
    const ringOffsets = [0];
    for (let i = 1; i < all.length; i++) {
      base += all[i - 1].length;
      ringOffsets.push(base);
    }
    for (const tri of triangles) {
      // earcut 索引：外环之后接孔洞
      const mapped = tri.map((idx) => {
        if (idx < contour.length) return idx;
        let acc = contour.length;
        for (let h = 0; h < holes.length; h++) {
          if (idx < acc + holes[h].length) return ringOffsets[h + 1] + (idx - acc);
          acc += holes[h].length;
        }
        return idx;
      });
      indices.push(mapped[0], mapped[1], mapped[2]);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      color: 0xff7a45,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  private buildSeverityMesh(boundary: Boundary, lift: number): THREE.Mesh | null {
    if (!this.burn) return null;
    this.damageGrid = buildDamageGrid(this.burn, boundary, store.state.severity.cutoffs);
    const grid = this.damageGrid;
    const half = grid.spacing / 2;
    const vertices: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    let v = 0;

    for (const cell of grid.cells) {
      const info = SEVERITY_LEVELS[cell.level];
      const c = new THREE.Color(info.color);
      const corners = [
        { x: cell.p.x - half, y: cell.p.y - half },
        { x: cell.p.x + half, y: cell.p.y - half },
        { x: cell.p.x + half, y: cell.p.y + half },
        { x: cell.p.x - half, y: cell.p.y + half },
      ];
      for (const q of corners) {
        const s = this.sampler.project(q);
        vertices.push(q.x, q.y, s.z + lift + LIFT_MARKER + 0.02);
        colors.push(c.r, c.g, c.b);
      }
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
    if (!vertices.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    return new THREE.Mesh(geo, mat);
  }

  private addBoundaryLine(ring: THREE.Vector3[], color: number, closed: boolean): void {
    const pts = closed ? [...ring, ring[0]] : ring;
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, linewidth: 2 }),
    );
    this.boundaryGroup.add(line);
  }

  private buildHandles(rings: Rings, lift: number): void {
    const sphere = new THREE.SphereGeometry(Math.max(0.8, this.extent * 0.006), 12, 10);
    const add = (ring: Pt[], ringIndex: number) => {
      ring.forEach((p, vertexIndex) => {
        const s = this.sampler.project(p);
        const mat = new THREE.MeshBasicMaterial({ color: HANDLE_COLOR });
        const mesh = new THREE.Mesh(sphere, mat);
        mesh.position.set(p.x, p.y, s.z + lift + LIFT_MARKER + 0.5);
        const handle: SceneHandle = { ringIndex, vertexIndex, point: p };
        mesh.userData.handle = handle;
        this.handleGroup.add(mesh);
        this.handleMeshes.push(mesh);
        this.handles.push(handle);
      });
    };
    add(rings.outer, 0);
    rings.holes.forEach((h, i) => add(h, i + 1));
  }

  private clearHandles(): void {
    this.handleGroup.clear();
    this.handleMeshes = [];
    this.handles = [];
    this.activeHandle = null;
  }

  // ---------------- 统计 ----------------

  private updateStats(rings: Rings, denseOuter: Pt[], denseHoles: Pt[][]): void {
    const boundary: Boundary = { outer: rings.outer, holes: rings.holes };
    const planar = planarArea(boundary);

    // 地表面积：对加密三角网的每个三角形求 3D 面积
    let surface = 0;
    const tri2d = ShapeUtils.triangulateShape(
      denseOuter.map((p) => new THREE.Vector2(p.x, p.y)),
      denseHoles.map((hr) => hr.map((p) => new THREE.Vector2(p.x, p.y))),
    );
    const allRings = [denseOuter, ...denseHoles];
    const ringOf = (idx: number): { ring: Pt[]; local: number } => {
      let acc = 0;
      for (const r of allRings) {
        if (idx < acc + r.length) return { ring: r, local: idx - acc };
        acc += r.length;
      }
      return { ring: denseOuter, local: 0 };
    };
    for (const t of tri2d) {
      const a = ringOf(t[0]);
      const b = ringOf(t[1]);
      const c = ringOf(t[2]);
      const pa = a.ring[a.local];
      const pb = b.ring[b.local];
      const pc = c.ring[c.local];
      const va = new THREE.Vector3(pa.x, pa.y, this.sampler.project(pa).z);
      const vb = new THREE.Vector3(pb.x, pb.y, this.sampler.project(pb).z);
      const vc = new THREE.Vector3(pc.x, pc.y, this.sampler.project(pc).z);
      surface += triangleArea3D(va, vb, vc);
    }
    if (!tri2d.length) surface = planar;

    // 贴地周长：加密环的 3D 边长之和
    const length3D = (ring: Pt[]): number => {
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = this.sampler.project(ring[i]);
        const b = this.sampler.project(ring[(i + 1) % ring.length]);
        sum += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      }
      return sum;
    };
    const perimeter = this.sampler instanceof FlatSampler
      ? ringPerimeter(denseOuter) + denseHoles.reduce((s, h) => s + ringPerimeter(h), 0)
      : length3D(denseOuter) + denseHoles.reduce((s, h) => s + length3D(h), 0);

    let levelAreas: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    if (this.damageGrid) levelAreas = levelAreasFromGrid(this.damageGrid);

    const bounds = ringBounds(denseOuter);
    const meanSlope = this.sampler instanceof TerrainSampler
      ? this.sampler.meanSlopeInside((p) => pointInBoundary(p, boundary), bounds)
      : 0;

    store.setStats({
      planarArea: planar,
      surfaceArea: surface,
      perimeter,
      levelAreas,
      meanSlope,
      vertexCount: rings.outer.length + rings.holes.reduce((s, h) => s + h.length, 0),
    });
  }

  // ---------------- 交互 ----------------

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    window.addEventListener('resize', () => this.onResize());
  }

  private onContextMenu(e: MouseEvent): void {
    if (!this.editMode || !store.rings) return;
    e.preventDefault();
    this.updatePointer(e as unknown as PointerEvent);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (!hits.length) return;
    const handle = hits[0].object.userData.handle as SceneHandle;
    store.editRings((rings) => {
      const ring = handle.ringIndex === 0 ? rings.outer : rings.holes[handle.ringIndex - 1];
      if (ring.length > 3) {
        ring.splice(handle.vertexIndex, 1);
        store.toast('顶点已删除', 'info');
      } else {
        store.toast('环至少需要保留 3 个顶点', 'error');
      }
    });
    if (store.rings) this.rebuildBoundary(store.rings);
    void store.rebuildNow();
  }

  private updatePointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.editMode || e.button !== 0) return;
    this.dragMoved = false;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (hits.length) {
      const handle = hits[0].object.userData.handle as SceneHandle;
      this.activeHandle = handle;
      (hits[0].object as THREE.Mesh).material instanceof THREE.MeshBasicMaterial &&
        (((hits[0].object as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex(HANDLE_ACTIVE));
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (this.activeHandle) {
      const lift = store.state.display.draped ? 0 : store.state.display.liftHeight;
      const world = rayToWorld(this.raycaster, lift);
      if (!world) return;
      this.dragMoved = true;
      const { ringIndex, vertexIndex } = this.activeHandle;
      store.editRings((rings) => {
        const ring = ringIndex === 0 ? rings.outer : rings.holes[ringIndex - 1];
        if (ring && ring[vertexIndex]) ring[vertexIndex] = world;
      });
      // 立即重建（earcut 路径），manifold 清理在防抖后由 store 调度
      if (store.rings) this.rebuildBoundary(store.rings);
      return;
    }

    // 悬停光标提示
    if (this.editMode) {
      const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
      this.renderer.domElement.style.cursor = hits.length ? 'grab' : 'default';
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.activeHandle) {
      this.activeHandle = null;
      this.controls.enabled = true;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
      void store.rebuildNow();
      return;
    }
    // 非拖拽：点击边界任意位置查询坡度与受损等级
    if (!this.dragMoved) this.runQuery();
  }

  private onDoubleClick(e: MouseEvent): void {
    if (!this.editMode || !store.rings || !store.state.boundary) return;
    this.updatePointer(e as unknown as PointerEvent);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const lift = store.state.display.draped ? 0 : store.state.display.liftHeight;
    const world = rayToWorld(this.raycaster, lift);
    if (!world) return;

    const nearest = nearestOnBoundary(world, store.state.boundary);
    const tolerance = this.extent * 0.012;
    if (nearest.distance > tolerance) {
      store.toast('请在边界线附近双击以插入顶点', 'info');
      return;
    }
    store.editRings((rings) => {
      const ring = nearest.ringIndex === 0 ? rings.outer : rings.holes[nearest.ringIndex - 1];
      const insertAt = (nearest.edgeIndex + 1) % ring.length;
      ring.splice(insertAt, 0, { ...nearest.point });
    });
    if (store.rings) this.rebuildBoundary(store.rings);
    void store.rebuildNow();
  }

  private runQuery(): void {
    const boundary = store.state.boundary;
    if (!boundary || boundary.outer.length < 3) return;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const lift = store.state.display.draped ? 0 : store.state.display.liftHeight;
    const world = rayToWorld(this.raycaster, lift);
    if (!world) return;

    const nearest = nearestOnBoundary(world, boundary);
    const tolerance = this.extent * 0.02;
    if (nearest.distance > tolerance) {
      store.setQuery(null);
      this.queryMarker.visible = false;
      return;
    }

    const p = nearest.point;
    const s = this.sampler.project(p);
    const slopeRad = this.sampler instanceof TerrainSampler ? this.sampler.slopeAt(p) : 0;
    const damageIndex = this.burn ? sampleDamageAt(this.burn, p) : 0;
    const severity = classifySeverity(damageIndex, store.state.severity.cutoffs);
    const info: QueryInfo = {
      point: p,
      elevation: s.elevation,
      slope: (slopeRad * 180) / Math.PI,
      severity,
      damageIndex,
    };
    store.setQuery(info);

    this.queryMarker.position.set(p.x, p.y, s.z + lift + LIFT_MARKER + 1);
    this.queryMarker.visible = true;
    const radius = Math.max(1.2, this.extent * 0.008);
    this.queryMarker.scale.setScalar(radius / 3);
  }

  /** 供外部调用：删除距离屏幕点最近的顶点（工具栏按钮触发时使用） */
  removeNearestVertex(screenX: number, screenY: number): boolean {
    if (!store.rings) return false;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((screenX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((screenY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.handleMeshes, false);
    if (!hits.length) return false;
    const handle = hits[0].object.userData.handle as SceneHandle;
    store.editRings((rings) => {
      const ring = handle.ringIndex === 0 ? rings.outer : rings.holes[handle.ringIndex - 1];
      if (ring.length > 3) ring.splice(handle.vertexIndex, 1);
      else store.toast('环至少需要保留 3 个顶点', 'error');
    });
    if (store.rings) this.rebuildBoundary(store.rings);
    void store.rebuildNow();
    return true;
  }

  refreshDisplayMode(): void {
    if (store.rings) this.rebuildBoundary(store.rings);
  }

  private onResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) {
        const withMap = mat as THREE.MeshLambertMaterial;
        if (withMap.map) withMap.map.dispose();
        mat.dispose();
      }
    });
    group.clear();
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function triangleArea3D(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return ab.cross(ac).length() / 2;
}
