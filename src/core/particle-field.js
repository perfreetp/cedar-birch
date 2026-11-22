// 粒子场: 12 万固定粒子, 三类结构(眼壁/螺旋雨带/外围环流)
import * as THREE from 'three';
import { PARTICLE_COUNT, QUOTA, Z_EXAG, COLOR_STOPS_HEX } from './constants.js';
import { mulberry32, gaussian, lerp, clamp, interpProfile } from './util.js';
import { windAtLevel, pressureAtLevel, tangentialWind, pressureAt, particleSweep } from './typhoon.js';

const REGION = { EYEWALL: 0, RAINBAND: 1, OUTER: 2 };

// 软圆点纹理(用于平面 billboard, 边缘 alpha 平滑 -> 无黑边)
function makeSoftCircleTexture() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ParticleField {
  constructor(data) {
    this.data = data;
    this.levels = data.levels;
    this.zMin = data.levels[0];
    this.zMax = data.levels[data.levels.length - 1];

    // 粒子静态属性(以参考关键帧的归一化半径 R 为基准生成)
    this.region = new Uint8Array(PARTICLE_COUNT);
    this.r0 = new Float32Array(PARTICLE_COUNT); // 归一化半径 r/R
    this.theta0 = new Float32Array(PARTICLE_COUNT); // 初始方位角 rad
    this.z = new Float32Array(PARTICLE_COUNT); // 高度 m
    this.bandArm = new Float32Array(PARTICLE_COUNT); // 雨带臂编号
    this.size = new Float32Array(PARTICLE_COUNT); // 基础尺寸
    this.jitter = new Float32Array(PARTICLE_COUNT); // 径向抖动相位

    // 当前帧世界坐标(km, z 已做视觉夸张)
    this.px = new Float32Array(PARTICLE_COUNT);
    this.py = new Float32Array(PARTICLE_COUNT);
    this.pz = new Float32Array(PARTICLE_COUNT);
    this.visibleFlag = new Uint8Array(PARTICLE_COUNT);

    // 实例槽 -> 粒子 id 映射(供 raycast 拾取)
    this.slotToId = new Int32Array(PARTICLE_COUNT);

    this._generate();
    this._buildMesh();
    this._buildDensityGrid();
  }

  _generate() {
    const rng = mulberry32(20261122);
    const nEye = Math.floor(PARTICLE_COUNT * QUOTA.eyewall);
    const nBand = Math.floor(PARTICLE_COUNT * QUOTA.rainband);
    let id = 0;

    // 1) 眼壁: 紧贴 RMW 的高耸环, 高度可达 16km
    for (let k = 0; k < nEye; k++, id++) {
      this.region[id] = REGION.EYEWALL;
      this.r0[id] = clamp(1 + gaussian(rng) * 0.1, 0.72, 1.35);
      this.theta0[id] = rng() * Math.PI * 2;
      // 高度略偏向中低层, 但保留高空羽流
      const u = rng();
      this.z[id] = Math.pow(u, 0.8) * (this.zMax - 300) + 200;
      this.size[id] = 1.5 + rng() * 0.9;
      this.jitter[id] = rng() * Math.PI * 2;
    }

    // 2) 螺旋雨带: 3 条对数螺旋臂, 1.2R ~ 3.2R
    const ARMS = 3;
    for (let k = 0; k < nBand; k++, id++) {
      this.region[id] = REGION.RAINBAND;
      const arm = k % ARMS;
      const u = rng();
      const rNorm = 1.2 + Math.pow(u, 1.15) * 2.0;
      this.r0[id] = rNorm;
      // 对数螺旋: theta 随半径增加, 加横向高斯展宽
      const spiral = 0.55 * Math.log(Math.max(rNorm, 1.01));
      this.theta0[id] =
        (arm * Math.PI * 2) / ARMS + spiral + gaussian(rng) * 0.22;
      this.bandArm[id] = arm;
      // 雨带主要集中 0~10km, 少量高空卷云
      this.z[id] = clamp(600 + Math.pow(rng(), 1.35) * 9800 + gaussian(rng) * 250, 150, 12500);
      this.size[id] = 1.2 + rng() * 0.8;
      this.jitter[id] = rng() * Math.PI * 2;
    }

    // 3) 外围环流: 3R ~ 外边界, 宽阔均匀的浅环流
    for (let k = id; k < PARTICLE_COUNT; k++) {
      this.region[k] = REGION.OUTER;
      const u = rng();
      const rNorm = 3.0 + Math.sqrt(u) * 3.6; // 面积均匀采样
      this.r0[k] = rNorm;
      this.theta0[k] = rng() * Math.PI * 2;
      // 外围偏浅薄: 0~6km
      this.z[k] = clamp(Math.pow(rng(), 1.6) * 5800 + 150, 100, 6500);
      this.size[k] = 1.0 + rng() * 0.7;
      this.jitter[k] = rng() * Math.PI * 2;
    }
  }

  _buildMesh() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: makeSoftCircleTexture(),
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, PARTICLE_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;

    // 实例颜色缓冲(5 色阶)
    this.palette = COLOR_STOPS_HEX.map((h) => new THREE.Color(h));
    this._tmpColor = new THREE.Color();
    // 每个粒子当前色阶(随密度重算), renderFrame 按深度顺序同步进实例缓冲
    this.colorLevel = new Uint8Array(PARTICLE_COUNT);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(PARTICLE_COUNT * 3),
      3
    );
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // 初始全部缩放到 0(隐藏)
    const m = new THREE.Matrix4();
    m.makeScale(0, 0, 0);
    for (let i = 0; i < PARTICLE_COUNT; i++) this.mesh.setMatrixAt(i, m);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = PARTICLE_COUNT;

    this._dummy = new THREE.Object3D();
  }

  // 密度栅格: 柱坐标(角度段 x 径向段 x 高度段), 只统计可见粒子
  _buildDensityGrid() {
    this.nA = 36;
    this.nR = 24;
    this.nZ = 14;
    this.nCells = this.nA * this.nR * this.nZ;
    this.cellOf = new Int32Array(PARTICLE_COUNT);
    this.cellCount = new Int32Array(this.nCells);
    this.cellLevel = new Uint8Array(this.nCells);
  }

  // 根据当前状态与累计转角更新所有粒子世界坐标
  updatePositions(state, rotationI) {
    this._lastState = state;
    const R = state.rmw;
    const outer = state.radiusOuter;
    const cx = 0;
    const cz = 0;
    for (let id = 0; id < PARTICLE_COUNT; id++) {
      const rNorm = this.r0[id];
      const sweep = particleSweep(rotationI, rNorm);
      const th = this.theta0[id] + sweep;
      // 外边界随状态缩放
      const maxNorm = outer / R;
      const norm = clamp(rNorm, 0, maxNorm);
      const r = norm * R;
      // 雨带轻微径向脉动, 让结构有呼吸感
      const pulse =
        this.region[id] === REGION.RAINBAND
          ? 1 + 0.03 * Math.sin(this.jitter[id] + rotationI * 0.35)
          : 1 + 0.012 * Math.sin(this.jitter[id] + rotationI * 0.2);
      const rr = r * pulse;
      this.px[id] = cx + rr * Math.cos(th);
      this.pz[id] = cz + rr * Math.sin(th);
      // 垂直坐标 km, 乘视觉夸张
      this.py[id] = (this.z[id] / 1000) * Z_EXAG;
    }
  }

  // 高度切面: 中心高度 sliceZ(m), 带宽 band(m); sliceEnabled=false 时全显示
  applySlice(sliceEnabled, sliceZ, band) {
    this.visibleCount = 0;
    this.visibleFlag.fill(0);
    if (!sliceEnabled) {
      for (let id = 0; id < PARTICLE_COUNT; id++) {
        this.visibleFlag[id] = 1;
        this.slotToId[id] = id;
      }
      this.visibleCount = PARTICLE_COUNT;
    } else {
      const lo = sliceZ - band * 0.5;
      const hi = sliceZ + band * 0.5;
      for (let id = 0; id < PARTICLE_COUNT; id++) {
        if (this.z[id] >= lo && this.z[id] <= hi) {
          this.visibleFlag[id] = 1;
          this.slotToId[this.visibleCount++] = id;
        }
      }
    }
    this.recomputeDensity();
  }

  // 可见粒子密度重算 -> 5 个离散色阶
  recomputeDensity() {
    const state = this._lastState;
    if (!state) return;
    const outer = state.radiusOuter;
    if (this.visibleCount === 0) {
      this.cellLevel.fill(4); // 无可见粒子时全部归最低档, 避免除零
      return;
    }
    this.cellCount.fill(0);
    const inv2pi = 1 / (Math.PI * 2);
    for (let s = 0; s < this.visibleCount; s++) {
      const id = this.slotToId[s];
      const x = this.px[id];
      const z = this.pz[id];
      const r = Math.sqrt(x * x + z * z);
      const a = (Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2);
      const ia = Math.min(this.nA - 1, (a * inv2pi * this.nA) | 0);
      const ir = Math.min(this.nR - 1, ((r / outer) * this.nR) | 0);
      const iz = Math.min(
        this.nZ - 1,
        (((this.z[id] - this.zMin) / (this.zMax - this.zMin)) * this.nZ) | 0
      );
      const c = ia * (this.nR * this.nZ) + ir * this.nZ + iz;
      this.cellOf[id] = c;
      this.cellCount[c]++;
    }
    // 非空格子计数排序求分位阈值 -> 5 档
    const occupied = [];
    for (let c = 0; c < this.nCells; c++) {
      if (this.cellCount[c] > 0) occupied.push(this.cellCount[c]);
    }
    occupied.sort((a, b) => a - b);
    const q = (p) => occupied[Math.min(occupied.length - 1, Math.floor(p * occupied.length))] || 1;
    const t1 = q(0.5);
    const t2 = q(0.75);
    const t3 = q(0.9);
    const t4 = q(0.97);
    for (let c = 0; c < this.nCells; c++) {
      const v = this.cellCount[c];
      let lv = 4;
      if (v >= t4) lv = 0;
      else if (v >= t3) lv = 1;
      else if (v >= t2) lv = 2;
      else if (v >= t1) lv = 3;
      this.cellLevel[c] = lv;
    }
    // 记录每个粒子的色阶, 实际实例颜色在 renderFrame 中随深度顺序写入
    for (let s = 0; s < this.visibleCount; s++) {
      const id = this.slotToId[s];
      this.colorLevel[id] = this.cellLevel[this.cellOf[id]];
    }
  }

  // 每帧: 深度排序 + billboard 实例矩阵写入
  // 用 2048 桶计数排序(近->远), 半透明按从远到近绘制
  renderFrame(camera, state) {
    this._lastState = state;
    const n = this.visibleCount;
    if (n === 0) {
      this.mesh.count = 0;
      return { sorted: 0 };
    }
    camera.updateMatrixWorld();
    const cp = camera.position;

    // 1) 计算深度并量化到桶
    const BINS = 2048;
    const binOf = this._binOf || (this._binOf = new Uint16Array(PARTICLE_COUNT));
    const dSq = this._dSq || (this._dSq = new Float32Array(PARTICLE_COUNT));
    let dMin = Infinity;
    let dMax = 0;
    for (let s = 0; s < n; s++) {
      const id = this.slotToId[s];
      const dx = this.px[id] - cp.x;
      const dy = this.py[id] - cp.y;
      const dz = this.pz[id] - cp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      dSq[s] = d2;
      if (d2 < dMin) dMin = d2;
      if (d2 > dMax) dMax = d2;
    }
    const range = Math.max(1e-6, dMax - dMin);
    const counts = this._sortCounts || (this._sortCounts = new Uint32Array(BINS));
    counts.fill(0);
    for (let s = 0; s < n; s++) {
      const b = Math.min(BINS - 1, (((dSq[s] - dMin) / range) * BINS) | 0);
      binOf[s] = b;
      counts[b]++;
    }
    // 2) 前缀和
    const offsets = this._sortOffsets || (this._sortOffsets = new Uint32Array(BINS));
    let acc = 0;
    for (let b = 0; b < BINS; b++) {
      offsets[b] = acc;
      acc += counts[b];
    }
    // 3) 桶内分发, 得到按深度升序的槽位序列
    const order = this._order || (this._order = new Int32Array(PARTICLE_COUNT));
    const cursor = this._sortCursor || (this._sortCursor = new Uint32Array(BINS));
    cursor.set(offsets);
    for (let s = 0; s < n; s++) {
      order[cursor[binOf[s]]++] = s;
    }

    // 4) 正向遍历深度序列(远->近)写实例矩阵, 透明混合要求最远的先画。
    // visibleIds 保持过滤结果不变, 排序结果写入独立的 renderSlot 供 raycast 拾取。
    const d = this._dummy;
    const scaleK = 1;
    const mat = this.mesh;
    const renderSlot = this.renderSlot || (this.renderSlot = new Int32Array(PARTICLE_COUNT));
    const colAttr = mat.instanceColor;
    const colArr = colAttr.array;
    for (let k = 0; k < n; k++) {
      const srcSlot = order[k]; // 深度升序: k=0 最近, k=n-1 最远
      const drawIndex = n - 1 - k; // 反转: 实例槽 0 放最远粒子
      const id = this.slotToId[srcSlot];
      renderSlot[drawIndex] = id;
      d.position.set(this.px[id], this.py[id], this.pz[id]);
      d.quaternion.copy(camera.quaternion);
      const sc = this.size[id] * scaleK;
      d.scale.set(sc, sc, sc);
      d.updateMatrix();
      mat.setMatrixAt(drawIndex, d.matrix);
      const c = this.palette[this.colorLevel[id]];
      const ci = drawIndex * 3;
      colArr[ci] = c.r;
      colArr[ci + 1] = c.g;
      colArr[ci + 2] = c.b;
    }
    // 多余实例隐藏
    if (n < PARTICLE_COUNT) {
      const zero = this._zeroMat || (this._zeroMat = new THREE.Matrix4().makeScale(0, 0, 0));
      for (let k = n; k < PARTICLE_COUNT; k++) {
        mat.setMatrixAt(k, zero);
        const ci = k * 3;
        colArr[ci] = colArr[ci + 1] = colArr[ci + 2] = 0;
      }
    }
    mat.count = PARTICLE_COUNT;
    mat.instanceMatrix.needsUpdate = true;
    colAttr.needsUpdate = true;
    return { sorted: n };
  }

  // 实例 index -> 粒子 id(拾取); renderSlot 每帧按深度顺序重建
  idAtInstance(instanceId) {
    return this.renderSlot ? this.renderSlot[instanceId] : this.slotToId[instanceId];
  }

  // 粒子所在位置的风速/气压(按当前插值态与粒子高度)
  sampleAt(id, state) {
    const x = this.px[id];
    const z = this.pz[id];
    const r = Math.sqrt(x * x + z * z);
    const vMax = windAtLevel(state, this.levels, this.z[id]);
    const pCenter = pressureAtLevel(state, this.levels, this.z[id]);
    // 环境气压: 数据最外层廓线(16km)与中心的差值在该高度已很小,
    // 用中心气压叠加一个随高度递减的环境扰动量作为环境气压
    const topDeficit =
      state.pressureProfile[state.pressureProfile.length - 1] -
      state.pressureProfile[0];
    const pEnv = pCenter + Math.max(28, 55 + topDeficit * 0.6);
    const wind = tangentialWind(r, state.rmw, vMax);
    const pressure = pressureAt(r, state.rmw, pCenter, pEnv);
    return {
      r,
      altitude: this.z[id],
      wind,
      pressure,
      region: this.region[id],
      x,
      y: this.py[id],
      z,
    };
  }

  // 眼壁最大风速位置(标注用): 取眼壁区在参考高度 3000m 附近、r 最接近 R 的可见粒子
  locateEyewallMax(state) {
    let best = -1;
    let bestScore = Infinity;
    const zTarget = 3000;
    for (let id = 0; id < PARTICLE_COUNT; id++) {
      if (this.region[id] !== REGION.EYEWALL) continue;
      const score = Math.abs(this.r0[id] - 1) * 4 + Math.abs(this.z[id] - zTarget) / 4000;
      if (score < bestScore) {
        bestScore = score;
        best = id;
      }
    }
    if (best < 0) return null;
    const v = windAtLevel(state, this.levels, this.z[best]);
    return { id: best, vmax: v, x: this.px[best], y: this.py[best], z: this.pz[best] };
  }

  // 统计信息(导出 JSON 用)
  stats(state, sliceEnabled, sliceZ, band) {
    const perRegion = [0, 0, 0];
    let windSum = 0;
    let windMax = 0;
    let pMin = Infinity;
    let pMax = -Infinity;
    for (let s = 0; s < this.visibleCount; s++) {
      const id = this.slotToId[s];
      perRegion[this.region[id]]++;
      const smp = this.sampleAt(id, state);
      windSum += smp.wind;
      if (smp.wind > windMax) windMax = smp.wind;
      if (smp.pressure < pMin) pMin = smp.pressure;
      if (smp.pressure > pMax) pMax = smp.pressure;
    }
    const names = ['eyewall', 'rainband', 'outer'];
    return {
      totalParticles: PARTICLE_COUNT,
      visibleParticles: this.visibleCount,
      byRegion: Object.fromEntries(names.map((nm, i) => [nm, perRegion[i]])),
      slice: sliceEnabled
        ? { enabled: true, centerAltitudeM: sliceZ, bandM: band }
        : { enabled: false },
      wind: {
        meanMs: Number((windSum / Math.max(1, this.visibleCount)).toFixed(2)),
        maxMs: Number(windMax.toFixed(2)),
      },
      pressure: {
        minHPa: Number(pMin.toFixed(1)),
        maxHPa: Number(pMax.toFixed(1)),
      },
      step: {
        index: state.i,
        time: state.time,
        center: state.center,
        centralPressureHPa: Number(state.centralPressure.toFixed(1)),
        rmwKm: Number(state.rmw.toFixed(1)),
      },
    };
  }
}

export { REGION };
