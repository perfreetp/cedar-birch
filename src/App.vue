<script setup lang="ts">
import { onMounted } from 'vue'
import Viewport from './components/Viewport.vue'
import Timeline from './components/Timeline.vue'
import ControlPanel from './components/ControlPanel.vue'
import { state, restoreFromLocal } from './core/store'

onMounted(async () => {
  // 启动时尝试从浏览器本地存储恢复上次的数据集
  const ok = await restoreFromLocal()
  if (!ok) {
    // 无本地数据时自动加载演示数据
    const { loadDemo } = await import('./core/store')
    await loadDemo()
  }
  // 测试/分享用 URL 参数:?frame=20&play=1&view=top
  const q = new URLSearchParams(location.search)
  const { seek, state: s } = await import('./core/store')
  if (q.has('frame')) seek(parseFloat(q.get('frame')!))
  if (q.get('view') === 'top' || q.get('view') === 'oblique') s.viewMode = q.get('view') as 'top' | 'oblique'
  if (q.get('play') === '1') s.playing = true
  // 就绪标志(自动化测试用)
  setTimeout(() => ((window as unknown as Record<string, unknown>).__floodReady = true), 1200)
})
</script>

<template>
  <div class="app">
    <Viewport />
    <ControlPanel />
    <Timeline />
    <div v-if="state.loading" class="overlay">
      <div class="spinner"></div>
      <div>{{ state.loadMessage || '加载中…' }}</div>
    </div>
  </div>
</template>

<style>
html,
body,
#app {
  margin: 0;
  height: 100%;
  overflow: hidden;
  background: #0e141b;
  font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif;
}
.app {
  position: relative;
  width: 100%;
  height: 100%;
}
.overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  background: rgba(14, 20, 27, 0.7);
  color: #7fd4ff;
  font-size: 14px;
  z-index: 20;
  pointer-events: none;
}
.spinner {
  width: 34px;
  height: 34px;
  border: 3px solid rgba(127, 212, 255, 0.25);
  border-top-color: #7fd4ff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
