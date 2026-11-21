<script lang="ts">
  import { configStore, durationStore, mutateConfig } from '../lib/stores'
  import { FULL_ANGLE } from '../lib/deploy'
  import { hingeColor } from '../lib/ui/colors'

  $: cfg = $configStore
  $: total = $durationStore

  // 甘特条：起点 = delay / total，宽度 = 转动耗时 / total
  $: rows = cfg.hinges.map((h, i) => {
    const move = FULL_ANGLE / Math.max(h.rate, 0.001)
    return {
      i,
      startPct: total > 0 ? (h.delay / total) * 100 : 0,
      widthPct: total > 0 ? Math.max(1.5, (move / total) * 100) : 100,
      move
    }
  })

  function num(v: number, min: number, max: number) {
    if (Number.isNaN(v)) return min
    return Math.min(max, Math.max(min, v))
  }

  // 输入框回显规整：消除浮点累加误差（如 3.5999999999 → 3.6）
  const fmt = (v: number) => Math.round(v * 1000) / 1000
</script>

<div>
  <div class="section-title">时序参数</div>
  <p class="dim">
    每节铰链按 β(t)=clamp((t−启动延迟)×转动速率, 0, 180°) 运动，前级转动期间后级保持折叠，
    从而实现逐节依次展开。
  </p>

  <table class="timing">
    <thead>
      <tr>
        <th>铰链</th>
        <th>启动延迟 (s)</th>
        <th>转动速率 (°/s)</th>
        <th>转满耗时</th>
      </tr>
    </thead>
    <tbody>
      {#each cfg.hinges as h, i (h.id)}
        <tr>
          <td>
            <span class="legend-dot" style="background:{hingeColor(i)};display:inline-block;margin-right:5px"></span>
            H{i + 1}
          </td>
          <td>
            <input
              type="number" min="0" max="60" step="0.1"
              value={fmt(h.delay)}
              on:change={(e) =>
                mutateConfig((d) => {
                  d.hinges[i].delay = fmt(num(+e.currentTarget.value, 0, 60))
                })}
            />
          </td>
          <td>
            <input
              type="number" min="5" max="360" step="5"
              value={fmt(h.rate)}
              on:change={(e) =>
                mutateConfig((d) => {
                  d.hinges[i].rate = fmt(num(+e.currentTarget.value, 5, 360))
                })}
            />
          </td>
          <td class="dim">{rows[i].move.toFixed(2)} s</td>
        </tr>
      {/each}
    </tbody>
  </table>

  <div class="section-title">展开甘特图</div>
  <div class="card">
    <div class="gantt">
      {#each rows as row (row.i)}
        <div class="gantt-row">
          <div class="gantt-label">H{row.i + 1}</div>
          <div class="gantt-track">
            <div
              class="gantt-fill"
              style="left:{row.startPct}%;width:{row.widthPct}%;background:{hingeColor(row.i)}"
              title={`延迟 ${cfg.hinges[row.i].delay}s 后启动，转动 ${row.move.toFixed(2)}s`}
            ></div>
          </div>
        </div>
      {/each}
    </div>
    <div class="row" style="margin-top:8px">
      <span class="dim">总展开时长</span>
      <span class="spacer"></span>
      <span class="tag">{total.toFixed(2)} s</span>
    </div>
  </div>

  <div class="section-title">快捷模板</div>
  <div class="btn-row">
    <button
      on:click={() =>
        mutateConfig((d) => {
          d.hinges.forEach((h, i) => {
            h.delay = Math.round(i * 1.2 * 1000) / 1000
            h.rate = 60
          })
        })}
    >
      顺序展开（1.2s 间隔）
    </button>
    <button
      on:click={() =>
        mutateConfig((d) => {
          d.hinges.forEach((h) => {
            h.delay = 0
            h.rate = 60
          })
        })}
    >
      同步展开
    </button>
  </div>
</div>
