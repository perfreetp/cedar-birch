// 交互: 粒子射线拾取、框选放大(保留切面状态)、视图恢复
import * as THREE from 'three';

export class Interactions {
  constructor(camera, renderer, controls, field, onPick) {
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.field = field; // 数据加载前可为 null
    this.onPick = onPick;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();

    this._down = null;
    this._boxEl = null;
    this.marqueeMode = false; // 由 UI 切换
    this._savedViews = [];

    this._bind();
  }

  _bind() {
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => this._onDown(e));
    dom.addEventListener('pointermove', (e) => this._onMove(e));
    window.addEventListener('pointerup', (e) => this._onUp(e));
  }

  _setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _onDown(e) {
    if (e.button !== 0) return;
    this._down = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (this.marqueeMode) {
      this.controls.enabled = false;
      this._ensureBoxEl();
      const rect = this.renderer.domElement.getBoundingClientRect();
      this._boxEl.style.display = 'block';
      this._boxRect = { left: e.clientX - rect.left, top: e.clientY - rect.top };
      this._boxEl.style.left = `${this._boxRect.left}px`;
      this._boxEl.style.top = `${this._boxRect.top}px`;
      this._boxEl.style.width = '0px';
      this._boxEl.style.height = '0px';
    }
  }

  _onMove(e) {
    if (this.marqueeMode && this._down) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const left = Math.min(x, this._boxRect.left);
      const top = Math.min(y, this._boxRect.top);
      this._boxEl.style.left = `${left}px`;
      this._boxEl.style.top = `${top}px`;
      this._boxEl.style.width = `${Math.abs(x - this._boxRect.left)}px`;
      this._boxEl.style.height = `${Math.abs(y - this._boxRect.top)}px`;
    }
  }

  async _onUp(e) {
    if (!this._down) return;
    const d = this._down;
    this._down = null;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);

    if (this.marqueeMode) {
      this.controls.enabled = true;
      if (this._boxEl) this._boxEl.style.display = 'none';
      if (moved > 8) this._zoomToMarquee(d, { x: e.clientX, y: e.clientY });
      this.marqueeMode = false;
      document.body.classList.remove('marquee-cursor');
      return;
    }
    // 普通点击(位移很小视为拾取)
    if (moved < 6 && performance.now() - d.t < 500) {
      this._pick(e);
    }
  }

  _ensureBoxEl() {
    if (this._boxEl) return;
    const el = document.createElement('div');
    el.className = 'marquee-box';
    el.style.display = 'none';
    this.renderer.domElement.parentElement.appendChild(el);
    this._boxEl = el;
  }

  _zoomToMarquee(p0, p1) {
    if (!this.field) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx0 = ((p0.x - rect.left) / rect.width) * 2 - 1;
    const ny0 = -((p0.y - rect.top) / rect.height) * 2 + 1;
    const nx1 = ((p1.x - rect.left) / rect.width) * 2 - 1;
    const ny1 = -((p1.y - rect.top) / rect.height) * 2 + 1;

    // 保存当前视角, 供"恢复视图"
    this._savedViews.push({
      pos: this.camera.position.clone(),
      target: this.controls.target.clone(),
      fov: this.camera.fov,
    });

    // 反投影屏幕矩形的四角到射线, 求可见粒子在该锥内的包围球
    const corners = [
      [Math.min(nx0, nx1), Math.min(ny0, ny1)],
      [Math.max(nx0, nx1), Math.min(ny0, ny1)],
      [Math.max(nx0, nx1), Math.max(ny0, ny1)],
      [Math.min(nx0, nx1), Math.max(ny0, ny1)],
    ];
    const inside = new THREE.Vector3();
    const center = new THREE.Vector3();
    let count = 0;
    const f = this.field;
    for (let s = 0; s < f.visibleCount; s++) {
      const id = f.slotToId[s];
      inside.set(f.px[id], f.py[id], f.pz[id]);
      const ndc = inside.clone().project(this.camera);
      if (
        ndc.z < 1 &&
        ndc.x >= Math.min(nx0, nx1) &&
        ndc.x <= Math.max(nx0, nx1) &&
        ndc.y >= Math.min(ny0, ny1) &&
        ndc.y <= Math.max(ny0, ny1)
      ) {
        center.add(inside);
        count++;
      }
    }
    if (count < 2) return;
    center.multiplyScalar(1 / count);

    // 包围球半径
    let radius = 1;
    for (let s = 0; s < f.visibleCount; s++) {
      const id = f.slotToId[s];
      inside.set(f.px[id], f.py[id], f.pz[id]);
      const ndc = inside.clone().project(this.camera);
      if (
        ndc.z < 1 &&
        ndc.x >= Math.min(nx0, nx1) &&
        ndc.x <= Math.max(nx0, nx1) &&
        ndc.y >= Math.min(ny0, ny1) &&
        ndc.y <= Math.max(ny0, ny1)
      ) {
        radius = Math.max(radius, inside.distanceTo(center));
      }
    }

    // 调整 fov 与位置, 使包围球充满框选区域(切面状态不动)
    const dist = radius / Math.tan((this.camera.fov * Math.PI) / 360);
    const dir = new THREE.Vector3()
      .subVectors(this.camera.position, this.controls.target)
      .normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, dist * 1.15);
    this.camera.near = Math.max(0.1, dist * 0.05);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    void corners;
  }

  restoreView() {
    const v = this._savedViews.pop();
    if (!v) return false;
    this.camera.position.copy(v.pos);
    this.controls.target.copy(v.target);
    this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    return true;
  }

  _pick(e) {
    if (!this.field) return;
    this._setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // InstancedMesh 射线检测
    const hits = this.raycaster.intersectObject(this.field.mesh, false);
    if (hits.length > 0 && hits[0].instanceId !== undefined) {
      const id = this.field.idAtInstance(hits[0].instanceId);
      if (id >= 0) this.onPick?.(id, hits[0].point);
    } else {
      this.onPick?.(-1, null);
    }
  }
}
