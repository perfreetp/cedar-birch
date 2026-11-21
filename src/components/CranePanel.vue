<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../state/store'
import type { GantryCrane, PortalCrane } from '../types'

const rad2deg = (r: number) => (r * 180) / Math.PI
const deg2rad = (d: number) => (d * Math.PI) / 180

const selected = computed(() => store.cranes.find((c) => c.id === store.selectedCraneId) ?? null)
const gantry = computed(() => (selected.value?.kind === 'gantry' ? (selected.value as GantryCrane) : null))
const portal = computed(() => (selected.value?.kind === 'portal' ? (selected.value as PortalCrane) : null))

function patch(p: Record<string, number | string | boolean>) {
  if (selected.value) store.updateCrane(selected.value.id, p)
}
</script>

<template>
  <div class="section">
    <h2>
      吊车列表
      <button @click="store.addCrane('gantry')">+ 龙门吊</button>
    </h2>
    <div
      v-for="c in store.cranes"
      :key="c.id"
      class="card"
      :class="{ selected: c.id === store.selectedCraneId }"
      @click="store.selectCrane(c.id)"
    >
      <div class="name">
        <span>{{ c.name }}</span>
        <label class="tag" @click.stop>
          <input
            type="checkbox"
            :checked="c.enabled"
            @change="store.updateCrane(c.id, { enabled: !c.enabled })"
          />
          启用
        </label>
      </div>
      <div class="sub">
        {{ c.kind === 'gantry' ? '龙门吊' : '门座吊' }} · 额定 {{ c.capacityT }}t ·
        ({{ c.x.toFixed(1) }}, {{ c.z.toFixed(1) }})
      </div>
    </div>
    <button style="width: 100%" @click="store.addCrane('portal')">+ 门座吊</button>
  </div>

  <div class="section" v-if="selected">
    <h2>参数 · {{ selected.name }}</h2>
    <div class="field">
      <label>名称</label>
      <input
        type="text"
        :value="selected.name"
        @change="(e) => patch({ name: (e.target as HTMLInputElement).value })"
      />
    </div>
    <div class="field">
      <label>额定起重量 <span>{{ selected.capacityT }} t</span></label>
      <input
        type="range"
        min="10"
        max="200"
        step="5"
        :value="selected.capacityT"
        @input="(e) => patch({ capacityT: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>最大起升高度 <span>{{ selected.liftHeight }} m</span></label>
      <input
        type="range"
        min="10"
        max="60"
        step="1"
        :value="selected.liftHeight"
        @input="(e) => patch({ liftHeight: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>位置 X <span>{{ selected.x.toFixed(1) }} m</span></label>
      <input
        type="range"
        :min="-store.dockWidth / 2"
        :max="store.dockWidth / 2"
        step="0.5"
        :value="selected.x"
        @input="(e) => patch({ x: Number((e.target as HTMLInputElement).value) })"
      />
    </div>
    <div class="field">
      <label>位置 Z <span>{{ selected.z.toFixed(1) }} m</span></label>
      <input
        type="range"
        :min="-store.dockLength / 2"
        :max="store.dockLength / 2"
        step="0.5"
        :value="selected.z"
        @input="(e) => patch({ z: Number((e.target as HTMLInputElement).value) })"
      />
    </div>

    <template v-if="gantry">
      <div class="field">
        <label>轨道长度 <span>{{ gantry.railLength }} m</span></label>
        <input
          type="range"
          min="12"
          max="70"
          step="1"
          :value="gantry.railLength"
          @input="(e) => patch({ railLength: Number((e.target as HTMLInputElement).value) })"
        />
      </div>
      <div class="field">
        <label>门架跨距 <span>{{ gantry.span }} m</span></label>
        <input
          type="range"
          min="6"
          max="40"
          step="1"
          :value="gantry.span"
          @input="(e) => patch({ span: Number((e.target as HTMLInputElement).value) })"
        />
      </div>
      <div class="field">
        <label>轨道方向 <span>{{ rad2deg(gantry.railAngle).toFixed(0) }}°</span></label>
        <input
          type="range"
          min="0"
          max="180"
          step="1"
          :value="rad2deg(gantry.railAngle)"
          @input="(e) => patch({ railAngle: deg2rad(Number((e.target as HTMLInputElement).value)) })"
        />
      </div>
      <div class="field">
        <label>远端容量折减系数 <span>{{ gantry.endFactor.toFixed(2) }}</span></label>
        <input
          type="range"
          min="0.3"
          max="1"
          step="0.05"
          :value="gantry.endFactor"
          @input="(e) => patch({ endFactor: Number((e.target as HTMLInputElement).value) })"
        />
      </div>
    </template>

    <template v-if="portal">
      <div class="field">
        <label>臂长 <span>{{ portal.boomLength }} m</span></label>
        <input
          type="range"
          min="12"
          max="55"
          step="1"
          :value="portal.boomLength"
          @input="(e) => patch({ boomLength: Number((e.target as HTMLInputElement).value) })"
        />
      </div>
      <div class="field">
        <label>臂架俯角 <span>{{ rad2deg(portal.boomAngle).toFixed(0) }}°</span></label>
        <input
          type="range"
          min="10"
          max="70"
          step="1"
          :value="rad2deg(portal.boomAngle)"
          @input="(e) => patch({ boomAngle: deg2rad(Number((e.target as HTMLInputElement).value)) })"
        />
      </div>
      <div class="field">
        <label>最小作业半径 <span>{{ portal.minRadius }} m</span></label>
        <input
          type="range"
          min="2"
          max="15"
          step="0.5"
          :value="portal.minRadius"
          @input="(e) => patch({ minRadius: Number((e.target as HTMLInputElement).value) })"
        />
      </div>
      <div class="field">
        <label>回转起始角 <span>{{ rad2deg(portal.slewStart).toFixed(0) }}°</span></label>
        <input
          type="range"
          min="-180"
          max="180"
          step="5"
          :value="rad2deg(portal.slewStart)"
          @input="(e) => patch({ slewStart: deg2rad(Number((e.target as HTMLInputElement).value)) })"
        />
      </div>
      <div class="field">
        <label>回转扫掠角 <span>{{ rad2deg(portal.slewRange).toFixed(0) }}°</span></label>
        <input
          type="range"
          min="30"
          max="360"
          step="5"
          :value="rad2deg(portal.slewRange)"
          @input="(e) => patch({ slewRange: deg2rad(Number((e.target as HTMLInputElement).value)) })"
        />
      </div>
    </template>

    <div class="btn-row">
      <button class="danger" @click="store.removeCrane(selected.id)">删除吊车</button>
    </div>
  </div>

  <div class="hint" v-else>
    在 3D 视口中拖拽吊车移动，或点击列表选中后用滑块精确调整参数。可达域体将实时重算。
  </div>
</template>
