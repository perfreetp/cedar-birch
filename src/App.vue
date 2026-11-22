<template>
  <div class="app">
    <!-- 顶部栏 -->
    <header class="topbar">
      <div class="brand">
        <div class="logo">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 2c-1.6 3.4-5 5.2-5 9a5 5 0 0 0 10 0c0-2-1-3.4-2-4.6 0 1.6-1 2.6-2 2.6 1-2.6 0-5.2-1-7z" fill="currentColor" />
          </svg>
        </div>
        <div class="brand-text">
          <h1>炼化火炬管网流向可视化</h1>
          <span>{{ config?.meta?.site }} · {{ segmentCount }} 段管段 · {{ nodeCount }} 个节点</span>
        </div>
      </div>

      <div class="conditions">
        <button
          v-for="c in conditionList"
          :key="c.key"
          class="cond-btn"
          :class="{ active: state.condition === c.key }"
          :style="{ '--c': c.color }"
          @click="switchCondition(c.key)"
        >
          <span class="cond-dot"></span>
          {{ c.name }}
        </button>
      </div>

      <div class="topright">
        <div class="solve-chip" :class="{ warn: !stats.converged }">
          <span class="pulse"></span>
          <span class="mono">{{ stats.ms.toFixed(1) }} ms</span>
          <span class="sep">·</span>
          <span class="mono">{{ stats.iterations }} 次迭代</span>
          <span class="sep">·</span>
          <span class="mono">残差 {{ stats.residual.toExponential(0) }}</span>
        </div>
        <button class="ghost-btn" title="保存到浏览器本地" @click="onPersist">保存</button>
        <button class="ghost-btn" title="导出管网配置文件" @click="onExport">导出配置</button>
        <label class="ghost-btn file-btn" title="导入管网配置文件">
          导入
          <input type="file" accept="application/json" @change="onImport" />
        </label>
      </div>
    </header>

    <div class="mobile-bar">
      <button class="mb-btn" @click="mobileLeft = !mobileLeft">☰ 排放源 / 工况</button>
      <button class="mb-btn" @click="mobileRight = !mobileRight">设备 / 列表</button>
    </div>

    <div class="body">
      <!-- 左侧：排放源 / 工况 -->
      <aside class="panel left" :class="{ 'mobile-open': mobileLeft }">
        <section class="sec">
          <div class="sec-head">
            <h2>工况</h2>
            <span class="hint">{{ conditionMeta.short }}</span>
          </div>
          <p class="cond-desc">{{ conditionMeta.description }}</p>
          <div class="kpis">
            <div class="kpi">
              <span>总排放</span>
              <b class="mono">{{ fmt(totalSourceFlow) }}</b>
              <em>m³/h</em>
            </div>
            <div class="kpi">
              <span>入火炬</span>
              <b class="mono">{{ fmt(stats.totalToFlare) }}</b>
              <em>m³/h</em>
            </div>
            <div class="kpi">
              <span>最高压力</span>
              <b class="mono">{{ (state.solution?.maxPressure / 1000).toFixed(1) }}</b>
              <em>kPa</em>
            </div>
          </div>
        </section>

        <section class="sec grow">
          <div class="sec-head">
            <h2>排放源</h2>
            <span class="hint">{{ sources.length }} 个</span>
          </div>
          <div class="source-list">
            <div
              v-for="s in sources"
              :key="s.id"
              class="source-item"
              :class="{ active: state.selectedSourceId === s.id, off: !s.flow }"
              @click="chooseSource(s.id)"
            >
              <div class="src-line">
                <span class="src-id">{{ s.id }}</span>
                <span class="src-name">{{ s.name }}</span>
                <span class="src-flow mono">{{ fmt(s.flow) }}</span>
              </div>
              <div class="src-meta">
                <span>{{ s.header === 'H1' ? '1# 系统' : '2# 系统' }}</span>
                <span class="dotsep">·</span>
                <span>干管 DN{{ s.dn }}</span>
                <span class="dotsep">·</span>
                <span :style="{ color: tierColor(s.maxFill) }">{{ tierLabel(s.maxFill) }}</span>
              </div>
              <div class="src-bar">
                <i :style="{ width: Math.min(100, s.maxFill) + '%', background: tierColor(s.maxFill) }"></i>
              </div>
            </div>
          </div>
        </section>

        <section class="sec" v-if="selectedSource">
          <div class="sec-head">
            <h2>{{ selectedSource.id }} · {{ selectedSource.name }}</h2>
            <span class="hint">{{ selectedSource.en }}</span>
          </div>
          <p class="cond-desc small">{{ selectedSource.description }}</p>

          <label class="field">
            <span class="field-label">排放量</span>
            <div class="field-input">
              <input
                type="range"
                min="0"
                :max="flowMax"
                step="50"
                :value="selectedSource.flow"
                @input="onFlowInput"
              />
              <input
                class="num mono"
                type="number"
                min="0"
                :max="flowMax"
                step="50"
                :value="Math.round(selectedSource.flow)"
                @change="onFlowNumber"
              />
              <span class="unit">m³/h</span>
            </div>
          </label>

          <div class="quick-row">
            <button class="chip" @click="setFlowPct(0)">切断</button>
            <button class="chip" @click="setFlowPct(0.25)">25%</button>
            <button class="chip" @click="setFlowPct(0.5)">50%</button>
            <button class="chip" @click="setConditionFlow">工况值</button>
            <button class="chip" @click="setEmergencyFlow">事故值</button>
          </div>

          <div class="mini-kpis">
            <div><span>最大流速</span><b class="mono">{{ selectedSource.maxVel.toFixed(2) }}</b><em>m/s</em></div>
            <div><span>最高充满度</span><b class="mono">{{ selectedSource.maxFill.toFixed(0) }}</b><em>%</em></div>
            <div><span>上游总流量</span><b class="mono">{{ fmt(selectedSource.downstream) }}</b><em>m³/h</em></div>
          </div>

          <label class="field compact">
            <span class="field-label">双支管分流</span>
            <div class="field-input">
              <input
                type="range"
                min="10"
                max="90"
                step="1"
                :value="Math.round((selectedSource.split?.[0] ?? 0.5) * 100)"
                @input="onSplitInput"
              />
              <span class="mono splitval">{{ Math.round((selectedSource.split?.[0] ?? 0.5) * 100) }} : {{ 100 - Math.round((selectedSource.split?.[0] ?? 0.5) * 100) }}</span>
            </div>
          </label>

          <button class="wide-btn" @click="isolateSelectedSource">
            隔离该支路并高亮源→火炬头路径
          </button>
        </section>
      </aside>

      <!-- 中间：3D 视图 -->
      <main class="viewport">
        <SceneView ref="sceneViewRef" />

        <div class="viewport-overlay">
          <div class="legend-card">
            <div class="legend-title">管径分档</div>
            <div class="legend-rows">
              <div v-for="t in dnTiers" :key="t.key" class="legend-row">
                <i :style="{ background: t.color }"></i>
                <span>{{ t.label }}</span>
              </div>
            </div>
          </div>
          <div class="legend-card">
            <div class="legend-title">流量档位（充满度）</div>
            <div class="legend-rows">
              <div v-for="t in flowTiers" :key="t.key" class="legend-row">
                <i :style="{ background: t.color }"></i>
                <span>{{ t.label }}</span>
              </div>
            </div>
          </div>
        </div>

        <div v-if="state.isolate" class="isolate-banner">
          <div class="ib-text">
            <b>已隔离：{{ state.isolate.label }}</b>
            <span class="mono">{{ state.isolate.segIds.length }} 段 · 其余管段降透明度</span>
          </div>
          <button class="ib-close" @click="store.clearIsolation()">退出隔离</button>
        </div>

        <div class="sliders-card" :class="{ collapsed: narrowView && !slidersOpen }">
          <button v-if="narrowView" class="sliders-toggle" @click="slidersOpen = !slidersOpen">
            {{ slidersOpen ? '收起显示设置' : '显示设置' }}
          </button>
          <template v-if="!narrowView || slidersOpen">
          <label>
            <span>条纹速度</span>
            <input type="range" min="0" max="3" step="0.05" :value="state.stripeSpeed" @input="onStripe" />
            <em class="mono">{{ state.stripeSpeed.toFixed(2) }}×</em>
          </label>
          <label>
            <span>管径视觉比例</span>
            <input type="range" min="0.6" max="2" step="0.05" :value="state.pipeScale" @input="onPipeScale" />
            <em class="mono">{{ state.pipeScale.toFixed(2) }}×</em>
          </label>
          <label class="inline">
            <input type="checkbox" :checked="state.showArrows" @change="onArrowsToggle" />
            <span>流向箭头</span>
          </label>
          </template>
        </div>
      </main>

      <!-- 右侧：设备与列表 -->
      <aside class="panel right" :class="{ 'mobile-open': mobileRight }">
        <div class="tabs">
          <button
            v-for="t in tabs"
            :key="t.key"
            :class="{ active: tab === t.key }"
            @click="tab = t.key"
          >
            {{ t.label }}
            <span class="tab-count">{{ t.count }}</span>
          </button>
        </div>

        <!-- 设备 -->
        <div v-if="tab === 'equip'" class="tab-body">
          <div class="sec-head sticky">
            <h2>水封罐</h2>
            <span class="hint">{{ exceededCount }} 个超限</span>
          </div>
          <div class="seal-list">
            <div
              v-for="s in sealList"
              :key="s.id"
              class="seal-item"
              :class="{ exceeded: s.seal?.exceeded, off: !s.seal?.flow }"
              @click="focusSeal(s)"
            >
              <div class="seal-top">
                <span class="seal-name">{{ s.name }}</span>
                <span class="seal-state" :class="{ bad: s.seal?.exceeded }">
                  {{ s.seal?.exceeded ? '越过水封' : s.seal?.flow > 1 ? '正常通气' : '无流量' }}
                </span>
              </div>
              <div class="seal-gauge">
                <div class="gauge-track">
                  <i class="gauge-fill" :style="{ width: Math.min(100, (s.seal?.levelMm / s.sealHeightMm) * 62.5) + '%', background: s.seal?.exceeded ? 'var(--danger)' : 'var(--accent-2)' }"></i>
                  <i class="gauge-mark" :style="{ left: '62.5%' }"></i>
                </div>
                <div class="seal-stats mono">
                  <span>液位 {{ Math.round(s.seal?.levelMm ?? 0) }} / {{ s.sealHeightMm }} mm</span>
                  <span>Δp {{ ((s.seal?.differentialPa ?? 0) / 1000).toFixed(1) }} kPa</span>
                </div>
              </div>
              <div class="seal-bottom">
                <div class="seal-flow mono">Q {{ fmt(s.seal?.flow ?? 0) }} m³/h</div>
                <label class="seal-edit" @click.stop>
                  <span>水封高度</span>
                  <input
                    class="num mono"
                    type="number"
                    min="100"
                    max="3000"
                    step="50"
                    :value="s.sealHeightMm"
                    @change="onSealHeight(s.id, $event)"
                  />
                  <span class="unit">mm</span>
                </label>
              </div>
            </div>
          </div>

          <div class="sec-head sticky spaced">
            <h2>分液罐 / 火炬头</h2>
          </div>
          <div class="equip-list">
            <div v-for="e in otherEquipment" :key="e.id" class="equip-item">
              <span class="eq-name">{{ e.name }}</span>
              <span class="eq-val mono">{{ equipValue(e) }}</span>
            </div>
          </div>
        </div>

        <!-- 支路 -->
        <div v-if="tab === 'branches'" class="tab-body">
          <div class="sec-head sticky">
            <h2>支路</h2>
            <span class="hint">点击隔离</span>
          </div>
          <div class="branch-list">
            <button
              v-for="b in branchList"
              :key="b.id"
              class="branch-item"
              :class="{ active: state.isolate?.kind === 'branch' && state.isolate.id === b.id, muted: !b.active }"
              @click="toggleIsolateBranch(b.id)"
            >
              <span class="br-name">{{ store.branchLabel(b.id) }}</span>
              <span class="br-flow mono">{{ fmt(b.flow) }}</span>
              <span class="br-fill" :style="{ background: tierColor(b.maxFill) }">{{ tierLabel(b.maxFill) }}</span>
            </button>
          </div>
        </div>

        <!-- 管段 -->
        <div v-if="tab === 'segments'" class="tab-body">
          <div class="sec-head sticky">
            <h2>管段</h2>
            <span class="hint">{{ filteredSegments.length }} / {{ segments.length }}</span>
          </div>
          <div class="seg-tools">
            <input v-model="segQuery" class="seg-search" placeholder="搜索管段号 / 支路" />
            <select v-model="segSort">
              <option value="id">按编号</option>
              <option value="flow">按流量</option>
              <option value="fill">按充满度</option>
              <option value="dn">按管径</option>
            </select>
          </div>
          <div class="seg-table">
            <div class="seg-head">
              <span>管段</span>
              <span>DN</span>
              <span>流量</span>
              <span>流速</span>
              <span>档位 / 流向</span>
            </div>
            <button
              v-for="s in filteredSegments"
              :key="s.id"
              class="seg-row"
              :class="{ selected: state.selectedSegId === s.id, closed: !s.active, isolated: state.isolate?.segIds.includes(s.id) }"
              @click="onSegClick(s)"
            >
              <span class="sg-id">
                <i :style="{ background: s.color }"></i>
                <span class="mono">{{ s.id }}</span>
              </span>
              <span class="sg-dn mono">{{ s.dn }}</span>
              <span class="sg-flow mono">{{ fmt(s.flow) }}</span>
              <span class="sg-vel mono">{{ s.velocity.toFixed(2) }}</span>
              <span class="sg-tier">
                <span class="tier-pill" :style="{ background: tierColor(s.fill) + '26', color: tierColor(s.fill) }">{{ s.tierLabel }}</span>
                <span class="dir" :class="{ rev: s.direction !== '正向' }">{{ s.direction === '正向' ? '→' : '←' }}</span>
              </span>
            </button>
          </div>
        </div>

        <!-- 参数 -->
        <div v-if="tab === 'params'" class="tab-body">
          <div class="sec-head sticky">
            <h2>支路阻力系数</h2>
            <span class="hint">整体缩放该支路阻力</span>
          </div>
          <div class="param-list">
            <label v-for="b in branchList" :key="'k' + b.id" class="param-row">
              <span class="pr-name">{{ store.branchLabel(b.id) }}</span>
              <input
                type="range"
                min="0.4"
                max="2.5"
                step="0.05"
                :value="state.branchK[b.id] ?? 1"
                @input="onBranchK(b.id, $event)"
              />
              <em class="mono">{{ (state.branchK[b.id] ?? 1).toFixed(2) }}</em>
            </label>
          </div>

          <div class="sec-head sticky spaced">
            <h2>工况关闭段</h2>
            <span class="hint">{{ state.closed.length }} 条规则</span>
          </div>
          <div class="closed-rules">
            <div v-for="r in allClosedRules" :key="r.rule" class="rule-row">
              <label class="rule-check">
                <input type="checkbox" :checked="state.closed.includes(r.rule)" @change="toggleRule(r.rule)" />
                <span>{{ r.label }}</span>
              </label>
              <span class="rule-tag mono">{{ r.rule }}</span>
            </div>
          </div>

          <div class="sec-head sticky spaced">
            <h2>本地存储</h2>
          </div>
          <div class="storage-box">
            <p>
              {{ state.persisted ? '已从浏览器本地恢复管网配置。' : '当前使用内置默认管网。' }}
              拓扑、支路阻力与工况参数保存在 <code>localStorage</code>。
            </p>
            <div class="storage-actions">
              <button class="wide-btn" @click="onPersist">保存到本地</button>
              <button class="wide-btn subtle" @click="onExport">导出 JSON</button>
              <button class="wide-btn subtle danger" @click="onReset">恢复默认管网</button>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <transition name="toast">
      <div v-if="state.status" class="toast">{{ state.status }}</div>
    </transition>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import SceneView from './components/SceneView.vue';
import { store } from './network/store.js';
import { CONDITION_META, DN_TIERS, FLOW_TIERS, flowTierIndex, flowTierLabel, dnColor } from './network/constants.js';

const { state } = store;
const sceneViewRef = ref(null);
const tab = ref('equip');
const mobileLeft = ref(false);
const mobileRight = ref(false);
const narrowView = ref(window.innerWidth < 760);
const slidersOpen = ref(false);
if (typeof window !== 'undefined') {
  window.addEventListener('resize', () => {
    narrowView.value = window.innerWidth < 760;
  });
}
const segQuery = ref('');
const segSort = ref('fill');
const pendingTabFocus = ref(null);

const config = computed(() => state.config);
const stats = computed(() => state.solveStats);
const conditionMeta = computed(() => CONDITION_META[state.condition] || CONDITION_META.normal);
const conditionList = computed(() =>
  Object.entries(CONDITION_META).map(([key, v]) => ({ key, ...v })),
);
const dnTiers = DN_TIERS;
const flowTiers = FLOW_TIERS.map((t) => ({ ...t, label: t.label }));

const sources = computed(() => store.sourcesView.value);
const segments = computed(() => store.segmentList.value);
const nodeCount = computed(() => config.value?.nodes.length || 0);
const segmentCount = computed(() => config.value?.segments.length || 0);

const totalSourceFlow = computed(() =>
  Object.values(state.flows).reduce((a, v) => a + (Number(v) || 0), 0),
);

const selectedSource = computed(() =>
  sources.value.find((s) => s.id === state.selectedSourceId) || null,
);

const flowMax = computed(() => {
  const s = selectedSource.value;
  if (!s) return 10000;
  return Math.max(2000, Math.round(s.conditionLimit * 1.2 / 100) * 100);
});

const sealList = computed(() =>
  (config.value?.equipment || []).filter((e) => e.type === 'waterseal').map((e) => ({
    ...e,
    seal: state.solution?.seals.find((x) => x.id === e.id) || null,
  })),
);
const exceededCount = computed(() => sealList.value.filter((s) => s.seal?.exceeded).length);
const otherEquipment = computed(() =>
  (config.value?.equipment || []).filter((e) => e.type === 'knockout' || e.type === 'flare'),
);

const branchList = computed(() => {
  const map = state.branches;
  if (!map) return [];
  const order = ['MAIN', 'R1', 'R2', 'H1', 'H2', 'XO'];
  const arr = [...map.values()];
  arr.sort((a, b) => {
    const ia = order.indexOf(a.id);
    const ib = order.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return b.flow - a.flow;
  });
  return arr;
});

const tabs = computed(() => [
  { key: 'equip', label: '设备', count: sealList.value.length + otherEquipment.value.length },
  { key: 'branches', label: '支路', count: branchList.value.length },
  { key: 'segments', label: '管段', count: segments.value.length },
  { key: 'params', label: '参数', count: '' },
]);

const filteredSegments = computed(() => {
  const q = segQuery.value.trim().toLowerCase();
  let arr = segments.value;
  if (q) {
    arr = arr.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.branchId.toLowerCase().includes(q) ||
        String(s.dn).includes(q),
    );
  }
  const sort = segSort.value;
  const copy = [...arr];
  if (sort === 'flow') copy.sort((a, b) => Math.abs(b.flow) - Math.abs(a.flow));
  else if (sort === 'fill') copy.sort((a, b) => b.fill - a.fill);
  else if (sort === 'dn') copy.sort((a, b) => b.dn - a.dn);
  else copy.sort((a, b) => a.id.localeCompare(b.id));
  return copy.slice(0, 400);
});

const allClosedRules = computed(() => {
  const rules = new Map();
  const cfg = config.value;
  if (!cfg) return [];
  for (const [key, cond] of Object.entries(cfg.conditions)) {
    for (const r of cond.closed || []) {
      if (!rules.has(r)) {
        rules.set(r, ruleLabel(r, cfg));
      }
    }
  }
  // 追加“全部关闭”快速项
  return [...rules.entries()].map(([rule, label]) => ({ rule, label }));
});

function ruleLabel(rule, cfg) {
  if (rule.startsWith('branch:')) {
    const id = rule.slice(7);
    return `${store.branchLabel(id)}（整条关闭）`;
  }
  if (rule.startsWith('line:')) {
    const [, srcId, line] = rule.split(':');
    return `${srcId} 支路 ${line} 线关闭`;
  }
  if (rule.startsWith('seg:')) {
    return `管段 ${rule.slice(4)} 关闭`;
  }
  return rule;
}

function tierColor(fill) {
  return FLOW_TIERS[flowTierIndex(fill)].color;
}
function tierLabel(fill) {
  return flowTierLabel(fill);
}
function fmt(v) {
  if (v == null || Number.isNaN(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toLocaleString('en-US');
  if (a >= 10) return v.toFixed(0);
  if (a >= 0.1) return v.toFixed(1);
  return v.toFixed(2);
}

function switchCondition(key) {
  store.applyCondition(key);
}

function chooseSource(id) {
  tab.value = 'equip';
  store.selectSource(id);
}

function onFlowInput(ev) {
  if (!selectedSource.value) return;
  store.setFlow(selectedSource.value.id, ev.target.value);
}
function onFlowNumber(ev) {
  if (!selectedSource.value) return;
  store.setFlow(selectedSource.value.id, ev.target.value);
}
function setFlowPct(pct) {
  const s = selectedSource.value;
  if (!s) return;
  const base = conditionBaseFlow(s.id);
  store.setFlow(s.id, pct === 0 ? 0 : Math.round(base * pct));
}
function conditionBaseFlow(id) {
  const cfg = config.value;
  return cfg?.conditions?.[state.condition]?.flows?.[id] ?? 0;
}
function setConditionFlow() {
  const s = selectedSource.value;
  if (!s) return;
  store.setFlow(s.id, conditionBaseFlow(s.id));
}
function setEmergencyFlow() {
  const s = selectedSource.value;
  if (!s) return;
  store.setFlow(s.id, config.value?.conditions?.emergency?.flows?.[s.id] ?? s.conditionLimit);
}
function onSplitInput(ev) {
  const s = selectedSource.value;
  if (!s) return;
  store.setSourceSplit(s.id, Number(ev.target.value) / 100);
}
function isolateSelectedSource() {
  const s = selectedSource.value;
  if (!s) return;
  if (state.isolate?.id === s.id) store.clearIsolation();
  else store.isolateBranch(s.id, 'branch');
}
function toggleIsolateBranch(id) {
  if (state.isolate?.kind === 'branch' && state.isolate.id === id) store.clearIsolation();
  else store.isolateBranch(id, 'branch');
}
function onSegClick(seg) {
  store.selectSegment(seg.id);
  if (state.isolate?.kind === 'segment' && state.isolate.id === seg.id) store.clearIsolation();
  else store.isolateBranch(seg.id, 'segment');
}
function focusSeal(s) {
  state.selectedEquipmentId = s.id;
  sceneViewRef.value?.focusPoint?.(s.pos[0], s.pos[1] + 2, s.pos[2], 70);
}
function equipValue(e) {
  const cfg = config.value;
  if (e.type === 'knockout') {
    const seg = cfg.segments.find((s) => s.kind === 'vessel' && s.branchId && s.name.includes(e.name.replace(/\s/g, '')));
    const sol = state.solution;
    // 用与分液罐相连的筒体管段
    const vessel = cfg.segments.find((s) => s.kind === 'vessel' && s.name.includes(e.id === 'KO-1' ? '1#' : '2#'));
    const r = vessel ? sol?.segById[vessel.id] : null;
    return r ? `${fmt(r.flow)} m³/h` : '—';
  }
  if (e.type === 'flare') {
    const branch = e.id === 'F1' ? 'R1' : 'R2';
    const segs = cfg.segments.filter((s) => s.branchId === branch);
    const last = segs[segs.length - 1];
    const r = last ? state.solution?.segById[last.id] : null;
    return r ? `${fmt(r.absFlow)} m³/h` : '—';
  }
  return '';
}

function onSealHeight(id, ev) {
  store.setSealHeight(id, ev.target.value);
}
function onBranchK(id, ev) {
  store.setBranchK(id, ev.target.value);
}
function toggleRule(rule) {
  store.toggleConditionClosedRule(rule);
}
function onStripe(ev) {
  store.setStripeSpeed(ev.target.value);
}
function onPipeScale(ev) {
  store.setPipeScale(ev.target.value);
}
function onArrowsToggle(ev) {
  store.toggleArrows();
}
function onPersist() {
  store.persist();
}
function onExport() {
  store.exportConfig();
}
async function onImport(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    await store.importConfig(file);
    state.status = '已导入管网配置';
    setTimeout(() => (state.status = ''), 2400);
  } catch (err) {
    state.status = '导入失败：' + err.message;
    setTimeout(() => (state.status = ''), 3200);
  }
  ev.target.value = '';
}
function onReset() {
  if (confirmReset()) {
    store.resetToDefault();
    state.status = '已恢复默认管网';
    setTimeout(() => (state.status = ''), 2400);
  }
}
function confirmReset() {
  return window.confirm('恢复默认管网将丢弃本地保存的修改，确定继续？');
}
</script>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
}

/* 顶栏 */
.topbar {
  display: flex;
  align-items: center;
  gap: 18px;
  height: 56px;
  padding: 0 16px;
  background: linear-gradient(180deg, #111823, #0d131b);
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.logo {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(228, 106, 74, 0.28), rgba(71, 168, 216, 0.24));
  border: 1px solid rgba(228, 106, 74, 0.35);
  color: #f0a084;
  flex-shrink: 0;
}
.brand-text h1 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  letter-spacing: 0.2px;
  white-space: nowrap;
}
.brand-text span {
  display: block;
  font-size: 11px;
  color: var(--fg-3);
  margin-top: 2px;
  white-space: nowrap;
}
.conditions {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: #0b1119;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin-left: auto;
}
.cond-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 14px;
  border-radius: 6px;
  color: var(--fg-2);
  font-size: 12.5px;
  transition: background 0.16s, color 0.16s;
}
.cond-btn:hover {
  color: var(--fg);
  background: #141d28;
}
.cond-btn.active {
  background: color-mix(in srgb, var(--c) 16%, #131c27);
  color: var(--fg);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 45%, transparent);
}
.cond-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--c);
  opacity: 0.5;
}
.cond-btn.active .cond-dot {
  opacity: 1;
  box-shadow: 0 0 8px var(--c);
}
.topright {
  display: flex;
  align-items: center;
  gap: 8px;
}
.solve-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--fg-3);
  padding: 4px 9px;
  border-radius: 5px;
  background: #0b1119;
  border: 1px solid var(--line);
  white-space: nowrap;
}
.solve-chip.warn {
  color: var(--warn);
  border-color: rgba(224, 165, 63, 0.4);
}
.solve-chip .sep {
  opacity: 0.4;
}
.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
.ghost-btn {
  padding: 6px 11px;
  border-radius: 6px;
  border: 1px solid var(--line);
  background: #0b1119;
  color: var(--fg-2);
  font-size: 12px;
  transition: 0.15s;
  white-space: nowrap;
}
.ghost-btn:hover {
  color: var(--fg);
  border-color: var(--line-2);
  background: #111a24;
}
.file-btn {
  position: relative;
  overflow: hidden;
}
.file-btn input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

/* 移动端底栏按钮（桌面隐藏） */
.mobile-bar {
  display: none;
}

/* 主体 */
.body {
  flex: 1;
  display: grid;
  grid-template-columns: 286px minmax(0, 1fr) 336px;
  min-height: 0;
}
.panel {
  background: var(--bg-1);
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.panel.left {
  border-right: 1px solid var(--line);
}
.panel.right {
  border-left: 1px solid var(--line);
}
.sec {
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}
.sec.grow {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-bottom: none;
}
.sec-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.sec-head h2 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--fg-2);
  margin: 0;
}
.sec-head .hint {
  font-size: 10.5px;
  color: var(--fg-3);
}
.sec-head.sticky {
  position: sticky;
  top: 0;
  background: var(--bg-1);
  padding: 12px 14px 8px;
  margin: 0 -14px;
  z-index: 2;
  border-bottom: 1px solid var(--line);
}
.sec-head.sticky.spaced {
  margin-top: 6px;
}
.cond-desc {
  font-size: 11.5px;
  line-height: 1.65;
  color: var(--fg-3);
  margin: 0 0 10px;
}
.cond-desc.small {
  font-size: 11px;
}
.kpis {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.kpi {
  background: #0c131c;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 7px 8px;
}
.kpi span {
  display: block;
  font-size: 10px;
  color: var(--fg-3);
  margin-bottom: 3px;
}
.kpi b {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
  letter-spacing: -0.2px;
}
.kpi em {
  font-style: normal;
  font-size: 9.5px;
  color: var(--fg-3);
  margin-left: 2px;
}

/* 排放源列表 */
.source-list {
  flex: 1;
  overflow-y: auto;
  margin: 0 -14px;
  padding: 0 8px 8px;
}
.source-item {
  padding: 8px 9px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background 0.14s, border-color 0.14s;
  margin-bottom: 3px;
}
.source-item:hover {
  background: #131c27;
}
.source-item.active {
  background: #122029;
  border-color: rgba(71, 168, 216, 0.4);
}
.source-item.off {
  opacity: 0.55;
}
.src-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.src-id {
  font-size: 10px;
  color: var(--fg-3);
  font-family: var(--mono);
  min-width: 22px;
}
.src-name {
  font-size: 12px;
  color: var(--fg);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-flow {
  font-size: 11.5px;
  color: var(--fg-2);
}
.src-meta {
  display: flex;
  gap: 5px;
  font-size: 10px;
  color: var(--fg-3);
  margin: 3px 0 5px 28px;
}
.dotsep {
  opacity: 0.4;
}
.src-bar {
  height: 3px;
  margin-left: 28px;
  border-radius: 2px;
  background: #1a2330;
  overflow: hidden;
}
.src-bar i {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 表单 */
.field {
  display: block;
  margin-bottom: 10px;
}
.field.compact {
  margin-bottom: 8px;
}
.field-label {
  display: block;
  font-size: 10.5px;
  color: var(--fg-3);
  margin-bottom: 5px;
}
.field-input {
  display: flex;
  align-items: center;
  gap: 8px;
}
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: #1e2835;
  outline: none;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: var(--accent-2);
  border: 2px solid #0d141c;
  box-shadow: 0 0 0 1px var(--accent-2);
  cursor: pointer;
}
input[type='range']::-moz-range-thumb {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--accent-2);
  border: 2px solid #0d141c;
  cursor: pointer;
}
.num {
  width: 78px;
  padding: 5px 7px;
  border-radius: 5px;
  background: #0b1119;
  border: 1px solid var(--line);
  color: var(--fg);
  font-size: 12px;
  text-align: right;
}
.num:focus {
  outline: none;
  border-color: var(--accent-2);
}
.unit {
  font-size: 10px;
  color: var(--fg-3);
  white-space: nowrap;
}
.splitval {
  font-size: 11px;
  color: var(--fg-2);
  min-width: 52px;
  text-align: right;
}
.quick-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.chip {
  padding: 4px 9px;
  border-radius: 4px;
  border: 1px solid var(--line);
  background: #0c131c;
  color: var(--fg-2);
  font-size: 10.5px;
}
.chip:hover {
  border-color: var(--accent-2);
  color: var(--fg);
}
.mini-kpis {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 9px;
  background: #0c131c;
  border-radius: 6px;
  border: 1px solid var(--line);
  margin-bottom: 10px;
}
.mini-kpis > div {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10.5px;
  color: var(--fg-3);
}
.mini-kpis b {
  margin-left: auto;
  font-size: 12px;
  color: var(--fg);
  font-weight: 500;
}
.mini-kpis em {
  font-style: normal;
  font-size: 9.5px;
  color: var(--fg-3);
}
.wide-btn {
  display: block;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(71, 168, 216, 0.13);
  border: 1px solid rgba(71, 168, 216, 0.4);
  color: #8ecbe8;
  font-size: 11.5px;
  text-align: center;
  transition: 0.15s;
}
.wide-btn:hover {
  background: rgba(71, 168, 216, 0.2);
  color: #bfe4f5;
}
.wide-btn.subtle {
  background: #0c131c;
  border-color: var(--line);
  color: var(--fg-2);
}
.wide-btn.subtle:hover {
  border-color: var(--line-2);
  color: var(--fg);
}
.wide-btn.danger {
  color: #e79382;
  border-color: rgba(228, 106, 74, 0.35);
}

/* 视口 */
.viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.viewport-overlay {
  position: absolute;
  left: 14px;
  top: 12px;
  display: flex;
  gap: 8px;
  pointer-events: none;
}
.legend-card {
  background: rgba(10, 15, 22, 0.82);
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 8px 10px;
  backdrop-filter: blur(6px);
  min-width: 104px;
}
.legend-title {
  font-size: 9.5px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--fg-3);
  margin-bottom: 6px;
}
.legend-rows {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.legend-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--fg-2);
}
.legend-row i {
  width: 14px;
  height: 4px;
  border-radius: 2px;
}
.isolate-banner {
  position: absolute;
  left: 50%;
  top: 12px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 7px 10px 7px 14px;
  border-radius: 7px;
  background: rgba(30, 24, 14, 0.92);
  border: 1px solid rgba(224, 165, 63, 0.45);
  backdrop-filter: blur(6px);
}
.ib-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ib-text b {
  font-size: 11.5px;
  color: #f0cf92;
  font-weight: 600;
}
.ib-text span {
  font-size: 10px;
  color: #a89068;
}
.ib-close {
  padding: 4px 9px;
  border-radius: 4px;
  border: 1px solid rgba(224, 165, 63, 0.35);
  color: #e8c98d;
  font-size: 10.5px;
}
.ib-close:hover {
  background: rgba(224, 165, 63, 0.14);
}
.sliders-card {
  position: absolute;
  left: 14px;
  bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px;
  background: rgba(10, 15, 22, 0.85);
  border: 1px solid var(--line);
  border-radius: 7px;
  backdrop-filter: blur(6px);
  width: 250px;
}
.sliders-card label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: var(--fg-3);
}
.sliders-card label span {
  width: 76px;
  flex-shrink: 0;
}
.sliders-card label em {
  font-style: normal;
  width: 38px;
  text-align: right;
  color: var(--fg-2);
  font-size: 10.5px;
}
.sliders-card label.inline {
  gap: 6px;
}
.sliders-card.collapsed {
  padding: 6px;
  width: auto;
}
.sliders-toggle {
  padding: 5px 10px;
  border-radius: 5px;
  border: 1px solid var(--line);
  background: #0f1620;
  color: var(--fg-2);
  font-size: 11px;
  white-space: nowrap;
}
.sliders-card input[type='checkbox'] {
  accent-color: var(--accent-2);
}

/* 右侧 */
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.tabs button {
  flex: 1;
  padding: 11px 4px;
  font-size: 11.5px;
  color: var(--fg-3);
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.tabs button:hover {
  color: var(--fg-2);
}
.tabs button.active {
  color: var(--fg);
  border-bottom-color: var(--accent);
}
.tab-count {
  font-size: 9.5px;
  padding: 0 4px;
  border-radius: 3px;
  background: #1a2330;
  color: var(--fg-3);
  font-family: var(--mono);
  min-width: 14px;
}
.tab-body {
  flex: 1;
  overflow-y: auto;
  padding: 0 14px 16px;
  min-height: 0;
}
.seal-list {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin-bottom: 8px;
}
.seal-item {
  padding: 8px 9px;
  border-radius: 6px;
  background: #0c131c;
  border: 1px solid var(--line);
  cursor: pointer;
  transition: border-color 0.15s;
}
.seal-item:hover {
  border-color: var(--line-2);
}
.seal-item.exceeded {
  border-color: rgba(228, 106, 74, 0.55);
  background: rgba(48, 22, 18, 0.55);
}
.seal-item.off {
  opacity: 0.6;
}
.seal-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 5px;
}
.seal-name {
  font-size: 11.5px;
  color: var(--fg);
}
.seal-state {
  font-size: 10px;
  color: var(--ok);
  white-space: nowrap;
}
.seal-state.bad {
  color: var(--danger);
  font-weight: 600;
}
.gauge-track {
  position: relative;
  height: 5px;
  border-radius: 3px;
  background: #17202b;
  overflow: hidden;
}
.gauge-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  transition: width 0.55s cubic-bezier(0.4, 0, 0.2, 1);
}
.gauge-mark {
  position: absolute;
  top: -1px;
  width: 1px;
  height: 7px;
  background: var(--warn);
}
.seal-stats {
  display: flex;
  justify-content: space-between;
  font-size: 9.5px;
  color: var(--fg-3);
  margin-top: 4px;
}
.seal-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}
.seal-flow {
  font-size: 10px;
  color: var(--fg-2);
}
.seal-edit {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9.5px;
  color: var(--fg-3);
}
.seal-edit .num {
  width: 58px;
  padding: 2px 5px;
  font-size: 10px;
}
.equip-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.equip-item {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 7px 9px;
  background: #0c131c;
  border: 1px solid var(--line);
  border-radius: 5px;
  font-size: 11px;
}
.eq-name {
  color: var(--fg-2);
}
.eq-val {
  color: var(--fg);
  font-size: 10.5px;
}
.branch-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.branch-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 9px;
  border-radius: 5px;
  background: #0c131c;
  border: 1px solid var(--line);
  text-align: left;
  transition: 0.14s;
}
.branch-item:hover {
  border-color: var(--line-2);
}
.branch-item.active {
  border-color: rgba(224, 165, 63, 0.6);
  background: rgba(40, 32, 18, 0.6);
}
.branch-item.muted {
  opacity: 0.45;
}
.br-name {
  flex: 1;
  font-size: 11px;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.br-flow {
  font-size: 10.5px;
  color: var(--fg-2);
}
.br-fill {
  font-size: 9.5px;
  padding: 2px 5px;
  border-radius: 3px;
  color: #0a0e14;
  font-weight: 600;
  white-space: nowrap;
}
.seg-tools {
  display: flex;
  gap: 5px;
  margin-bottom: 8px;
  position: sticky;
  top: 44px;
  background: var(--bg-1);
  padding-bottom: 6px;
  z-index: 1;
}
.seg-search {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 5px;
  background: #0b1119;
  border: 1px solid var(--line);
  color: var(--fg);
  font-size: 11px;
}
.seg-search:focus {
  outline: none;
  border-color: var(--line-2);
}
.seg-tools select {
  padding: 5px 6px;
  border-radius: 5px;
  background: #0b1119;
  border: 1px solid var(--line);
  color: var(--fg-2);
  font-size: 10.5px;
}
.seg-table {
  display: flex;
  flex-direction: column;
}
.seg-head {
  display: grid;
  grid-template-columns: 1.1fr 0.5fr 0.9fr 0.6fr 1.1fr;
  gap: 4px;
  padding: 0 7px 5px;
  font-size: 9.5px;
  color: var(--fg-3);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.seg-row {
  display: grid;
  grid-template-columns: 1.1fr 0.5fr 0.9fr 0.6fr 1.1fr;
  gap: 4px;
  align-items: center;
  padding: 5px 7px;
  border-radius: 4px;
  text-align: left;
  font-size: 10.5px;
  border: 1px solid transparent;
}
.seg-row:hover {
  background: #131c27;
}
.seg-row.selected {
  background: #122029;
  border-color: rgba(71, 168, 216, 0.4);
}
.seg-row.closed {
  opacity: 0.42;
}
.seg-row.isolated {
  background: rgba(40, 32, 18, 0.42);
}
.sg-id {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--fg-2);
  min-width: 0;
}
.sg-id i {
  width: 3px;
  height: 12px;
  border-radius: 2px;
  flex-shrink: 0;
}
.sg-dn,
.sg-flow,
.sg-vel {
  color: var(--fg-3);
  text-align: right;
}
.sg-flow {
  color: var(--fg);
}
.sg-tier {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: flex-end;
}
.tier-pill {
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 3px;
  white-space: nowrap;
}
.dir {
  color: var(--ok);
  font-size: 12px;
  line-height: 1;
}
.dir.rev {
  color: var(--warn);
}
.param-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.param-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
}
.pr-name {
  width: 92px;
  flex-shrink: 0;
  color: var(--fg-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.param-row em {
  font-style: normal;
  width: 32px;
  text-align: right;
  color: var(--fg-3);
  font-size: 10px;
}
.closed-rules {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  background: #0c131c;
  border: 1px solid var(--line);
  border-radius: 5px;
}
.rule-check {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10.5px;
  color: var(--fg-2);
  cursor: pointer;
}
.rule-check input {
  accent-color: var(--accent-2);
}
.rule-tag {
  font-size: 9px;
  color: var(--fg-3);
}
.storage-box p {
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--fg-3);
  margin: 0 0 8px;
}
.storage-box code {
  font-family: var(--mono);
  font-size: 9.5px;
  background: #0b1119;
  padding: 1px 4px;
  border-radius: 3px;
  color: var(--fg-2);
}
.storage-actions {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.toast {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  padding: 9px 16px;
  border-radius: 7px;
  background: rgba(22, 32, 44, 0.96);
  border: 1px solid var(--line-2);
  color: var(--fg);
  font-size: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  z-index: 100;
}
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}

@media (max-width: 1380px) {
  .body {
    grid-template-columns: 258px minmax(0, 1fr) 306px;
  }
  .brand-text span {
    display: none;
  }
  .solve-chip {
    display: none;
  }
}

@media (max-width: 1080px) {
  .body {
    grid-template-columns: 232px minmax(0, 1fr);
  }
  .panel.right {
    display: none;
  }
  .panel.right.mobile-open {
    display: flex;
    position: fixed;
    right: 0;
    top: 56px;
    bottom: 0;
    width: min(340px, 88vw);
    z-index: 40;
    box-shadow: -16px 0 40px rgba(0, 0, 0, 0.55);
  }
  .viewport-overlay {
    display: none;
  }
}

@media (max-width: 760px) {
  .mobile-bar {
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--line);
    background: #0b1119;
    flex-shrink: 0;
  }
  .mb-btn {
    flex: 1;
    padding: 7px 8px;
    border-radius: 5px;
    border: 1px solid var(--line);
    background: #0f1620;
    color: var(--fg-2);
    font-size: 11px;
  }
  .mb-btn:active {
    background: #16202c;
  }
  .topbar {
    height: auto;
    flex-wrap: wrap;
    padding: 8px 10px;
    gap: 8px;
  }
  .brand-text h1 {
    font-size: 12.5px;
  }
  .conditions {
    order: 3;
    width: 100%;
    margin-left: 0;
  }
  .cond-btn {
    flex: 1;
    justify-content: center;
    padding: 6px 4px;
    font-size: 11.5px;
  }
  .topright {
    margin-left: auto;
  }
  .ghost-btn {
    padding: 5px 8px;
    font-size: 11px;
  }
  .body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
  }
  .panel.left {
    display: none;
  }
  .panel.left.mobile-open {
    display: flex;
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(300px, 86vw);
    z-index: 50;
    box-shadow: 16px 0 40px rgba(0, 0, 0, 0.55);
    padding-top: 8px;
  }
  .sliders-card {
    width: calc(100% - 24px);
    left: 12px;
    bottom: 12px;
  }
  .camera-tools {
    right: 10px;
    bottom: 96px;
  }
  .isolate-banner {
    top: 8px;
    width: calc(100% - 24px);
    justify-content: space-between;
  }
}
</style>
