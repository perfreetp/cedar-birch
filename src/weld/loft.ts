// 沿焊缝 z 方向放样焊道几何: 叠加摆动(weave)与粗细波动,使任意 z 处截面不同,
// 从而 three-mesh-bvh 剖切得到的是真实的实时截面而非固定拉伸体。
// 焊道为完整圆柱放样,与坡口壁/相邻道的熔合由熔深偏置在排布层面积计算中体现,
// 不在几何上强行钳制(避免边缘焊道退化成点)。
import * as THREE from 'three';
import { Bead } from '../types';
import { Pt } from './polygon2d';

const RING_SEGMENTS = 64;
const STATIONS = 14;
const WEAVE_PERIODS = 2.5; // 整条焊缝上的摆动周期数
const WEAVE_AMP = 0.1; // 摆幅 / 焊道半径
const RIPPLE = 0.045; // 粗细波动比例

export interface LoftBuildResult {
  geometry: THREE.BufferGeometry;
  /** 每个焊道在合并几何体中的顶点范围(按 ring 顶点计),供拾取后回查 */
  ranges: Array<{ bead: Bead; vertexStart: number; vertexCount: number }>;
}

export function buildWeldLoftGeometry(
  beads: Bead[],
  weldLength: number,
  _nominalCCW: unknown,
  _penetration: number,
  colorForLayer: (layer: number) => number,
): LoftBuildResult {
  const positions: number[] = [];
  const beadIndices: number[] = []; // 每个顶点对应的焊道序号
  const layerIndices: number[] = []; // 每个顶点对应的层号
  const colors: number[] = [];
  const ranges: LoftBuildResult['ranges'] = [];

  beads.forEach((bead, beadIdx) => {
    const vertexStart = positions.length / 3;
    const seed = bead.order;
    const weavePhase = (seed * 0.73) % (Math.PI * 2);

    for (let s = 0; s <= STATIONS; s++) {
      const u = s / STATIONS;
      const z = -weldLength / 2 + u * weldLength;
      const wave = Math.sin(u * Math.PI * 2 * WEAVE_PERIODS + weavePhase);
      const weaveX = wave * bead.r * WEAVE_AMP;
      const weaveY =
        Math.cos(u * Math.PI * 2 * WEAVE_PERIODS + weavePhase) * bead.r * WEAVE_AMP * 0.5;
      const localR =
        bead.r * (1 + RIPPLE * Math.sin(u * Math.PI * 2 * (WEAVE_PERIODS * 2) + seed));
      const cx = bead.cx + weaveX;
      const cy = bead.cy + weaveY;
      for (let j = 0; j < RING_SEGMENTS; j++) {
        const a = (j / RING_SEGMENTS) * Math.PI * 2;
        positions.push(cx + localR * Math.cos(a), cy + localR * Math.sin(a), z);
        beadIndices.push(beadIdx);
        layerIndices.push(bead.layer);
        const col = new THREE.Color(colorForLayer(bead.layer));
        colors.push(col.r, col.g, col.b);
      }
    }
    ranges.push({ bead, vertexStart, vertexCount: (STATIONS + 1) * RING_SEGMENTS });
  });

  const beadsCount = beads.length;
  const indices: number[] = [];
  const ringVerts = (STATIONS + 1) * RING_SEGMENTS;
  for (let b = 0; b < beadsCount; b++) {
    const base = b * ringVerts;
    for (let s = 0; s < STATIONS; s++) {
      for (let j = 0; j < RING_SEGMENTS; j++) {
        const a = base + s * RING_SEGMENTS + j;
        const b1 = base + s * RING_SEGMENTS + ((j + 1) % RING_SEGMENTS);
        const c = base + (s + 1) * RING_SEGMENTS + ((j + 1) % RING_SEGMENTS);
        const d = base + (s + 1) * RING_SEGMENTS + j;
        indices.push(a, b1, d, b1, c, d);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('beadIndex', new THREE.Float32BufferAttribute(beadIndices, 1));
  geometry.setAttribute('layerIndex', new THREE.Float32BufferAttribute(layerIndices, 1));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, ranges };
}

/** 基板/盖面金属: 2D 轮廓沿 z 拉伸 */
export function extrudeProfile(poly: Pt[], holes: Pt[][], weldLength: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) shape.lineTo(poly[i].x, poly[i].y);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.moveTo(hole[0].x, hole[0].y);
    for (let i = 1; i < hole.length; i++) path.lineTo(hole[i].x, hole[i].y);
    path.closePath();
    shape.holes.push(path);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: weldLength, bevelEnabled: false, steps: 1 });
  geo.translate(0, 0, -weldLength / 2);
  geo.computeVertexNormals();
  return geo;
}
