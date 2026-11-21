import * as THREE from 'three';
import type { SimState, TrajectoryData, TrajectoryKeyframe } from '../types';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _mat = new THREE.Matrix4();

export class TrajectorySampler {
  readonly name: string;
  readonly frames: TrajectoryKeyframe[];
  readonly duration: number;
  private maxAlt = 0;

  constructor(data: TrajectoryData) {
    if (!data.keyframes || data.keyframes.length < 2) {
      throw new Error('弹道数据至少需要 2 个关键帧');
    }
    const frames = [...data.keyframes].sort((a, b) => a.t - b.t);
    if (frames.some((f) => !Number.isFinite(f.t) || !Number.isFinite(f.x))) {
      throw new Error('弹道关键帧包含非数值字段');
    }
    this.frames = frames;
    this.name = data.name || '未命名弹道';
    this.duration = frames[frames.length - 1].t;
    for (const f of frames) this.maxAlt = Math.max(this.maxAlt, f.y);
  }

  static async fromFile(file: File): Promise<TrajectorySampler> {
    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error('文件不是合法 JSON');
    }
    return new TrajectorySampler(json as TrajectoryData);
  }

  get maxAltitude(): number {
    return this.maxAlt;
  }

  sample(time: number, out: SimState): SimState {
    const frames = this.frames;
    const t = THREE.MathUtils.clamp(time, 0, this.duration);

    let hi = 1;
    while (hi < frames.length - 1 && frames[hi].t < t) hi++;
    const a = frames[hi - 1];
    const b = frames[hi];
    const span = b.t - a.t || 1;
    const k = THREE.MathUtils.clamp((t - a.t) / span, 0, 1);

    const lerp = (va: number, vb: number) => va + (vb - va) * k;
    out.time = t;
    out.position.set(lerp(a.x, b.x), lerp(a.y, b.y), lerp(a.z, b.z));
    out.velocity.set(lerp(a.vx, b.vx), lerp(a.vy, b.vy), lerp(a.vz, b.vz));
    out.speed = out.velocity.length();
    out.altitude = out.position.y;
    out.throttle = lerp(a.throttle ?? 1, b.throttle ?? 1);

    // 朝向：优先显式 pitch/heading，否则由速度方向推算
    _fwd.copy(out.velocity);
    if (_fwd.lengthSq() < 1e-6) {
      _fwd.set(0, 1, 0);
    } else {
      _fwd.normalize();
    }
    if (a.pitch !== undefined && b.pitch !== undefined) {
      const pitch = THREE.MathUtils.degToRad(lerp(a.pitch, b.pitch));
      const heading = THREE.MathUtils.degToRad(lerp(a.heading ?? 0, b.heading ?? 0));
      _fwd.set(
        Math.cos(pitch) * Math.cos(heading),
        Math.sin(pitch),
        Math.cos(pitch) * Math.sin(heading),
      ).normalize();
    }
    // 由前进方向构造正交基并写入四元数（箭体 +Y 轴指向前方）
    _right.crossVectors(_z, _fwd);
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0);
    _right.normalize();
    _up.crossVectors(_fwd, _right).normalize();
    _mat.makeBasis(_right, _fwd, _up);
    out.quaternion.setFromRotationMatrix(_mat);
    return out;
  }
}
