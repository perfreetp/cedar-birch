<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { DockScene, type ScreenLabel } from './babylon/DockScene'
import { store } from './state/store'
import { downloadLayout, pickLayoutFile } from './utils/file'
import LegendBar from './components/LegendBar.vue'
import CranePanel from './components/CranePanel.vue'
import SegmentPanel from './components/SegmentPanel.vue'
import SequencePanel from './components/SequencePanel.vue'
import { registerDockScene } from './main'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const engineKind = ref<'webgpu' | 'webgl2'>('webgl2')
const labels = ref<ScreenLabel[]>([])
const importError = ref('')
const importing = reactive({ gridSize: store.gridSize })

let scene: DockScene | null = null
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  if (!canvasRef.value) return
  scene = new DockScene(canvasRef.value)
  engineKind.value = await scene.init()
  registerDockScene(scene)
  unsubscribe = scene.onLabels((next) => {
    labels.value = next
  })
  // store 数据变化 -> 同步场景（拖拽、滑杆、序列移走都会走这里）
  store.subscribe(() => scene?.syncAll())
})

onBeforeUnmount(() => {
  unsubscribe?.()
  scene?.dispose()
})

function doExport() {
  downloading.value = true
  try {
    downloadLayout(store.exportLayout())
  } finally {
    setTimeout(() => (downloading.value = false), 400)
  }
}

const downloading = ref(false)

async function doImport() {
  importError.value = ''
  const layout = await pickLayoutFile()
  if (!layout) {
    importError.value = '文件解析失败，请选择本工具导出的 JSON'
    return
  }
  const ok = store.importLayout(layout)
  if (!ok) importError.value = '布局文件版本不兼容'
}

function applyGrid() {
  if (importing.gridSize < 1 || importing.gridSize > 8) return
  store.gridSize = importing.gridSize
  store.refresh()
}

watch(
  () => store.gridSize,
  (v) => (importing.gridSize = v)
)
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <h1>船厂坞区 · 吊车可达域体渲染工具</h1>
      <span class="engine-badge" :class="{ webgpu: engineKind === 'webgpu' }">
        {{ engineKind === 'webgpu' ? 'WebGPU 引擎' : 'WebGL2 回退' }}
      </span>
      <span class="tag">网格 {{ store.gridSize }}m</span>
      <LegendBar />
      <div class="spacer"></div>
      <div class="field" style="margin: 0; display: flex; align-items: center; gap: 6px">
        <label style="margin: 0">网格精度</label>
        <input
          type="number"
          min="1"
          max="8"
          step="0.5"
          v-model.number="importing.gridSize"
          style="width: 64px"
        />
        <button @click="applyGrid">应用</button>
      </div>
      <button class="primary" :disabled="downloading" @click="doExport">导出布局</button>
      <button @click="doImport">导入布局</button>
    </header>

    <aside class="side">
      <CranePanel />
    </aside>

    <main class="viewport">
      <canvas ref="canvasRef"></canvas>
      <div class="label-layer">
        <div
          v-for="l in labels"
          :key="l.id + l.kind"
          v-show="l.visible"
          class="scene-label"
          :class="l.kind"
          :style="{ left: l.x + 'px', top: l.y + 'px' }"
        >
          {{ l.text }}
        </div>
      </div>
      <div
        v-if="importError"
        style="
          position: absolute;
          top: 12px;
          left: 50%;
          transform: translateX(-50%);
          background: rgba(122, 42, 60, 0.92);
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
        "
      >
        {{ importError }}
      </div>
      <div
        style="
          position: absolute;
          bottom: 10px;
          left: 12px;
          font-size: 12px;
          color: var(--muted);
          background: rgba(12, 17, 24, 0.7);
          padding: 6px 10px;
          border-radius: 6px;
          line-height: 1.6;
        "
      >
        左键拖拽吊车/分段改变位置 · 鼠标左键空白处旋转视角 · 滚轮缩放 · 右键平移
      </div>
    </main>

    <aside class="side right">
      <SequencePanel />
      <SegmentPanel />
    </aside>
  </div>
</template>
