<script setup lang="ts">
import { computed } from 'vue'
import { state, SPEEDS, togglePlay, stepFrame, seek, setSpeed, currentTime, currentArea, frameCount, currentFrameIndex } from '../core/store'

const timeText = computed(() => formatTime(currentTime.value))
const areaText = computed(() => {
  const a = currentArea.value
  return a >= 1e6 ? `${(a / 1e6).toFixed(2)} km²` : `${(a / 1e4).toFixed(2)} 万m²`
})
const progress = computed(() => (frameCount.value > 1 ? state.currentFrame / (frameCount.value - 1) : 0))

// 面积过程线(简单 SVG sparkline)
const areaPath = computed(() => {
  const areas = state.meta?.areas
  if (!areas || !areas.length) return ''
  const max = Math.max(...areas, 1)
  const W = 100
  const H = 26
  const pts = areas.map((a, i) => `${((i / (areas.length - 1)) * W).toFixed(1)},${(H - (a / max) * (H - 2) - 1).toFixed(1)}`)
  return `M${pts.join(' L')}`
})

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

function onSeek(e: Event): void {
  seek(parseFloat((e.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="timeline" v-if="state.meta">
    <!-- 淹没面积显示(时间轴上方) -->
    <div class="area-row">
      <div class="area-box">
        <span class="label">当前淹没面积</span>
        <span class="value">{{ areaText }}</span>
      </div>
      <svg class="area-chart" viewBox="0 0 100 26" preserveAspectRatio="none">
        <path :d="areaPath" fill="none" stroke="#4fc3f7" stroke-width="1.2" vector-effect="non-scaling-stroke" />
        <line
          v-if="frameCount > 1"
          :x1="progress * 100"
          :x2="progress * 100"
          y1="0"
          y2="26"
          stroke="#ffd54f"
          stroke-width="1"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="time-box">
        <span class="label">T+</span>
        <span class="value">{{ timeText }}</span>
        <span class="frame">帧 {{ currentFrameIndex + 1 }}/{{ frameCount }}</span>
      </div>
    </div>

    <input
      class="slider"
      type="range"
      :min="0"
      :max="frameCount - 1"
      :step="0.05"
      :value="state.currentFrame"
      @input="onSeek"
    />

    <div class="controls">
      <button class="btn" title="上一帧" @click="stepFrame(-1)">⏮</button>
      <button class="btn play" :title="state.playing ? '暂停' : '播放'" @click="togglePlay">
        {{ state.playing ? '⏸' : '▶' }}
      </button>
      <button class="btn" title="下一帧" @click="stepFrame(1)">⏭</button>
      <div class="speeds">
        <button
          v-for="(s, i) in SPEEDS"
          :key="s.value"
          class="btn speed"
          :class="{ active: state.speedIndex === i }"
          @click="setSpeed(i)"
        >
          {{ s.label }}
        </button>
      </div>
      <div class="views">
        <button class="btn" :class="{ active: state.viewMode === 'top' }" @click="state.viewMode = 'top'">俯视</button>
        <button class="btn" :class="{ active: state.viewMode === 'oblique' }" @click="state.viewMode = 'oblique'">斜视</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 14px;
  background: rgba(14, 20, 27, 0.82);
  backdrop-filter: blur(6px);
  border: 1px solid rgba(120, 160, 200, 0.25);
  border-radius: 10px;
  padding: 10px 14px 12px;
  color: #d7e3f0;
  user-select: none;
}
.area-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 6px;
}
.area-box,
.time-box {
  display: flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}
.label {
  font-size: 12px;
  color: #8fa8bf;
}
.value {
  font-size: 18px;
  font-weight: 600;
  color: #7fd4ff;
  font-variant-numeric: tabular-nums;
}
.frame {
  font-size: 12px;
  color: #8fa8bf;
}
.area-chart {
  flex: 1;
  height: 26px;
  min-width: 0;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 4px;
}
.slider {
  width: 100%;
  accent-color: #4fc3f7;
  margin: 2px 0 8px;
}
.controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.btn {
  background: rgba(79, 195, 247, 0.12);
  border: 1px solid rgba(79, 195, 247, 0.35);
  color: #cfe8f7;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 14px;
  cursor: pointer;
}
.btn:hover {
  background: rgba(79, 195, 247, 0.25);
}
.btn.active {
  background: #2f81b7;
  border-color: #4fc3f7;
  color: #fff;
}
.play {
  font-size: 16px;
  min-width: 44px;
}
.speeds,
.views {
  display: flex;
  gap: 6px;
  margin-left: 12px;
}
.speed {
  font-size: 12px;
}
</style>
