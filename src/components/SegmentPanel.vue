<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../state/store'

const rad2deg = (r: number) => (r * 180) / Math.PI
const deg2rad = (d: number) => (d * Math.PI) / 180

const selected = computed(() => store.segments.find((s) => s.id === store.selectedSegmentId) ?? null)

function patch(p: Record<string, number | string | boolean>) {
  if (selected.value) store.updateSegment(selected.value.id, p)
}

function craneName(id: string) {
  return store.cranes.find((c) => c.id === id)?.name ?? id
}
</script>

<template>
  <div class="section">
    <h2>
      坞区分段
      <button @click="store.addSegment()">+ 分段</button>
    </h2>
    <div
      v-for="s in store.segments"
      :key="s.id"
      class="card"
      :class="{ selected: s.id === store.selectedSegmentId }"
      @click="store.selectSegment(s.id)"
    >
      <div class="name">
        <span>{{ s.name }} {{ s.removed ? '· 已吊走' : '' }}</span>
        <span class="tag" :class="s.weightT >= 80 ? 'bad' : 'ok'">{{ s.weightT }}t</span>
      </div>
      <div class="sub">
        {{ s.length }}×{{ s.width }}×{{ s.height }}m · ({{ s.x.toFixed(1) }}, {{ s.z.toFixed(1) }})
      </div>
    </div>
  </div>

  <div class="section" v-if="selected">
    <h2>分段参数</h2>
    <div class="field">
      <label>名称</label>
      <input
        type="text"
        :value="selected.name"
        @change="(e) => patch({ name: (e.target as HTMLInputElement).value })"
      />
    </div>
    <div class="field">
      <label>重量 <span>{{ selected.weightT }} t</span></label>
      <input
        type="range"
        min="5"
        max="200"
        step="5"
        :value="selected.weightT"
        @input="(e) => patch({ weightT: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>长 <span>{{ selected.length }} m</span></label>
      <input
        type="range"
        min="4"
        max="30"
        step="1"
        :value="selected.length"
        @input="(e) => patch({ length: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>宽 <span>{{ selected.width }} m</span></label>
      <input
        type="range"
        min="3"
        max="20"
        step="1"
        :value="selected.width"
        @input="(e) => patch({ width: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>高度 <span>{{ selected.height }} m</span></label>
      <input
        type="range"
        min="2"
        max="15"
        step="0.5"
        :value="selected.height"
        @input="(e) => patch({ height: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>旋转 <span>{{ rad2deg(selected.rotationY).toFixed(0) }}°</span></label>
      <input
        type="range"
        min="-180"
        max="180"
        step="5"
        :value="rad2deg(selected.rotationY)"
        @input="(e) => patch({ rotationY: deg2rad(Number((e.target as HTMLInputElement).value)) })"
      />
    </div>
    <div class="btn-row">
      <button class="danger" @click="store.removeSegment(selected.id)">删除分段</button>
    </div>
  </div>

  <div class="section">
    <h2>可达性判定</h2>
    <div v-if="store.segmentReports.length === 0" class="hint">所有分段均已吊走。</div>
    <div v-for="r in store.segmentReports" :key="r.segmentId" class="report-item">
      <div class="name" style="font-size: 13px">
        {{ store.segments.find((s) => s.id === r.segmentId)?.name }}
        <span class="tag" :class="r.feasible ? 'ok' : 'bad'">
          {{ r.feasible ? '可吊装' : '不可行' }}
        </span>
        <span v-if="r.coopCapable" class="tag coop">协同</span>
      </div>
      <div class="reasons">
        <div v-if="r.soloCapableCraneIds.length">
          单机可吊：{{ r.soloCapableCraneIds.map(craneName).join('、') }}
        </div>
        <div v-else-if="r.reachableCraneIds.length">
          可达吊车：{{ r.reachableCraneIds.map(craneName).join('、') }}（单机容量不足）
        </div>
        <div v-for="(reason, i) in r.reasons" :key="i">· {{ reason }}</div>
      </div>
    </div>
  </div>
</template>
