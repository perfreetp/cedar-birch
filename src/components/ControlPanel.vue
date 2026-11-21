<script setup lang="ts">
import { computed, ref } from 'vue'
import { state, loadDemo, loadFromFiles, clearLocal, currentFrameIndex } from '../core/store'
import { frameCache } from '../core/frameCache'
import { exportDepthASC, exportExtentGeoJSON } from '../core/exporter'

const terrainInput = ref<HTMLInputElement | null>(null)
const framesInput = ref<HTMLInputElement | null>(null)
const terrainFile = ref<File | null>(null)
const frameFiles = ref<File[]>([])
const intervalSec = ref(600)
const errorMsg = ref('')
const exporting = ref(false)
const collapsed = ref(false)

const hasData = computed(() => !!state.meta)
const picked = computed(() => state.picked)

function onTerrainChange(e: Event): void {
  terrainFile.value = (e.target as HTMLInputElement).files?.[0] ?? null
}
function onFramesChange(e: Event): void {
  frameFiles.value = Array.from((e.target as HTMLInputElement).files ?? [])
}

async function onLoadFiles(): Promise<void> {
  errorMsg.value = ''
  if (!terrainFile.value) {
    errorMsg.value = '请先选择地形文件(.asc / .tif)'
    return
  }
  if (!frameFiles.value.length) {
    errorMsg.value = '请选择至少一个水深帧文件'
    return
  }
  try {
    await loadFromFiles(terrainFile.value, frameFiles.value, intervalSec.value)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

async function onDemo(): Promise<void> {
  errorMsg.value = ''
  try {
    await loadDemo()
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  }
}

async function onClearLocal(): Promise<void> {
  await clearLocal()
  alert('已清除浏览器本地缓存的数据')
}

async function currentFrameData(): Promise<Float32Array | null> {
  return frameCache.getFrameData(currentFrameIndex.value)
}

async function onExportDepth(): Promise<void> {
  if (!state.meta) return
  exporting.value = true
  try {
    const data = await currentFrameData()
    if (data) exportDepthASC(data, state.meta, currentFrameIndex.value)
  } finally {
    exporting.value = false
  }
}

async function onExportExtent(): Promise<void> {
  if (!state.meta) return
  exporting.value = true
  try {
    const data = await currentFrameData()
    if (data) exportExtentGeoJSON(data, state.meta, currentFrameIndex.value)
  } finally {
    exporting.value = false
  }
}

function fmtTime(sec: number): string {
  if (sec < 0) return '未淹没'
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `T+${h}h ${m}m` : `T+${m}m`
}
</script>

<template>
  <div class="panel" :class="{ collapsed }">
    <div class="panel-header" @click="collapsed = !collapsed">
      <span class="title">溃坝洪水演进三维渲染</span>
      <span class="toggle">{{ collapsed ? '▸' : '▾' }}</span>
    </div>

    <div v-show="!collapsed" class="panel-body">
      <!-- 数据加载 -->
      <section>
        <h4>数据</h4>
        <div class="row">
          <button class="btn primary" :disabled="state.loading" @click="onDemo">加载演示数据</button>
          <span v-if="state.restored" class="tag">已从本地恢复</span>
        </div>
        <details class="custom-load">
          <summary>导入自定义栅格</summary>
          <label class="file-label">
            地形 (.asc/.tif)
            <input ref="terrainInput" type="file" accept=".asc,.txt,.tif,.tiff" @change="onTerrainChange" />
          </label>
          <label class="file-label">
            水深帧序列(多选,按文件名排序)
            <input ref="framesInput" type="file" multiple accept=".asc,.txt,.tif,.tiff" @change="onFramesChange" />
          </label>
          <label class="file-label">
            帧间隔(秒)
            <input v-model.number="intervalSec" type="number" min="1" class="num" />
          </label>
          <button class="btn" :disabled="state.loading" @click="onLoadFiles">导入并渲染</button>
        </details>
        <div v-if="state.loading" class="loading">{{ state.loadMessage || '处理中…' }}</div>
        <div v-if="errorMsg" class="error">{{ errorMsg }}</div>
        <div v-if="state.meta" class="meta">
          <div>{{ state.meta.name }}</div>
          <div>{{ state.meta.width }}×{{ state.meta.height }} · {{ state.meta.frameCount }} 帧 · 像元 {{ state.meta.cellSize }}m</div>
          <div>最大水深 {{ state.meta.maxDepth.toFixed(2) }} m</div>
          <button class="btn small" @click="onClearLocal">清除本地缓存</button>
        </div>
      </section>

      <!-- 点击查询 -->
      <section v-if="hasData">
        <h4>点位查询 <span class="hint">(点击场景任意位置)</span></h4>
        <div v-if="picked" class="picked">
          <div class="kv"><span>坐标</span><b>{{ picked.x.toFixed(1) }}, {{ picked.y.toFixed(1) }}</b></div>
          <div class="kv"><span>地面高程</span><b>{{ picked.elev.toFixed(2) }} m</b></div>
          <div class="kv"><span>当前水深</span><b :class="{ wet: picked.depth >= 0.05 }">{{ picked.depth.toFixed(2) }} m</b></div>
          <div class="kv"><span>到达时间</span><b>{{ fmtTime(picked.arrivalTime) }}</b></div>
        </div>
        <div v-else class="hint">尚未选择点位</div>
      </section>

      <!-- 导出 -->
      <section v-if="hasData">
        <h4>导出当前时刻(帧 {{ currentFrameIndex + 1 }})</h4>
        <div class="row">
          <button class="btn" :disabled="exporting" @click="onExportDepth">水深栅格 (.asc)</button>
          <button class="btn" :disabled="exporting" @click="onExportExtent">淹没范围 (.geojson)</button>
        </div>
      </section>

      <!-- 色带图例 -->
      <section v-if="hasData">
        <h4>水深色带(m)</h4>
        <div class="legend">
          <div class="bar"></div>
          <div class="ticks">
            <span>0.5</span><span>1.0</span><span>1.5</span><span>2.0</span><span>3.0</span><span>≥5.0</span>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: absolute;
  top: 14px;
  left: 14px;
  width: 300px;
  max-width: calc(100vw - 28px);
  background: rgba(14, 20, 27, 0.85);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(120, 160, 200, 0.25);
  border-radius: 10px;
  color: #d7e3f0;
  font-size: 13px;
  z-index: 5;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
}
.title {
  font-weight: 600;
  font-size: 14px;
}
.toggle {
  color: #8fa8bf;
}
.panel-body {
  padding: 0 14px 12px;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
}
section {
  border-top: 1px solid rgba(120, 160, 200, 0.15);
  padding: 8px 0;
}
h4 {
  margin: 4px 0 8px;
  font-size: 12px;
  color: #8fa8bf;
  font-weight: 600;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.btn {
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.35);
  color: #cfe8f7;
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 13px;
}
.btn:hover:not(:disabled) {
  background: rgba(79, 195, 247, 0.25);
}
.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.btn.primary {
  background: #2f81b7;
  border-color: #4fc3f7;
  color: #fff;
}
.btn.small {
  font-size: 11px;
  padding: 3px 8px;
  margin-top: 6px;
}
.tag {
  font-size: 11px;
  color: #9ccc65;
}
.custom-load {
  margin-top: 8px;
}
.custom-load summary {
  cursor: pointer;
  color: #9fc6e8;
  margin-bottom: 6px;
}
.file-label {
  display: block;
  margin: 6px 0;
  color: #aebfcf;
  font-size: 12px;
}
.file-label input[type='file'] {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  max-width: 100%;
}
.num {
  width: 90px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(120, 160, 200, 0.3);
  color: #d7e3f0;
  border-radius: 4px;
  padding: 3px 6px;
  margin-left: 6px;
}
.loading {
  color: #7fd4ff;
  margin-top: 6px;
}
.error {
  color: #ef9a9a;
  margin-top: 6px;
}
.meta {
  margin-top: 8px;
  color: #aebfcf;
  font-size: 12px;
  line-height: 1.6;
}
.hint {
  color: #7b8fa3;
  font-size: 11px;
  font-weight: 400;
}
.picked .kv {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
}
.picked .kv span {
  color: #8fa8bf;
}
.picked .kv b {
  font-variant-numeric: tabular-nums;
}
.picked .kv b.wet {
  color: #7fd4ff;
}
.legend .bar {
  height: 12px;
  border-radius: 3px;
  background: linear-gradient(to right, #9edbf2, #66b8eb, #408fe0, #2456d1, #1242b8, #08218c);
}
.legend .ticks {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #8fa8bf;
  margin-top: 3px;
}
</style>
