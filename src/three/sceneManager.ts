// 场景管理器: three.js 场景/渲染循环、BVH 网格装配、剖切面拖拽、焊道拾取与高亮
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshBVH } from 'three-mesh-bvh';
import { GrooveConfig, Bead, LayoutResult } from '../types';
import { buildGrooveGeometry } from '../weld/groove';
import { buildWeldLoftGeometry, extrudeProfile } from '../weld/loft';
import { layerColor } from '../weld/layout';
import { thermalBinOf } from '../weld/thermal';
import { makeMetalMaterial, makeWeldMaterial, WeldMaterialHandle } from './materials';
import {
  buildGrooveWallLines,
  buildSection,
  clipDiagnostics,
  ClipSource,
  disposeSection,
  SectionBuildResult,
} from './section';

export interface SelectionInfo {
  bead: Bead;
  sectionArea: number;
  nominalArea: number;
  interpassTemp: number | null;
}

interface BeadEntry {
  bead: Bead;
  mesh: THREE.Mesh;
  bvh: MeshBVH;
  baseColor: number;
}

const STEEL_COLOR = 0x8a93a0;
const CAP_COLOR = 0xb58a4a;

export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private container: HTMLElement;

  private clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private planeVisual!: THREE.Mesh;
  private planeBorder!: THREE.LineLoop;
  private planeHandle!: THREE.Mesh;
  private wallLine: THREE.Line | null = null;

  private baseMesh: THREE.Mesh | null = null;
  private capMesh: THREE.Mesh | null = null;
  private baseBVH: MeshBVH | null = null;
  private capBVH: MeshBVH | null = null;
  // three-mesh-bvh 0.9 在原型上挂载的 boundsTree 声明为 GeometryBVH,统一转为 MeshBVH 使用
  private static bvhOf(geo: THREE.BufferGeometry): MeshBVH {
    return geo.boundsTree as unknown as MeshBVH;
  }

  private weldGroup = new THREE.Group();
  private mergedWeld: THREE.Mesh | null = null;
  private weldHandle: WeldMaterialHandle | null = null;
  private beadEntries: BeadEntry[] = [];
  private clipSources: ClipSource[] = [];
  private sectionResult: SectionBuildResult | null = null;

  private grooveCfg: GrooveConfig | null = null;
  private currentLayout: LayoutResult | null = null;
  private thermalMap: Map<string, number> | null = null;
  private thermalOn = false;
  private selectedId: string | null = null;
  private visibleLayers = 999;
  private clippingOn = true;
  private nominalCW: { x: number; y: number }[] = [];

  private dragging = false;
  private disposed = false;
  private rebuildGrooveCount = 0;
  private rebuildWeldCount = 0;
  private onSelect: (info: SelectionInfo | null) => void;

  constructor(container: HTMLElement, onSelect: (info: SelectionInfo | null) => void) {
    this.container = container;
    this.onSelect = onSelect;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x10141b);
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      2000,
    );
    // 正视剖切面(沿 z 方向略偏), 让截面成为画面主体, 同时保留一点立体透视
    this.camera.position.set(46, 40, 118);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    this.setupLights();
    this.setupHelpers();
    this.setupPlaneVisual();
    this.scene.add(this.weldGroup);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('resize', this.onResize);

    // 调试钩子(无头测试用): 暴露内部状态快照
    (window as unknown as { __WELD_DEBUG__?: unknown }).__WELD_DEBUG__ = {
      snapshot: () => ({
        beadCount: this.beadEntries.length,
        clipSources: this.clipSources.length,
        sectionPieces: this.sectionResult?.pieces.length ?? 0,
        sectionBeadPieces: this.sectionResult?.pieces.filter((p) => p.bead !== null).length ?? 0,
        visibleSectionPieces:
          this.sectionResult?.pieces.filter((p) => p.fill.visible).length ?? 0,
        selectedId: this.selectedId,
        clipConstant: this.clipPlane.constant,
        visibleLayers: this.visibleLayers,
        thermalOn: this.thermalOn,
        rebuildGrooveCount: this.rebuildGrooveCount,
        rebuildWeldCount: this.rebuildWeldCount,
        totalTrianglesInFirstBead:
          this.beadEntries[0]?.mesh.geometry.getIndex()?.count ?? 0,
        sectionAreaSample: this.sectionResult?.pieces
          .filter((p) => p.bead !== null)
          .slice(0, 3)
          .map((p) => Number(p.area.toFixed(3))),
        sectionVertexSample: this.sectionResult?.pieces.slice(0, 4).map((p) => {
          const pos = p.fill.geometry.getAttribute('position') as THREE.BufferAttribute;
          const zs = new Set<number>();
          for (let i = 0; i < Math.min(pos.count, 12); i++) zs.add(Number(pos.getZ(i).toFixed(3)));
          return {
            beadId: p.bead?.id ?? 'metal',
            verts: pos.count,
            zValues: [...zs],
          };
        }),
      }),
      /** 测试用: 按归一化屏幕坐标(-1..1)执行真实射线拾取,返回命中焊道 id */
      pickAt: (nx: number, ny: number) => {
        this.pointer.set(nx, ny);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        if (this.clippingOn && this.sectionResult) {
          const fills = this.sectionResult.pieces
            .filter((p) => p.fill.visible)
            .map((p) => p.fill);
          const hits = this.raycaster.intersectObjects(fills, false);
          // 共面重叠时优先返回焊道片, 母材金属片(无 beadId)作为回退
          const beadHit = hits.find((h) => h.object.userData.beadId);
          const beadId = beadHit
            ? (beadHit.object.userData.beadId as string)
            : null;
          if (beadId) this.emitSelection(beadId);
          return beadId;
        }
        return null;
      },
      /** 测试用: 射线诊断, 返回原始相交信息 */
      rayDebug: (nx: number, ny: number) => {
        this.pointer.set(nx, ny);
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const fills = (this.sectionResult?.pieces ?? [])
          .filter((p) => p.fill.visible)
          .map((p) => p.fill);
        const hits = this.raycaster.intersectObjects(fills, false);
        return {
          rayOrigin: this.raycaster.ray.origin.toArray().map((n) => Number(n.toFixed(3))),
          rayDir: this.raycaster.ray.direction.toArray().map((n) => Number(n.toFixed(3))),
          fillCount: fills.length,
          hitCount: hits.length,
          firstHits: hits.slice(0, 3).map((h) => ({
            beadId: h.object.userData.beadId,
            distance: Number(h.distance.toFixed(3)),
            point: h.point.toArray().map((n) => Number(n.toFixed(3))),
          })),
        };
      },
      /** 测试用: 返回当前所有剖面片的世界包围盒中心,供计算点击坐标 */
      sectionCenters: () =>
        (this.sectionResult?.pieces ?? [])
          .filter((p) => p.bead !== null && p.fill.visible)
          .map((p) => {
            p.fill.geometry.computeBoundingBox();
            const c = new THREE.Vector3();
            p.fill.geometry.boundingBox!.getCenter(c);
            return { beadId: p.bead!.id, x: c.x, y: c.y, z: c.z };
          }),
      worldToScreen: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(this.camera);
        return { nx: v.x, ny: v.y };
      },
      clipDiagnostics: () => clipDiagnostics.slice(),
    };

    this.animate();
  }

  private setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 0.85));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(60, 90, 70);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fc0ff, 0.5);
    fill.position.set(-70, 30, -50);
    this.scene.add(fill);
  }

  private setupHelpers() {
    const grid = new THREE.GridHelper(160, 32, 0x3a4456, 0x232a36);
    grid.position.y = -0.02;
    this.scene.add(grid);
    const axes = new THREE.AxesHelper(14);
    axes.position.set(-62, 0.5, -62);
    this.scene.add(axes);
  }

  private setupPlaneVisual() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mat.clippingPlanes = [];
    this.planeVisual = new THREE.Mesh(geo, mat);
    this.planeVisual.renderOrder = 1;

    const borderGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1));
    const borderMat = new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.9 });
    borderMat.clippingPlanes = [];
    this.planeBorder = new THREE.LineLoop(borderGeo, borderMat);
    this.planeBorder.renderOrder = 1;

    const handleGeo = new THREE.BoxGeometry(7, 1.6, 1.6);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    handleMat.clippingPlanes = [];
    this.planeHandle = new THREE.Mesh(handleGeo, handleMat);
    this.planeHandle.renderOrder = 1;

    this.scene.add(this.planeVisual, this.planeBorder, this.planeHandle);
  }

  // ---------- 模型重建 ----------

  rebuildGroove(cfg: GrooveConfig) {
    this.rebuildGrooveCount++;
    this.grooveCfg = cfg;
    const geom = buildGrooveGeometry(cfg, 0);
    this.nominalCW = geom.nominal;

    if (this.baseMesh) {
      this.scene.remove(this.baseMesh);
      this.baseMesh.geometry.dispose();
      (this.baseMesh.material as THREE.Material).dispose();
    }
    if (this.capMesh) {
      this.scene.remove(this.capMesh);
      this.capMesh.geometry.dispose();
      (this.capMesh.material as THREE.Material).dispose();
    }

    const baseGeo = extrudeProfile(geom.plateOutline, [geom.nominal], cfg.weldLength);
    baseGeo.computeBoundsTree();
    this.baseBVH = SceneManager.bvhOf(baseGeo);
    this.baseMesh = new THREE.Mesh(baseGeo, makeMetalMaterial(STEEL_COLOR));
    (this.baseMesh.material as THREE.MeshStandardMaterial).clippingPlanes = [this.clipPlane];
    this.scene.add(this.baseMesh);

    const capGeo = extrudeProfile(geom.capPoly, [], cfg.weldLength);
    capGeo.computeBoundsTree();
    this.capBVH = SceneManager.bvhOf(capGeo);
    this.capMesh = new THREE.Mesh(capGeo, makeMetalMaterial(CAP_COLOR));
    (this.capMesh.material as THREE.MeshStandardMaterial).clippingPlanes = [this.clipPlane];
    this.scene.add(this.capMesh);

    this.controls.target.set(0, cfg.thickness * 0.5, 0);

    const h = cfg.thickness + 16;
    const w = cfg.plateWidth * 0.98;
    this.planeVisual.geometry.dispose();
    this.planeVisual.geometry = new THREE.PlaneGeometry(w, h);
    this.planeBorder.geometry.dispose();
    this.planeBorder.geometry = new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h));
    this.planeHandle.position.set(0, cfg.thickness + 10, 0);

    this.refreshClipSources();
    this.refreshSection();
  }

  rebuildWeld(cfg: GrooveConfig, result: LayoutResult, penetrationRatio: number) {
    this.rebuildWeldCount++;
    this.currentLayout = result;
    this.grooveCfg = cfg;

    // 清理旧焊道(BVH 随 geometry 一起释放)
    for (const e of this.beadEntries) {
      e.mesh.geometry.dispose();
      (e.mesh.material as THREE.Material).dispose();
    }
    this.beadEntries = [];
    if (this.mergedWeld) {
      this.weldGroup.remove(this.mergedWeld);
      this.mergedWeld.geometry.dispose();
      this.weldHandle?.material.dispose();
      this.mergedWeld = null;
    }
    this.weldGroup.clear();

    const nominalCCW = this.nominalCW.slice().reverse();
    const layerCount = weldLayerCount(result);

    // 单次放样全部焊道,再按顶点范围切片为每道独立几何(BVH 数据源)
    const loft = buildWeldLoftGeometry(
      result.beads,
      cfg.weldLength,
      nominalCCW,
      penetrationRatio * result.beadDiameter,
      (layer) => layerColor(layer, layerCount),
    );
    const mergedIndex = loft.geometry.getIndex()!;
    const mergedPos = loft.geometry.getAttribute('position') as THREE.BufferAttribute;
    const mergedColor = loft.geometry.getAttribute('color') as THREE.BufferAttribute;

    for (const range of loft.ranges) {
      const bead = range.bead;
      const start = range.vertexStart;
      const count = range.vertexCount;
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = mergedPos.getX(start + i);
        positions[i * 3 + 1] = mergedPos.getY(start + i);
        positions[i * 3 + 2] = mergedPos.getZ(start + i);
        colors[i * 3] = mergedColor.getX(start + i);
        colors[i * 3 + 1] = mergedColor.getY(start + i);
        colors[i * 3 + 2] = mergedColor.getZ(start + i);
      }
      const localIndex: number[] = [];
      for (let i = 0; i < mergedIndex.count; i++) {
        const gi = mergedIndex.getX(i);
        if (gi >= start && gi < start + count) localIndex.push(gi - start);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(localIndex);
      geo.computeVertexNormals();
      geo.computeBoundsTree();
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.28,
        side: THREE.DoubleSide,
      });
      mat.clippingPlanes = [this.clipPlane];
      const mesh = new THREE.Mesh(geo, mat);
      this.beadEntries.push({
        bead,
        mesh,
        bvh: SceneManager.bvhOf(geo),
        baseColor: layerColor(bead.layer, layerCount),
      });
    }

    // 合并显示网格(实体外观 + 剥层/高亮 shader)
    this.weldHandle = makeWeldMaterial();
    this.weldHandle.material.clippingPlanes = [this.clipPlane];
    this.mergedWeld = new THREE.Mesh(loft.geometry, this.weldHandle.material);
    this.weldGroup.add(this.mergedWeld);

    this.weldHandle.setMaxLayer(this.visibleLayers);
    this.applyPeelVisibility();
    this.refreshClipSources();
    this.refreshSection();
  }

  private refreshClipSources() {
    const sources: ClipSource[] = [];
    if (this.baseMesh && this.baseBVH) {
      sources.push({
        mesh: this.baseMesh,
        bvh: this.baseBVH,
        bead: null,
        baseColor: STEEL_COLOR,
      });
    }
    if (this.capMesh && this.capBVH) {
      sources.push({
        mesh: this.capMesh,
        bvh: this.capBVH,
        bead: null,
        baseColor: CAP_COLOR,
      });
    }
    for (const e of this.beadEntries) {
      sources.push({ mesh: e.mesh, bvh: e.bvh, bead: e.bead, baseColor: e.baseColor });
    }
    this.clipSources = sources;
  }

  // ---------- 剖切 ----------

  setSectionZ(z: number) {
    const L = this.grooveCfg?.weldLength ?? 100;
    const clamped = THREE.MathUtils.clamp(z, -L / 2, L / 2);
    this.clipPlane.constant = -clamped;
    this.planeVisual.position.set(0, (this.grooveCfg?.thickness ?? 20) * 0.5, clamped);
    this.planeBorder.position.copy(this.planeVisual.position);
    this.planeHandle.position.z = clamped;
    this.refreshSection();
  }

  private thermalColorFor(bead: Bead): number | null {
    if (!this.thermalOn || !this.thermalMap) return null;
    const t = this.thermalMap.get(bead.id);
    return t === undefined ? null : thermalBinOf(t).color;
  }

  refreshSection() {
    if (!this.grooveCfg) return;
    disposeSection(this.sectionResult);
    if (this.wallLine) {
      this.scene.remove(this.wallLine);
      this.wallLine.geometry.dispose();
      (this.wallLine.material as THREE.Material).dispose();
      this.wallLine = null;
    }
    if (!this.clippingOn) return;

    const z = -this.clipPlane.constant;
    this.sectionResult = buildSection(
      this.clipSources,
      this.clipPlane,
      (b) => this.thermalColorFor(b),
      this.selectedId,
    );
    this.applyPeelVisibility();
    this.scene.add(this.sectionResult.group);

    this.wallLine = buildGrooveWallLines(this.nominalCW, z);
    this.scene.add(this.wallLine);
  }

  // ---------- 剥层 / 温度 / 高亮 / 剖切开关 ----------

  setPeel(visibleLayers: number) {
    this.visibleLayers = visibleLayers - 1; // 入参为可见层数
    this.weldHandle?.setMaxLayer(this.visibleLayers);
    this.applyPeelVisibility();
  }

  private applyPeelVisibility() {
    if (this.sectionResult) {
      for (const p of this.sectionResult.pieces) {
        if (p.bead) {
          const vis = p.bead.layer <= this.visibleLayers;
          p.fill.visible = vis;
          p.edge.visible = vis;
        }
      }
    }
  }

  setThermal(on: boolean, map: Map<string, number>) {
    this.thermalOn = on;
    this.thermalMap = map;
    // 实体焊道温度色: 按排布顺序写入 DataTexture
    if (this.weldHandle && this.currentLayout) {
      const rgb = new Uint8Array(this.currentLayout.beads.length * 3);
      const c = new THREE.Color();
      this.currentLayout.beads.forEach((b, i) => {
        const t = map.get(b.id);
        if (t !== undefined) c.set(thermalBinOf(t).color);
        else c.set(layerColor(b.layer, weldLayerCount(this.currentLayout!)));
        rgb[i * 3] = Math.round(c.r * 255);
        rgb[i * 3 + 1] = Math.round(c.g * 255);
        rgb[i * 3 + 2] = Math.round(c.b * 255);
      });
      this.weldHandle.setThermal(on, rgb);
    }
    this.refreshSection();
  }

  setHighlight(beadId: string | null) {
    this.selectedId = beadId;
    if (beadId === null) {
      this.weldHandle?.setHighlight(-1);
    } else {
      const idx = this.currentLayout?.beads.findIndex((b) => b.id === beadId) ?? -1;
      this.weldHandle?.setHighlight(idx);
    }
    this.refreshSection();
  }

  setClipping(on: boolean) {
    this.clippingOn = on;
    const planes = on ? [this.clipPlane] : [];
    if (this.baseMesh) {
      (this.baseMesh.material as THREE.MeshStandardMaterial).clippingPlanes = planes;
    }
    if (this.capMesh) {
      (this.capMesh.material as THREE.MeshStandardMaterial).clippingPlanes = planes;
    }
    for (const e of this.beadEntries) {
      (e.mesh.material as THREE.MeshStandardMaterial).clippingPlanes = planes;
    }
    if (this.weldHandle) this.weldHandle.material.clippingPlanes = planes;
    this.planeVisual.visible = on;
    this.planeBorder.visible = on;
    this.planeHandle.visible = on;
    if (this.wallLine) this.wallLine.visible = on;
    if (this.sectionResult) this.sectionResult.group.visible = on;
    if (on) this.refreshSection();
  }

  // ---------- 拾取与拖拽 ----------

  private updatePointer(e: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  private onPointerDown = (e: PointerEvent) => {
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // 优先: 剖面填充拾取(共面重叠时优先焊道片, 母材金属片回退)
    if (this.clippingOn && this.sectionResult) {
      const fills = this.sectionResult.pieces.filter((p) => p.fill.visible).map((p) => p.fill);
      const hits = this.raycaster.intersectObjects(fills, false);
      const beadHit = hits.find((h) => h.object.userData.beadId);
      if (beadHit) {
        this.emitSelection(beadHit.object.userData.beadId as string);
        return;
      }
    }

    // 其次: 剖切面手柄/面片 -> 开始拖拽
    const planeHits = this.raycaster.intersectObjects(
      [this.planeHandle, this.planeVisual],
      false,
    );
    if (planeHits.length && this.clippingOn) {
      this.dragging = true;
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(e.pointerId);
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging || !this.grooveCfg) return;
    this.updatePointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // 拖拽参考面: 包含 z 轴且朝向相机
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const normal = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 0, 1), camDir).normalize();
    const ref = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      new THREE.Vector3(0, this.grooveCfg.thickness * 0.5, -this.clipPlane.constant),
    );
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(ref, hit)) {
      const L = this.grooveCfg.weldLength;
      const z = THREE.MathUtils.clamp(hit.z, -L / 2, L / 2);
      this.setSectionZ(z);
      this.onSectionDragged?.(z);
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (this.dragging) {
      this.dragging = false;
      this.controls.enabled = true;
      try {
        this.renderer.domElement.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略重复释放 */
      }
    }
  };

  onSectionDragged: ((z: number) => void) | null = null;

  private emitSelection(beadId: string) {
    const bead = this.currentLayout?.beads.find((b) => b.id === beadId);
    if (!bead) return;
    const piece = this.sectionResult?.pieces.find((p) => p.bead?.id === beadId);
    const temp = this.thermalMap?.get(beadId) ?? null;
    this.onSelect({
      bead,
      sectionArea: piece?.area ?? bead.fusionArea,
      nominalArea: bead.nominalArea,
      interpassTemp: temp,
    });
  }

  // ---------- 生命周期 ----------

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private animate = () => {
    if (this.disposed) return;
    requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function weldLayerCount(result: LayoutResult): number {
  return result.beads.reduce((m, b) => Math.max(m, b.layer), 0) + 1;
}
