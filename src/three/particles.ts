import * as THREE from 'three';
import type { SimParams } from '../types';
import { bvhOf } from './bvh';

const DEBRIS_GEO = new THREE.TetrahedronGeometry(0.055);
const DUMMY = new THREE.Object3D();
const _spinQ = new THREE.Quaternion();
const _sphere = new THREE.Sphere();

interface Debris {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: THREE.Vector3; // 角速度 rad/s
  quat: THREE.Quaternion;
  life: number;
  maxLife: number;
  size: number;
  active: boolean;
}

/**
 * 分离碎片：InstancedMesh 实例化的金属碎块，按分离冲量向两侧扩散，
 * 每块带独立线速度与旋转角速度，并与卫星/箭体做 BVH 碰撞反弹。
 */
export class DebrisSystem {
  readonly mesh: THREE.InstancedMesh;
  private debris: Debris[] = [];
  private capacity: number;
  private blockers: THREE.Mesh[];
  private lastT = -1;

  constructor(capacity: number, blockers: THREE.Mesh[]) {
    this.capacity = capacity;
    this.blockers = blockers;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xc9ccd6,
      metalness: 0.85,
      roughness: 0.3,
    });
    this.mesh = new THREE.InstancedMesh(DEBRIS_GEO, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < capacity; i++) {
      this.debris.push({
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        life: 0,
        maxLife: 1,
        size: 1,
        active: false,
      });
      DUMMY.position.set(0, -999, 0);
      DUMMY.scale.setScalar(0);
      DUMMY.updateMatrix();
      this.mesh.setMatrixAt(i, DUMMY.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** 分离瞬间沿两条结合缝（z=±R）迸发碎块，随对应罩瓣向 ±X 冲离 */
  burst(t: number, params: SimParams, seamY0: number, seamY1: number, seamZ: number): void {
    let spawned = 0;
    for (const d of this.debris) {
      if (spawned >= params.particleCount) break;
      if (d.active) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      const y = seamY0 + Math.random() * (seamY1 - seamY0);
      // 出生在对应侧的结合缝上
      d.pos.set((Math.random() - 0.5) * 0.06, y, side * seamZ + (Math.random() - 0.5) * 0.06);
      // 冲量方向：随该侧罩瓣斜向扩散（与罩瓣抛离方向一致），叠加随机锥角与向上分量
      const cone = (Math.random() - 0.5) * params.particleSpread;
      const speed = params.particleSpeed * (0.45 + Math.random() * 0.9);
      const dirX = 0.82, dirZ = 0.57;
      d.vel.set(
        side * speed * dirX * Math.cos(cone),
        params.axialSpeed * 0.6 + Math.random() * 1.2,
        side * speed * dirZ + (Math.random() - 0.5) * 1.5 + speed * Math.sin(cone),
      );
      d.spin.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
      );
      d.quat.setFromEuler(
        new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      );
      d.maxLife = 2.2 + Math.random() * 1.8;
      d.life = d.maxLife;
      d.size = 0.5 + Math.random() * 1.4;
      d.active = true;
      spawned++;
    }
    this.lastT = t;
  }

  /** 时间轴回退时清空 */
  reset(): void {
    for (const d of this.debris) {
      d.active = false;
      DUMMY.position.set(0, -999, 0);
      DUMMY.scale.setScalar(0);
      DUMMY.updateMatrix();
    }
    for (let i = 0; i < this.capacity; i++) this.mesh.setMatrixAt(i, DUMMY.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lastT = -1;
  }

  /** 按仿真时间推进；dt 可能为负（拖动时间轴），此时仅重定位 */
  update(t: number, dt: number): void {
    if (this.lastT < 0 || t < this.lastT) {
      this.lastT = t;
      return;
    }
    const step = Math.min(dt, 1 / 30);
    for (let i = 0; i < this.capacity; i++) {
      const d = this.debris[i];
      if (!d.active) continue;
      d.life -= step;
      if (d.life <= 0) {
        d.active = false;
        DUMMY.position.set(0, -999, 0);
        DUMMY.scale.setScalar(0);
        DUMMY.updateMatrix();
        this.mesh.setMatrixAt(i, DUMMY.matrix);
        continue;
      }
      d.vel.y -= 2.2 * step; // 微重力下坠
      d.vel.multiplyScalar(1 - 0.25 * step); // 气动阻尼
      d.pos.addScaledVector(d.vel, step);
      _spinQ.setFromEuler(
        new THREE.Euler(d.spin.x * step, d.spin.y * step, d.spin.z * step),
      );
      d.quat.multiply(_spinQ);

      // BVH 碰撞：碎块外包球与卫星/箭体相交则沿速度方向反弹
      for (const blocker of this.blockers) {
        blocker.updateWorldMatrix(true, false);
        _sphere.center.copy(d.pos);
        _sphere.radius = 0.06 * d.size;
        if (bvhOf(blocker.geometry).intersectsSphere(_sphere)) {
          const n = d.vel.clone().normalize();
          d.vel.reflect(n).multiplyScalar(0.45);
          d.pos.addScaledVector(n, 0.12);
        }
      }

      const fade = Math.min(1, d.life / 0.6);
      DUMMY.position.copy(d.pos);
      DUMMY.quaternion.copy(d.quat);
      DUMMY.scale.setScalar(d.size * fade);
      DUMMY.updateMatrix();
      this.mesh.setMatrixAt(i, DUMMY.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lastT = t;
  }

  get activeCount(): number {
    return this.debris.reduce((n, d) => n + (d.active ? 1 : 0), 0);
  }
}

interface DustParticle {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  active: boolean;
}

/** 尘雾点云：自定义着色器的 Points，按生命衰减尺寸与透明度 */
export class DustSystem {
  readonly points: THREE.Points;
  private particles: DustParticle[] = [];
  private capacity: number;
  private geo: THREE.BufferGeometry;
  private lastT = -1;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.geo = new THREE.BufferGeometry();
    const pos = new Float32Array(capacity * 3);
    const size = new Float32Array(capacity);
    const alpha = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) {
      pos[i * 3 + 1] = -999;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
    this.particles = Array.from({ length: capacity }, () => ({
      pos: new THREE.Vector3(0, -999, 0),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 1,
      active: false,
    }));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color(0x8fa6cc) } },
      vertexShader: `
        attribute float aSize;
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (45.0 / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - vec2(0.5);
          float r = length(c);
          if (r > 0.5) discard;
          float glow = smoothstep(0.5, 0.15, r);
          gl_FragColor = vec4(uColor, glow * vAlpha);
        }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  burst(t: number, params: SimParams, seamY0: number, seamY1: number, seamZ: number): void {
    let spawned = 0;
    for (const p of this.particles) {
      if (spawned >= params.dustCount) break;
      if (p.active) continue;
      const side = Math.random() < 0.5 ? -1 : 1;
      p.pos.set(
        (Math.random() - 0.5) * 0.15,
        seamY0 + Math.random() * (seamY1 - seamY0),
        side * seamZ + (Math.random() - 0.5) * 0.15,
      );
      p.vel.set(
        side * params.particleSpeed * 0.82 * (0.3 + Math.random() * 0.6),
        0.4 + Math.random() * 1.4,
        side * params.particleSpeed * 0.57 * (0.3 + Math.random() * 0.6) +
          (Math.random() - 0.5) * 1.2,
      );
      p.maxLife = 1.4 + Math.random() * 1.6;
      p.life = p.maxLife;
      p.active = true;
      spawned++;
    }
    this.lastT = t;
  }

  reset(): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('aAlpha') as THREE.BufferAttribute;
    const size = this.geo.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < this.capacity; i++) {
      this.particles[i].active = false;
      pos.setXYZ(i, 0, -999, 0);
      alpha.setX(i, 0);
      size.setX(i, 0);
    }
    pos.needsUpdate = alpha.needsUpdate = size.needsUpdate = true;
    this.lastT = -1;
  }

  update(t: number, dt: number): void {
    if (this.lastT < 0 || t < this.lastT) {
      this.lastT = t;
      return;
    }
    const step = Math.min(dt, 1 / 30);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const alpha = this.geo.getAttribute('aAlpha') as THREE.BufferAttribute;
    const size = this.geo.getAttribute('aSize') as THREE.BufferAttribute;
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= step;
      if (p.life <= 0) {
        p.active = false;
        pos.setXYZ(i, 0, -999, 0);
        alpha.setX(i, 0);
        size.setX(i, 0);
        continue;
      }
      p.vel.multiplyScalar(1 - 0.5 * step);
      p.pos.addScaledVector(p.vel, step);
      const u = p.life / p.maxLife;
      pos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
      alpha.setX(i, u * 0.22);
      size.setX(i, 2.5 + (1 - u) * 9);
    }
    pos.needsUpdate = alpha.needsUpdate = size.needsUpdate = true;
    this.lastT = t;
  }

  get activeCount(): number {
    return this.particles.reduce((n, p) => n + (p.active ? 1 : 0), 0);
  }
}
