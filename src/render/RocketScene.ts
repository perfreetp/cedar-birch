import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  BlendFunction,
} from 'postprocessing';
import { createBlackbodyLUT, TEMP_MIN, TEMP_MAX } from './blackbody';
import { flameVertexShader, flameFragmentShader } from './shaders/flame';
import { smokeVertexShader, smokeFragmentShader } from './shaders/smoke';
import {
  skyVertexShader,
  skyFragmentShader,
  groundVertexShader,
  groundFragmentShader,
} from './shaders/environment';
import type { RendererSettings, SimState } from '../types';
import { MAX_FLAME_PARTICLES, MAX_SMOKE_PARTICLES, PARTICLE_TIERS } from '../types';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ParticleMaterial extends THREE.ShaderMaterial {
  uniforms: Record<string, THREE.IUniform>;
}

/** 构造带实例属性的四边形粒子几何 */
function buildParticleGeometry(maxCount: number, sizeMin: number, sizeMax: number, lifeMin: number, lifeMax: number) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ]), 3));

  const seeds = new Float32Array(maxCount * 4);
  const life = new Float32Array(maxCount);
  const size = new Float32Array(maxCount);
  const rnd = mulberry32(20261122);
  for (let i = 0; i < maxCount; i++) {
    seeds[i * 4 + 0] = rnd();
    seeds[i * 4 + 1] = rnd();
    seeds[i * 4 + 2] = rnd();
    seeds[i * 4 + 3] = rnd();
    life[i] = lifeMin + rnd() * (lifeMax - lifeMin);
    size[i] = sizeMin + rnd() * (sizeMax - sizeMin);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.setAttribute('aLife', new THREE.InstancedBufferAttribute(life, 1));
  geo.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
  geo.instanceCount = maxCount;
  return geo;
}

export class RocketScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: BloomEffect;
  private flameMat: ParticleMaterial;
  private smokeMat: ParticleMaterial;
  private flameMesh: THREE.Mesh;
  private smokeMesh: THREE.Mesh;
  private rocket = new THREE.Group();
  private pad: THREE.Group;
  private sky!: THREE.Mesh;
  private lut: THREE.Texture;
  private sim: SimState;
  private camTarget = new THREE.Vector3();
  private camPos = new THREE.Vector3(260, 70, 260);
  private lastCameraMode: string | null = null;
  private tierIndex = -1;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, sim: SimState) {
    this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true, // 同步截取 PNG 所需
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0f1a, 1);

    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 30000);
    this.camera.position.copy(this.camPos);

    // ---- 灯光 ----
    const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
    sun.position.set(800, 1200, 500);
    const fill = new THREE.DirectionalLight(0x9db4d6, 0.8);
    fill.position.set(-600, 300, -400);
    this.scene.add(sun, fill, new THREE.HemisphereLight(0x9db4d6, 0x3a3530, 1.3));

    // ---- 天空与地面 ----
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVertexShader,
      fragmentShader: skyFragmentShader,
      uniforms: { uSunDir: { value: new THREE.Vector3(0.55, 0.8, 0.35).normalize() } },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 20), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000; // 最先绘制，垫底
    this.scene.add(sky);
    this.sky = sky;

    const groundMat = new THREE.ShaderMaterial({
      vertexShader: groundVertexShader,
      fragmentShader: groundFragmentShader,
      uniforms: { uCamPos: { value: new THREE.Vector3() } },
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.pad = this.buildPad();
    this.scene.add(this.pad);
    this.buildRocket();

    // ---- 黑体 LUT 与粒子材质 ----
    this.lut = createBlackbodyLUT();
    this.flameMat = new THREE.ShaderMaterial({
      vertexShader: flameVertexShader,
      fragmentShader: flameFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uAxis: { value: new THREE.Vector3(0, -1, 0) },
        uSide1: { value: new THREE.Vector3(1, 0, 0) },
        uSide2: { value: new THREE.Vector3(0, 0, 1) },
        uActiveCount: { value: MAX_FLAME_PARTICLES },
        uThrottle: { value: 1 },
        uExhaustSpeed: { value: 280 },
        uSizeScale: { value: 1 },
        uLUT: { value: this.lut },
        uTempMin: { value: TEMP_MIN },
        uTempMax: { value: TEMP_MAX },
        uMachEnabled: { value: 1 },
        uMachFreq: { value: 1.15 },
        uIntensity: { value: 0.95 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }) as ParticleMaterial;

    this.smokeMat = new THREE.ShaderMaterial({
      vertexShader: smokeVertexShader,
      fragmentShader: smokeFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uAxis: { value: new THREE.Vector3(0, -1, 0) },
        uSide1: { value: new THREE.Vector3(1, 0, 0) },
        uSide2: { value: new THREE.Vector3(0, 0, 1) },
        uWind: { value: new THREE.Vector3(12, 0, 0) },
        uActiveCount: { value: MAX_SMOKE_PARTICLES },
        uGroundFade: { value: 1 },
        uSizeScale: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
    }) as ParticleMaterial;

    const flameGeo = buildParticleGeometry(MAX_FLAME_PARTICLES, 1.4, 2.8, 0.35, 0.9);
    const smokeGeo = buildParticleGeometry(MAX_SMOKE_PARTICLES, 5, 10, 4, 9);
    this.flameMesh = new THREE.Mesh(flameGeo, this.flameMat);
    this.smokeMesh = new THREE.Mesh(smokeGeo, this.smokeMat);
    this.flameMesh.frustumCulled = false;
    this.smokeMesh.frustumCulled = false;
    // 烟羽先画（普通透明混合），火焰后画（加性），避免火焰辉光穿透烟羽染色
    this.smokeMesh.renderOrder = 1;
    this.flameMesh.renderOrder = 2;
    this.scene.add(this.smokeMesh, this.flameMesh);

    // ---- 后处理：Bloom + ACES 色调映射 + 暗角 ----
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new BloomEffect({
      intensity: 0.9,
      luminanceThreshold: 0.85,
      luminanceSmoothing: 0.3,
      mipmapBlur: true,
      radius: 0.6,
    });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.35 });
    const fx = new EffectPass(this.camera, this.bloom, tone, vignette);
    this.composer.addPass(fx);
  }

  private buildRocket() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.45, metalness: 0.25 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.6, metalness: 0.4 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xb03030, roughness: 0.5 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 40, 24), white);
    body.position.y = 24;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(2.2, 8, 24), white);
    nose.position.y = 48;
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 1.7, 3, 24), dark);
    skirt.position.y = 2.5;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 1.6, 24), accent);
    band.position.y = 14;
    this.rocket.add(body, nose, skirt, band);
    this.scene.add(this.rocket);
  }

  private buildPad(): THREE.Group {
    const g = new THREE.Group();
    const concrete = new THREE.MeshStandardMaterial({ color: 0x777d86, roughness: 0.85, metalness: 0.05 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a525c, roughness: 0.5, metalness: 0.7 });
    // 扁平台面替代高圆柱，避免低机位仰视时出现黑色穹顶
    const base = new THREE.Mesh(new THREE.CylinderGeometry(26, 28, 2, 32), concrete);
    base.position.y = 1;
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 1.2, 24), steel);
    deck.position.y = 2.6;
    const tower = new THREE.Mesh(new THREE.BoxGeometry(2, 58, 2), steel);
    tower.position.set(9, 32, 0);
    g.add(base, deck, tower);
    return g;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
  }

  /** 按高度选择三档粒子数量，返回是否发生了切换 */
  private updateTier(altitude: number): boolean {
    let idx = 0;
    for (let i = 0; i < PARTICLE_TIERS.length; i++) {
      if (altitude >= PARTICLE_TIERS[i].minAltitude) idx = i;
    }
    if (idx === this.tierIndex) return false;
    this.tierIndex = idx;
    const tier = PARTICLE_TIERS[idx];
    this.flameMat.uniforms.uActiveCount.value = tier.flame;
    this.smokeMat.uniforms.uActiveCount.value = tier.smoke;
    return true;
  }

  get currentTierLabel(): string {
    return PARTICLE_TIERS[Math.max(0, this.tierIndex)].label;
  }

  private readonly _fwd = new THREE.Vector3();
  private readonly _nozzle = new THREE.Vector3();
  private readonly _axis = new THREE.Vector3();
  private readonly _s1 = new THREE.Vector3();
  private readonly _s2 = new THREE.Vector3();
  private readonly _q = new THREE.Quaternion();

  update(time: number, settings: RendererSettings) {
    if (this.disposed) return;
    const sim = this.sim;
    this.rocket.position.copy(sim.position);
    this.rocket.quaternion.copy(sim.quaternion);

    // 喷口世界坐标与喷流局部基
    this._fwd.set(0, 1, 0).applyQuaternion(sim.quaternion);
    this._q.copy(sim.quaternion);
    this._nozzle.copy(sim.position).addScaledVector(this._fwd, -24);
    this._axis.set(0, -1, 0).applyQuaternion(this._q);
    this._s1.set(1, 0, 0).applyQuaternion(this._q);
    this._s2.set(0, 0, 1).applyQuaternion(this._q);

    const alt = sim.altitude;
    this.updateTier(alt);

    // 高空低压：喷流膨胀、烟羽淡出
    const pressureExpand = 1 + THREE.MathUtils.clamp(alt / 12000, 0, 1) * 1.6;
    const groundFade = 1 - THREE.MathUtils.smoothstep(alt, 2000, 6500);
    const engineOn = sim.throttle > 0.02 ? 1 : 0;

    const fu = this.flameMat.uniforms;
    fu.uTime.value = time;
    fu.uOrigin.value.copy(this._nozzle);
    fu.uAxis.value.copy(this._axis);
    fu.uSide1.value.copy(this._s1);
    fu.uSide2.value.copy(this._s2);
    fu.uThrottle.value = sim.throttle;
    fu.uExhaustSpeed.value = 240 + 90 * sim.throttle;
    fu.uSizeScale.value = pressureExpand * (0.1 + 0.9 * Math.max(engineOn, sim.throttle));
    fu.uMachEnabled.value = settings.showMach ? 1 : 0;
    fu.uIntensity.value = 0.95 * (0.08 + 0.92 * Math.max(engineOn, sim.throttle));

    const su = this.smokeMat.uniforms;
    su.uTime.value = time;
    su.uOrigin.value.copy(this._nozzle);
    su.uAxis.value.copy(this._axis);
    su.uSide1.value.copy(this._s1);
    su.uSide2.value.copy(this._s2);
    su.uWind.value.set(settings.wind, 0, 0);
    su.uGroundFade.value = groundFade * (settings.showSmoke ? 1 : 0);
    su.uSizeScale.value = pressureExpand;
    this.smokeMesh.visible = settings.showSmoke;

    this.updateCamera(settings);
    // 天空穹顶跟随相机，避免球面边缘进入视野产生黑色地平线
    this.sky.position.copy(this.camera.position);
    const groundMat = this.scene.children.find((c) => c instanceof THREE.Mesh && (c as THREE.Mesh).geometry instanceof THREE.PlaneGeometry) as THREE.Mesh;
    (groundMat.material as THREE.ShaderMaterial).uniforms.uCamPos.value.copy(this.camera.position);

    this.bloom.blendMode.setBlendFunction(settings.bloom ? BlendFunction.SCREEN : BlendFunction.SKIP);
    this.composer.render();
  }

  private updateCamera(settings: RendererSettings) {
    const sim = this.sim;
    // 视角切换时立即重定位，避免从地面机位长距离 lerp
    if (this.lastCameraMode !== settings.cameraMode) {
      this.lastCameraMode = settings.cameraMode;
      if (settings.cameraMode === 'follow') {
        this._fwd.set(0, 1, 0).applyQuaternion(sim.quaternion);
        this.camPos.copy(sim.position).addScaledVector(this._fwd, -70).add(new THREE.Vector3(95, 42, 25));
        this.camPos.y = Math.max(this.camPos.y, 10);
        this.camTarget.copy(sim.position);
      } else {
        this.camPos.set(260, 70, 260);
        this.camTarget.copy(sim.position);
      }
    }
    if (settings.cameraMode === 'follow') {
      this._fwd.set(0, 1, 0).applyQuaternion(sim.quaternion);
      const desired = sim.position.clone()
        .addScaledVector(this._fwd, -70)
        .add(new THREE.Vector3(95, 42, 25));
      // 不允许相机穿入地面
      desired.y = Math.max(desired.y, 10);
      this.camPos.lerp(desired, 0.08);
      this.camera.position.copy(this.camPos);
      this.camTarget.lerp(sim.position.clone().addScaledVector(this._fwd, 20), 0.12);
      this.camera.lookAt(this.camTarget);
      this.camera.near = 1;
      this.camera.far = 30000;
    } else {
      // 地面固定机位：位置不动，朝向跟踪箭体
      this.camPos.set(260, 70, 260);
      this.camera.position.copy(this.camPos);
      this.camTarget.lerp(sim.position, 0.06);
      this.camera.lookAt(this.camTarget);
      this.camera.near = 1;
      this.camera.far = 30000;
    }
    this.camera.updateProjectionMatrix();
  }

  /** 同步截取当前画布 PNG */
  capturePNG(): string {
    this.composer.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  /** 按给定时间序列逐帧渲染并回调（弹道关键帧截图序列） */
  async captureSequence(times: number[], applyTime: (t: number) => void, settings: RendererSettings,
    onProgress?: (i: number, total: number) => void): Promise<Blob[]> {
    const blobs: Blob[] = [];
    for (let i = 0; i < times.length; i++) {
      applyTime(times[i]);
      this.update(times[i], settings);
      const blob: Blob | null = await new Promise((resolve) =>
        this.renderer.domElement.toBlob((b) => resolve(b), 'image/png'));
      if (blob) blobs.push(blob);
      onProgress?.(i + 1, times.length);
      // 让出主线程，避免长时间阻塞
      await new Promise((r) => setTimeout(r, 0));
    }
    return blobs;
  }

  dispose() {
    this.disposed = true;
    this.lut.dispose();
    this.flameMat.dispose();
    this.smokeMat.dispose();
    (this.flameMesh.geometry as THREE.BufferGeometry).dispose();
    (this.smokeMesh.geometry as THREE.BufferGeometry).dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
