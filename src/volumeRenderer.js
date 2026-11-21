// 体积渲染器：多层切片实例化 + 视线主轴选择 + 前后向（front-to-back）alpha 合成
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Terrain } from './terrain.js';

const BG_COLOR = 0x07090c;
const TARGET_FPS = 55;

const VERT = /* glsl */ `
  // 注：uv 为 Three.js 内置 attribute（几何体含 uv 时自动声明），此处不可重复声明
  attribute vec4 iTile;            // x,y: 瓦片列行；z,w: 图集列数行数
  varying vec2 vTileUv;
  varying vec3 vWorldPos;
  void main() {
    vec2 tileSize = vec2(1.0 / iTile.z, 1.0 / iTile.w);
    vTileUv = (vec2(iTile.x, iTile.y) + uv) * tileSize;
    vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uTextureA;
  uniform sampler2D uTextureB;
  uniform sampler2D uTerrainHeight;
  uniform float uInterp;
  uniform float uAlphaScale;
  uniform float uTerrainMinY;
  uniform float uInvTerrainRangeY;
  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  varying vec2 vTileUv;
  varying vec3 vWorldPos;

  void main() {
    vec4 sa = texture2D(uTextureA, vTileUv);
    vec4 sb = texture2D(uTextureB, vTileUv);
    vec4 samp = mix(sa, sb, uInterp);
    if (samp.a <= 0.002) discard;

    // 地形相交裁剪：体素位于地形高度以下则剔除
    vec2 xzn = clamp(
      (vWorldPos.xz - uBoxMin.xz) / (uBoxMax.xz - uBoxMin.xz),
      vec2(0.0), vec2(1.0)
    );
    // 高度纹理为 DataTexture（flipY=false）：数据 row 0（z 最小）即纹理 v=0，
    // 而 xzn.y 在 z 最小时也为 0，故直接采样即可正确对应
    float terrainY = uTerrainMinY + texture2D(uTerrainHeight, xzn).r / uInvTerrainRangeY;
    if (vWorldPos.y < terrainY) discard;

    float a = clamp(samp.a * uAlphaScale, 0.0, 1.0);
    // 预乘 alpha：配合 FTB 混合因子实现标准 over 算子
    gl_FragColor = vec4(samp.rgb * a, a);
  }
`;

// 各切片轴的平面几何参数：面内 u/v 轴（与 worker PLANE_AXES 对应）
const PLANE_DEF = [
  { axis: 0, u: 2, v: 1 },
  { axis: 1, u: 0, v: 2 },
  { axis: 2, u: 0, v: 1 },
];

export class VolumeRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,   // 保证 PNG 导出可直接取画布
      powerPreference: 'high-performance',
    });
    // FTB（front-to-back）合成要求目标帧缓冲初始 alpha=0，否则 (1-dstAlpha) 恒为 0、切片全被吞掉
    this.renderer.setClearColor(BG_COLOR, 0);
    this.maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 1, 200000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.scene.add(new THREE.HemisphereLight(0xbfd4ea, 0x3a2e22, 1.1));
    const sun = new THREE.DirectionalLight(0xffe6c2, 1.6);
    sun.position.set(-8000, 12000, 6000);
    this.scene.add(sun);

    // 不透明深色背景球（内表面）：提供 FTB 合成所需的深色底色。
    // 关键：颜色正常写入，但 alpha 输出 0，使切片的 (1-dst.alpha) 累积从 0 开始；
    // 渲染结束后未被切片覆盖的区域由 CSS 画布底色兜底（导出时另行合成背景）。
    this.bgSphere = new THREE.Mesh(
      new THREE.SphereGeometry(90000, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 c; void main(){ gl_FragColor = vec4(c, 0.0); }`,
        uniforms: { c: { value: new THREE.Color(BG_COLOR) } },
        side: THREE.BackSide,
        depthWrite: false,
      })
    );
    this.bgSphere.renderOrder = -1000;
    this.scene.add(this.bgSphere);

    // 包围盒辅助线
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x3d4a5a, transparent: true, opacity: 0.7 });
    this.boxHelper = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), edgeMat);
    this.scene.add(this.boxHelper);

    this.volumeRoot = new THREE.Group();
    this.scene.add(this.volumeRoot);

    this.dataset = null;
    this.bounds = null;
    this.terrain = null;
    this.sliceMeshes = [];
    this.currentAxis = -1;
    this._orderKey = '';
    this.textureA = null;
    this.textureB = null;
    this.bakeGrid = null;
    this.sliceCount = 64;
    this.interp = 0;
    this.markers = [];
    this.markerGroup = new THREE.Group();
    this.scene.add(this.markerGroup);

    this.resolutionScale = 1;
    this._fpsEMA = 60;
    this._adaptTick = 0;
    this._interactingUntil = 0;
    this.controls.addEventListener('start', () => { this._interactingUntil = performance.now() + 1200; });

    this._raycaster = new THREE.Raycaster();
    this._boundResize = () => this.resize();
    window.addEventListener('resize', this._boundResize);
    this.resize();
  }

  loadDataset(dataset) {
    this.dataset = dataset;
    const { header } = dataset;
    const size = new THREE.Vector3(
      header.nx * header.voxel[0],
      header.ny * header.voxel[1],
      header.nz * header.voxel[2]
    );
    const min = new THREE.Vector3(...header.origin);
    const max = min.clone().add(size);
    this.bounds = new THREE.Box3(min, max);
    this.voxel = header.voxel.slice();

    if (this.terrain) {
      this.scene.remove(this.terrain.group);
      this.terrain.dispose();
    }
    // 释放上一份数据集的切片纹理
    this.textureA?.dispose();
    this.textureB?.dispose();
    this.textureA = this.textureB = null;
    this.bakeGrid = null;
    this.terrain = new Terrain(this.bounds, 128);
    this.scene.add(this.terrain.group);

    this.boxHelper.geometry.dispose();
    this.boxHelper.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    this.boxHelper.position.copy(min).addScaledVector(size, 0.5);

    // 相机：低斜角（接近水平侧视），充分展现扁平体域内云团的垂直厚度
    const center = min.clone().addScaledVector(size, 0.5);
    const radius = size.length() * 0.62;
    this.camera.position.set(
      center.x + radius * 1.05,
      center.y + size.y * 0.62,
      center.z + radius * 0.95
    );
    this.camera.near = 1;
    this.camera.far = radius * 8;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = size.length() * 0.12;
    this.controls.maxDistance = size.length() * 2.2;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.update();

    // 切片材质只创建一次；数据集切换时仅更新其 uniform，避免材质泄漏
    if (!this.sliceMaterial) this._buildSliceMaterials();
    this._updateTerrainUniforms();
    this._buildSliceMeshes();
    this.chooseAxis(true);
  }

  _updateTerrainUniforms() {
    const u = this.sliceMaterial.uniforms;
    u.uTerrainHeight.value = this.terrain.heightTexture;
    u.uTerrainMinY.value = this.terrain.heightRange.minY;
    u.uInvTerrainRangeY.value = this.terrain.heightRange.invRangeY;
    u.uBoxMin.value = this.bounds.min;
    u.uBoxMax.value = this.bounds.max;
  }

  _buildSliceMaterials() {
    this.sliceMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTextureA: { value: null },
        uTextureB: { value: null },
        uInterp: { value: 0 },
        uAlphaScale: { value: 0.5 },
        uTerrainHeight: { value: this.terrain.heightTexture },
        uTerrainMinY: { value: this.terrain.heightRange.minY },
        uInvTerrainRangeY: { value: this.terrain.heightRange.invRangeY },
        uBoxMin: { value: this.bounds.min },
        uBoxMax: { value: this.bounds.max },
      },
      // front-to-back 标准 over 算子（源颜色已在 shader 中预乘 alpha）：
      //   rgb:  dst + src * (1 - dst.a)   因子 (ONE, ONE_MINUS_DST_ALPHA)
      //   alpha: dst.a + src.a * (1 - dst.a)
      // 清屏 alpha=0，切片由前到后逐层累积；高浓度区快速趋近不透明，不发灰雾。
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusDstAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusDstAlphaFactor,
    });
  }

  _planeGeometry(axisDef) {
    const { axis, u, v } = axisDef;
    const d = [this.dataset.header.nx, this.dataset.header.ny, this.dataset.header.nz];
    const half = [
      d[0] * this.voxel[0] / 2,
      d[1] * this.voxel[1] / 2,
      d[2] * this.voxel[2] / 2,
    ];
    const positions = [];
    const uvs = [];
    const idx = [];
    const corner = (fu, fv) => {
      const p = [0, 0, 0];
      p[u] = (fu - 0.5) * 2 * half[u];
      p[v] = (fv - 0.5) * 2 * half[v];
      positions.push(p[0], p[1], p[2]);
      uvs.push(fu, fv);
    };
    corner(0, 0); corner(1, 0); corner(1, 1); corner(0, 1);
    idx.push(0, 1, 2, 0, 2, 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.bounds.min.distanceTo(this.bounds.max));
    return geo;
  }

  _buildSliceMeshes() {
    for (const m of this.sliceMeshes) {
      this.volumeRoot.remove(m);
      m.geometry.dispose();
      m.dispose();
    }
    this.sliceMeshes = PLANE_DEF.map((def) => {
      const mesh = new THREE.InstancedMesh(this._planeGeometry(def), this.sliceMaterial, this.sliceCount);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(this.sliceCount * 4), 4);
      tileAttr.setUsage(THREE.DynamicDrawUsage);
      mesh.geometry.setAttribute('iTile', tileAttr);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.volumeRoot.add(mesh);
      return mesh;
    });
    this.currentAxis = -1;
  }

  setSliceCount(count) {
    if (count === this.sliceCount && this.sliceMeshes.length) return;
    this.sliceCount = count;
    this._buildSliceMeshes();
  }

  // 依据视线方向选择切片主轴（平面法线与视线夹角最小者）
  chooseAxis(force = false) {
    if (!this.bounds) return -1;
    // 复用临时向量，避免每帧分配造成 GC 抖动
    this._viewDir ??= new THREE.Vector3();
    this._viewDir.copy(this.controls.target).sub(this.camera.position).normalize();
    const vx = Math.abs(this._viewDir.x);
    const vy = Math.abs(this._viewDir.y);
    const vz = Math.abs(this._viewDir.z);
    const best = vx >= vy && vx >= vz ? 0 : vy >= vz ? 1 : 2;
    if (force || best !== this.currentAxis) {
      this.currentAxis = best;
      this.sliceMeshes.forEach((m, i) => { m.visible = i === best; });
      this.updateInstanceOrder();
    }
    return best;
  }

  // 按相机所在一侧，从近到远排列实例（front-to-back 混合要求严格顺序）
  updateInstanceOrder() {
    if (!this.bakeGrid || this.currentAxis < 0) return;
    const mesh = this.sliceMeshes[this.currentAxis];
    const def = PLANE_DEF[this.currentAxis];
    const d = [this.dataset.header.nx, this.dataset.header.ny, this.dataset.header.nz];
    const center = new THREE.Vector3();
    this.bounds.getCenter(center);
    const rel = this.camera.position.clone().sub(center);
    const cameraOnPositiveSide = rel.getComponent(def.axis) >= 0;

    // 轴、层数、图集网格、相机侧别都不变时顺序保持不变，旋转/缩放零重建开销
    const key = `${this.currentAxis}|${this.sliceCount}|${this.bakeGrid.cols}x${this.bakeGrid.rows}|${cameraOnPositiveSide ? 1 : 0}`;
    if (key === this._orderKey) return;
    this._orderKey = key;

    const { cols, rows } = this.bakeGrid;
    const m = new THREE.Matrix4();
    const offset = new THREE.Vector3();
    const span = d[def.axis] * this.voxel[def.axis];
    const tile = mesh.geometry.getAttribute('iTile');
    for (let k = 0; k < this.sliceCount; k++) {
      // 相机在正侧时，最近的是最高坐标切片
      const slice = cameraOnPositiveSide ? this.sliceCount - 1 - k : k;
      const along = (slice + 0.5) / this.sliceCount * span - span / 2;
      offset.set(0, 0, 0).setComponent(def.axis, along);
      m.makeTranslation(center.x + offset.x, center.y + offset.y, center.z + offset.z);
      mesh.setMatrixAt(k, m);
      tile.setXYZW(k, slice % cols, Math.floor(slice / cols), cols, rows);
    }
    mesh.instanceMatrix.needsUpdate = true;
    tile.needsUpdate = true;
  }

  // worker 烘焙完成后挂载新纹理（在下一帧生效）
  setBakedTextures(bitmapA, bitmapB, grid) {
    const mk = (bitmap) => {
      const tex = new THREE.Texture(bitmap);
      tex.flipY = false;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.anisotropy = Math.min(8, this.maxAniso);
      tex.needsUpdate = true;
      return tex;
    };
    this.textureA?.dispose();
    this.textureB?.dispose();
    this.textureA = mk(bitmapA);
    this.textureB = mk(bitmapB);
    this.bakeGrid = grid;
    this.sliceMaterial.uniforms.uTextureA.value = this.textureA;
    this.sliceMaterial.uniforms.uTextureB.value = this.textureB;
    // 单层不透明度随层数反比缩放：层数越多每层越透明，总累积浓度感保持稳定
    // FTB 合成下该值保证核心区能充分累积到不透明，外围仍有通透感
    this.sliceMaterial.uniforms.uAlphaScale.value = THREE.MathUtils.clamp(46 / this.sliceCount, 0.32, 1.0);
    this.updateInstanceOrder();
  }

  setInterp(t) {
    this.interp = t;
    if (this.sliceMaterial) this.sliceMaterial.uniforms.uInterp.value = t;
  }

  // ---------- 拾取 ----------
  async pick(nx, ny, baker, frameA, frameB) {
    this.controls.update();
    this._raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const ray = this._raycaster.ray;

    // slab 法求射线与 AABB 的进/出两个交点（相机可能在盒内，故 t 允许为负）
    const { min, max } = this.bounds;
    const o = ray.origin, d = ray.direction;
    let t0 = -Infinity, t1 = Infinity;
    for (const ax of ['x', 'y', 'z']) {
      if (Math.abs(d[ax]) < 1e-9) {
        if (o[ax] < min[ax] || o[ax] > max[ax]) {
          return { ok: false, reason: '点击位置不在浓度场包围盒内' };
        }
        continue;
      }
      let ta = (min[ax] - o[ax]) / d[ax];
      let tb = (max[ax] - o[ax]) / d[ax];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (t1 < Math.max(0, t0)) return { ok: false, reason: '点击位置不在浓度场包围盒内' };
    const enter = o.clone().addScaledVector(d, Math.max(0, t0));
    const exit = o.clone().addScaledVector(d, t1);

    // 地形 BVH 求交：若地形在体数据之前挡住射线，则该点不可采样
    // MeshBVH.raycastFirst(ray, materialOrSide, near, far) -> Intersection|null
    const terrainHit = this.terrain.bvh.raycastFirst(
      ray, THREE.DoubleSide, this.camera.near, this.camera.far
    );
    const tTerrain = terrainHit ? terrainHit.distance : Infinity;
    const tEnter = Math.max(0, t0);
    if (tTerrain < tEnter) return { ok: false, reason: '该位置被地形遮挡，地形以下不显示' };
    const totalDist = enter.distanceTo(exit);
    const stepLen = Math.min(...this.voxel) * 0.85;
    const steps = Math.min(420, Math.max(8, Math.floor(totalDist / stepLen)));
    const h = this.dataset.header;
    const pts = [];
    const worldPts = [];
    for (let i = 0; i <= steps; i++) {
      const p = enter.clone().lerp(exit, i / steps);
      worldPts.push(p);
      pts.push(
        (p.x - h.origin[0]) / h.voxel[0],
        (p.y - h.origin[1]) / h.voxel[1],
        (p.z - h.origin[2]) / h.voxel[2]
      );
    }
    const values = await baker.sample(frameA, frameB, this.interp, new Float32Array(pts));

    // 优先返回射线上第一个超过当前阈值的点，否则取浓度最大点
    let chosen = 0, maxV = -1;
    for (let i = 0; i < values.length; i++) {
      if (values[i] > maxV) { maxV = values[i]; chosen = i; }
    }
    if (maxV <= 0) {
      return { ok: false, reason: '射线穿过区域内无有效浓度（可能低于当前阈值或为空白区）' };
    }
    const point = worldPts[chosen];
    return {
      ok: true,
      point,
      normalized: values[chosen],
      voxel: {
        x: Math.floor(pts[chosen * 3]),
        y: Math.floor(pts[chosen * 3 + 1]),
        z: Math.floor(pts[chosen * 3 + 2]),
      },
      maxAlongRay: maxV,
    };
  }

  addMarker(point, text) {
    this.clearMarkers();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(Math.min(...this.voxel) * 0.9, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xffe08a })
    );
    sphere.position.copy(point);
    this.markerGroup.add(sphere);

    const label = this._makeSprite(text);
    label.position.copy(point).add(new THREE.Vector3(0, this.voxel[1] * 2.2, 0));
    this.markerGroup.add(label);
    this.markers.push(sphere, label);
  }

  _makeSprite(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 72;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(13,17,23,0.85)';
    ctx.strokeStyle = '#e0995e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(2, 2, 252, 68, 12);
    else ctx.rect(2, 2, 252, 68);
    ctx.fill(); ctx.stroke();
    ctx.font = 'bold 30px "Segoe UI", sans-serif';
    ctx.fillStyle = '#f2c14e';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const scale = this.bounds.min.distanceTo(this.bounds.max) * 0.055;
    sprite.scale.set(scale * 3.5, scale, 1);
    sprite.renderOrder = 999;
    return sprite;
  }

  clearMarkers() {
    for (const obj of this.markers) {
      this.markerGroup.remove(obj);
      obj.geometry?.dispose?.();
      if (obj.material) {
        obj.material.map?.dispose?.();
        obj.material.dispose();
      }
    }
    this.markers = [];
  }

  // ---------- 自适应分辨率（保 55fps） ----------
  resize() {
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth;
    const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight;
    this.renderer.setPixelRatio(this.dpr * this.resolutionScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _adaptResolution(dtMs) {
    const fps = 1000 / Math.max(1, dtMs);
    this._fpsEMA = this._fpsEMA * 0.92 + fps * 0.08;
    this._adaptTick++;
    if (performance.now() < this._interactingUntil) return;

    if (this._fpsEMA < TARGET_FPS - 5 && this.resolutionScale > 0.6 && this._adaptTick % 45 === 0) {
      this.resolutionScale = Math.max(0.6, this.resolutionScale - 0.12);
      this.resize();
    } else if (this._fpsEMA > TARGET_FPS + 4 && this.resolutionScale < 1 && this._adaptTick % 240 === 0) {
      this.resolutionScale = Math.min(1, this.resolutionScale + 0.1);
      this.resize();
    }
  }

  get fps() { return this._fpsEMA; }

  renderFrame(dtMs) {
    this.controls.update();
    this.chooseAxis();
    this.updateInstanceOrder();
    this.renderer.render(this.scene, this.camera);
    this._adaptResolution(dtMs);
  }

  exportPNG() {
    this.renderer.render(this.scene, this.camera);
    // WebGL 画布为透明（FTB 需要清屏 alpha=0），导出时在 2D 画布先铺深色背景再合成，
    // 保证 PNG 不透明且与界面观感一致
    const w = this.canvas.width, h = this.canvas.height;
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#07090c';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.canvas, 0, 0, w, h);
    return out.toDataURL('image/png');
  }

  dispose() {
    window.removeEventListener('resize', this._boundResize);
    this.clearMarkers();
    this.terrain?.dispose();
    this.textureA?.dispose();
    this.textureB?.dispose();
    this.sliceMaterial?.dispose();
    for (const m of this.sliceMeshes) m.geometry.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
