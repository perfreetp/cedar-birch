<script lang="ts">
  import {
    deployAll,
    durationStore,
    foldAll,
    pause,
    play,
    playStore,
    seek,
    setManualAngle,
    setSpeed
  } from '../lib/stores'
  import { SLIDER_STEPS } from '../lib/deploy'
  import { downloadDataURL } from '../lib/export'

  /** 由 App 绑定的场景截图函数 */
  export let captureScene: () => string

  $: p = $playStore
  $: total = $durationStore
  $: progress = total > 0 ? Math.min(1, p.simTime / total) : 0
  $: statusText =
    p.mode === 'playing'
      ? '时序展开中'
      : p.mode === 'paused'
        ? '已暂停（时间轴）'
        : '手动构型模式'

  function onSlider(e: Event) {
    setManualAngle(Number((e.target as HTMLInputElement).value))
  }

  function onSeek(e: Event) {
    seek(Number((e.target as HTMLInputElement).value))
  }

  function snapshot() {
    const url = captureScene()
    if (url) downloadDataURL('solar-wing-pose.png', url)
  }
</script>

<div class="deploy-bar">
  <div class="deploy-row">
    <button class="primary" on:click={() => play()} disabled={p.mode === 'playing'}>
      ▶ 播放时序
    </button>
    <button on:click={() => pause()} disabled={p.mode !== 'playing'}>⏸ 暂停</button>
    <button class="warn" on:click={foldAll}>⮌ 折叠收拢</button>
    <button class="primary" on:click={deployAll}>⮎ 全展开</button>

    <label class="row" style="gap:6px">
      <span class="dim">倍速</span>
      <select
        value={p.speed}
        on:change={(e) => setSpeed(Number(e.currentTarget.value))}
        style="width:auto"
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
    </label>

    <button on:click={snapshot}>📷 导出姿态 PNG</button>
    <span class="spacer"></span>
    <span class="tag">{statusText}</span>
  </div>

  <div class="deploy-row">
    <div class="slider-stack">
      <label for="manual-angle">
        手动展开角（5 档步进：0–180°）—
        <strong style="color:var(--accent-2)">{p.manualAngle}°</strong>
      </label>
      <input
        id="manual-angle"
        type="range"
        min="0"
        max="180"
        step="45"
        value={p.manualAngle}
        on:input={onSlider}
      />
      <div class="tick-row">
        {#each SLIDER_STEPS as deg}
          <span>{deg}°</span>
        {/each}
      </div>
    </div>

    <div class="slider-stack">
      <label for="time-seek">
        时间轴 —
        <strong style="color:var(--accent)">{p.simTime.toFixed(2)}s</strong>
        / {total.toFixed(2)}s（{(progress * 100).toFixed(0)}%）
      </label>
      <input
        id="time-seek"
        type="range"
        min="0"
        max={Math.max(total, 0.001)}
        step="0.01"
        value={Math.min(p.simTime, total)}
        on:input={onSeek}
      />
      <div class="tick-row">
        <span>0s</span>
        <span>{total.toFixed(1)}s</span>
      </div>
    </div>
  </div>
</div>
