import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { produce } from 'solid-js/store';
import { state, setState, STORAGE_KEY } from '../store.js';

// three-mesh-bvh 接管 raycast；无 boundsTree 时自动回退到原生实现
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DEG2RAD = Math.PI / 180;
const CAMPUS_SIZE = 240;
const YAW_STEPS = 64;    // 视锥水平采样
const PITCH_STEPS = 28;  // 视锥垂直采样
const BLIND_CELL = 4;    // 盲区分析网格边长（米）
const COVERAGE_BASE_Y = 0.12; // 覆盖高亮离地高度（高于路面 0.06 防止深度冲突）
const BVH_THRESHOLD = 50; // 摄像头数量超过该值启用 BVH 加速

const PALETTE = [0x4fc3f7, 0xffd54f, 0x81c784, 0xba68c8, 0xff8a65, 0x4db6ac, 0xf06292, 0xaed581, 0x7986cb, 0xe57373];

let renderer, scene, camera, controls, canvasEl;
let buildingMesh, groundMesh;
let blindMesh = null;
const camObjects = new Map(); // id -> { group, pole, headGroup, headMat, pick, frustum, frustumEdge, coverage, color, yOffset }
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let viewAnim = null;
let dragState = null;
const refreshDirty = new Set();
let prevTime = 0;
let camSeq = 1;

const _v1 = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

const r1 = (v) => Math.round(v * 10) / 10;

// ---------------- 校园建模 ----------------

function generateBuildings() {
  const list = [];
  let seed = 20261122;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const spacing = 44;
  for (let gx = -2; gx <= 2; gx++) {
    for (let gz = -2; gz <= 2; gz++) {
      if (gx === 0 && gz === 0) continue; // 中心广场
      const cx = gx * spacing, cz = gz * spacing;
      const n = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) {
        const w = 12 + rand() * 16;
        const d = 12 + rand() * 16;
        const h = 8 + rand() * 26;
        const ox = (rand() - 0.5) * Math.max(0, 34 - w);
        const oz = (rand() - 0.5) * Math.max(0, 34 - d);
        list.push({ x: r1(cx + ox), z: r1(cz + oz), w: r1(w), d: r1(d), h: r1(h) });
      }
    }
  }
  return list;
}

export const BUILDINGS = generateBuildings();

function buildCampus() {
  // 地面
  const groundGeo = new THREE.PlaneGeometry(CAMPUS_SIZE, CAMPUS_SIZE);
  groundGeo.rotateX(-Math.PI / 2);
  groundMesh = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ color: 0x6f9a5b }));
  scene.add(groundMesh);

  // 道路 + 中心广场
  const roadGeos = [];
  for (const c of [-66, -22, 22, 66]) {
    const v = new THREE.BoxGeometry(8, 0.06, CAMPUS_SIZE);
    v.translate(c, 0.03, 0);
    roadGeos.push(v);
    const h = new THREE.BoxGeometry(CAMPUS_SIZE, 0.06, 8);
    h.translate(0, 0.03, c);
    roadGeos.push(h);
  }
  const plaza = new THREE.BoxGeometry(36, 0.06, 36);
  plaza.translate(0, 0.03, 0);
  roadGeos.push(plaza);
  const roads = new THREE.Mesh(mergeGeometries(roadGeos), new THREE.MeshStandardMaterial({ color: 0x3c4046 }));
  scene.add(roads);

  // 建筑（合并为单一网格，作为遮挡判定的 raycast 目标）
  const geos = BUILDINGS.map((b, i) => {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x, b.h / 2, b.z);
    const col = new THREE.Color().setHSL(0.07 + (i % 7) * 0.012, 0.28, 0.5 + (i % 5) * 0.045);
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let k = 0; k < count; k++) {
      colors[k * 3] = col.r; colors[k * 3 + 1] = col.g; colors[k * 3 + 2] = col.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  buildingMesh = new THREE.Mesh(
    mergeGeometries(geos),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  );
  scene.add(buildingMesh);
}

// ---------------- 方向与覆盖计算 ----------------

// yaw=0 朝 -Z，yaw 增大向 +X 旋转；pitch 为向下俯角
function dirFromAngles(yawDeg, pitchDeg, out) {
  const yaw = yawDeg * DEG2RAD, pitch = pitchDeg * DEG2RAD;
  const cp = Math.cos(pitch);
  out.set(Math.sin(yaw) * cp, -Math.sin(pitch), -Math.cos(yaw) * cp);
  return out;
}

// 对视锥做 (YAW_STEPS+1)x(PITCH_STEPS+1) 扇形光线采样：
// 每条光线分别与地面和建筑求交，得到遮挡裁剪后的落点与是否覆盖地面
function computeGrid(cam) {
  _origin.set(cam.x, cam.y, cam.z);
  const cols = YAW_STEPS + 1, rows = PITCH_STEPS + 1;
  const points = new Float32Array(cols * rows * 3);
  const covered = new Uint8Array(cols * rows);
  raycaster.far = cam.range;
  for (let j = 0; j < rows; j++) {
    const v = -cam.vfov / 2 + (cam.vfov * j) / PITCH_STEPS;
    for (let i = 0; i < cols; i++) {
      const h = -cam.fov / 2 + (cam.fov * i) / YAW_STEPS;
      dirFromAngles(cam.yaw + h, cam.pitch + v, _dir);
      let tGround = Infinity;
      if (_dir.y < -1e-6) {
        const t = _origin.y / -_dir.y;
        if (t > 0) tGround = t;
      }
      let tBuild = Infinity;
      raycaster.set(_origin, _dir);
      const hits = raycaster.intersectObject(buildingMesh, false);
      if (hits.length > 0) tBuild = hits[0].distance;
      const idx = j * cols + i;
      // 地面交点在射程内且先于建筑命中 => 地面被覆盖（否则被建筑遮挡裁剪）
      covered[idx] = tGround <= cam.range && tGround < tBuild ? 1 : 0;
      const t = Math.min(tGround, tBuild, cam.range);
      points[idx * 3] = _origin.x + _dir.x * t;
      points[idx * 3 + 1] = Math.max(0, _origin.y + _dir.y * t);
      points[idx * 3 + 2] = _origin.z + _dir.z * t;
    }
  }
  return { points, covered, cols, rows };
}

// 覆盖区域地面高亮网格 + 面积
function updateCoverageGeometry(obj, cam, grid) {
  const { points, covered, cols, rows } = grid;
  const verts = [];
  const idx = [];
  const vid = new Map();
  let area = 0;
  const y = obj.yOffset;
  const getV = (vi) => {
    let r = vid.get(vi);
    if (r === undefined) {
      r = verts.length / 3;
      vid.set(vi, r);
      verts.push(points[vi * 3], y, points[vi * 3 + 2]);
    }
    return r;
  };
  const tri = (a, b, c) => {
    const ax = points[a * 3], az = points[a * 3 + 2];
    const bx = points[b * 3], bz = points[b * 3 + 2];
    const cx = points[c * 3], cz = points[c * 3 + 2];
    return Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
  };
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      if (covered[a] && covered[b] && covered[c] && covered[d]) {
        idx.push(getV(a), getV(c), getV(b), getV(b), getV(c), getV(d));
        area += tri(a, c, b) + tri(b, c, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  g.setIndex(idx);
  obj.coverage.geometry.dispose();
  obj.coverage.geometry = g;
  setState('coverage', cam.id, { area: r1(area) });
}

// 视锥体网格：远端面在 建筑/地面/射程 三者最近处裁剪，侧面连接顶点
function updateFrustumGeometry(obj, cam, grid) {
  const { points, cols, rows } = grid;
  const n = cols * rows;
  const verts = new Float32Array((n + 1) * 3);
  for (let k = 0; k < n; k++) {
    verts[k * 3] = points[k * 3] - cam.x;
    verts[k * 3 + 1] = points[k * 3 + 1] - cam.y;
    verts[k * 3 + 2] = points[k * 3 + 2] - cam.z;
  }
  const apex = n; // (0,0,0)
  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const loop = [];
  for (let i = 0; i < cols; i++) loop.push(i);
  for (let j = 1; j < rows; j++) loop.push(j * cols + cols - 1);
  for (let i = cols - 2; i >= 0; i--) loop.push((rows - 1) * cols + i);
  for (let j = rows - 2; j >= 1; j--) loop.push(j * cols);
  for (let k = 0; k < loop.length; k++) idx.push(apex, loop[k], loop[(k + 1) % loop.length]);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  obj.frustum.geometry.dispose();
  obj.frustum.geometry = g;
  obj.frustum.position.set(cam.x, cam.y, cam.z);

  const ep = new Float32Array(loop.length * 3);
  loop.forEach((vi, k) => {
    ep[k * 3] = verts[vi * 3]; ep[k * 3 + 1] = verts[vi * 3 + 1]; ep[k * 3 + 2] = verts[vi * 3 + 2];
  });
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  obj.frustumEdge.geometry.dispose();
  obj.frustumEdge.geometry = eg;
  obj.frustumEdge.position.copy(obj.frustum.position);
}

// ---------------- 摄像头对象 ----------------

function createCameraObjects(cam) {
  const idx = camObjects.size;
  const color = new THREE.Color(PALETTE[idx % PALETTE.length]);
  const group = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 1, 10),
    new THREE.MeshStandardMaterial({ color: 0x9aa0a8 })
  );
  const headGroup = new THREE.Group();
  const headMat = new THREE.MeshStandardMaterial({ color });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 1.2), headMat);
  const lens = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 0.7, 12),
    new THREE.MeshStandardMaterial({ color: 0x222831 })
  );
  lens.rotation.x = Math.PI / 2;
  lens.position.z = 0.9;
  headGroup.add(head, lens);
  group.add(pole, headGroup);

  // 拾取代理（透明球，便于点击/拖拽）
  const pick = new THREE.Mesh(
    new THREE.SphereGeometry(1.6, 8, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  );
  pick.userData.camId = cam.id;
  headGroup.add(pick);

  const frustum = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  const frustumEdge = new THREE.LineLoop(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.7 })
  );
  const coverage = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide })
  );

  scene.add(group, frustum, frustumEdge, coverage);
  camObjects.set(cam.id, {
    group, pole, headGroup, headMat, pick, frustum, frustumEdge, coverage, color,
    yOffset: COVERAGE_BASE_Y + (idx % 16) * 0.004,
  });
  refreshCameraObject(cam.id);
}

function refreshCameraObject(id) {
  const cam = state.cameras.find((c) => c.id === id);
  const obj = camObjects.get(id);
  if (!cam || !obj) return;
  obj.group.position.set(cam.x, 0, cam.z);
  obj.pole.scale.y = cam.y;
  obj.pole.position.y = cam.y / 2;
  obj.headGroup.position.y = cam.y;
  dirFromAngles(cam.yaw, cam.pitch, _dir);
  obj.headGroup.lookAt(cam.x + _dir.x, cam.y + _dir.y, cam.z + _dir.z);
  const grid = computeGrid(cam);
  updateFrustumGeometry(obj, cam, grid);
  updateCoverageGeometry(obj, cam, grid);
}

function disposeCameraObjects(id) {
  const o = camObjects.get(id);
  if (!o) return;
  scene.remove(o.group, o.frustum, o.frustumEdge, o.coverage);
  o.group.traverse((m) => { if (m.geometry) m.geometry.dispose(); });
  o.frustum.geometry.dispose();
  o.frustumEdge.geometry.dispose();
  o.coverage.geometry.dispose();
  camObjects.delete(id);
}

function applySelectionStyles() {
  camObjects.forEach((o, id) => {
    const sel = id === state.selectedId;
    o.coverage.material.opacity = sel ? 0.55 : 0.18;
    o.frustum.material.opacity = sel ? 0.16 : 0.06;
    o.headMat.emissive.setHex(sel ? 0x444444 : 0x000000);
    o.coverage.visible = state.showAllCoverage || sel;
    o.frustum.visible = state.showAllCoverage || sel;
    o.frustumEdge.visible = o.frustum.visible;
  });
}

// 多摄像头半透明视锥按与观察者的距离排序，保证叠加渲染正确
function sortTransparent() {
  const arr = [...camObjects.values()];
  arr.sort((a, b) => b.frustum.position.distanceToSquared(camera.position) - a.frustum.position.distanceToSquared(camera.position));
  arr.forEach((o, i) => {
    o.frustum.renderOrder = 20 + i;
    o.frustumEdge.renderOrder = 40 + i;
    o.coverage.renderOrder = 60 + i;
  });
  if (blindMesh) blindMesh.renderOrder = 10;
}

// ---------------- BVH 管理（>50 摄像头启用） ----------------

function refreshBVH() {
  const want = state.cameras.length > BVH_THRESHOLD;
  const geo = buildingMesh.geometry;
  if (want && !geo.boundsTree) geo.computeBoundsTree();
  if (!want && geo.boundsTree) geo.disposeBoundsTree();
  raycaster.firstHitOnly = want;
  setState('bvhActive', want);
}

// ---------------- 盲区分析 ----------------

function coversPoint(cam, px, pz) {
  const dx = px - cam.x, dz = pz - cam.z;
  const horiz = Math.hypot(dx, dz);
  const dist = Math.hypot(horiz, cam.y);
  if (dist > cam.range) return false;
  let dyaw = Math.atan2(dx, -dz) / DEG2RAD - cam.yaw;
  dyaw = ((dyaw + 540) % 360) - 180;
  if (Math.abs(dyaw) > cam.fov / 2) return false;
  const pitchTo = Math.atan2(cam.y, horiz) / DEG2RAD;
  if (Math.abs(pitchTo - cam.pitch) > cam.vfov / 2) return false;
  _origin.set(cam.x, cam.y, cam.z);
  _dir.set(dx, -cam.y, dz).normalize();
  raycaster.set(_origin, _dir);
  raycaster.far = dist - 0.05;
  return raycaster.intersectObject(buildingMesh, false).length === 0;
}

export function apiComputeBlind() {
  const cell = BLIND_CELL, half = CAMPUS_SIZE / 2;
  const n = Math.floor(CAMPUS_SIZE / cell);
  const cells = [];
  let buildingCells = 0;
  const down = new THREE.Vector3(0, -1, 0);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const px = -half + (ix + 0.5) * cell;
      const pz = -half + (iz + 0.5) * cell;
      // 建筑 footprint 内的格子不计入可覆盖区域
      _origin.set(px, 500, pz);
      raycaster.set(_origin, down);
      raycaster.far = 1000;
      if (raycaster.intersectObject(buildingMesh, false).length > 0) { buildingCells++; continue; }
      let covered = false;
      for (const cam of state.cameras) {
        if (coversPoint(cam, px, pz)) { covered = true; break; }
      }
      if (!covered) cells.push([ix, iz]);
    }
  }
  buildBlindMesh(cells);
  const totalCells = n * n - buildingCells;
  const blindArea = cells.length * cell * cell;
  const unionArea = (totalCells - cells.length) * cell * cell;
  setState('blind', { cells, count: cells.length, area: blindArea, cellSize: cell });
  setState('unionArea', unionArea);
  setState('coverageRate', totalCells > 0 ? unionArea / (totalCells * cell * cell) : 0);
  setState('blindStale', false);
}

function buildBlindMesh(cells) {
  if (blindMesh) {
    scene.remove(blindMesh);
    blindMesh.geometry.dispose();
    blindMesh = null;
  }
  if (!cells.length) return;
  const cell = BLIND_CELL, half = CAMPUS_SIZE / 2;
  const verts = new Float32Array(cells.length * 12);
  const idx = new Uint32Array(cells.length * 6);
  cells.forEach(([ix, iz], k) => {
    const x0 = -half + ix * cell, z0 = -half + iz * cell;
    const x1 = x0 + cell, z1 = z0 + cell, y = 0.09;
    verts.set([x0, y, z0, x1, y, z0, x0, y, z1, x1, y, z1], k * 12);
    idx.set([k * 4, k * 4 + 2, k * 4 + 1, k * 4 + 1, k * 4 + 2, k * 4 + 3], k * 6);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  blindMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: 0xff2222, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide,
  }));
  blindMesh.visible = state.blindVisible;
  scene.add(blindMesh);
}

// ---------------- 对外 API ----------------

export function apiAddCamera(x, z, overrides = {}) {
  const id = 'cam_' + (camSeq++) + '_' + Math.random().toString(36).slice(2, 7);
  const cam = {
    id, name: `摄像头 ${camSeq - 1}`,
    x: r1(x), y: 6, z: r1(z),
    yaw: 45, pitch: 35, fov: 70, vfov: 45, range: 45,
    ...overrides,
  };
  setState('cameras', (c) => [...c, cam]);
  createCameraObjects(cam);
  refreshBVH();
  apiSelectCamera(id);
  markBlindStale();
  saveLocal();
  return id;
}

export function apiAddTestCameras(n = 60) {
  const cams = [];
  for (let k = 0; k < n; k++) {
    const ang = (k / n) * Math.PI * 2;
    const r = 50 + (k % 3) * 28;
    const id = 'cam_' + (camSeq++) + '_' + Math.random().toString(36).slice(2, 7);
    cams.push({
      id, name: `摄像头 ${camSeq - 1}`,
      x: r1(Math.cos(ang) * r), y: 6 + (k % 4), z: r1(Math.sin(ang) * r),
      yaw: r1((ang / DEG2RAD + 180 + (k % 5) * 14) % 360),
      pitch: 30 + (k % 3) * 8, fov: 60 + (k % 4) * 10, vfov: 45, range: 40 + (k % 3) * 10,
    });
  }
  setState('cameras', (c) => [...c, ...cams]);
  cams.forEach(createCameraObjects);
  refreshBVH();
  markBlindStale();
  saveLocal();
}

export function apiDeleteCamera(id) {
  disposeCameraObjects(id);
  setState('cameras', (c) => c.filter((cam) => cam.id !== id));
  setState('coverage', produce((s) => { delete s[id]; }));
  if (state.selectedId === id) setState('selectedId', null);
  refreshBVH();
  markBlindStale();
  saveLocal();
}

export function apiClearCameras() {
  [...camObjects.keys()].forEach(disposeCameraObjects);
  setState('cameras', []);
  setState('coverage', {});
  setState('selectedId', null);
  setState('blind', null);
  setState('unionArea', 0);
  setState('coverageRate', 0);
  if (blindMesh) { scene.remove(blindMesh); blindMesh.geometry.dispose(); blindMesh = null; }
  refreshBVH();
  saveLocal();
}

export function apiRefreshCamera(id) {
  refreshCameraObject(id);
  markBlindStale();
}

export function apiSelectCamera(id) {
  setState('selectedId', id);
  applySelectionStyles();
}

export function apiSetShowAllCoverage(v) {
  setState('showAllCoverage', v);
  applySelectionStyles();
}

export function apiSetBlindVisible(v) {
  setState('blindVisible', v);
  if (blindMesh) blindMesh.visible = v;
}

export function apiRebuildAll() {
  [...camObjects.keys()].forEach(disposeCameraObjects);
  state.cameras.forEach(createCameraObjects);
  refreshBVH();
  applySelectionStyles();
}

export function apiImportCameras(cams) {
  const clean = cams
    .filter((c) => c && typeof c.x === 'number' && typeof c.z === 'number')
    .map((c, i) => ({
      id: c.id || 'cam_imp_' + i + '_' + Math.random().toString(36).slice(2, 7),
      name: c.name || `摄像头 ${i + 1}`,
      y: 6, yaw: 45, pitch: 35, fov: 70, vfov: 45, range: 45,
      ...c,
    }));
  [...camObjects.keys()].forEach(disposeCameraObjects);
  setState('cameras', clean);
  setState('coverage', {});
  setState('blind', null);
  setState('selectedId', null);
  clean.forEach(createCameraObjects);
  refreshBVH();
  saveLocal();
}

export function apiSetViewMode(mode) {
  setState('viewMode', mode);
  const toPos = mode === 'top' ? new THREE.Vector3(0, 235, 0.01) : new THREE.Vector3(-85, 4.5, 85);
  const toTgt = mode === 'top' ? new THREE.Vector3(0, 0, 0) : new THREE.Vector3(30, 8, -30);
  viewAnim = { t: 0, fromPos: camera.position.clone(), toPos, fromTgt: controls.target.clone(), toTgt };
}

function markBlindStale() {
  if (state.blind) setState('blindStale', true);
}

// ---------------- 本地存储 / 导出 ----------------

export function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ cameras: state.cameras }));
  } catch { /* ignore */ }
}

export function loadSaved() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const d = JSON.parse(s);
      if (Array.isArray(d.cameras)) return d.cameras;
    }
  } catch { /* ignore */ }
  return null;
}

export function clearLocal() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

export function buildExportJSON() {
  const perCamera = state.cameras.map((c) => ({
    id: c.id, name: c.name, coverageArea: state.coverage[c.id]?.area ?? 0,
  }));
  const sumArea = perCamera.reduce((s, p) => s + p.coverageArea, 0);
  return {
    meta: {
      tool: 'campus-security-3d',
      version: 1,
      exportedAt: new Date().toISOString(),
      cameraCount: state.cameras.length,
      bvhAccelerated: state.bvhActive,
    },
    campus: { size: CAMPUS_SIZE, buildings: BUILDINGS },
    cameras: state.cameras.map((c) => ({ ...c })),
    analysis: {
      perCamera,
      sumCameraArea: r1(sumArea),
      unionCoveredArea: state.unionArea,
      blindArea: state.blind ? state.blind.area : null,
      coverageRate: r1(state.coverageRate * 1000) / 1000,
      blindCellSize: BLIND_CELL,
      blindCells: state.blind ? state.blind.cells : null,
    },
  };
}

// ---------------- 交互 ----------------

function setNDC(e) {
  const r = canvasEl.getBoundingClientRect();
  ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  setNDC(e);
  raycaster.setFromCamera(ndc, camera);
  raycaster.far = 3000;
  const picks = [];
  camObjects.forEach((o) => picks.push(o.pick));
  const hits = raycaster.intersectObjects(picks, false);
  if (hits.length > 0) {
    const id = hits[0].object.userData.camId;
    apiSelectCamera(id);
    dragState = { id, moved: false, sx: e.clientX, sy: e.clientY };
    controls.enabled = false;
    return;
  }
  if (state.placeMode) {
    const g = raycaster.intersectObject(groundMesh, false);
    if (g.length > 0) apiAddCamera(g[0].point.x, g[0].point.z);
  }
}

function onPointerMove(e) {
  if (!dragState) return;
  if (Math.abs(e.clientX - dragState.sx) + Math.abs(e.clientY - dragState.sy) > 4) dragState.moved = true;
  if (!dragState.moved) return;
  setNDC(e);
  raycaster.setFromCamera(ndc, camera);
  const p = raycaster.ray.intersectPlane(groundPlane, _v1);
  if (!p) return;
  const half = CAMPUS_SIZE / 2 - 2;
  const x = Math.max(-half, Math.min(half, p.x));
  const z = Math.max(-half, Math.min(half, p.z));
  setState('cameras', (c) => c.id === dragState.id, 'x', r1(x));
  setState('cameras', (c) => c.id === dragState.id, 'z', r1(z));
  refreshDirty.add(dragState.id); // 拖拽触发覆盖重算（每帧一次）
}

function onPointerUp() {
  if (!dragState) return;
  controls.enabled = true;
  if (dragState.moved) {
    markBlindStale();
    saveLocal();
    if (state.blind) apiComputeBlind(); // 已做过盲区分析则拖拽后自动重算
  }
  dragState = null;
}

// ---------------- 初始化与主循环 ----------------

function onResize() {
  if (!renderer || !canvasEl) return;
  const w = canvasEl.clientWidth || 1;
  const h = canvasEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function updateViewAnim(dt) {
  viewAnim.t += dt / 1.1;
  const t = Math.min(viewAnim.t, 1);
  const s = t * t * (3 - 2 * t);
  camera.position.lerpVectors(viewAnim.fromPos, viewAnim.toPos, s);
  controls.target.lerpVectors(viewAnim.fromTgt, viewAnim.toTgt, s);
  if (t >= 1) viewAnim = null;
}

function tick(time) {
  const dt = Math.min((time - prevTime) / 1000, 0.1);
  prevTime = time;
  if (viewAnim) updateViewAnim(dt);
  controls.update();
  refreshDirty.forEach((id) => refreshCameraObject(id));
  refreshDirty.clear();
  sortTransparent();
  renderer.render(scene, camera);
}

export function initScene(canvas) {
  canvasEl = canvas;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9db8d6);
  scene.fog = new THREE.Fog(0x9db8d6, 320, 750);

  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  camera.position.set(0, 235, 0.01);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.maxDistance = 600;
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(80, 150, 60);
  scene.add(sun);

  buildCampus();

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', onResize);
  onResize();
  renderer.setAnimationLoop(tick);
}
