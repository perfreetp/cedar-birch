/**
 * 3D 场景：把管网配置和求解结果渲染成 Babylon.js 场景。
 *
 * 设计要点：
 *  - 202 段管段用 1 个 thin-instance 圆柱网格渲染，逐实例属性驱动
 *    颜色（管径分档）、条纹相位/速度、透明度、隔离暗化、关闭状态。
 *  - 流向箭头同样用一个 thin-instance 网格（锥体），每段按流速给定数量。
 *  - 设备（分液罐/水封罐/火炬头）用标准材质网格 + 液位/火焰子网格。
 *  - 隔离时对非路径管段降低透明度并去饱和，路径管段加亮。
 *  - 流量切换时用缓动插值，条纹速度与管段颜色平滑过渡。
 */

import { Engine } from '@babylonjs/core/Engines/engine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { Vector3, Color3, Color4, Matrix, Quaternion } from '@babylonjs/core/Maths/math.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder.js';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import '@babylonjs/core/Materials/Textures/Loaders/index.js';
import '@babylonjs/core/Meshes/thinInstanceMesh.js';
import '@babylonjs/core/Culling/ray.js';

import { DN_TIERS, FLOW_TIERS, dnTierIndex, hexToRgb } from '../network/constants.js';
import { PIPE_VERTEX, PIPE_FRAGMENT, ARROW_VERTEX, ARROW_FRAGMENT } from './shaders.js';

const MAX_ARROWS_PER_SEG = 6;
const MIN_ARROW_FLOW = 30; // m³/h 以下不显示箭头

function makeStripeTexture(scene) {
  // 128x8 横向条纹贴图：亮条 + 暗底 + 细刻度，用于沿管流动
  const w = 128;
  const h = 8;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = x / w;
      // 主条纹（高斯）
      let v = 0;
      for (let k = 0; k < 2; k++) {
        let d = Math.abs(t - (0.18 + k * 0.5));
        d = Math.min(d, 1 - d);
        v += Math.exp(-(d * d) / (2 * 0.055 * 0.055));
      }
      // 细刻度（每 1/4 一道暗线）
      const tick = Math.abs(((t * 4) % 1) - 0.5);
      const tickV = tick < 0.035 ? 0.22 : 0;
      const val = Math.min(1, v * 0.95 + tickV);
      const i = (y * w + x) * 4;
      data[i] = Math.round(val * 255);
      data[i + 1] = Math.round(val * 255);
      data[i + 2] = Math.round(val * 255);
      data[i + 3] = 255;
    }
  }
  const tex = RawTexture.CreateRGBATexture(data, w, h, scene, true, false, Texture.NEAREST_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 1;
  tex.vScale = 1;
  return tex;
}

function makeGridTexture(scene) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const isLine = x % 32 === 0 || y % 32 === 0;
      const isMajor = x % 128 === 0 || y % 128 === 0;
      const v = isMajor ? 60 : isLine ? 38 : 22;
      const i = (y * size + x) * 4;
      data[i] = v;
      data[i + 1] = v + 4;
      data[i + 2] = v + 10;
      data[i + 3] = 255;
    }
  }
  const tex = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
  tex.wrapU = Texture.WRAP_ADDRESSMODE;
  tex.wrapV = Texture.WRAP_ADDRESSMODE;
  tex.uScale = 10;
  tex.vScale = 10;
  return tex;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class NetworkScene {
  constructor(canvas, model, config) {
    this.canvas = canvas;
    this.model = model;
    this.config = config;
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true }, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.039, 0.051, 0.075, 1);
    this.scene.ambientColor = new Color3(0.2, 0.22, 0.28);

    const bounds = this._computeBounds();
    this._bounds = bounds;
    const center = new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    this._homeTarget = center.clone();
    // 3D 视口上方有覆盖层、下方有滑杆卡片，画面上移一点更平衡
    this._homeTarget.y += (bounds.max.y - bounds.min.y) * 0.06;
    this._chooseHomeOrientation();
    this._homeRadius = this._fitRadius(center, this._homeBeta);
    this.camera = new ArcRotateCamera('cam', this._homeAlpha, this._homeBeta, this._homeRadius, center, this.scene);
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 18;
    this.camera.upperRadiusLimit = 1600;
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI * 0.495;
    this.camera.wheelDeltaPercentage = 0.02;
    this.camera.panningSensibility = 45;
    this.camera.inertia = 0.82;
    this.camera.minZ = 0.5;
    this.camera.maxZ = 4000;

    const hemi = new HemisphericLight('hemi', new Vector3(0.2, 1, 0.15), this.scene);
    hemi.intensity = 0.75;
    hemi.groundColor = new Color3(0.06, 0.08, 0.12);
    hemi.diffuse = new Color3(0.72, 0.8, 0.95);
    const dir = new DirectionalLight('dir', new Vector3(-0.45, -1, -0.35), this.scene);
    dir.intensity = 0.65;
    dir.diffuse = new Color3(1, 0.96, 0.9);

    this.tierColors = DN_TIERS.map((t) => Color3.FromHexString(t.color));
    this.tierRGB = DN_TIERS.map((t) => hexToRgb(t.color));
    const flowRGB = FLOW_TIERS.map((t) => hexToRgb(t.color));

    this.isolateSegIds = null;
    this.selectedSegId = null;
    this.pipeScale = 1;
    this.transitionTime = 1.1;

    this.geometry = {
      pipeRadius: new Float32Array(model.segments.length),
      pipeLength: new Float32Array(model.segments.length),
      pipeDir: [],
      pipeMid: [],
      uvRepeat: new Float32Array(model.segments.length),
    };

    this._buildGround();
    this._buildPipes(flowRGB);
    this._buildJoints();
    this._buildArrows();
    this._buildEquipment();

    // 每段渲染状态（目标值 + 当前过渡值）
    const n = model.segments.length;
    this.target = {
      phase: new Float32Array(n),
      speed: new Float32Array(n),
      intensity: new Float32Array(n),
      alpha: new Float32Array(n),
      fill: new Float32Array(n),
      tier: new Float32Array(n),
      closed: new Float32Array(n),
      highlight: new Float32Array(n),
      dim: new Float32Array(n),
      flow: new Float32Array(n),
    };
    this.current = {
      phase: new Float32Array(n),
      speed: new Float32Array(n),
      intensity: new Float32Array(n),
      alpha: new Float32Array(n),
      fill: new Float32Array(n),
      tier: new Float32Array(n),
      closed: new Float32Array(n),
      highlight: new Float32Array(n),
      dim: new Float32Array(n),
    };
    for (let i = 0; i < n; i++) {
      this.target.alpha[i] = 1;
      this.target.tier[i] = 0;
      this.target.closed[i] = model.segments[i]._initiallyClosed ? 1 : 0;
      this.current.alpha[i] = 1;
    }

    this.hoverSegId = null;
    this.globalAlpha = 1;
    this.stripeSpeedScale = 1;
    this._lastT = performance.now();
    this._raf = null;
    this._subscribers = new Set();
    this._pickHandler = null;
    this._pendingUpdate = false;

    this.engine.runRenderLoop(() => this._frame());
    this._resizeObs = new ResizeObserver(() => this.engine.resize());
    this._resizeObs.observe(canvas.parentElement || canvas);

    this.pointerObserver = this.scene.onPointerObservable.add((info) => this._onPointer(info));
  }

  onPick(fn) {
    this._pickHandler = fn;
  }

  _onPointer(info) {
    if (!this._pickHandler) return;
    if (info.type === 1) {
      // POINTERDOWN
      const pick = info.pickInfo;
      if (!pick) return;
      this._handlePick(pick, true);
    } else if (info.type === 32 || info.type === 4) {
      // POINTERMOVE / POINTERPICK(悬停) — 用节流
      const now = performance.now();
      if (now - (this._lastHover || 0) < 60) return;
      this._lastHover = now;
      const pick = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
      this._handlePick(pick, false);
    }
  }

  _handlePick(pick, isClick) {
    let segId = null;
    let equipId = null;
    let nodeKey = null;
    if (pick && pick.hit) {
      const hitSet = this.pipeMeshes?.find((ps) => ps.mesh === pick.pickedMesh);
      if (hitSet && pick.thinInstanceIndex != null && pick.thinInstanceIndex >= 0) {
        const segIdx = hitSet.segIdxs[pick.thinInstanceIndex];
        if (segIdx !== undefined) segId = this.model.segments[segIdx].id;
      } else if (pick.pickedMesh && pick.pickedMesh.metadata?.segmentId) {
        segId = pick.pickedMesh.metadata.segmentId;
      } else if (pick.pickedMesh && pick.pickedMesh.metadata?.equipmentId) {
        equipId = pick.pickedMesh.metadata.equipmentId;
      } else if (pick.pickedMesh && pick.pickedMesh.metadata?.nodeKey) {
        nodeKey = pick.pickedMesh.metadata.nodeKey;
      }
    }
    if (isClick) {
      this._pickHandler({ segId, equipId, nodeKey, isClick: true });
    } else {
      const hoverKey = segId || equipId || null;
      if (hoverKey !== this.hoverKey) {
        this.hoverKey = hoverKey;
        this.canvas.style.cursor = hoverKey ? 'pointer' : 'default';
        this._pickHandler({ segId, equipId, nodeKey, isClick: false });
      }
    }
  }

  _buildGround() {
    this.groundMat = new StandardMaterial('groundMat', this.scene);
    this.groundMat.diffuseTexture = makeGridTexture(this.scene);
    this.groundMat.emissiveColor = new Color3(0.09, 0.11, 0.15);
    this.groundMat.diffuseColor = new Color3(0.055, 0.065, 0.09);
    this.groundMat.specularColor = new Color3(0, 0, 0);
    const ground = CreateGround('ground', { width: 900, height: 700, subdivisions: 1 }, this.scene);
    ground.material = this.groundMat;
    ground.position.y = -1.2;
    ground.position.x = 30;
    ground.isPickable = false;
  }

  _pipeMaterial(name, opts = {}) {
    const scene = this.scene;
    const mat = new ShaderMaterial(
      name,
      scene,
      { vertexSource: PIPE_VERTEX, fragmentSource: PIPE_FRAGMENT },
      {
        attributes: ['position', 'normal', 'uv', 'pipeData', 'pipeColor', 'pipeState'],
        uniforms: ['world', 'viewProjection', 'uGlobalAlpha'],
        samplers: ['uStripe'],
        defines: [],
        needAlphaBlending: true,
      },
    );
    mat.alphaMode = opts.additive ? Engine.ALPHA_ADD : Engine.ALPHA_COMBINE;
    mat.backFaceCulling = !opts.additive;
    mat.setTexture('uStripe', makeStripeTexture(scene));
    mat.setArray3('uTierColors', FLOW_TIERS.map((t) => hexToRgb(t.color)).flat());
    mat.setVector3('uLightDir', new Vector3(-0.45, -1, -0.35));
    mat.setVector3('uCameraPos', Vector3.Zero());
    mat.setFloat('uGlobalAlpha', 1);
    if (opts.disableDepthWrite) mat.disableDepthWrite = true;
    return mat;
  }

  _pipeMesh(name, capacity) {
    const scene = this.scene;
    const base = CreateCylinder(name, { height: 1, diameter: 2, tessellation: 14, cap: Mesh.NO_CAP, subdivisions: 1 }, scene);
    const data = new Float32Array(Math.max(1, capacity) * 4);
    const color = new Float32Array(Math.max(1, capacity) * 4);
    const state = new Float32Array(Math.max(1, capacity) * 4);
    const matrices = new Float32Array(Math.max(1, capacity) * 16);
    base.thinInstanceSetBuffer('matrix', matrices, 16, false);
    // 这三个属性每帧都会更新（条纹相位、填充度、透明度），必须是非静态缓冲
    base.thinInstanceSetBuffer('pipeData', data, 4, false);
    base.thinInstanceSetBuffer('pipeColor', color, 4, false);
    base.thinInstanceSetBuffer('pipeState', state, 4, false);
    base.thinInstanceCount = 0;
    base.thinInstanceEnablePicking = true;
    base.doNotSyncBoundingInfo = true;
    base.alwaysSelectAsActiveMesh = true;
    base.isPickable = true;
    return { mesh: base, data, color, state, matrices, segIdxs: [], instOfSeg: new Map() };
  }

  _buildPipes(flowRGB) {
    const scene = this.scene;
    const model = this.model;
    const n = model.segments.length;
    this.flowRGB = flowRGB;

    // 几何：位置 / 半径 / 方向
    const up = Vector3.Up();
    const rot = Quaternion.Identity();
    for (let i = 0; i < n; i++) {
      const s = model.segments[i];
      const p0 = s.fromNode.pos;
      const p1 = s.toNode.pos;
      const a = new Vector3(p0[0], p0[1], p0[2]);
      const b = new Vector3(p1[0], p1[1], p1[2]);
      const axis = b.subtract(a);
      const len = Math.max(axis.length(), 0.01);
      const dirN = axis.normalizeToNew();
      // 视觉夸张：细管也可见，对 DN 做压缩映射
      const r = Math.max(0.34, 0.30 + Math.pow(s.dn / 1200, 0.72) * 0.95);
      Quaternion.FromUnitVectorsToRef(up, dirN, rot);
      this.geometry.pipeRadius[i] = r;
      this.geometry.pipeLength[i] = len;
      this.geometry.pipeDir[i] = dirN;
      this.geometry.pipeMid[i] = a.add(b).scale(0.5);
      // 条纹节距按世界长度 ~9 m 一段，长管多段、短管少段
      this.geometry.uvRepeat[i] = Math.max(0.6, len / 9);
    }

    // 三个批次：不透明管段 / 隔离暗化管段 / 高亮路径光晕
    this.pipeSolid = this._pipeMesh('pipes-solid', n);
    this.pipeDim = this._pipeMesh('pipes-dim', n);
    this.pipeHalo = this._pipeMesh('pipes-halo', n);
    this.pipeSolid.mesh.material = this._pipeMaterial('pipeMatSolid');
    this.pipeDim.mesh.material = this._pipeMaterial('pipeMatDim', { disableDepthWrite: true });
    this.pipeDim.mesh.renderingGroupId = 0;
    this.pipeHalo.mesh.material = this._pipeMaterial('pipeMatHalo', { additive: true, disableDepthWrite: true });
    this.pipeHalo.mesh.thinInstanceEnablePicking = false;
    this.pipeHalo.mesh.isPickable = false;
    this.pipeMeshes = [this.pipeDim, this.pipeSolid, this.pipeHalo];
    this.pipeMat = this.pipeSolid.mesh.material;

    this._rebuildPipePartition();
  }

  _composePipeMatrix(segIdx, out, offset) {
    const s = this.model.segments[segIdx];
    const up = Vector3.Up();
    const rot = Quaternion.Identity();
    const scl = new Vector3();
    const tr = new Vector3();
    const world = Matrix.Identity();
    const dir = this.geometry.pipeDir[segIdx];
    const mid = this.geometry.pipeMid[segIdx];
    const r = this.geometry.pipeRadius[segIdx] * this.pipeScale;
    Quaternion.FromUnitVectorsToRef(up, dir, rot);
    scl.set(r, this.geometry.pipeLength[segIdx], r);
    Matrix.ComposeToRef(scl, rot, mid, world);
    world.copyToArray(out, offset * 16);
  }

  /** 依据隔离状态分配实例到三个批次，并写入静态属性 */
  _rebuildPipePartition() {
    const n = this.model.segments.length;
    const isolating = !!this.isolateSegIds;
    const solid = [];
    const dim = [];
    const halo = [];
    for (let i = 0; i < n; i++) {
      const id = this.model.segments[i].id;
      const onPath = isolating && this.isolateSegIds.has(id);
      if (isolating && !onPath) dim.push(i);
      else {
        solid.push(i);
        if (onPath) halo.push(i);
      }
    }
    this._fillPipeSet(this.pipeSolid, solid, 1);
    this._fillPipeSet(this.pipeDim, dim, 1);
    this._fillPipeSet(this.pipeHalo, halo, 1);
    this.pendingArrows = true;
  }

  _fillPipeSet(set, segIdxs, alphaMul) {
    const { mesh } = set;
    set.segIdxs = segIdxs;
    set.instOfSeg.clear();
    for (let k = 0; k < segIdxs.length; k++) set.instOfSeg.set(segIdxs[k], k);
    const count = segIdxs.length;
    if (!count) {
      mesh.thinInstanceCount = 0;
      mesh.setEnabled(false);
      return;
    }
    mesh.setEnabled(true);
    for (let k = 0; k < count; k++) {
      const i = segIdxs[k];
      this._composePipeMatrix(i, set.matrices, k);
      const s = this.model.segments[i];
      const c = this.tierRGB[dnTierIndex(s.dn)];
      set.color[k * 4] = c[0];
      set.color[k * 4 + 1] = c[1];
      set.color[k * 4 + 2] = c[2];
      set.color[k * 4 + 3] = 0;
      set.data[k * 4] = 0;
      set.data[k * 4 + 1] = 0.4;
      set.data[k * 4 + 2] = alphaMul;
      set.data[k * 4 + 3] = this.geometry.uvRepeat[i];
      set.state[k * 4] = 0.3;
      set.state[k * 4 + 1] = 2;
      set.state[k * 4 + 2] = 0;
      set.state[k * 4 + 3] = 0;
    }
    mesh.thinInstanceSetBuffer('matrix', set.matrices, 16, false);
    mesh.thinInstanceSetBuffer('pipeData', set.data, 4, false);
    mesh.thinInstanceSetBuffer('pipeColor', set.color, 4, false);
    mesh.thinInstanceSetBuffer('pipeState', set.state, 4, false);
    // thinInstanceSetBuffer 会把实例数重置为缓冲容量，必须在之后写回真实数量
    mesh.thinInstanceCount = count;
    mesh.thinInstanceRefreshBoundingInfo(false);
  }

  /** 节点球接头：增强“管网”的立体感，随管径缩放 */
  _buildJoints() {
    const scene = this.scene;
    const model = this.model;
    const maxR = new Float32Array(model.nodes.length);
    const deg = new Int32Array(model.nodes.length);
    for (let i = 0; i < model.segments.length; i++) {
      const a = model.segments[i].fromIdx;
      const b = model.segments[i].toIdx;
      maxR[a] = Math.max(maxR[a], this.geometry.pipeRadius[i]);
      maxR[b] = Math.max(maxR[b], this.geometry.pipeRadius[i]);
      deg[a]++;
      deg[b]++;
    }
    const entries = [];
    for (let i = 0; i < model.nodes.length; i++) {
      if (deg[i] < 2) continue;
      entries.push({ pos: model.nodes[i].pos, r: maxR[i] * 1.02 });
    }
    this._jointEntries = entries;
    const sphere = CreateSphere('joints', { diameter: 1, segments: 10 }, scene);
    sphere.isPickable = false;
    const mat = new StandardMaterial('jointMat', scene);
    mat.diffuseColor = new Color3(0.34, 0.38, 0.44);
    mat.emissiveColor = new Color3(0.05, 0.06, 0.08);
    mat.specularColor = new Color3(0.4, 0.42, 0.46);
    mat.alpha = 0.92;
    sphere.material = mat;
    sphere.thinInstanceSetBuffer('matrix', new Float32Array(Math.max(1, entries.length) * 16), 16, false);
    sphere.thinInstanceCount = entries.length;
    sphere.doNotSyncBoundingInfo = true;
    sphere.alwaysSelectAsActiveMesh = true;
    this.jointMesh = sphere;
    this._writeJointMatrices();
  }

  _writeJointMatrices() {
    const entries = this._jointEntries;
    if (!entries || !this.jointMesh) return;
    const mat = new Float32Array(entries.length * 16);
    const rot = Quaternion.Identity();
    const scl = new Vector3();
    const tr = new Vector3();
    const world = Matrix.Identity();
    for (let k = 0; k < entries.length; k++) {
      const e = entries[k];
      const r = Math.max(0.1, e.r * this.pipeScale);
      tr.set(e.pos[0], e.pos[1], e.pos[2]);
      scl.set(r, r, r);
      Matrix.ComposeToRef(scl, rot, tr, world);
      world.copyToArray(mat, k * 16);
    }
    this.jointMesh.thinInstanceSetBuffer('matrix', mat, 16, false);
    this.jointMesh.thinInstanceRefreshBoundingInfo(false);
  }

  _buildArrows() {
    const scene = this.scene;
    const model = this.model;
    const n = model.segments.length;
    const maxArrows = n * MAX_ARROWS_PER_SEG;
    const cone = CreateCylinder('arrowBase', { height: 1.0, diameterTop: 0, diameterBottom: 0.78, tessellation: 10 }, scene);
    // 箭头默认朝 +Y，矩阵负责旋转
    cone.isPickable = false;

    const matrices = new Float32Array(maxArrows * 16);
    const colors = new Float32Array(maxArrows * 4);
    cone.thinInstanceSetBuffer('matrix', matrices, 16, false);
    cone.thinInstanceSetBuffer('arrowTint', colors, 4, false);
    cone.thinInstanceCount = 0;
    cone.doNotSyncBoundingInfo = true;
    cone.alwaysSelectAsActiveMesh = true;
    cone.isPickable = false;

    const mat = new ShaderMaterial(
      'arrowMat',
      scene,
      { vertexSource: ARROW_VERTEX, fragmentSource: ARROW_FRAGMENT },
      {
        attributes: ['position', 'normal', 'arrowTint'],
        uniforms: ['world', 'viewProjection', 'uLightDir'],
        defines: [],
        needAlphaBlending: true,
      },
    );
    mat.alphaMode = Engine.ALPHA_COMBINE;
    mat.backFaceCulling = false;
    mat.setVector3('uLightDir', new Vector3(-0.45, -1, -0.35));
    cone.material = mat;

    this.arrowMesh = cone;
    this.arrowMatrices = matrices;
    this.arrowColors = colors;
    this.maxArrows = maxArrows;
    this.pendingArrows = true;
  }

  /** 依据当前解的流量重建箭头位置/朝向/数量 */
  _rebuildArrows() {
    const model = this.model;
    const sol = this.solution;
    if (!sol) return;
    let count = 0;
    const up = Vector3.Up();
    const rot = Quaternion.Identity();
    const scl = new Vector3(1, 1, 1);
    const tr = new Vector3(0, 0, 0);
    const world = Matrix.Identity();

    for (let i = 0; i < model.segments.length; i++) {
      const s = model.segments[i];
      const r = sol.segById[s.id];
      if (!r || !r.active || r.absFlow < MIN_ARROW_FLOW) continue;
      const vis = this.target.dim[i] < 0.5 ? 1 : 0.35;
      const k = Math.min(MAX_ARROWS_PER_SEG, Math.max(1, Math.round(Math.abs(r.fill) / 18)));
      const dir = this.geometry.pipeDir[i];
      const mid = this.geometry.pipeMid[i];
      const len = this.geometry.pipeLength[i];
      const flowDir = r.flow >= 0 ? dir : dir.scale(-1);
      const tierColor = this.flowRGB[r.tier] || this.flowRGB[0];
      // 箭头颜色：档位色，高亮时金色
      const hl = this.target.highlight[i];
      const cr = hl > 0.5 ? 1.0 : tierColor[0];
      const cg = hl > 0.5 ? 0.82 : tierColor[1];
      const cb = hl > 0.5 ? 0.35 : tierColor[2];
      // 箭头浮在管面外侧并偏向相机，保证任何视角都可见
      const pipeR = this.geometry.pipeRadius[i] * this.pipeScale;
      const sc = Math.max(0.44, pipeR * 1.35 + Math.min(0.28, Math.abs(r.velocity) * 0.025));
      let toCam = this.camera.globalPosition.subtract(mid);
      toCam.y = 0;
      if (toCam.lengthSquared() < 1e-6) toCam = new Vector3(0, 0, 1);
      toCam.normalize();
      const liftDir = new Vector3(0, 0.85, 0).add(toCam.scale(0.55)).normalize();
      for (let j = 0; j < k; j++) {
        const t = (j + 0.5) / k;
        const off = (t - 0.5) * len * 0.82;
        tr.copyFrom(mid).addInPlace(flowDir.scale(off)).addInPlace(liftDir.scale(pipeR + sc * 0.5));
        scl.set(sc, sc, sc);
        Quaternion.FromUnitVectorsToRef(up, flowDir, rot);
        Matrix.ComposeToRef(scl, rot, tr, world);
        if (count < this.maxArrows) {
          world.copyToArray(this.arrowMatrices, count * 16);
          this.arrowColors[count * 4] = cr;
          this.arrowColors[count * 4 + 1] = cg;
          this.arrowColors[count * 4 + 2] = cb;
          this.arrowColors[count * 4 + 3] = 0.95 * vis;
          count++;
        }
      }
    }
    this.arrowMesh.thinInstanceCount = count;
    this.arrowMesh.thinInstanceBufferUpdated('matrix');
    this.arrowMesh.thinInstanceBufferUpdated('arrowTint');
    this.pendingArrows = false;
  }

  _buildEquipment() {
    const scene = this.scene;
    const model = this.model;
    this.equipVisuals = new Map();

    const matPipeSteel = new StandardMaterial('steel', scene);
    matPipeSteel.diffuseColor = new Color3(0.36, 0.4, 0.46);
    matPipeSteel.specularColor = new Color3(0.35, 0.38, 0.42);
    matPipeSteel.emissiveColor = new Color3(0.05, 0.06, 0.08);
    matPipeSteel.alpha = 0.92;

    this.steelMat = matPipeSteel;

    for (const e of this.config.equipment) {
      if (e.type === 'knockout') {
        const group = [];
        const shell = CreateCylinder(`ko-${e.id}`, {
          height: e.length,
          diameter: e.radius * 2,
          tessellation: 28,
        }, scene);
        shell.rotation.z = Math.PI / 2;
        shell.position.set(e.pos[0], e.pos[1], e.pos[2]);
        const m = matPipeSteel.clone(`koMat-${e.id}`);
        m.diffuseColor = new Color3(0.30, 0.36, 0.44);
        m.alpha = 0.55;
        m.backFaceCulling = false;
        shell.material = m;
        shell.metadata = { equipmentId: e.id };
        shell.isPickable = true;
        group.push(shell);
        // 端盖
        for (const sx of [-1, 1]) {
          const cap = CreateSphere(`koCap-${e.id}-${sx}`, { diameter: e.radius * 2, segments: 16 }, scene);
          // 用半球：缩放压扁
          cap.scaling.set(0.45, 1, 1);
          cap.position.set(e.pos[0] + sx * e.length / 2, e.pos[1], e.pos[2]);
          cap.material = m;
          cap.metadata = { equipmentId: e.id };
          cap.isPickable = true;
          group.push(cap);
        }
        // 液位（内部半透明液柱）
        const liquid = CreateCylinder(`koLiquid-${e.id}`, {
          height: e.length * 0.9,
          diameter: e.radius * 2 * 0.92,
          tessellation: 20,
        }, scene);
        liquid.rotation.z = Math.PI / 2;
        liquid.position.set(e.pos[0], e.pos[1] - e.radius * 0.25, e.pos[2]);
        liquid.scaling.y = 1;
        const lm = new StandardMaterial(`koLiqMat-${e.id}`, scene);
        lm.diffuseColor = new Color3(0.24, 0.5, 0.62);
        lm.emissiveColor = new Color3(0.05, 0.14, 0.2);
        lm.alpha = 0.5;
        liquid.material = lm;
        liquid.isPickable = false;
        group.push(liquid);

        this.equipVisuals.set(e.id, { type: 'knockout', shell, liquid, material: m, group });
      } else if (e.type === 'waterseal') {
        const group = [];
        const shell = CreateCylinder(`ws-${e.id}`, {
          height: e.height,
          diameter: e.radius * 2,
          tessellation: 24,
        }, scene);
        shell.position.set(e.pos[0], e.pos[1] + e.height / 2 - 1.5, e.pos[2]);
        const m = matPipeSteel.clone(`wsMat-${e.id}`);
        m.diffuseColor = new Color3(0.32, 0.4, 0.5);
        m.alpha = 0.42;
        m.backFaceCulling = false;
        shell.material = m;
        shell.metadata = { equipmentId: e.id };
        shell.isPickable = true;
        group.push(shell);

        // 水位（可动）
        const water = CreateCylinder(`wsWater-${e.id}`, {
          height: 1,
          diameter: e.radius * 2 * 0.94,
          tessellation: 20,
        }, scene);
        const wm = new StandardMaterial(`wsWaterMat-${e.id}`, scene);
        wm.diffuseColor = new Color3(0.18, 0.5, 0.72);
        wm.emissiveColor = new Color3(0.05, 0.2, 0.32);
        wm.alpha = 0.72;
        wm.specularColor = new Color3(0.6, 0.7, 0.8);
        water.material = wm;
        water.isPickable = false;
        group.push(water);

        // 水封高度刻度环
        const ring = CreateTorus(`wsRing-${e.id}`, {
          diameter: e.radius * 2 + 0.1,
          thickness: 0.06,
          tessellation: 28,
        }, scene);
        const rm = new StandardMaterial(`wsRingMat-${e.id}`, scene);
        rm.emissiveColor = new Color3(0.95, 0.62, 0.25);
        rm.diffuseColor = new Color3(0.9, 0.55, 0.2);
        ring.material = rm;
        ring.isPickable = false;
        group.push(ring);

        // 状态灯
        const lamp = CreateSphere(`wsLamp-${e.id}`, { diameter: 0.75, segments: 12 }, scene);
        lamp.position.set(e.pos[0] + e.radius + 0.6, e.pos[1] + e.height - 1.5, e.pos[2]);
        const lampMat = new StandardMaterial(`wsLampMat-${e.id}`, scene);
        lampMat.emissiveColor = new Color3(0.3, 0.9, 0.5);
        lampMat.diffuseColor = Color3.Black();
        lamp.material = lampMat;
        lamp.isPickable = false;
        group.push(lamp);

        this.equipVisuals.set(e.id, {
          type: 'waterseal',
          shell,
          water,
          ring,
          lamp,
          material: m,
          lampMat,
          baseY: e.pos[1] + e.height / 2 - 1.5,
          height: e.height,
          radius: e.radius,
          waterMat: wm,
          ringMat: rm,
          group,
        });
      } else if (e.type === 'flare') {
        const group = [];
        const h = e.height;
        const basePos = new Vector3(e.base[0], e.base[1], e.base[2]);
        const top = new Vector3(e.pos[0], e.pos[1], e.pos[2]);

        // 塔架（三根斜支柱 + 环）
        const towerMat = new StandardMaterial(`flareTower-${e.id}`, scene);
        towerMat.diffuseColor = new Color3(0.30, 0.33, 0.38);
        towerMat.emissiveColor = new Color3(0.04, 0.05, 0.06);
        for (let k = 0; k < 3; k++) {
          const ang = (k / 3) * Math.PI * 2;
          const leg = CreateCylinder(`flareLeg-${e.id}-${k}`, {
            height: h,
            diameter: 0.45,
            tessellation: 8,
          }, scene);
          leg.position.set(basePos.x + Math.cos(ang) * 2.4, h / 2, basePos.z + Math.sin(ang) * 2.4);
          leg.material = towerMat;
          leg.metadata = { equipmentId: e.id };
          leg.isPickable = true;
          group.push(leg);
        }
        for (let yy = 12; yy < h - 6; yy += 14) {
          const ring = CreateTorus(`flareRing-${e.id}-${yy}`, {
            diameter: 4.8,
            thickness: 0.16,
            tessellation: 20,
          }, scene);
          ring.position.set(basePos.x, yy, basePos.z);
          ring.material = towerMat;
          ring.isPickable = false;
          group.push(ring);
        }

        // 火炬筒体
        const stack = CreateCylinder(`flareStack-${e.id}`, {
          height: h,
          diameterTop: 1.6,
          diameterBottom: 2.4,
          tessellation: 16,
        }, scene);
        stack.position.set(basePos.x, h / 2, basePos.z);
        const sm = new StandardMaterial(`flareStackMat-${e.id}`, scene);
        sm.diffuseColor = new Color3(0.44, 0.46, 0.5);
        sm.emissiveColor = new Color3(0.08, 0.08, 0.09);
        sm.specularColor = new Color3(0.4, 0.4, 0.4);
        stack.material = sm;
        stack.metadata = { equipmentId: e.id };
        stack.isPickable = true;
        group.push(stack);

        // 火焰（锥体，按流量缩放/闪烁）
        const flame = CreateCylinder(`flareFlame-${e.id}`, {
          height: 6,
          diameterTop: 0,
          diameterBottom: 2.6,
          tessellation: 14,
        }, scene);
        flame.position.set(top.x, h + 3, top.z);
        const fm = new StandardMaterial(`flareFlameMat-${e.id}`, scene);
        fm.emissiveColor = new Color3(1.0, 0.55, 0.15);
        fm.diffuseColor = new Color3(1, 0.4, 0.1);
        fm.alpha = 0.85;
        fm.disableLighting = true;
        flame.material = fm;
        flame.isPickable = false;
        flame.scaling.y = 0.1;
        group.push(flame);

        // 光晕
        const halo = CreateSphere(`flareHalo-${e.id}`, { diameter: 8, segments: 16 }, scene);
        halo.position.set(top.x, h + 2, top.z);
        const hm = new StandardMaterial(`flareHaloMat-${e.id}`, scene);
        hm.emissiveColor = new Color3(1, 0.55, 0.2);
        hm.alpha = 0.16;
        hm.disableLighting = true;
        halo.material = hm;
        halo.isPickable = false;
        group.push(halo);

        this.equipVisuals.set(e.id, {
          type: 'flare',
          stack,
          flame,
          halo,
          flameMat: fm,
          haloMat: hm,
          flameBaseY: h + 3,
          x: top.x,
          z: top.z,
          group,
        });
      } else if (e.type === 'source') {
        // 排放源标识塔（细立柱 + 环）
        const group = [];
        const pole = CreateCylinder(`srcPole-${e.id}`, { height: 7, diameter: 0.28, tessellation: 8 }, scene);
        pole.position.set(e.pos[0], e.pos[1] + 3.5, e.pos[2]);
        const pm = new StandardMaterial(`srcPoleMat-${e.id}`, scene);
        pm.diffuseColor = new Color3(0.4, 0.44, 0.5);
        pm.emissiveColor = new Color3(0.05, 0.06, 0.08);
        pole.material = pm;
        pole.isPickable = false;
        group.push(pole);

        const ring = CreateTorus(`srcRing-${e.id}`, { diameter: 1.6, thickness: 0.14, tessellation: 24 }, scene);
        ring.position.set(e.pos[0], e.pos[1] + 7, e.pos[2]);
        const rm = new StandardMaterial(`srcRingMat-${e.id}`, scene);
        rm.emissiveColor = new Color3(0.35, 0.8, 0.95);
        rm.diffuseColor = new Color3(0.2, 0.5, 0.65);
        ring.material = rm;
        ring.isPickable = true;
        ring.metadata = { equipmentId: e.id };
        group.push(ring);

        this.equipVisuals.set(e.id, { type: 'source', pole, ring, ringMat: rm, group });
      }
    }
  }

  /** 将一次求解结果作为目标状态（会平滑过渡） */
  applySolution(solution, opts = {}) {
    this.solution = solution;
    const model = this.model;
    const n = model.segments.length;
    const t = this.target;
    for (let i = 0; i < n; i++) {
      const s = model.segments[i];
      const r = solution.segById[s.id];
      t.flow[i] = r.flow;
      t.fill[i] = Math.min(1, r.fill / 100);
      t.tier[i] = r.tier;
      t.closed[i] = r.active ? 0 : 1;
      const velN = Math.min(1, r.velocity / 40);
      t.intensity[i] = r.active ? 0.22 + 0.78 * velN : 0.05;
      t.speed[i] = r.active ? Math.sign(r.flow) * (0.12 + velN * 0.95) : 0;
    }
    this.transitionTime = opts.instant ? 0.02 : (opts.transitionTime ?? 1.1);
    this.pendingArrows = true;
    if (opts.instant) {
      this._snapToTarget();
    }
  }

  _snapToTarget() {
    const t = this.target;
    const c = this.current;
    for (let i = 0; i < t.fill.length; i++) {
      c.phase[i] = t.phase[i];
      c.speed[i] = t.speed[i];
      c.intensity[i] = t.intensity[i];
      c.alpha[i] = t.alpha[i];
      c.fill[i] = t.fill[i];
      c.tier[i] = t.tier[i];
      c.closed[i] = t.closed[i];
      c.highlight[i] = t.highlight[i];
      c.dim[i] = t.dim[i];
    }
  }

  /** 设置隔离：传 null 取消 */
  setIsolation(segIds) {
    this.isolateSegIds = segIds ? new Set(segIds) : null;
    this._isolatedBranchIds = null;
    if (this.isolateSegIds) {
      const set = new Set();
      for (const sid of this.isolateSegIds) {
        const seg = this.model.segments.find((x) => x.id === sid);
        if (seg) set.add(seg.branchId);
      }
      this._isolatedBranchIds = set;
    }
    const n = this.model.segments.length;
    for (let i = 0; i < n; i++) {
      const id = this.model.segments[i].id;
      if (!this.isolateSegIds) {
        this.target.highlight[i] = 0;
        this.target.dim[i] = 0;
        this.target.alpha[i] = 1;
      } else if (this.isolateSegIds.has(id)) {
        this.target.highlight[i] = 1;
        this.target.dim[i] = 0;
        this.target.alpha[i] = 1;
      } else {
        this.target.highlight[i] = 0;
        this.target.dim[i] = 1;
        this.target.alpha[i] = 1;
      }
    }
    this._rebuildPipePartition();
    this.pendingArrows = true;
  }

  setSelectedSegment(segId) {
    this.selectedSegId = segId;
  }

  setStripeSpeedScale(v) {
    this.stripeSpeedScale = v;
  }

  /** 每帧：过渡 + 条纹相位推进 + 写实例属性 */
  _frame() {
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    this._lastT = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);

    const k = 1 - Math.exp(-dt / Math.max(0.02, this.transitionTime * 0.32));
    const c = this.current;
    const t = this.target;
    const n = this.model.segments.length;

    for (let i = 0; i < n; i++) {
      c.speed[i] += (t.speed[i] - c.speed[i]) * k;
      c.intensity[i] += (t.intensity[i] - c.intensity[i]) * k;
      c.alpha[i] += (t.alpha[i] - c.alpha[i]) * k;
      c.fill[i] += (t.fill[i] - c.fill[i]) * k;
      c.tier[i] += (t.tier[i] - c.tier[i]) * k;
      c.closed[i] += (t.closed[i] - c.closed[i]) * k;
      c.highlight[i] += (t.highlight[i] - c.highlight[i]) * k;
      c.dim[i] += (t.dim[i] - c.dim[i]) * k;
      // 条纹相位：速度决定滚动速率，正负决定方向
      c.phase[i] += c.speed[i] * dt * 1.35 * this.stripeSpeedScale;
      if (c.phase[i] > 1e4) c.phase[i] -= 1e4;
      if (c.phase[i] < -1e4) c.phase[i] += 1e4;
    }

    this._writePipeAttrs();
    if (this.pendingArrows) this._rebuildArrows();

    this.scene.render();
  }

  _writePipeAttrs() {
    const c = this.current;
    const phase = c.phase;
    const sets = this.pipeMeshes;
    for (let si = 0; si < sets.length; si++) {
      const set = sets[si];
      const isHalo = set === this.pipeHalo;
      const isDim = set === this.pipeDim;
      const segIdxs = set.segIdxs;
      const cnt = segIdxs.length;
      if (!cnt) continue;
      const data = set.data;
      const state = set.state;
      const color = set.color;
      for (let k = 0; k < cnt; k++) {
        const i = segIdxs[k];
        data[k * 4] = phase[i];
        data[k * 4 + 1] = isHalo ? 1.0 : c.intensity[i];
        data[k * 4 + 2] = 1.0;
        data[k * 4 + 3] = this.geometry.uvRepeat[i];
        state[k * 4] = c.fill[i];
        state[k * 4 + 1] = c.tier[i];
        state[k * 4 + 2] = isHalo ? 0 : c.closed[i];
        // 暗化值使用平滑过渡的 c.dim，透明度在片元着色器里按它衰减
        state[k * 4 + 3] = isDim ? 1 : c.dim[i];
        const id = this.model.segments[i].id;
        const selBoost = id === this.selectedSegId ? 0.6 : 0;
        color[k * 4 + 3] = isHalo ? 0.5 : Math.max(c.highlight[i] * 0 + selBoost, 0);
      }
      set.mesh.thinInstanceBufferUpdated('pipeData');
      set.mesh.thinInstanceBufferUpdated('pipeState');
      set.mesh.thinInstanceBufferUpdated('pipeColor');
    }

    // 相机参数
    for (const set of sets) {
      set.mesh.material.setVector3('uCameraPos', this.camera.globalPosition);
    }
  }

  /** 每帧轻量更新设备动画（火焰闪烁、水封液位过渡） */
  updateEquipmentFrame(solution) {
    if (!solution) return;
    const seals = new Map(solution.seals.map((s) => [s.id, s]));
    const t = performance.now() / 1000;
    for (const [id, vis] of this.equipVisuals) {
      if (vis.type === 'flare') {
        const flow = this._flareFlow?.[id] ?? 0;
        const norm = Math.min(1.4, flow / 30000);
        const flicker = 0.9 + Math.sin(t * 6.7 + id.length * 1.3) * 0.07 + Math.sin(t * 11.3) * 0.05;
        const hgt = (0.5 + norm * 2.6) * flicker;
        vis.flame.scaling.set(0.55 + norm * 0.55, hgt, 0.55 + norm * 0.55);
        vis.flame.position.y = vis.flameBaseY + 3 * hgt - 3;
        vis.flame.setEnabled(flow > 20);
        vis.halo.setEnabled(flow > 20);
        vis.halo.scaling.setAll(0.5 + norm * 0.55);
      } else if (vis.type === 'waterseal') {
        const s = seals.get(id);
        if (!s) continue;
        const ratio = Math.min(1.8, s.ratio);
        const waterH = Math.max(0.4, (s.sealHeightMm / 1000) * Math.max(0.25, ratio));
        vis.water.scaling.y = waterH;
        vis.water.position.set(
          vis.shell.position.x,
          vis.shell.position.y - vis.height / 2 + waterH / 2,
          vis.shell.position.z,
        );
        // 水封高度环位置
        const sealH = (s.sealHeightMm / 1000);
        vis.ring.position.set(
          vis.shell.position.x,
          vis.shell.position.y - vis.height / 2 + sealH,
          vis.shell.position.z,
        );
        const exceed = s.exceeded;
        vis.lampMat.emissiveColor.set(exceed ? 1.0 : 0.25, exceed ? 0.3 : 0.85, exceed ? 0.2 : 0.45);
        vis.lamp.scaling.setAll(exceed ? 1.15 + Math.sin(t * 6) * 0.12 : 0.9);
        vis.ringMat.emissiveColor.set(exceed ? 1.0 : 0.95, exceed ? 0.35 : 0.62, exceed ? 0.2 : 0.25);
        const flowN = Math.min(1, s.flow / Math.max(1, s.designFlow));
        vis.waterMat.emissiveColor.set(0.05 + 0.1 * flowN, 0.2 + 0.18 * flowN, 0.32 + 0.2 * flowN);
        if (this.isolateSegIds) {
          const segs = this.isolateSegIds;
          const onPath = segs.has(s.segId);
          vis.shell.visibility = onPath ? 1 : 0.25;
        } else {
          vis.shell.visibility = 1;
        }
      } else if (vis.type === 'knockout') {
        if (this.isolateSegIds) {
          const branch = this._koBranch?.[id];
          vis.shell.visibility = this._isolatedBranchIds?.has(branch) ? 1 : 0.28;
        } else vis.shell.visibility = 1;
      } else if (vis.type === 'source') {
        const active = (this._sourceFlow?.[id] ?? 0) > 0;
        vis.ringMat.emissiveColor.set(active ? 0.35 : 0.18, active ? 0.85 : 0.22, active ? 0.95 : 0.26);
      }
    }
  }

  setFlareFlows(map) {
    this._flareFlow = map;
  }

  setSourceFlows(map) {
    this._sourceFlow = map;
  }

  setKoBranches(map) {
    this._koBranch = map;
  }

  setGlobalVisibility(v) {
    this.globalAlpha = v;
    for (const set of this.pipeMeshes || []) set.mesh.material.setFloat('uGlobalAlpha', v);
  }

  setPipeScale(v) {
    this.pipeScale = v;
    for (const set of this.pipeMeshes) {
      const cnt = set.segIdxs.length;
      if (!cnt) continue;
      for (let k = 0; k < cnt; k++) this._composePipeMatrix(set.segIdxs[k], set.matrices, k);
      set.mesh.thinInstanceSetBuffer('matrix', set.matrices, 16, false);
      set.mesh.thinInstanceRefreshBoundingInfo(false);
    }
    this._writeJointMatrices();
    this.pendingArrows = true;
  }

  focusNode(key) {
    const ni = this.model.resolve(key);
    if (ni === undefined) return;
    const p = this.model.nodes[ni].pos;
    this.camera.setTarget(new Vector3(p[0], p[1], p[2]));
    this.camera.radius = Math.min(this.camera.radius, 120);
  }

  focusPoint(x, y, z, radius) {
    this.camera.setTarget(new Vector3(x, y, z));
    if (radius) this.camera.radius = radius;
  }

  resetView() {
    this.camera.setTarget(this._homeTarget);
    this.camera.alpha = this._homeAlpha;
    this.camera.beta = this._homeBeta;
    this.camera.radius = this._homeRadius;
  }

  /**
   * 横屏时让管网长轴（X）落在屏幕水平方向；竖屏（手机）时旋转 90°，
   * 让长轴落在屏幕竖直方向，避免整网被压成一条细线。
   */
  _chooseHomeOrientation() {
    const w = this.canvas.clientWidth || 1200;
    const h = this.canvas.clientHeight || 700;
    const aspect = w / Math.max(1, h);
    if (aspect < 0.92) {
      this._homeAlpha = 0;
      this._homeBeta = Math.PI * 0.26;
    } else {
      this._homeAlpha = -Math.PI * 0.5;
      this._homeBeta = Math.PI * 0.32;
    }
  }

  /** 按相机朝向把包围盒投影到屏幕两轴，计算刚好容纳全网的相机距离 */
  _fitRadius(center, beta) {
    const b = this._bounds;
    if (!b) return 300;
    const w = this.canvas.clientWidth || 1200;
    const h = this.canvas.clientHeight || 700;
    const fovY = this.camera?.fov ?? 0.8;
    const aspect = Math.max(0.35, w / h);
    const fovX = 2 * Math.atan(Math.tan(fovY / 2) * aspect);
    const alpha = this._homeAlpha;
    const target = this._homeTarget || new Vector3(0, 18, 0);
    // 相机基向量
    const off = new Vector3(
      Math.cos(alpha) * Math.sin(beta),
      Math.cos(beta),
      Math.sin(alpha) * Math.sin(beta),
    );
    const fwd = off.scale(-1).normalize();
    const right = Vector3.Cross(Vector3.Up(), fwd).normalize();
    if (!isFinite(right.x) || right.lengthSquared() < 1e-6) right.set(1, 0, 0);
    const up = Vector3.Cross(fwd, right).normalize();
    let halfW = 0;
    let halfH = 0;
    let depth = 0;
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          const p = new Vector3(
            ix ? b.max.x : b.min.x,
            iy ? b.max.y : b.min.y,
            iz ? b.max.z : b.min.z,
          ).subtract(target);
          halfW = Math.max(halfW, Math.abs(Vector3.Dot(p, right)));
          halfH = Math.max(halfH, Math.abs(Vector3.Dot(p, up)));
          depth = Math.max(depth, Math.abs(Vector3.Dot(p, fwd)));
        }
      }
    }
    halfW += 8;
    halfH += 8;
    // 屏幕边缘留出面板遮挡区域；depth 是包围盒沿视线方向的半深，
    // 相机在包围球外时距离需再加上它，才能保证近端角点也入镜
    const padding = 1.06;
    const dH = (halfW * padding) / Math.tan(fovX / 2);
    const dV = (halfH * padding) / Math.tan(fovY / 2);
    return Math.max(40, Math.max(dH, dV) + depth * 0.5);
  }

  fitAll(reorient = false) {
    if (reorient) this._chooseHomeOrientation();
    this._homeRadius = this._fitRadius(this._homeTarget, this._homeBeta);
    this.resetView();
  }





  _computeBounds() {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const n of this.config.nodes) {
      min.x = Math.min(min.x, n.pos[0]);
      min.y = Math.min(min.y, n.pos[1]);
      min.z = Math.min(min.z, n.pos[2]);
      max.x = Math.max(max.x, n.pos[0]);
      max.y = Math.max(max.y, n.pos[1]);
      max.z = Math.max(max.z, n.pos[2]);
    }
    for (const e of this.config.equipment) {
      if (!e.pos) continue;
      min.x = Math.min(min.x, e.pos[0]);
      min.y = Math.min(min.y, e.pos[1]);
      min.z = Math.min(min.z, e.pos[2]);
      max.x = Math.max(max.x, e.pos[0]);
      max.y = Math.max(max.y, e.pos[1]);
      max.z = Math.max(max.z, e.pos[2]);
    }
    min.y = Math.min(min.y, 0);
    return { min, max };
  }

  dispose() {
    this._resizeObs?.disconnect();
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }
}
