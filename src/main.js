import './styles.css';
import { parseDustVol, normalizedToPhysical } from './volumeFormat.js';
import { BakerClient } from './bakerClient.js';
import { VolumeRenderer } from './volumeRenderer.js';
import { THRESHOLD_LEVELS } from './colorLUT.js';

const AXIS_NAMES = ['X 轴切面（沿视线纵深切 X）', 'Y 轴切面（水平横切）', 'Z 轴切面（沿视线纵深切 Z）'];
const BASE_FRAME_RATE = 2;   // 1× 速度下每秒推进 2 个时刻帧

class App {
  constructor() {
    this.el = this._collectElements();
    this.baker = new BakerClient();
    this.renderer = new VolumeRenderer(this.el.canvas);
    this.dataset = null;
    this.header = null;
    this.thresholdIndex = 2;
    this.sliceCount = 64;
    this.time = 0;                 // 连续时刻（可为小数）
    this.playing = false;
    this.speed = 1;
    this.loop = true;
    this.bakeToken = 0;
    this.bakeDirty = false;
    this.baking = false;
    this.lastBakeKey = '';
    this.lastStats = null;
    this._downPos = null;
    this._lastFrameMs = performance.now();
    this._hudTimer = 0;

    this._initThresholdUI();
    this._bindEvents();
    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);
  }

  _collectElements() {
    const $ = (id) => document.getElementById(id);
    return {
      canvas: $('gl-canvas'),
      dataDot: $('data-dot'), dataStatusText: $('data-status-text'),
      metaDims: $('meta-dims'), metaFrames: $('meta-frames'), metaRange: $('meta-range'),
      loadTrack: $('load-progress-track'), loadFill: $('load-progress-fill'),
      btnDemo: $('btn-load-demo'), fileInput: $('file-input'),
      thresholdSlider: $('threshold-slider'), thresholdValue: $('threshold-value'),
      thresholdDesc: $('threshold-desc'), levelLabels: $('level-labels'),
      sliceSlider: $('slice-slider'), sliceValue: $('slice-value'),
      bakeDot: document.querySelector('#bake-status .dot'), bakeText: $('bake-status-text'),
      timeSlider: $('time-slider'), timeValue: $('time-value'),
      btnPlay: $('btn-play'), btnStepBack: $('btn-step-back'), btnStepFwd: $('btn-step-fwd'),
      speedSeg: $('speed-seg'), loopCheck: $('loop-check'),
      fps: $('fps-readout'), quality: $('quality-readout'), axis: $('hud-axis'),
      pickBox: $('pick-readout'), pickCoord: $('pick-coord'), pickValue: $('pick-value'),
      pickClear: $('pick-clear'),
      btnPng: $('btn-export-png'), btnJson: $('btn-export-json'),
      overlay: $('loading-overlay'), overlayText: $('overlay-text'),
    };
  }

  // ---------------- 区域一：数据加载 ----------------
  _initThresholdUI() {
    this.el.levelLabels.innerHTML = THRESHOLD_LEVELS
      .map((l, i) => `<span data-i="${i}">${l.label}</span>`).join('');
    this.el.levelLabels.querySelectorAll('span').forEach((s) => {
      s.addEventListener('click', () => {
        this.el.thresholdSlider.value = s.dataset.i;
        this._onThresholdChange();
      });
    });
    this._refreshThresholdUI();
  }

  async loadFromArrayBuffer(buffer, name) {
    this._setDataStatus('loading', `正在解析 ${name}…`);
    this._showOverlay('正在解析体数据…');
    try {
      const { header, frames } = await parseDustVol(buffer, (p) => {
        this.el.loadFill.style.width = `${Math.round(p * 100)}%`;
      });
      this.header = header;
      // frames 共享同一个底层 buffer，取完整 buffer 转移给 worker
      const fullBuffer = frames[0].buffer;
      this.dataset = { header, name };

      this._showOverlay('正在初始化烘焙 Worker…');
      await this.baker.init(header, fullBuffer);

      this.renderer.loadDataset(this.dataset);
      this._populateMeta();
      this._setDataStatus('ready', `已加载：${name}`);
      this.el.loadTrack.hidden = true;

      this.time = 0;
      this.el.timeSlider.max = String(header.frameCount - 1);
      this.el.timeSlider.value = '0';
      this._refreshTimeUI();
      this._hideOverlay();
      this._requestBake(true);
      this._refreshStats();
    } catch (err) {
      console.error(err);
      this._setDataStatus('error', '加载失败');
      this._showOverlay(`加载失败：${err.message}（点击界面任意处关闭）`);
      this.el.overlay.addEventListener('click', () => this._hideOverlay(), { once: true });
    }
  }

  _populateMeta() {
    const h = this.header;
    this.el.metaDims.textContent = `${h.nx} × ${h.ny} × ${h.nz}`;
    this.el.metaFrames.textContent = `${h.frameCount} 时刻`;
    this.el.metaRange.textContent = `${h.cMin.toFixed(0)}–${h.cMax.toFixed(0)} ${h.unit}`;
  }

  _setDataStatus(kind, text) {
    this.el.dataDot.className = `dot ${kind}`;
    this.el.dataStatusText.textContent = text;
  }

  _showOverlay(text) { this.el.overlayText.textContent = text; this.el.overlay.hidden = false; }
  _hideOverlay() { this.el.overlay.hidden = true; }

  // ---------------- 区域三：阈值与切片 ----------------
  get thresholdNorm() { return THRESHOLD_LEVELS[this.thresholdIndex].norm; }

  _refreshThresholdUI() {
    const lv = THRESHOLD_LEVELS[this.thresholdIndex];
    this.el.thresholdValue.textContent = lv.label;
    this.el.thresholdDesc.textContent = `${lv.desc}（归一化 ≥ ${lv.norm.toFixed(2)}，物理浓度 ≥ ${
      this.header ? normalizedToPhysical(this.header, lv.norm).toFixed(1) + ' ' + this.header.unit : '—'
    }）`;
    this.el.levelLabels.querySelectorAll('span').forEach((s, i) =>
      s.classList.toggle('active', i === this.thresholdIndex));
  }

  _onThresholdChange() {
    this.thresholdIndex = Number(this.el.thresholdSlider.value);
    this._refreshThresholdUI();
    this._requestBake();   // 阈值变化：重新生成切片纹理
  }

  _onSliceChange() {
    this.sliceCount = Number(this.el.sliceSlider.value);
    this.el.sliceValue.textContent = `${this.sliceCount} 层`;
    this.renderer.setSliceCount(this.sliceCount);
    this._requestBake();   // 层数变化：重新生成切片纹理
  }

  // 烘焙调度：合并连续调整，丢弃过期任务，结果下一帧挂载
  _bakeKey() {
    const axis = Math.max(0, this.renderer.currentAxis);
    const { a } = this._framePair();
    return [axis, this.sliceCount, this.thresholdIndex, a].join('|');
  }

  async _requestBake(immediate = false) {
    if (!this.dataset) return;
    if (this.baking) {
      // 烘焙进行中：标记脏，由 _runBake 结束后自动补最新参数的烘焙
      this.bakeDirty = true;
      return;
    }
    if (!immediate) {
      clearTimeout(this._bakeTimer);
      this._bakeTimer = setTimeout(() => this._runBake(), 90);
    } else {
      clearTimeout(this._bakeTimer);
      this._runBake();
    }
  }

  async _runBake() {
    if (!this.dataset || this.baking) return;
    const axis = Math.max(0, this.renderer.currentAxis);
    const { a, b, t } = this._framePair();
    const key = [axis, this.sliceCount, this.thresholdIndex, a, b].join('|');
    if (key === this.lastBakeKey) { this.bakeDirty = false; return; }

    const token = ++this.bakeToken;
    this.baking = true;
    this.bakeDirty = false;
    this._setBakeStatus('baking', `烘焙中… ${this.sliceCount} 层 / ${THRESHOLD_LEVELS[this.thresholdIndex].label}`);
    try {
      const result = await this.baker.bake({
        frameA: a, frameB: b, interp: t,
        axis, sliceCount: this.sliceCount,
        thresholdNorm: this.thresholdNorm,
      });
      if (token !== this.bakeToken) return;   // 已被新任务取代
      this.renderer.setBakedTextures(result.bitmapA, result.bitmapB, result.grid);
      this.lastBakeKey = key;
      this._setBakeStatus('ready', `就绪（${result.bakeMs.toFixed(0)} ms，图集 ${result.grid.cols}×${result.grid.rows}）`);
    } catch (err) {
      if (token === this.bakeToken) this._setBakeStatus('idle', `烘焙失败：${err.message}`);
    } finally {
      if (token === this.bakeToken) {
        this.baking = false;
        // 烘焙期间若阈值/层数/时刻又发生变化，立即补一次最新参数的烘焙，
        // 保证“调整后重新生成纹理并在下一帧生效”不被中途的修改吞掉
        if (this.bakeDirty) {
          this.bakeDirty = false;
          this._runBake();
        }
      }
    }
  }

  _setBakeStatus(kind, text) {
    this.el.bakeDot.className = `dot dot-${kind === 'baking' ? 'baking' : kind === 'ready' ? 'ready' : 'idle'}`;
    this.el.bakeText.textContent = text;
  }

  // ---------------- 区域四：时间序列播放 ----------------
  _framePair() {
    const n = this.header ? this.header.frameCount : 1;
    const clamped = Math.min(n - 1, Math.max(0, this.time));
    const a = Math.min(n - 2, Math.floor(clamped));
    const b = a + 1;
    return { a, b, t: clamped - a };
  }

  _refreshTimeUI() {
    this.el.timeSlider.value = this.time.toFixed(2);
    const h = this.header;
    const sec = this.time * (h ? h.frameIntervalSec : 0);
    this.el.timeValue.textContent = `t = ${this.time.toFixed(2)}（${this._formatClock(sec)}）`;
  }

  _formatClock(sec) {
    const hh = Math.floor(sec / 3600);
    const mm = Math.floor((sec % 3600) / 60);
    return `T+${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  _setPlaying(playing) {
    this.playing = playing;
    this.el.btnPlay.textContent = playing ? '⏸' : '▶';
  }

  _tickPlayback(dtMs) {
    if (!this.playing || !this.header) return;
    const n = this.header.frameCount;
    this.time += (BASE_FRAME_RATE * this.speed * dtMs) / 1000;
    if (this.time >= n - 1) {
      if (this.loop) this.time = this.time % (n - 1);
      else { this.time = n - 1; this._setPlaying(false); }
    }
    this._refreshTimeUI();
    this._maybeRebakeForTime();
  }

  // 跨越整数时刻时重新烘焙新的帧对（插值过渡由 shader 中 uInterp 完成）
  _maybeRebakeForTime() {
    const { a } = this._framePair();
    const axis = Math.max(0, this.renderer.currentAxis);
    const key = [axis, this.sliceCount, this.thresholdIndex, a].join('|');
    if (key !== this.lastBakeKey && !this.baking) this._requestBake();
    else if (this.baking) this.bakeDirty = true;
  }

  // ---------------- 拾取与标注 ----------------
  async _onCanvasClick(e) {
    if (!this.dataset || this._dragMoved) return;
    const rect = this.el.canvas.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    const { a, b, t } = this._framePair();

    this.el.pickBox.hidden = false;
    this.el.pickValue.textContent = '采样中…';
    const result = await this.renderer.pick(nx, ny, this.baker, a, b, t);
    if (!result.ok) {
      this.el.pickValue.textContent = result.reason;
      this.el.pickCoord.textContent = '';
      this.renderer.clearMarkers();
      return;
    }
    const h = this.header;
    const physical = normalizedToPhysical(h, result.normalized);
    const p = result.point;
    this.el.pickCoord.textContent =
      `(${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) m · 体素[${result.voxel.x}, ${result.voxel.y}, ${result.voxel.z}]`;
    this.el.pickValue.textContent = `${physical.toFixed(1)} ${h.unit}（归一化 ${result.normalized.toFixed(3)}）`;
    this.renderer.addMarker(p, `${physical.toFixed(0)} ${h.unit}`);
  }

  // ---------------- 导出 ----------------
  _exportPNG() {
    if (!this.dataset) return;
    const url = this.renderer.exportPNG();
    const a = document.createElement('a');
    a.href = url;
    a.download = `dust-volume_t${this.time.toFixed(2)}_${this.sliceCount}slices.png`;
    a.click();
  }

  async _exportJSON() {
    if (!this.dataset) return;
    const { a, b, t } = this._framePair();
    const stats = await this.baker.stats(a, b, t, this.thresholdNorm);
    const h = this.header;
    const physical = (v) => normalizedToPhysical(h, v);
    const summary = {
      exportTime: new Date().toISOString(),
      dataset: { name: this.dataset.name, dimensions: { nx: h.nx, ny: h.ny, nz: h.nz }, frameCount: h.frameCount },
      time: {
        continuousFrame: Number(this.time.toFixed(3)),
        frameA: a, frameB: b, interpolation: Number(t.toFixed(3)),
        elapsedSec: this.time * h.frameIntervalSec,
      },
      render: {
        sliceCount: this.sliceCount,
        sliceAxis: ['x', 'y', 'z'][Math.max(0, this.renderer.currentAxis)],
        threshold: {
          level: this.thresholdIndex,
          label: THRESHOLD_LEVELS[this.thresholdIndex].label,
          normalized: this.thresholdNorm,
          physical: physical(this.thresholdNorm),
          unit: h.unit,
        },
      },
      concentration: {
        unit: h.unit,
        min: physical(stats.normalized.min),
        max: physical(stats.normalized.max),
        mean: physical(stats.normalized.mean),
        activeVoxelCount: stats.normalized.activeVoxelCount,
        totalNonZeroVoxelCount: stats.normalized.totalNonZeroVoxelCount,
        activeCentroidVoxel: stats.normalized.activeCentroidVoxel,
        histogram: stats.histogram.map((count, i) => ({
          bin: i,
          normalizedRange: [i / stats.bins, (i + 1) / stats.bins],
          physicalRange: [physical(i / stats.bins), physical((i + 1) / stats.bins)],
          voxelCount: count,
        })),
      },
    };
    const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `dust-summary_t${this.time.toFixed(2)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async _refreshStats() {
    if (!this.dataset) return;
    const { a, b, t } = this._framePair();
    this.lastStats = await this.baker.stats(a, b, t, this.thresholdNorm);
  }

  // ---------------- 事件绑定 ----------------
  _bindEvents() {
    this.el.btnDemo.addEventListener('click', async () => {
      this.el.loadTrack.hidden = false;
      this.el.loadFill.style.width = '0%';
      const resp = await fetch('/demo-dust.dustvol');
      if (!resp.ok) throw new Error('演示数据不存在，请先运行 npm run gen-data');
      const buffer = await resp.arrayBuffer();
      this.loadFromArrayBuffer(buffer, 'demo-dust.dustvol');
    });

    this.el.fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.el.loadTrack.hidden = false;
      this.el.loadFill.style.width = '0%';
      const buffer = await file.arrayBuffer();
      this.loadFromArrayBuffer(buffer, file.name);
      e.target.value = '';
    });

    this.el.thresholdSlider.addEventListener('input', () => this._onThresholdChange());
    this.el.sliceSlider.addEventListener('input', () => this._onSliceChange());

    this.el.timeSlider.addEventListener('input', () => {
      this.time = Number(this.el.timeSlider.value);
      this._refreshTimeUI();
      this._maybeRebakeForTime();
    });
    this.el.btnPlay.addEventListener('click', () => this._setPlaying(!this.playing));
    this.el.btnStepBack.addEventListener('click', () => {
      this.time = Math.max(0, Math.ceil(this.time) - 1);
      this._setPlaying(false); this._refreshTimeUI(); this._maybeRebakeForTime();
    });
    this.el.btnStepFwd.addEventListener('click', () => {
      this.time = Math.min((this.header?.frameCount ?? 1) - 1, Math.floor(this.time) + 1);
      this._setPlaying(false); this._refreshTimeUI(); this._maybeRebakeForTime();
    });
    this.el.speedSeg.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.el.speedSeg.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.speed = Number(btn.dataset.speed);
      });
    });
    this.el.loopCheck.addEventListener('change', (e) => { this.loop = e.target.checked; });

    this.el.canvas.addEventListener('pointerdown', (e) => {
      this._downPos = { x: e.clientX, y: e.clientY };
      this._dragMoved = false;
    });
    this.el.canvas.addEventListener('pointermove', (e) => {
      if (!this._downPos) return;
      if (Math.hypot(e.clientX - this._downPos.x, e.clientY - this._downPos.y) > 5) this._dragMoved = true;
    });
    this.el.canvas.addEventListener('pointerup', (e) => {
      if (e.button === 0) this._onCanvasClick(e);
      this._downPos = null;
    });
    this.el.pickClear.addEventListener('click', () => {
      this.el.pickBox.hidden = true;
      this.renderer.clearMarkers();
    });

    this.el.btnPng.addEventListener('click', () => this._exportPNG());
    this.el.btnJson.addEventListener('click', () => this._exportJSON());
  }

  // ---------------- 主循环 ----------------
  _renderLoop(now) {
    const dt = Math.min(100, now - this._lastFrameMs);
    this._lastFrameMs = now;

    this._tickPlayback(dt);
    if (this.dataset) {
      const { t } = this._framePair();
      this.renderer.setInterp(t);
      const axisBefore = this.renderer.currentAxis;
      this.renderer.renderFrame(dt);
      // 旋转导致切片主轴切换：按新轴重新烘焙切片纹理
      if (this.renderer.currentAxis !== axisBefore) this._maybeRebakeForTime();
      this.el.axis.textContent = `切片主轴：${AXIS_NAMES[Math.max(0, this.renderer.currentAxis)]} · ${this.sliceCount} 层`;
    }

    this._hudTimer += dt;
    if (this._hudTimer > 500) {
      this._hudTimer = 0;
      this.el.fps.textContent = `FPS ${this.renderer.fps.toFixed(0)}`;
      this.el.fps.style.color = this.renderer.fps >= TARGET_FPS ? '#5eb87a' : '#d9825b';
      this.el.quality.textContent = `分辨率 ${Math.round(this.renderer.resolutionScale * 100)}%`;
    }
    requestAnimationFrame(this._renderLoop);
  }
}

const TARGET_FPS = 55;
new App();
