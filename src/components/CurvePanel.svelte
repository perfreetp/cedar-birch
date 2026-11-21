<script lang="ts">
  import AngleChart from './AngleChart.svelte'
  import { configStore, currentAngles, playStore } from '../lib/stores'
  import { sampleCurve } from '../lib/deploy'
  import { buildPayload, exportCsv, exportJson } from '../lib/export'
  import { hingeColor } from '../lib/ui/colors'

  let chart: AngleChart

  $: cfg = $configStore
  $: play = $playStore
  // 构型/时序变化即重采样曲线
  $: curve = sampleCurve(cfg, 0.05)
  $: angles = $currentAngles
  $: isManual = play.mode === 'manual'

  function exportAll() {
    const payload = buildPayload(cfg, play.simTime, angles, curve)
    exportJson(payload)
  }
</script>

<div>
  <div class="section-title">角度-时间曲线</div>
  <div class="legend">
    {#each cfg.hinges as h, i (h.id)}
      <span class="legend-item">
        <span class="legend-dot" style="background:{hingeColor(i)}"></span>
        铰链 {i + 1}
      </span>
    {/each}
  </div>

  <AngleChart
    bind:this={chart}
    {curve}
    seriesCount={cfg.hinges.length}
    currentTime={play.simTime}
    manualAngle={isManual ? play.manualAngle : null}
  />

  <div class="btn-row">
    <button class="primary" on:click={exportAll}>导出姿态+曲线 JSON</button>
    <button on:click={() => exportCsv(curve)}>导出曲线 CSV</button>
    <button on:click={() => chart.savePng()}>导出曲线 PNG</button>
  </div>

  <div class="section-title">当前铰链角度</div>
  <div class="card">
    <table class="timing">
      <thead>
        <tr><th>铰链</th><th>展开角</th><th>局部转角</th><th>状态</th></tr>
      </thead>
      <tbody>
        {#each angles as a, i}
          <tr>
            <td>
              <span class="legend-dot" style="background:{hingeColor(i)};display:inline-block;margin-right:5px"></span>
              H{i + 1}
            </td>
            <td>{a.toFixed(1)}°</td>
            <td>{(180 - a).toFixed(1)}°</td>
            <td class="dim">
              {a <= 0.05 ? '折叠' : a >= 179.95 ? '全展开' : '展开中'}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="dim" style="margin-bottom:0">
      局部转角 = 180° − 展开角，即铰链绕自身铰链轴（局部 Z 轴）的书页式翻转角。
    </p>
  </div>
</div>
