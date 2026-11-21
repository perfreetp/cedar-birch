<script setup lang="ts">
import { computed } from 'vue'
import { store } from '../state/store'

const ordered = computed(() =>
  [...store.segments].filter((s) => s.sequence > 0).sort((a, b) => a.sequence - b.sequence)
)
const unsequenced = computed(() => store.segments.filter((s) => s.sequence === 0))

function move(id: string, delta: number) {
  const ids = ordered.value.map((s) => s.id)
  const i = ids.indexOf(id)
  const j = i + delta
  if (j < 0 || j >= ids.length) return
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  store.setSequenceOrder(ids)
}

function addToSequence(id: string) {
  const maxSeq = Math.max(0, ...store.segments.map((s) => s.sequence))
  store.updateSegment(id, { sequence: maxSeq + 1 })
}

function liftNext() {
  const seg = store.liftNext()
  if (seg) {
    // 移走后域体由 store.refresh 联动重算，碰撞提示同步更新
  }
}
</script>

<template>
  <div class="section">
    <h2>吊装顺序</h2>
    <div class="btn-row" style="margin-bottom: 8px">
      <button class="primary" :disabled="ordered.every((s) => s.removed)" @click="liftNext">
        吊走下一段
      </button>
      <button @click="store.resetSequence()">全部复位</button>
    </div>

    <div v-for="s in ordered" :key="s.id" class="seq-row" :class="{ done: s.removed }">
      <span class="idx">{{ s.sequence }}</span>
      <div class="grow">
        <div>{{ s.name }} · {{ s.weightT }}t</div>
        <div class="sub" style="color: var(--muted); font-size: 11px">
          {{ s.removed ? '已吊走，可达域已释放' : '待吊装' }}
        </div>
      </div>
      <button :disabled="s.removed || s.sequence === 1" @click="move(s.id, -1)">↑</button>
      <button :disabled="s.removed || s.sequence === ordered.length" @click="move(s.id, 1)">↓</button>
    </div>

    <div v-if="unsequenced.length" style="margin-top: 10px">
      <h2>未排入序列</h2>
      <div v-for="s in unsequenced" :key="s.id" class="seq-row">
        <div class="grow">{{ s.name }} · {{ s.weightT }}t</div>
        <button @click="addToSequence(s.id)">排入</button>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>碰撞提示</h2>
    <div v-if="store.collisions.length === 0" class="hint">当前布局无碰撞。</div>
    <div v-for="(c, i) in store.collisions" :key="i" class="collision-item">{{ c.message }}</div>
  </div>
</template>
