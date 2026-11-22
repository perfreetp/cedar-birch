import { defineStore } from '../mini-store.js';
import { reactive, computed, watch } from 'vue';
import defaultConfig from '../data/network.json';
import { buildModel, solveNetwork, branchSummary, pathForSegment, findFlowPath } from './solver.js';
import { dnColor, flowTierLabel } from './constants.js';
import { loadStoredConfig, saveStoredConfig, clearStoredConfig, STORAGE_KEY } from './persist.js';

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export const store = defineStore(() => {
  const state = reactive({
    config: null,
    model: null,
    solution: null,
    condition: 'normal',
    flows: {},
    closed: [],
    branchK: {},
    selectedSourceId: null,
    selectedSegId: null,
    selectedEquipmentId: null,
    isolate: null, // { kind: 'branch'|'segment', id, segIds: [], label }
    showArrows: true,
    stripeSpeed: 1.0,
    pipeScale: 1.0,
    showClosed: true,
    solveStats: { ms: 0, iterations: 0, converged: true, residual: 0, reducedNodes: 0 },
    status: '',
    persisted: false,
    modelVersion: 0,
  });

  const listeners = new Set();

  function emit(evt, payload) {
    for (const fn of listeners) fn(evt, payload);
  }

  function init() {
    const stored = loadStoredConfig();
    const cfg = stored?.config || clone(defaultConfig);
    state.persisted = !!stored?.config;
    setConfig(cfg, { silent: true });
    state.condition = 'normal';
    applyCondition('normal', { instant: true, silent: true });
    state.selectedSourceId = state.config.sources[0]?.id ?? null;
    recompute({ instant: true });
  }

  function setConfig(cfg, opts = {}) {
    state.config = cfg;
    state.model = buildModel(cfg);
    state.modelVersion++;
    state.branchK = cfg.params?.branchResistance ? clone(cfg.params.branchResistance) : {};
    state.stripeSpeed = cfg.params?.stripeSpeed ?? 1;
    state.pipeScale = cfg.params?.pipeScale ?? 1;
    if (!opts.silent) recompute({ instant: true });
  }

  /** 应用工况的默认参数（排放量、关闭段） */
  function applyCondition(key, opts = {}) {
    const cond = state.config.conditions[key];
    if (!cond) return;
    state.condition = key;
    state.flows = { ...cond.flows };
    state.closed = [...(cond.closed || [])];
    recompute(opts);
    emit('condition', key);
  }

  function setFlow(sourceId, value) {
    const v = Math.max(0, Number(value) || 0);
    state.flows = { ...state.flows, [sourceId]: v };
    scheduleSolve();
  }

  function setFlows(next) {
    state.flows = { ...next };
    scheduleSolve();
  }

  function setBranchK(branchId, value) {
    const v = Math.max(0.2, Math.min(4, Number(value) || 1));
    state.branchK = { ...state.branchK, [branchId]: v };
    scheduleSolve();
  }

  function setSealHeight(equipmentId, mm) {
    const e = state.config.equipment.find((x) => x.id === equipmentId);
    if (!e) return;
    e.sealHeightMm = Math.max(50, Math.min(3000, Number(mm) || 0));
    // 水封高度只影响“是否越过水封”的判据，通气阻力保持标定值
    if (state.model) recompute({ instant: true });
    else state.model = buildModel(state.config);
  }

  function setSourceSplit(sourceId, a) {
    const src = state.config.sources.find((s) => s.id === sourceId);
    if (!src) return;
    const first = Math.max(0, Math.min(1, Number(a)));
    src.split = [first, 1 - first];
    state.model = buildModel(state.config);
    state.modelVersion++;
    recompute({ instant: true });
  }

  function toggleConditionClosedRule(rule) {
    const has = state.closed.includes(rule);
    state.closed = has ? state.closed.filter((r) => r !== rule) : [...state.closed, rule];
    scheduleSolve();
  }

  let solveTimer = null;
  let pendingInstant = false;
  function scheduleSolve() {
    if (solveTimer) return;
    solveTimer = requestAnimationFrame(() => {
      solveTimer = null;
      recompute({ instant: pendingInstant });
      pendingInstant = false;
    });
  }

  function recompute(opts = {}) {
    if (!state.model) return;
    const t0 = performance.now();
    const sol = solveNetwork(state.model, {
      flows: state.flows,
      closed: state.closed,
      branchK: state.branchK,
      warmStart: state.solution?.head,
    });
    state.solution = sol;
    state.solveStats = {
      ms: sol.solveMs,
      iterations: sol.iterations,
      converged: sol.converged,
      residual: sol.residual,
      reducedNodes: sol.reducedNodes,
      totalToFlare: sol.totalToFlare * 3600,
    };
    state.branches = branchSummary(state.model, sol);
    // 隔离路径随流量重新计算
    if (state.isolate) {
      refreshIsolationPath();
    }
    emit('solution', { solution: sol, instant: opts.instant });
  }

  function selectSource(id) {
    state.selectedSourceId = id;
    const src = state.config.sources.find((s) => s.id === id);
    if (src) state.selectedEquipmentId = id;
  }

  function selectSegment(id) {
    state.selectedSegId = id;
    if (id) {
      const seg = state.config.segments.find((s) => s.id === id);
      if (seg) {
        const n = state.model.nodes.find((x) => x.id === seg.from || x.key === seg.from);
        emit('focus', { type: 'segment', id });
      }
    }
  }

  function isolateBranch(branchId, kind = 'branch') {
    if (!branchId) {
      state.isolate = null;
      emit('isolate', null);
      return;
    }
    let segIds;
    let label;
    if (kind === 'segment') {
      const seg = state.config.segments.find((s) => s.id === branchId);
      if (!seg) return;
      const p = pathForSegment(state.model, state.solution, seg.id);
      segIds = p ? p.segIds : [seg.id];
      label = `管段 ${seg.id} → 火炬头`;
    } else {
      const branchSegs = state.config.segments.filter((s) => s.branchId === branchId).map((s) => s.id);
      const set = new Set();
      // 从该支路每一段分别向上游/下游补全到火炬头的路径，仅保留“主路径”：
      // 用每条子管段的下游路径并集，再并上支路自身管段，得到源→火炬头完整链路
      for (const sid of branchSegs) {
        const p = pathForSegment(state.model, state.solution, sid);
        if (p) for (const x of p.segIds) set.add(x);
      }
      for (const sid of branchSegs) set.add(sid);
      segIds = [...set];
      const sample = state.config.segments.find((s) => s.branchId === branchId);
      label = sample ? branchLabel(branchId) : branchId;
    }
    state.isolate = { kind, id: branchId, segIds, label };
    emit('isolate', state.isolate);
  }

  function refreshIsolationPath() {
    if (!state.isolate) return;
    if (state.isolate.kind === 'segment') {
      const p = pathForSegment(state.model, state.solution, state.isolate.id);
      if (p) state.isolate.segIds = p.segIds;
    } else {
      const branchSegs = state.config.segments.filter((s) => s.branchId === state.isolate.id).map((s) => s.id);
      const set = new Set();
      for (const sid of branchSegs) {
        const p = pathForSegment(state.model, state.solution, sid);
        if (p) for (const x of p.segIds) set.add(x);
      }
      for (const sid of branchSegs) set.add(sid);
      state.isolate.segIds = [...set];
    }
  }

  function clearIsolation() {
    state.isolate = null;
    emit('isolate', null);
  }

  function branchLabel(branchId) {
    const meta = {
      MAIN: '主放空总管',
      H1: '1# 火炬总管',
      H2: '2# 火炬总管',
      R1: '1# 火炬立管',
      R2: '2# 火炬立管',
      XO: '1#↔2# 跨线',
    };
    if (meta[branchId]) return meta[branchId];
    const src = state.config.sources.find((s) => s.id === branchId);
    if (src) return `${src.id} ${src.name}`;
    return branchId;
  }

  function setStripeSpeed(v) {
    state.stripeSpeed = Number(v) || 1;
  }

  function setPipeScale(v) {
    state.pipeScale = Number(v) || 1;
  }

  function toggleArrows() {
    state.showArrows = !state.showArrows;
    emit('arrows', state.showArrows);
  }

  function resetToDefault() {
    clearStoredConfig();
    state.persisted = false;
    setConfig(clone(defaultConfig), { silent: true });
    state.isolate = null;
    state.selectedSegId = null;
    state.condition = 'normal';
    state.selectedSourceId = state.config.sources[0]?.id ?? null;
    applyCondition('normal', { instant: true });
    emit('reset');
  }

  function persist() {
    const cfg = clone(state.config);
    cfg.params.branchResistance = clone(state.branchK);
    cfg.params.stripeSpeed = state.stripeSpeed;
    cfg.params.pipeScale = state.pipeScale;
    // 记录当前工况下用户调整过的流量与关闭规则
    const cond = cfg.conditions[state.condition];
    if (cond) {
      cond.flows = { ...state.flows };
      cond.closed = [...state.closed];
    }
    cfg.params.sealHeightMm = Object.fromEntries(
      cfg.equipment.filter((e) => e.type === 'waterseal').map((e) => [e.id, e.sealHeightMm]),
    );
    saveStoredConfig(cfg);
    state.persisted = true;
    state.status = '已保存到浏览器本地';
    setTimeout(() => {
      if (state.status === '已保存到浏览器本地') state.status = '';
    }, 2600);
  }

  function exportConfig() {
    const cfg = clone(state.config);
    cfg.params.branchResistance = clone(state.branchK);
    cfg.params.stripeSpeed = state.stripeSpeed;
    cfg.params.pipeScale = state.pipeScale;
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flare-network-${state.condition}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importConfig(file) {
    const text = await file.text();
    const cfg = JSON.parse(text);
    if (!cfg.nodes || !cfg.segments) throw new Error('不是有效的管网配置文件');
    setConfig(cfg, { silent: true });
    state.branchK = cfg.params?.branchResistance || {};
    state.condition = 'normal';
    state.isolate = null;
    state.selectedSegId = null;
    state.selectedSourceId = cfg.sources[0]?.id ?? null;
    applyCondition('normal', { instant: true });
    emit('reset');
  }

  // 派生
  const sourcesView = computed(() => {
    const cfg = state.config;
    if (!cfg) return [];
    return cfg.sources.map((s) => {
      const flow = state.flows[s.id] ?? 0;
      const segs = cfg.segments.filter((x) => x.branchId === s.id);
      const sol = state.solution;
      let maxFill = 0;
      let maxVel = 0;
      let downstream = 0;
      for (const sg of segs) {
        const r = sol?.segById[sg.id];
        if (!r) continue;
        maxFill = Math.max(maxFill, r.fill);
        maxVel = Math.max(maxVel, r.velocity);
        downstream = Math.max(downstream, r.absFlow);
      }
      const meta = cfg.equipment.find((e) => e.id === s.id);
      return {
        ...s,
        flow,
        maxFill,
        maxVel,
        downstream,
        sealId: `WS-${s.id}`,
        description: meta?.overview || '',
        conditionLimit: cfg.conditions.emergency.flows[s.id] ?? 0,
      };
    });
  });

  const equipmentView = computed(() => {
    const cfg = state.config;
    if (!cfg) return [];
    return cfg.equipment
      .filter((e) => e.type === 'waterseal' || e.type === 'knockout' || e.type === 'flare')
      .map((e) => {
        const seal = state.solution?.seals.find((s) => s.id === e.id) || null;
        return { ...e, seal };
      });
  });

  const segmentList = computed(() => {
    const cfg = state.config;
    if (!cfg) return [];
    return cfg.segments.map((s) => {
      const r = state.solution?.segById[s.id];
      const from = cfg.nodes.find((n) => n.id === s.from);
      const to = cfg.nodes.find((n) => n.id === s.to);
      return {
        ...s,
        fromName: from?.name || s.from,
        toName: to?.name || s.to,
        flow: r?.flow ?? 0,
        velocity: r?.velocity ?? 0,
        fill: r?.fill ?? 0,
        tier: r?.tier ?? 0,
        tierLabel: flowTierLabel(r?.fill ?? 0),
        active: r?.active ?? true,
        connected: r?.connected ?? true,
        pressureDrop: r?.pressureDrop ?? 0,
        direction: (r?.flow ?? 0) >= 0 ? '正向' : '反向',
        color: dnColor(s.dn),
      };
    });
  });

  return {
    state,
    listeners,
    init,
    setConfig,
    applyCondition,
    setFlow,
    setFlows,
    setBranchK,
    setSealHeight,
    setSourceSplit,
    toggleConditionClosedRule,
    recompute,
    selectSource,
    selectSegment,
    isolateBranch,
    clearIsolation,
    branchLabel,
    setStripeSpeed,
    setPipeScale,
    toggleArrows,
    resetToDefault,
    persist,
    exportConfig,
    importConfig,
    sourcesView,
    equipmentView,
    segmentList,
  };
});
