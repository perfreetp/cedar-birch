// 精确复现引擎关键帧轨迹的碰撞扫描（含左右瓣、张开与抛离全程）
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createClamshellGeometry, FAIRING_DIMS, HINGE_Y, ROCKET_RADIUS } from '../src/three/geometry.ts';
import { smootherstep } from '../src/lib/mathUtils.ts';

const baseY = 4.275;
const satY = 5.85;
const sep = 5, openDur = 1.2, jetDur = 2.0, angleMax = 65 * Math.PI / 180;
const radialEnd = 2.2 * jetDur;
const axialEnd = 1.2 * jetDur;

function sampleChannel(frames, t) {
  if (t <= frames[0].t) return frames[0].v;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (t <= b.t) {
      const u = smootherstep((t - a.t) / (b.t - a.t));
      return a.v + (b.v - a.v) * u;
    }
  }
  return frames.at(-1).v;
}
const t1 = sep + openDur, t2 = t1 + jetDur;
const angleFrames = [{ t: 0, v: 0 }, { t: sep, v: 0 }, { t: t1, v: angleMax * 0.92 }, { t: t2, v: angleMax }];
const radialFrames = [{ t: 0, v: 0 }, { t: t1, v: 0 }, { t: t2, v: radialEnd }];
const axialFrames = [{ t: 0, v: 0 }, { t: t1, v: 0 }, { t: t2, v: axialEnd }];

const blockers = {
  sat: { geo: new THREE.BoxGeometry(0.5, 0.9, 0.42), world: new THREE.Matrix4().makeTranslation(0, satY, 0) },
  rocket: { geo: new THREE.CylinderGeometry(ROCKET_RADIUS, ROCKET_RADIUS, 14, 40), world: new THREE.Matrix4().makeTranslation(0, -3, 0) },
};

const tmp = new THREE.Matrix4();
for (const side of [1, -1]) {
  const geo = createClamshellGeometry(side);
  const bvh = new MeshBVH(geo);
  const sign = -1;
  let minD = Infinity, at = '';
  for (let t = sep; t <= t2 + 0.01; t += 0.05) {
    const angle = sign * sampleChannel(angleFrames, t);
    const radial = sampleChannel(radialFrames, t);
    const axial = sampleChannel(axialFrames, t);
    const hinge = new THREE.Matrix4().makeRotationY(angle);
    hinge.setPosition(side * radial * 0.82, baseY + HINGE_Y + axial, side * (FAIRING_DIMS.R + radial * 0.57));
    const meshLocal = new THREE.Matrix4().makeTranslation(0, -HINGE_Y, -side * FAIRING_DIMS.R);
    const w = meshLocal.premultiply(hinge);
    for (const [name, b] of Object.entries(blockers)) {
      tmp.copy(w).invert().multiply(b.world);
      const hit = bvh.closestPointToGeometry(b.geo, tmp);
      const d = hit ? hit.distance : Infinity;
      if (d < minD) { minD = d; at = `t=${t.toFixed(2)} ${name} angle=${(angle * 180 / Math.PI).toFixed(1)}° r=${radial.toFixed(2)} a=${axial.toFixed(2)}`; }
      if (d < 0.01) console.log(`侧${side} 穿模 t=${t.toFixed(2)} vs ${name} d=${d.toFixed(4)}`);
    }
  }
  console.log(`侧${side} 全轨迹最小间距 ${minD.toFixed(4)} m @ ${at}`);
}
