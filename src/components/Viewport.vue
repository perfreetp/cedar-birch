<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { FloodScene } from '../three/FloodScene'
import { state, queryPoint } from '../core/store'

const emit = defineEmits<{ (e: 'scene-ready', scene: FloodScene): void }>()
const container = ref<HTMLElement | null>(null)
let scene: FloodScene | null = null
let downPos: { x: number; y: number } | null = null

onMounted(() => {
  scene = new FloodScene()
  scene.init(container.value!)
  emit('scene-ready', scene)
  // 数据集就绪后重建
  watch(
    () => state.meta,
    (meta) => {
      if (meta && state.terrain && scene) scene.build(meta, state.terrain)
    },
    { immediate: true },
  )
  watch(
    () => state.viewMode,
    (m) => scene?.setView(m),
  )
})

onBeforeUnmount(() => {
  scene?.dispose()
  scene = null
})

function onPointerDown(e: PointerEvent): void {
  downPos = { x: e.clientX, y: e.clientY }
}

async function onPointerUp(e: PointerEvent): Promise<void> {
  if (!downPos || !scene || !container.value) return
  const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
  downPos = null
  if (moved > 5 || !state.meta) return // 拖拽不触发查询
  const rect = container.value.getBoundingClientRect()
  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1
  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1
  const cell = scene.pick(nx, ny)
  if (cell) await queryPoint(cell.col, cell.row)
}

defineExpose({ getScene: () => scene })
</script>

<template>
  <div
    ref="container"
    class="viewport"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
  ></div>
</template>

<style scoped>
.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
}
.viewport :deep(canvas) {
  display: block;
}
</style>
