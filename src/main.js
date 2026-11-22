// 主编排: 四大区域联动 + 动画循环
import * as THREE from 'three';
import { PARTICLE_COUNT, DEFAULT_BAND, DATA_SCHEMA } from './core/constants.js';
import { generateSampleData } from './core/sample-data.js';
import { createScene } from './core/scene.js';
import { ParticleField } from './core/particle-field.js';
import {
  interpolateState,
  buildRotationTable,
  rotationAt,
} from './core/typhoon.js';
import { EyewallAnnotation } from './core/annotation.js';
import { Interactions } from './core/interactions.js';
import { exportPNG, exportStatsJSON } from './core/exporter.js';
import { fmt } from './core/util.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.data = null;
    this.field = null;
    this.rotationTable = null;
    this.frameF = 0; // 连续时间位置(0..23)
    this.playing = false;
    this.loop = true;
    this.speed = 1;
    this.sliceEnabled = true;
    this.sliceZ = 3000;
    this.band = DEFAULT_BAND;
    this._lastSec = performance.now();
    this._frames = 0;
    this._fps = 0;
    this._dirtyDensity = true;

    const viewport = $('viewport');
    this.viewport = viewport;
    this.three = createScene(viewport);
    this.annotation = new EyewallAnnotation(this.three.scene);

    this.interactions = new Interactions(
      this.three.camera,
      this.three.renderer,
      this.three.controls,
      null,
      (id, point) => this._onPick(id, point)
    );

    this._bindUI();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  // ---------- 数据 ----------
  async loadData(data, sourceLabel) {
    const err = validate(data);
    if (err) {
      alert(`数据校验失败: ${err}`);
      return;
    }
    this.data = data;
    if (this.field) {
      this.three.scene.remove(this.field.mesh);
      this.field.mesh.geometry.dispose();
      this.field.mesh.material.dispose();
    }
    this.field = new ParticleField(data);
    this.three.scene.add(this.field.mesh);
    this.rotationTable = buildRotationTable(data, data.levels);
    this.interactions.field = this.field;

    // 滑块范围按数据高度层对齐
    const zMin = data.levels[0];
    const zMax = data.levels[data.levels.length - 1];
    const sl = $('sliceZ');
    sl.min = zMin;
    sl.max = zMax;
    this.sliceZ = Math.round((zMin + zMax) / 2);
    sl.value = this.sliceZ;
    $('sliceZOut').textContent = `${this.sliceZ.toLocaleString()} m`;

    // 时间轴 24 时刻
    const n = data.steps.length;
    $('timeSlider').max = n - 1;
    this.frameF = 0;
    $('timeSlider').value = 0;
    $('timeSlider').disabled = false;
    $('playBtn').disabled = false;
    $('exportPngBtn').disabled = false;
    $('exportJsonBtn').disabled = false;
    $('datasetMeta').textContent = `${sourceLabel} · ${n} 时刻 · ${data.levels.length} 高度层`;

    this._dirtyDensity = true;
    this._updateField(true);
    this._renderTicks(n);
    this._updateHUD();
  }

  // ---------- UI 事件 ----------
  _bindUI() {
    $('loadSampleBtn').addEventListener('click', () => {
      this.loadData(generateSampleData(), '示例台风 TY-DEMO');
    });

    $('fileInput').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        await this.loadData(json, file.name);
      } catch (err) {
        alert(`文件解析失败: ${err.message}`);
      }
      e.target.value = '';
    });

    $('sliceEnable').addEventListener('change', (e) => {
      this.sliceEnabled = e.target.checked;
      this._dirtyDensity = true;
    });
    $('sliceZ').addEventListener('input', (e) => {
      this.sliceZ = Number(e.target.value);
      $('sliceZOut').textContent = `${this.sliceZ.toLocaleString()} m`;
      this._dirtyDensity = true;
    });
    $('band').addEventListener('input', (e) => {
      this.band = Number(e.target.value);
      $('bandOut').textContent = `${this.band.toLocaleString()} m`;
      this._dirtyDensity = true;
    });

    // 时间轴
    $('playBtn').addEventListener('click', () => this._togglePlay());
    $('timeSlider').addEventListener('input', (e) => {
      this.frameF = Number(e.target.value);
      this.playing = false;
      $('playBtn').textContent = '▶ 播放';
      this._dirtyDensity = true;
    });
    $('speedSel').addEventListener('change', (e) => {
      this.speed = Number(e.target.value);
    });
    $('loopBtn').addEventListener('click', () => {
      this.loop = !this.loop;
      $('loopBtn').textContent = `循环: ${this.loop ? '开' : '关'}`;
    });

    // 框选
    $('marqueeBtn').addEventListener('click', () => {
      this.interactions.marqueeMode = true;
      document.body.classList.add('marquee-cursor');
      $('marqueeBtn').classList.add('active');
      setTimeout(() => $('marqueeBtn').classList.remove('active'), 1600);
    });
    $('restoreBtn').addEventListener('click', () => {
      if (!this.interactions.restoreView()) alert('没有可恢复的视角');
    });
    $('resetCamBtn').addEventListener('click', () => this._resetCamera());

    // 导出
    $('exportPngBtn').addEventListener('click', () => {
      this._lastPNG = exportPNG(this.three.composer, this.three.renderer);
    });
    $('exportJsonBtn').addEventListener('click', () => {
      const state = this._currentState();
      this._lastJSON = exportStatsJSON({
        meta: {
          ...this.data.meta,
          exportedAt: new Date().toISOString(),
          engine: 'three.js + postprocessing InstancedMesh',
        },
        particleStats: this.field.stats(state, this.sliceEnabled, this.sliceZ, this.band),
        colorStops: ['#8b0f1c', '#e0532f', '#f0b14e', '#8fd6d6', '#bfe3f5'],
        camera: {
          position: this.three.camera.position.toArray().map((v) => Number(v.toFixed(2))),
          target: this.three.controls.target.toArray().map((v) => Number(v.toFixed(2))),
          fov: this.three.camera.fov,
        },
      });
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        this._togglePlay();
      }
    });
  }

  _renderTicks(n) {
    const wrap = $('tlTicks');
    wrap.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const tick = document.createElement('i');
      tick.title = `T${String(i).padStart(2, '0')}`;
      wrap.appendChild(tick);
    }
  }

  _togglePlay() {
    if (!this.data) return;
    this.playing = !this.playing;
    $('playBtn').textContent = this.playing ? '⏸ 暂停' : '▶ 播放';
  }

  _resetCamera() {
    const c = this.three.camera;
    c.position.set(260, 300, 260);
    c.fov = 50;
    c.near = 0.5;
    c.far = 4000;
    c.updateProjectionMatrix();
    this.three.controls.target.set(0, 12, 0);
    this.three.controls.update();
  }

  _currentState() {
    return interpolateState(this.data, this.frameF);
  }

  // ---------- 每帧数据更新 ----------
  _updateField(forceDensity) {
    if (!this.field) return;
    const state = this._currentState();
    const I = rotationAt(this.rotationTable, this.frameF);
    this.field.updatePositions(state, I);
    if (this._dirtyDensity || forceDensity) {
      this.field.applySlice(this.sliceEnabled, this.sliceZ, this.band);
      this._dirtyDensity = false;
    }
    const { sorted } = this.field.renderFrame(this.three.camera, state);
    this._sortedN = sorted;

    // troika 标注: 眼壁最大风速位置
    const loc = this.field.locateEyewallMax(state);
    this.annotation.update(loc, state);
    this.annotation.faceCamera(this.three.camera);
    this._lastState = state;
  }

  _updateHUD() {
    if (!this._lastState) return;
    const s = this._lastState;
    $('hudStep').textContent = `时刻 ${s.time} (${s.i + 1}/${this.data.steps.length})`;
    $('hudWind').textContent = `Vmax ${fmt(s.maxSustainedWind)} m/s`;
    $('hudPressure').textContent = `中心气压 ${fmt(s.centralPressure)} hPa`;
    $('tlTime').textContent = s.time;
    $('tlName').textContent = s.i !== undefined ? `T${String(Math.round(this.frameF)).padStart(2, '0')}` : '';
    $('visibleCount').textContent = this.field.visibleCount.toLocaleString();
    $('visiblePct').textContent = `${((this.field.visibleCount / PARTICLE_COUNT) * 100).toFixed(1)}%`;
    $('sortN').textContent = this._sortedN?.toLocaleString() ?? '0';
  }

  _onPick(id) {
    const box = $('pickInfo');
    const tip = $('tooltip');
    if (id < 0) {
      tip.hidden = true;
      box.innerHTML = '<p class="empty">在视图中点击任意粒子查看该点风速与气压</p>';
      return;
    }
    const state = this._currentState();
    const smp = this.field.sampleAt(id, state);
    const regionName = ['眼壁', '螺旋雨带', '外围环流'][smp.region];
    box.innerHTML = `
      <div class="pick-grid">
        <div class="kv full"><span>所属结构</span><b>${regionName}</b></div>
        <div class="kv"><span>风速</span><b>${fmt(smp.wind)} m/s</b></div>
        <div class="kv"><span>气压</span><b>${fmt(smp.pressure)} hPa</b></div>
        <div class="kv"><span>高度</span><b>${fmt(smp.altitude, 0)} m</b></div>
        <div class="kv"><span>距中心</span><b>${fmt(smp.r)} km</b></div>
      </div>`;
    tip.innerHTML = `<b>${regionName}</b><br>风速 ${fmt(smp.wind)} m/s<br>气压 ${fmt(smp.pressure)} hPa`;
    const rect = this.viewport.getBoundingClientRect();
    const proj = new THREE.Vector3(smp.x, smp.y, smp.z).project(this.three.camera);
    const x = (proj.x * 0.5 + 0.5) * rect.width;
    const y = (-proj.y * 0.5 + 0.5) * rect.height;
    tip.style.left = `${Math.min(rect.width - 250, x + 14)}px`;
    tip.style.top = `${Math.max(8, y - 10)}px`;
    tip.hidden = false;
  }

  // ---------- 主循环 ----------
  _loop(now) {
    requestAnimationFrame(this._loop);
    const dt = Math.min(0.1, (now - (this._lastNow || now)) / 1000);
    this._lastNow = now;

    if (this.data && this.playing) {
      const n = this.data.steps.length;
      // 1x 速度: 24 时刻约 12 秒走完一圈
      this.frameF += dt * this.speed * 2;
      if (this.frameF >= n - 1) {
        if (this.loop) this.frameF = 0;
        else {
          this.frameF = n - 1;
          this.playing = false;
          $('playBtn').textContent = '▶ 播放';
        }
      }
      $('timeSlider').value = this.frameF;
      // 回放中粒子按插值过渡, 切面与色阶联动更新
      this._dirtyDensity = true;
    }

    if (this.data) {
      this._updateField(false);
      this._updateHUD();
    }
    this.three.controls.update();
    this.three.composer.render();

    // FPS
    this._frames++;
    if (now - this._lastSec >= 1000) {
      this._fps = Math.round((this._frames * 1000) / (now - this._lastSec));
      $('fps').textContent = String(this._fps);
      this._frames = 0;
      this._lastSec = now;
    }
  }
}

function validate(d) {
  if (!d || typeof d !== 'object') return '不是有效的 JSON 对象';
  if (d.meta?.schema && d.meta.schema !== DATA_SCHEMA) {
    // 仅警告, 不阻止
    console.warn(`schema 版本不一致: ${d.meta.schema}`);
  }
  if (!Array.isArray(d.levels) || d.levels.length < 2) return 'levels 需为至少 2 层的高度数组';
  if (!Array.isArray(d.steps) || d.steps.length === 0) return 'steps 为空';
  for (let i = 0; i < d.steps.length; i++) {
    const s = d.steps[i];
    if (!Array.isArray(s.pressureProfile) || s.pressureProfile.length !== d.levels.length)
      return `steps[${i}].pressureProfile 长度与 levels 不符`;
    if (!Array.isArray(s.windProfile) || s.windProfile.length !== d.levels.length)
      return `steps[${i}].windProfile 长度与 levels 不符`;
    if (typeof s.centralPressure !== 'number' || typeof s.maxSustainedWind !== 'number')
      return `steps[${i}] 缺少 centralPressure/maxSustainedWind`;
  }
  return null;
}

window.addEventListener('DOMContentLoaded', () => {
  window.__app = new App();
});
