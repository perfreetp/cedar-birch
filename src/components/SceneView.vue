<template>
  <div class="scene-wrap">
    <canvas ref="canvasRef" class="scene-canvas"></canvas>

    <!-- 3D 标签覆盖层 -->
    <div v-if="showLabels" class="labels">
      <div
        v-for="lbl in labels"
        :key="lbl.key"
        class="label"
        :class="[lbl.kind, { active: lbl.active, warning: lbl.warning }]"
        :style="{ transform: `translate(${lbl.x}px, ${lbl.y}px)` }"
        @click="onLabelClick(lbl)"
      >
        <span class="dot"></span>
        <span class="txt">{{ lbl.text }}</span>
        <span v-if="lbl.badge" class="badge">{{ lbl.badge }}</span>
      </div>
    </div>

    <!-- 悬停提示 -->
    <div v-if="hoverInfo" class="hover-card" :style="{ left: hoverInfo.x + 'px', top: hoverInfo.y + 'px' }">
      <div class="h-title">{{ hoverInfo.title }}</div>
      <div class="h-row"><span>流量</span><b class="mono">{{ fmt(hoverInfo.flow) }} m³/h</b></div>
      <div class="h-row"><span>流速</span><b class="mono">{{ hoverInfo.velocity.toFixed(2) }} m/s</b></div>
      <div class="h-row"><span>充满度</span><b class="mono">{{ hoverInfo.fill.toFixed(0) }}%</b></div>
      <div class="h-row"><span>档位</span><b>{{ hoverInfo.tierLabel }}</b></div>
      <div v-if="hoverInfo.closed" class="h-closed">该管段已关闭</div>
    </div>

    <!-- 相机控制 -->
    <div class="camera-tools">
      <button title="重置视角" @click="resetView">⌂</button>
      <button title="俯视" @click="topView">▣</button>
      <button title="侧视" @click="sideView">◫</button>
      <button title="聚焦火炬" @click="focusFlare">▲</button>
    </div>

    <div class="fps-chip mono">{{ fps }} fps</div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch, shallowRef } from 'vue';
import { NetworkScene } from '../scene/NetworkScene.js';
import { store } from '../network/store.js';
import { flowTierLabel } from '../network/constants.js';
import { Vector3, Matrix } from '@babylonjs/core/Maths/math.js';

const canvasRef = ref(null);
const sceneRef = shallowRef(null);
const labels = ref([]);
const hoverInfo = ref(null);
const fps = ref(0);
const showLabels = ref(true);
const { state } = store;

let labelRaf = null;
let lastFpsT = performance.now();
let frames = 0;

const labelDefs = computed(() => {
  const cfg = state.config;
  if (!cfg) return [];
  const out = [];
  for (const s of cfg.sources) {
    const meta = cfg.equipment.find((e) => e.id === s.id);
    out.push({
      key: `src-${s.id}`,
      kind: 'source',
      text: `${s.id} ${s.shortName}`,
      pos: meta?.pos || [0, 8, 0],
      offset: [0, -26],
      ref: { type: 'source', id: s.id },
      active: state.selectedSourceId === s.id,
    });
  }
  for (const e of cfg.equipment) {
    if (e.type === 'knockout') {
      out.push({
        key: `ko-${e.id}`,
        kind: 'vessel',
        text: e.name,
        pos: [e.pos[0], e.pos[1] + e.radius + 1.4, e.pos[2]],
        offset: [0, -12],
        ref: { type: 'equipment', id: e.id },
      });
    } else if (e.type === 'flare') {
      out.push({
        key: `fl-${e.id}`,
        kind: 'flare',
        text: e.name,
        pos: [e.pos[0], e.pos[1] + 6, e.pos[2]],
        offset: [14, -8],
        ref: { type: 'equipment', id: e.id },
      });
    }
  }
  const mainSeal = cfg.equipment.find((e) => e.id === 'WS-MAIN');
  if (mainSeal) {
    out.push({
      key: 'ws-main',
      kind: 'vessel',
      text: '主水封罐',
      pos: [mainSeal.pos[0], mainSeal.pos[1] + mainSeal.height + 1.2, mainSeal.pos[2]],
      offset: [0, -12],
      ref: { type: 'equipment', id: mainSeal.id },
    });
  }
  return out;
});

function fmt(v) {
  if (v == null) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (a >= 10) return v.toFixed(0);
  if (a >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

function project(pos) {
  const s = sceneRef.value;
  if (!s) return null;
  const { Vector3 } = s._vec;
  const p = Vector3.Project(
    new Vector3(pos[0], pos[1], pos[2]),
    s._identity,
    s.scene.getTransformMatrix(),
    s.camera.viewport.toGlobal(s.engine.getRenderWidth(), s.engine.getRenderHeight()),
  );
  // 视锥外或背后剔除
  const cam = s.camera.position;
  const dx = pos[0] - cam.x, dy = pos[1] - cam.y, dz = pos[2] - cam.z;
  const fwd = s.camera.getForwardRay().direction;
  const dot = dx * fwd.x + dy * fwd.y + dz * fwd.z;
  if (dot <= 0) return null;
  return { x: p.x, y: p.y };
}

function onPick(info) {
  const s = sceneRef.value;
  if (!s) return;
  if (info.isClick) {
    if (info.segId) {
      store.selectSegment(info.segId);
    } else if (info.equipId) {
      const src = state.config.sources.find((x) => x.id === info.equipId);
      if (src) store.selectSource(src.id);
      else state.selectedEquipmentId = info.equipId;
    } else {
      store.selectSegment(null);
    }
  } else if (info.segId) {
    const seg = state.config.segments.find((x) => x.id === info.segId);
    const r = state.solution?.segById[info.segId];
    if (seg && r) {
      hoverInfo.value = {
        x: s.scene.pointerX + 16,
        y: s.scene.pointerY + 14,
        title: `${seg.id} · DN${seg.dn} · L=${seg.length}m`,
        flow: r.flow,
        velocity: r.velocity,
        fill: r.fill,
        tierLabel: flowTierLabel(r.fill),
        closed: !r.active,
      };
    }
  } else {
    hoverInfo.value = null;
  }
}

function rebuildScene() {
  const old = sceneRef.value;
  if (old) old.dispose();
  labels.value = [];
  const s = new NetworkScene(canvasRef.value, state.model, state.config);
  s._vec = { Vector3 };
  s._identity = Matrix.Identity();
  sceneRef.value = s;
  s.onPick(onPick);
  if (state.solution) rebuildFromSolution(state.solution, true);
  requestAnimationFrame(() => {
    if (!sceneRef.value) return;
    if (state.solution) rebuildFromSolution(state.solution, true);
    sceneRef.value.setPipeScale(state.pipeScale);
    sceneRef.value.setStripeSpeedScale(state.stripeSpeed);
    sceneRef.value.arrowMesh.setEnabled(!!state.showArrows);
  });
}

let labelTick = 0;
function updateLabels() {
  const s = sceneRef.value;
  if (!s) return;
  // 标签每 3 帧更新一次，避免频繁触发 Vue 渲染
  labelTick = (labelTick + 1) % 3;
  if (labelTick === 0) {
    const defs = labelDefs.value;
    const out = [];
    const placed = [];
    const w = s.canvas.clientWidth;
    const h = s.canvas.clientHeight;
    const narrow = w < 700;
    // 优先级：选中的源 > 火炬 > 排放源 > 设备
    const sorted = [...defs].sort((a, b) => {
      const pa = a.active ? 10 : a.kind === 'flare' ? 8 : a.kind === 'source' ? 5 : 3;
      const pb = b.active ? 10 : b.kind === 'flare' ? 8 : b.kind === 'source' ? 5 : 3;
      return pb - pa;
    });
    let placedCount = 0;
    const maxLabels = narrow ? 6 : 40;
    for (const d of sorted) {
      if (placedCount >= maxLabels) break;
      const p = project(d.pos);
      if (!p) continue;
      if (p.x < -80 || p.x > w + 80 || p.y < -30 || p.y > h + 30) continue;
      const x = p.x + (d.offset?.[0] || 0);
      const y = p.y + (d.offset?.[1] || 0);
      const wBox = 26 + d.text.length * 12;
      const box = { x0: x, y0: y - 12, x1: x + wBox, y1: y + 12 };
      const collide = placed.some((b2) => !(box.x1 < b2.x0 || box.x0 > b2.x1 || box.y1 < b2.y0 || box.y0 > b2.y1));
      if (collide) continue;
      placed.push(box);
      out.push({ ...d, x, y });
      placedCount++;
    }
    labels.value = out;
  }
  labelRaf = requestAnimationFrame(updateLabels);
}

function onLabelClick(lbl) {
  if (lbl.ref.type === 'source') {
    store.selectSource(lbl.ref.id);
    const src = state.config.sources.find((x) => x.id === lbl.ref.id);
    if (src) sceneRef.value?.focusNode(src.nodeKey);
  } else {
    const e = state.config.equipment.find((x) => x.id === lbl.ref.id);
    if (e) {
      state.selectedEquipmentId = e.id;
      sceneRef.value?.focusPoint(e.pos[0], e.pos[1], e.pos[2], 90);
    }
  }
}

function resetView() {
  sceneRef.value?.resetView();
}
function topView() {
  const cam = sceneRef.value?.camera;
  if (!cam) return;
  cam.beta = 0.08;
  cam.alpha = -Math.PI / 2;
  cam.radius = 300;
}
function sideView() {
  const cam = sceneRef.value?.camera;
  if (!cam) return;
  cam.beta = 1.18;
  cam.alpha = -Math.PI * 0.72;
  cam.radius = 280;
}
function focusFlare() {
  sceneRef.value?.focusPoint(150, 45, 10, 130);
}

function rebuildFromSolution(solution, instant) {
  const s = sceneRef.value;
  if (!s) return;
  s.applySolution(solution, { instant });
  s.setIsolation(state.isolate?.segIds || null);
  s.setSelectedSegment(state.selectedSegId);

  const flareFlow = {};
  const cfg = state.config;
  // 按火炬头分配下游流量：取该火炬立管最后一根管段的流量
  for (const e of cfg.equipment) {
    if (e.type !== 'flare') continue;
    const branch = e.id === 'F1' ? 'R1' : 'R2';
    const seg = cfg.segments.filter((s2) => s2.branchId === branch);
    const last = seg[seg.length - 1];
    const r = last ? solution.segById[last.id] : null;
    flareFlow[e.id] = r ? r.absFlow : 0;
  }
  s.setFlareFlows(flareFlow);
  const srcFlows = {};
  for (const src of cfg.sources) srcFlows[src.id] = state.flows[src.id] || 0;
  s.setSourceFlows(srcFlows);
  s.updateEquipmentFrame(solution);
}

let offSolution = () => {};
let offIsolate = () => {};
let offFocus = () => {};
let offArrows = () => {};
let fpsTimer = null;
let countRaf = 0;

function subscribe(evt, fn) {
  const wrapped = (e, p) => {
    if (e === evt) fn(p);
  };
  store.listeners.add(wrapped);
  return () => store.listeners.delete(wrapped);
}

let lastAspectClass = '';
function onResize() {
  const s = sceneRef.value;
  if (!s) return;
  s.engine.resize();
  requestAnimationFrame(() => {
    if (!sceneRef.value) return;
    const w = s.canvas.clientWidth || 1;
    const h = s.canvas.clientHeight || 1;
    const cls = w / h < 0.92 ? 'portrait' : 'landscape';
    const changed = cls !== lastAspectClass;
    lastAspectClass = cls;
    // 宽高比类别变化时重新取向，否则只重新适配距离
    s.fitAll(changed);
  });
}

onMounted(() => {
  const s = new NetworkScene(canvasRef.value, state.model, state.config);
  s._vec = { Vector3 };
  s._identity = Matrix.Identity();
  sceneRef.value = s;

  s.onPick(onPick);

  offSolution = subscribe('solution', ({ solution, instant }) => {
    rebuildFromSolution(solution, instant);
  });
  offIsolate = subscribe('isolate', () => {
    sceneRef.value?.setIsolation(state.isolate?.segIds || null);
  });
  offFocus = subscribe('focus', (payload) => {
    if (payload.type === 'source') {
      const src = state.config.sources.find((x) => x.id === payload.id);
      if (src) sceneRef.value?.focusNode(src.nodeKey);
    } else if (payload.type === 'segment') {
      const seg = state.config.segments.find((x) => x.id === payload.id);
      if (seg) {
        const a = state.model.nodes.find((n) => n.id === seg.from || n.key === seg.from);
        const b = state.model.nodes.find((n) => n.id === seg.to || n.key === seg.to);
        if (a && b) {
          sceneRef.value?.focusPoint((a.pos[0] + b.pos[0]) / 2, (a.pos[1] + b.pos[1]) / 2, (a.pos[2] + b.pos[2]) / 2, 110);
        }
      }
    }
  });
  offArrows = subscribe('arrows', (v) => {
    sceneRef.value?.arrowMesh.setEnabled(!!v);
  });

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  if (state.solution) rebuildFromSolution(state.solution, true);
  requestAnimationFrame(() => {
    if (!sceneRef.value) return;
    if (state.solution) rebuildFromSolution(state.solution, true);
    sceneRef.value.setPipeScale(state.pipeScale);
    sceneRef.value.setStripeSpeedScale(state.stripeSpeed);
    sceneRef.value.setGlobalVisibility(1);
    sceneRef.value.fitAll(true);
  });

  labelRaf = requestAnimationFrame(updateLabels);

  fpsTimer = setInterval(() => {
    const now = performance.now();
    fps.value = Math.round((frames * 1000) / (now - lastFpsT));
    frames = 0;
    lastFpsT = now;
  }, 900);
  const countFrame = () => {
    frames++;
    countRaf = requestAnimationFrame(countFrame);
  };
  countRaf = requestAnimationFrame(countFrame);

  watch(() => state.modelVersion, () => rebuildScene());
  watch(() => state.stripeSpeed, (v) => sceneRef.value?.setStripeSpeedScale(v));
  watch(() => state.pipeScale, (v) => sceneRef.value?.setPipeScale(v));
  watch(() => state.selectedSegId, (v) => sceneRef.value?.setSelectedSegment(v));
  watch(() => state.isolate, () => sceneRef.value?.setIsolation(state.isolate?.segIds || null));
});

defineExpose({
  resetView,
  topView,
  sideView,
  focusFlare,
  focusPoint(x, y, z, radius) {
    sceneRef.value?.focusPoint(x, y, z, radius);
  },
  focusNode(key) {
    sceneRef.value?.focusNode(key);
  },
  scene: sceneRef,
});

onBeforeUnmount(() => {
  clearInterval(fpsTimer);
  cancelAnimationFrame(countRaf);
  cancelAnimationFrame(labelRaf);
  offSolution();
  offIsolate();
  offFocus();
  offArrows();
  window.removeEventListener('resize', onResize);
  window.removeEventListener('orientationchange', onResize);
  sceneRef.value?.dispose();
  sceneRef.value = null;
});
</script>

<style scoped>
.scene-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #0a0e14;
}
.scene-canvas {
  width: 100%;
  height: 100%;
  display: block;
  outline: none;
  touch-action: none;
}
.labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.label {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  border-radius: 5px;
  background: rgba(10, 15, 22, 0.78);
  border: 1px solid rgba(72, 92, 116, 0.55);
  color: #c7d3e2;
  font-size: 11px;
  white-space: nowrap;
  pointer-events: auto;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transform-origin: left top;
  transition: border-color 0.15s, background 0.15s;
}
.label:hover {
  border-color: #5d7691;
  background: rgba(19, 28, 40, 0.92);
}
.label .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #5f7c99;
}
.label.source .dot {
  background: #47a8d8;
}
.label.flare .dot {
  background: #e8903f;
}
.label.vessel .dot {
  background: #4fc3a1;
}
.label.active {
  border-color: rgba(79, 195, 161, 0.85);
  background: rgba(20, 42, 38, 0.92);
  color: #dff3ec;
}
.label .badge {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(228, 106, 74, 0.22);
  color: #f0a58f;
}
.hover-card {
  position: absolute;
  z-index: 20;
  min-width: 168px;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(12, 18, 26, 0.95);
  border: 1px solid #33404f;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  pointer-events: none;
  font-size: 11px;
}
.h-title {
  font-size: 11.5px;
  color: #e6eef8;
  margin-bottom: 5px;
  font-weight: 600;
}
.h-row {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  color: #8593a6;
  line-height: 1.7;
}
.h-row b {
  color: #dbe4ef;
  font-weight: 500;
}
.h-closed {
  margin-top: 4px;
  color: #e46a4a;
}
.camera-tools {
  position: absolute;
  right: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.camera-tools button {
  width: 30px;
  height: 30px;
  border-radius: 6px;
  background: rgba(16, 23, 32, 0.88);
  border: 1px solid #2a3543;
  color: #9fb0c4;
  font-size: 14px;
  line-height: 1;
  display: grid;
  place-items: center;
}
.camera-tools button:hover {
  color: #e6eef8;
  border-color: #3d4c5e;
}
.fps-chip {
  position: absolute;
  right: 14px;
  top: 12px;
  font-size: 10.5px;
  color: #5d6d81;
  background: rgba(10, 15, 22, 0.7);
  padding: 2px 7px;
  border-radius: 4px;
}
</style>
