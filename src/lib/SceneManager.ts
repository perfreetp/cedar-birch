import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { gapToBin, binColor } from './heat';
import type { PlateRecord, WeldRecord } from '../types';

interface PickInfo {
  index: number;
  x: number;
  y: number;
}

/** stencil 封边分组（three.js 官方 clipping_stencil 示例方案） */
function createPlaneStencilGroup(geometry: THREE.BufferGeometry, plane: THREE.Plane, renderOrder: number): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshBasicMaterial();
  baseMat.depthWrite = false;
  baseMat.depthTest = false;
  baseMat.colorWrite = false;
  baseMat.stencilWrite = true;
  baseMat.stencilFunc = THREE.AlwaysStencilFunc;

  const mat0 = baseMat.clone();
  mat0.side = THREE.BackSide;
  mat0.clippingPlanes = [plane];
  mat0.stencilFail = THREE.IncrementWrapStencilOp;
  mat0.stencilZFail = THREE.IncrementWrapStencilOp;
  mat0.stencilZPass = THREE.IncrementWrapStencilOp;
  const mesh0 = new THREE.Mesh(geometry, mat0);
  mesh0.renderOrder = renderOrder;

  const mat1 = baseMat.clone();
  mat1.side = THREE.FrontSide;
  mat1.clippingPlanes = [plane];
  mat1.stencilFail = THREE.DecrementWrapStencilOp;
  mat1.stencilZFail = THREE.DecrementWrapStencilOp;
  mat1.stencilZPass = THREE.DecrementWrapStencilOp;
  const mesh1 = new THREE.Mesh(geometry, mat1);
  mesh1.renderOrder = renderOrder;

  group.add(mesh0, mesh1);
  group.visible = false;
  return group;
}

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;

  private welds: WeldRecord[] = [];
  private weldGroup = new THREE.Group();
  private solidWeld!: THREE.InstancedMesh;
  private ghostWeld!: THREE.InstancedMesh;
  private solidPulse!: THREE.InstancedMesh;
  private ghostPulse!: THREE.InstancedMesh;
  private weldGeo: THREE.BufferGeometry | null = null;
  private alphaAttr!: THREE.InstancedBufferAttribute;
  private pulseAttr!: THREE.InstancedBufferAttribute;
  private pulseUniforms: { uPulse: { value: number } }[] = [];

  private plateGroup = new THREE.Group();
  private plateGeo: THREE.BufferGeometry | null = null;
  private solidPlateMat!: THREE.MeshStandardMaterial;
  private ghostPlateMat!: THREE.MeshStandardMaterial;
  private solidPlateMesh: THREE.Mesh | null = null;
  private ghostPlateMesh: THREE.Mesh | null = null;
  private stencilGroup: THREE.Group | null = null;
  private capMesh: THREE.Mesh | null = null;
  private capMat!: THREE.MeshStandardMaterial;

  /** 实体侧裁剪面（保留 -X 或 +X 一侧） */
  private solidClip = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  /** 半透明侧裁剪面（法线相反） */
  private ghostClip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);

  private sectionHandle: THREE.Mesh;
  private sectionFrame: THREE.LineSegments;
  private selectMarker: THREE.Mesh;

  private sectionEnabled = false;
  private sectionX = 0;
  private ghostSide: 'positive' | 'negative' = 'positive';

  private palette: string[] = [];
  private threshold = 6;
  private gapFilter: [number, number] = [0, 99];
  private recolorQueued = false;

  private focusTween: {
    t: number;
    dur: number;
    fromPos: THREE.Vector3;
    toPos: THREE.Vector3;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  } | null = null;

  private draggingPlane = false;
  private dragPlane = new THREE.Plane();
  private downX = 0;
  private downY = 0;
  private clickSuppressed = false;
  private dragRaf = 0;
  private pendingDragX: number | null = null;
  private tmpV = new THREE.Vector3();
  private resizeObs: ResizeObserver;
  private disposed = false;

  public onPick: (info: (PickInfo & { weld: WeldRecord }) | null) => void = () => {};
  public onHover: (info: (PickInfo & { weld: WeldRecord }) | null) => void = () => {};
  public onSectionDrag: (x: number) => void = () => {};

  constructor(container: HTMLElement) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.renderer.localClippingEnabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
    this.camera.position.set(28, 20, 30);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxDistance = 400;

    this.scene.background = new THREE.Color(0x0e141c);
    this.scene.fog = new THREE.Fog(0x0e141c, 120, 320);

    const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x2a3340, 1.1);
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(30, 40, 20);
    const dir2 = new THREE.DirectionalLight(0x88aaff, 0.7);
    dir2.position.set(-25, -10, -20);
    this.scene.add(hemi, dir, dir2);

    const grid = new THREE.GridHelper(80, 40, 0x3a4a5e, 0x22303f);
    grid.position.y = -6.2;
    this.scene.add(grid);
    this.scene.add(new THREE.AxesHelper(2.5));
    this.scene.add(this.weldGroup, this.plateGroup);

    // 剖切平面手柄（可直接在 3D 视图中拖动）
    const handleMat = new THREE.MeshBasicMaterial({
      color: 0x66d9ff,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.sectionHandle = new THREE.Mesh(new THREE.PlaneGeometry(20, 16), handleMat);
    this.sectionHandle.visible = false;
    this.sectionHandle.renderOrder = 6;
    this.sectionHandle.name = 'section-handle';
    this.sectionFrame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(20, 16)),
      new THREE.LineBasicMaterial({ color: 0x66d9ff }),
    );
    this.sectionFrame.visible = false;
    this.sectionFrame.renderOrder = 7;
    this.scene.add(this.sectionHandle, this.sectionFrame);

    // 选中标记
    this.selectMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }),
    );
    this.selectMarker.visible = false;
    this.selectMarker.renderOrder = 10;
    this.scene.add(this.selectMarker);

    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.handleResize());
    this.resizeObs.observe(container);
    this.animate();
  }

  // —————————————————— 数据装载 ——————————————————

  loadWelds(welds: WeldRecord[], palette: string[], threshold: number, filter: [number, number]): void {
    this.clearWelds();
    this.welds = welds;
    this.palette = palette;
    this.threshold = threshold;
    this.gapFilter = filter;
    if (!welds.length) return;

    const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
    geo.rotateZ(Math.PI / 2); // 圆柱轴向 -> X
    const n = welds.length;
    const dummy = new THREE.Object3D();
    const R = 0.035;

    this.alphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.pulseAttr = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.pulseAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alphaAttr);
    geo.setAttribute('aPulse', this.pulseAttr);
    this.weldGeo = geo;

    const solidMat = this.makeWeldMaterial(false);
    const ghostMat = this.makeWeldMaterial(true);
    this.solidWeld = new THREE.InstancedMesh(geo, solidMat, n);
    this.ghostWeld = new THREE.InstancedMesh(geo, ghostMat, n);
    this.solidPulse = new THREE.InstancedMesh(geo, this.makePulseMaterial(false), n);
    this.ghostPulse = new THREE.InstancedMesh(geo, this.makePulseMaterial(true), n);
    for (const m of [this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    this.solidWeld.renderOrder = 0;
    this.ghostWeld.renderOrder = 3;
    this.solidPulse.renderOrder = 4;
    this.ghostPulse.renderOrder = 5;

    // 实例矩阵
    for (let i = 0; i < n; i++) {
      const w = welds[i];
      const dir = new THREE.Vector3(...w.direction).normalize();
      dummy.position.set(w.position[0], w.position[1], w.position[2]);
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
      dummy.scale.set(Math.max(0.05, w.length), R, R);
      dummy.updateMatrix();
      for (const m of [this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse]) {
        m.setMatrixAt(i, dummy.matrix);
      }
    }
    for (const m of [this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse]) {
      m.instanceMatrix.needsUpdate = true;
    }
    this.weldGroup.add(this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse);

    this.applySectionMaterials();
    this.recolorImmediate();
    this.frameContent();
  }

  private makeWeldMaterial(isGhost: boolean): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      metalness: 0.2,
      roughness: 0.5,
      transparent: true,
      opacity: isGhost ? 0.22 : 1,
      depthWrite: !isGhost, // 半透明侧不写深度，保证透过板材看到内部焊缝
      alphaTest: 0.05, // 被筛选隐藏的实例（aAlpha=0）直接丢弃片元，不写深度
    });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aAlpha;\nvarying float vInstAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstAlpha = aAlpha;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstAlpha;')
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vInstAlpha;');
    };
    return mat;
  }

  private makePulseMaterial(isGhost: boolean): THREE.MeshBasicMaterial {
    const uniforms = { uPulse: { value: 0.6 } };
    this.pulseUniforms.push(uniforms);
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      opacity: isGhost ? 0.5 : 1,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPulse = uniforms.uPulse;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aPulse;\nvarying float vPulse;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPulse = aPulse;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uPulse;\nvarying float vPulse;',
        )
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\ngl_FragColor.rgb *= 1.7;\ngl_FragColor.a *= vPulse * uPulse;',
        );
    };
    return mat;
  }

  /** 板材：盒体定义或 GLB 网格，统一合并为单个几何，实体/半透明各渲染一次 */
  loadPlates(plates: PlateRecord[]): void {
    const geos: THREE.BufferGeometry[] = [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const p of plates) {
      const g = box.clone();
      g.scale(p.size[0] * 2, p.size[1] * 2, p.size[2] * 2);
      g.translate(p.position[0], p.position[1], p.position[2]);
      geos.push(g);
    }
    this.setPlateGeometry(mergeGeometries(geos, false) ?? undefined);
  }

  async loadModelFile(file: File): Promise<void> {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const url = URL.createObjectURL(file);
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      const geos: THREE.BufferGeometry[] = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          const g0 = mesh.geometry as THREE.BufferGeometry;
          const g = (g0.index ? g0.toNonIndexed() : g0).clone();
          g.applyMatrix4(mesh.matrixWorld);
          geos.push(g);
        }
      });
      if (!geos.length) throw new Error('模型中没有可用的网格');
      this.setPlateGeometry(mergeGeometries(geos, false) ?? undefined);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private setPlateGeometry(geo: THREE.BufferGeometry | undefined): void {
    this.clearPlates();
    if (!geo) return;
    this.plateGeo = geo;
    this.solidPlateMat = new THREE.MeshStandardMaterial({
      color: 0x9fb4c8,
      metalness: 0.35,
      roughness: 0.6,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    this.ghostPlateMat = new THREE.MeshStandardMaterial({
      color: 0x9fb4c8,
      metalness: 0.3,
      roughness: 0.7,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.solidPlateMesh = new THREE.Mesh(geo, this.solidPlateMat);
    this.ghostPlateMesh = new THREE.Mesh(geo, this.ghostPlateMat);
    this.solidPlateMesh.renderOrder = 0;
    this.ghostPlateMesh.renderOrder = 2;

    // stencil 封边：在裁剪轮廓内填充切面，露出板内结构
    this.stencilGroup = createPlaneStencilGroup(geo, this.solidClip, 1);
    this.capMat = new THREE.MeshStandardMaterial({
      color: 0xd8b48a,
      metalness: 0.2,
      roughness: 0.85,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: 0,
      stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilZPass: THREE.ReplaceStencilOp,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.capMesh = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), this.capMat);
    this.capMesh.renderOrder = 1.2;
    this.capMesh.visible = false;
    this.capMat.clippingPlanes = [];
    this.capMesh.onAfterRender = (renderer) => renderer.clearStencil();

    this.plateGroup.add(this.solidPlateMesh, this.ghostPlateMesh, this.stencilGroup, this.capMesh);
    this.applySectionMaterials();
  }

  // —————————————————— 热力着色（滑块高频路径，仅更新 GPU 缓冲） ——————————————————

  setColorParams(palette: string[], threshold: number, filter: [number, number]): void {
    this.palette = palette;
    this.threshold = threshold;
    this.gapFilter = filter;
    if (this.recolorQueued) return;
    this.recolorQueued = true;
    requestAnimationFrame(() => {
      this.recolorQueued = false;
      this.recolorImmediate();
    });
  }

  private recolorImmediate(): void {
    if (!this.welds.length || !this.solidWeld) return;
    const c = new THREE.Color();
    const n = this.welds.length;
    for (let i = 0; i < n; i++) {
      const w = this.welds[i];
      const visible = w.gap >= this.gapFilter[0] && w.gap <= this.gapFilter[1] ? 1 : 0;
      this.alphaAttr.setX(i, visible);
      this.pulseAttr.setX(i, visible && w.gap > this.threshold ? 1 : 0);
      binColor(this.palette, gapToBin(w.gap), c);
      for (const m of [this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse]) {
        m.setColorAt(i, c);
      }
    }
    this.alphaAttr.needsUpdate = true;
    this.pulseAttr.needsUpdate = true;
    for (const m of [this.solidWeld, this.ghostWeld, this.solidPulse, this.ghostPulse]) {
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  // —————————————————— 剖切 ——————————————————

  setSection(enabled: boolean, x: number, ghostSide: 'positive' | 'negative'): void {
    this.sectionEnabled = enabled;
    this.sectionX = x;
    this.ghostSide = ghostSide;
    this.applySectionMaterials();
  }

  private applySectionMaterials(): void {
    const on = this.sectionEnabled;
    const x = this.sectionX;
    // solidClip 保留实体侧，ghostClip 保留半透明侧（两者互补）
    if (this.ghostSide === 'positive') {
      // 半透明 +X 侧；实体侧为 -X
      this.ghostClip.normal.set(1, 0, 0);
      this.ghostClip.constant = -x;
      this.solidClip.normal.set(-1, 0, 0);
      this.solidClip.constant = x;
    } else {
      this.ghostClip.normal.set(-1, 0, 0);
      this.ghostClip.constant = x;
      this.solidClip.normal.set(1, 0, 0);
      this.solidClip.constant = -x;
    }

    const solidPlanes = on ? [this.solidClip] : [];
    const ghostPlanes = on ? [this.ghostClip] : [];

    if (this.solidWeld) {
      (this.solidWeld.material as THREE.MeshStandardMaterial).clippingPlanes = solidPlanes;
      (this.ghostWeld.material as THREE.MeshStandardMaterial).clippingPlanes = ghostPlanes;
      (this.solidPulse.material as THREE.MeshBasicMaterial).clippingPlanes = solidPlanes;
      (this.ghostPulse.material as THREE.MeshBasicMaterial).clippingPlanes = ghostPlanes;
      this.ghostWeld.visible = on;
      this.ghostPulse.visible = on;
    }
    if (this.solidPlateMesh) {
      this.solidPlateMat.clippingPlanes = solidPlanes;
      this.ghostPlateMat.clippingPlanes = ghostPlanes;
      this.ghostPlateMesh!.visible = on;
      if (this.stencilGroup) this.stencilGroup.visible = on;
      if (this.capMesh) this.capMesh.visible = on;
    }
    this.sectionHandle.visible = on;
    this.sectionFrame.visible = on;
    if (on) {
      this.sectionHandle.position.set(x, 0, 0);
      this.sectionFrame.position.set(x, 0, 0);
      this.sectionHandle.rotation.y = Math.PI / 2;
      this.sectionFrame.rotation.y = Math.PI / 2;
    }
  }

  // —————————————————— 选中与定位 ——————————————————

  selectWeld(id: string | null): void {
    if (!id) {
      this.selectMarker.visible = false;
      return;
    }
    const idx = this.welds.findIndex((w) => w.id === id);
    if (idx < 0) return;
    const w = this.welds[idx];
    this.selectMarker.position.set(...w.position);
    this.selectMarker.visible = true;
  }

  focusWeld(id: string): void {
    const idx = this.welds.findIndex((w) => w.id === id);
    if (idx < 0) return;
    const w = this.welds[idx];
    const target = new THREE.Vector3(...w.position);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = Math.max(3, this.camera.position.distanceTo(this.controls.target) * 0.35);
    this.focusTween = {
      t: 0,
      dur: 0.7,
      fromPos: this.camera.position.clone(),
      toPos: target.clone().add(dir.multiplyScalar(dist)).add(new THREE.Vector3(2, 1.5, 2)),
      fromTarget: this.controls.target.clone(),
      toTarget: target,
    };
    this.selectWeld(id);
  }

  private frameContent(): void {
    if (!this.welds.length) return;
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    for (const w of this.welds) {
      p.set(w.position[0], w.position[1], w.position[2]);
      box.expandByPoint(p);
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(maxDim * 0.9, maxDim * 0.65, maxDim * 1.05));
    this.controls.update();
  }

  // —————————————————— 交互 ——————————————————

  private bindEvents(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerup', this.onPointerUp);
  }

  private setRayPointer(e: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private pickWeld(e: PointerEvent): (PickInfo & { weld: WeldRecord }) | null {
    if (!this.solidWeld || !this.welds.length) return null;
    this.setRayPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const meshes = this.sectionEnabled
      ? [this.solidWeld, this.ghostWeld].filter((m) => m.visible)
      : [this.solidWeld];
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) return null;
    const hit = hits[0];
    if (hit.instanceId === undefined) return null;
    const weld = this.welds[hit.instanceId];
    if (this.alphaAttr.getX(hit.instanceId) < 0.5) return null; // 被筛选隐藏
    return { index: hit.instanceId, weld, x: e.clientX, y: e.clientY };
  }

  private onPointerDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.clickSuppressed = false;
    if (!this.sectionEnabled || e.button !== 0) return;
    this.setRayPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.sectionHandle, false);
    if (hit.length) {
      this.draggingPlane = true;
      this.controls.enabled = false;
      // 拖动平面：法线垂直于船长轴并朝向相机，保证交点沿 X 滑动
      const camDir = this.camera.getWorldDirection(new THREE.Vector3());
      const n = camDir.clone().sub(new THREE.Vector3(camDir.x, 0, 0));
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1); // 相机沿船长轴直视时的回退法线
      n.normalize();
      this.dragPlane.normal.copy(n);
      this.dragPlane.constant = -n.dot(this.sectionHandle.position);
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) {
      this.clickSuppressed = true; // 轨道旋转/平移，不再视为点击
    }
    if (this.draggingPlane) {
      this.setRayPointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const pt = new THREE.Vector3();
      if (this.raycaster.ray.intersectPlane(this.dragPlane, pt)) {
        const [lo, hi] = this.xDomain();
        const x = THREE.MathUtils.clamp(pt.x, lo, hi);
        this.sectionX = x;
        this.sectionHandle.position.set(x, 0, 0);
        this.sectionFrame.position.set(x, 0, 0);
        this.updateClipConstants();
        // rAF 节流：每帧最多向 React 回传一次位置
        this.pendingDragX = x;
        if (!this.dragRaf) {
          this.dragRaf = requestAnimationFrame(() => {
            this.dragRaf = 0;
            if (this.pendingDragX !== null) this.onSectionDrag(this.pendingDragX);
            this.pendingDragX = null;
          });
        }
      }
      return;
    }
    const info = this.pickWeld(e);
    this.renderer.domElement.style.cursor = info ? 'pointer' : 'default';
    this.onHover(info);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.draggingPlane) {
      this.draggingPlane = false;
      this.controls.enabled = true;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针已释放 */
      }
      return;
    }
    if (this.clickSuppressed) return;
    const info = this.pickWeld(e);
    this.onPick(info);
  };

  private xDomain(): [number, number] {
    // 拖动范围取焊缝 X 包围盒
    let lo = Infinity;
    let hi = -Infinity;
    for (const w of this.welds) {
      const x = w.position[0];
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    return [lo - 0.5, hi + 0.5];
  }

  private updateClipConstants(): void {
    const x = this.sectionX;
    if (this.ghostSide === 'positive') {
      this.ghostClip.constant = -x;
      this.solidClip.constant = x;
    } else {
      this.ghostClip.constant = x;
      this.solidClip.constant = -x;
    }
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private animate = (): void => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    const dt = this.clock.getDelta();
    const t = this.clock.elapsedTime;
    const pulse = 0.45 + 0.4 * (0.5 + 0.5 * Math.sin(t * 4.2));
    for (const u of this.pulseUniforms) u.uPulse.value = pulse;

    if (this.focusTween) {
      const tw = this.focusTween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, ease);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, ease);
      if (k >= 1) this.focusTween = null;
    }

    // 封边平面跟随剖切平面
    if (this.capMesh && this.capMesh.visible) {
      this.solidClip.coplanarPoint(this.capMesh.position);
      this.capMesh.lookAt(
        this.tmpV.copy(this.capMesh.position).sub(this.solidClip.normal),
      );
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private clearWelds(): void {
    this.pulseUniforms.length = 0;
    this.weldGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.weldGroup.clear();
    if (this.weldGeo) this.weldGeo.dispose();
    this.weldGeo = null;
    this.welds = [];
    this.selectMarker.visible = false;
  }

  private clearPlates(): void {
    this.plateGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.plateGroup.clear();
    if (this.plateGeo) this.plateGeo.dispose();
    this.plateGeo = null;
    this.solidPlateMesh = null;
    this.ghostPlateMesh = null;
    this.stencilGroup = null;
    this.capMesh = null;
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    this.controls.dispose();
    this.clearWelds();
    this.clearPlates();
    this.renderer.dispose();
    el.remove();
  }
}
