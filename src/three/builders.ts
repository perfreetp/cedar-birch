import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Building, RoadNetwork, VehicleSchedule } from '../sim/types';
import { getIndex } from '../sim/network';

/** 点位按垃圾产生量分层的颜色 */
export const TIERS = [
  { max: 25, color: new THREE.Color('#37d67a'), label: '<25 低' },
  { max: 50, color: new THREE.Color('#f5d90a'), label: '25-50 中' },
  { max: 75, color: new THREE.Color('#ff8c1a'), label: '50-75 高' },
  { max: Infinity, color: new THREE.Color('#e23b3b'), label: '>75 特高' },
];

export function tierColor(eff: number): THREE.Color {
  for (const t of TIERS) if (eff < t.max) return t.color;
  return TIERS[TIERS.length - 1].color;
}

/** 拥堵度 → 绿/黄/红 */
export function congestionColor(c: number, out = new THREE.Color()): THREE.Color {
  const green = new THREE.Color('#2ecc71');
  const yellow = new THREE.Color('#f1c40f');
  const red = new THREE.Color('#e74c3c');
  if (c < 0.5) return out.copy(green).lerp(yellow, c * 2);
  return out.copy(yellow).lerp(red, (c - 0.5) * 2);
}

/** 装载率 → 绿→黄→红 */
export function loadColor(frac: number, out = new THREE.Color()): THREE.Color {
  return congestionColor(frac, out);
}

/** 道路网格：所有边合并为单个几何体（顶点色），供 BVH 加速拾取 */
export function buildRoadMesh(net: RoadNetwork): THREE.Mesh {
  const { nodeById } = getIndex(net);
  const pos: number[] = [];
  const norm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const e of net.edges) {
    const a = nodeById.get(e.a)!;
    const b = nodeById.get(e.b)!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (e.width / 2);
    const pz = (dx / len) * (e.width / 2);
    const y = 0.02;
    const base = pos.length / 3;
    pos.push(a.x + px, y, a.z + pz, a.x - px, y, a.z - pz, b.x + px, y, b.z + pz, b.x - px, y, b.z - pz);
    for (let i = 0; i < 4; i++) norm.push(0, 1, 0);
    const shade = 0.16 + 0.05 * Math.min(1, (e.width - 6) / 6);
    c.setRGB(shade, shade * 1.06, shade * 1.22);
    for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'roads';
  return mesh;
}

/** 拥堵色带：按车流密度渲染红黄色带 */
export function buildBandMesh(net: RoadNetwork): THREE.Mesh {
  const { nodeById } = getIndex(net);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const e of net.edges) {
    const a = nodeById.get(e.a)!;
    const b = nodeById.get(e.b)!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * (e.width * 0.24);
    const pz = (dx / len) * (e.width * 0.24);
    const y = 0.05;
    const base = pos.length / 3;
    pos.push(a.x + px, y, a.z + pz, a.x - px, y, a.z - pz, b.x + px, y, b.z + pz, b.x - px, y, b.z - pz);
    congestionColor(e.congestion, c);
    for (let i = 0; i < 4; i++) col.push(c.r, c.g, c.b);
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }),
  );
  mesh.name = 'congestion-bands';
  mesh.renderOrder = 1;
  return mesh;
}

/** 建筑合并网格（遮挡判断的 BVH 目标） */
export function buildBuildingsMesh(buildings: Building[]): THREE.Mesh | null {
  if (buildings.length === 0) return null;
  const geos = buildings.map((b) => {
    const g = new THREE.BoxGeometry(b.w, b.h, b.d);
    g.translate(b.x, b.h / 2, b.z);
    const shade = 0.26 + Math.random() * 0.14;
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[3 * i] = shade * 0.85;
      colors[3 * i + 1] = shade * 0.95;
      colors[3 * i + 2] = shade * 1.2;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  });
  const merged = mergeGeometries(geos)!;
  geos.forEach((g) => g.dispose());
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'buildings';
  return mesh;
}

/**
 * 收运路线：带状曲面贴合路面（路面上方 0.08m），
 * 普通段用车队色、返程段灰色；方向箭头沿路径实例化分布。
 */
export function buildRouteGroup(schedule: VehicleSchedule, colorHex: number): THREE.Group {
  const group = new THREE.Group();
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const col = new THREE.Color(colorHex);
  const retCol = new THREE.Color(0x8d949e);
  const W = 2.6;
  const y = 0.08;
  const arrows: { x: number; z: number; dx: number; dz: number }[] = [];

  for (const seg of schedule.segments) {
    if (seg.kind !== 'travel' || !seg.path) continue;
    const coords = seg.path.coords;
    const n = coords.length / 2;
    if (n < 2) continue;
    const c = seg.isReturn ? retCol : col;
    const base = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const ip = Math.max(0, i - 1);
      const inx = Math.min(n - 1, i + 1);
      let dx = coords[2 * inx] - coords[2 * ip];
      let dz = coords[2 * inx + 1] - coords[2 * ip + 1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const px = -dz * (W / 2);
      const pz = dx * (W / 2);
      const x0 = coords[2 * i];
      const z0 = coords[2 * i + 1];
      positions.push(x0 + px, y, z0 + pz, x0 - px, y, z0 - pz);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let i = 0; i < n - 1; i++) {
      const b = base + 2 * i;
      indices.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    // 方向箭头：沿累计里程等距布置
    const cum = seg.path.cum;
    const step = 16;
    let next = step * 0.5;
    for (let i = 1; i < n; i++) {
      while (next <= cum[i] && next <= seg.path.length) {
        const span = cum[i] - cum[i - 1];
        const f = span > 1e-9 ? (next - cum[i - 1]) / span : 0;
        arrows.push({
          x: coords[2 * (i - 1)] + (coords[2 * i] - coords[2 * (i - 1)]) * f,
          z: coords[2 * (i - 1) + 1] + (coords[2 * i + 1] - coords[2 * (i - 1) + 1]) * f,
          dx: coords[2 * i] - coords[2 * (i - 1)],
          dz: coords[2 * i + 1] - coords[2 * (i - 1) + 1],
        });
        next += step;
      }
    }
  }

  if (positions.length > 0) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    const ribbon = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }),
    );
    ribbon.renderOrder = 2;
    group.add(ribbon);
  }

  if (arrows.length > 0) {
    const ageo = new THREE.ConeGeometry(0.7, 2.2, 6);
    const amat = new THREE.MeshBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.65) });
    const amesh = new THREE.InstancedMesh(ageo, amat, arrows.length);
    const up = new THREE.Vector3(0, 1, 0);
    const dirV = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    arrows.forEach((a, i) => {
      const l = Math.hypot(a.dx, a.dz) || 1;
      dirV.set(a.dx / l, 0, a.dz / l);
      q.setFromUnitVectors(up, dirV);
      m.makeRotationFromQuaternion(q).setPosition(a.x, 0.2, a.z);
      amesh.setMatrixAt(i, m);
    });
    amesh.instanceMatrix.needsUpdate = true;
    amesh.renderOrder = 3;
    group.add(amesh);
  }
  return group;
}

/** 场站标记 */
export function buildDepotMesh(x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(5, 5, 0.6, 24),
    new THREE.MeshLambertMaterial({ color: 0xd4a017 }),
  );
  base.position.set(x, 0.3, z);
  const tower = new THREE.Mesh(
    new THREE.BoxGeometry(3, 6, 3),
    new THREE.MeshLambertMaterial({ color: 0xe8c05a }),
  );
  tower.position.set(x, 3.3, z);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(6.5, 0.3, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd54f }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(x, 0.1, z);
  g.add(base, tower, ring);
  return g;
}
