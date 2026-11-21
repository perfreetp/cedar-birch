<script lang="ts">
  import { configStore, mutateConfig, restoreDefaults, importConfig } from '../lib/stores'
  import { makePanel } from '../lib/config'
  import type { WingConfig } from '../lib/types'
  import { downloadText } from '../lib/export'

  $: cfg = $configStore
  const MAX_PANELS = 8

  function num(v: number, min: number, max: number) {
    if (Number.isNaN(v)) return min
    return Math.min(max, Math.max(min, v))
  }

  function addPanel() {
    if (cfg.panels.length >= MAX_PANELS) return
    mutateConfig((d) => {
      d.panels.push(makePanel())
    })
  }

  function removePanel(index: number) {
    mutateConfig((d) => {
      d.panels.splice(index, 1)
    })
  }

  function exportConfig() {
    downloadText(
      'solar-wing-config.json',
      JSON.stringify(cfg, null, 2),
      'application/json'
    )
  }

  function onImportFile(e: Event) {
    const input = e.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as WingConfig
        if (!Array.isArray(parsed.panels) || !Array.isArray(parsed.hinges)) {
          alert('文件格式不正确：缺少 panels / hinges 字段')
          return
        }
        importConfig(parsed)
      } catch {
        alert('构型 JSON 解析失败')
      }
    }
    reader.readAsText(file)
    input.value = ''
  }
</script>

<div>
  <div class="section-title">基板（固定端）</div>
  <div class="card">
    <div class="grid-3">
      <label>
        长 (m)
        <input
          type="number" min="0.4" max="6" step="0.1"
          value={cfg.base.length}
          on:change={(e) =>
            mutateConfig((d) => {
              d.base.length = num(+e.currentTarget.value, 0.4, 6)
            })}
        />
      </label>
      <label>
        宽 (m)
        <input
          type="number" min="0.4" max="6" step="0.1"
          value={cfg.base.width}
          on:change={(e) =>
            mutateConfig((d) => {
              d.base.width = num(+e.currentTarget.value, 0.4, 6)
            })}
        />
      </label>
      <label>
        厚 (m)
        <input
          type="number" min="0.02" max="0.5" step="0.01"
          value={cfg.base.thickness}
          on:change={(e) =>
            mutateConfig((d) => {
              d.base.thickness = num(+e.currentTarget.value, 0.02, 0.5)
            })}
        />
      </label>
    </div>
  </div>

  <div class="section-title row" style="justify-content:space-between">
    <span>翼板 / 铰链层级（{cfg.panels.length} 节）</span>
  </div>
  {#each cfg.panels as panel, i (panel.id)}
    <div class="card">
      <div class="row" style="margin-bottom:8px">
        <span class="tag">铰链 {i + 1} → 翼板 {i + 1}</span>
        <span class="spacer"></span>
        <button
          class="warn"
          disabled={cfg.panels.length <= 1}
          on:click={() => removePanel(i)}
        >
          删除
        </button>
      </div>
      <div class="grid-3">
        <label>
          板长 (m)
          <input
            type="number" min="0.4" max="6" step="0.1"
            value={panel.length}
            on:change={(e) =>
              mutateConfig((d) => {
                d.panels[i].length = num(+e.currentTarget.value, 0.4, 6)
              })}
          />
        </label>
        <label>
          板宽 (m)
          <input
            type="number" min="0.4" max="6" step="0.1"
            value={panel.width}
            on:change={(e) =>
              mutateConfig((d) => {
                d.panels[i].width = num(+e.currentTarget.value, 0.4, 6)
              })}
          />
        </label>
        <label>
          板厚 (m)
          <input
            type="number" min="0.02" max="0.3" step="0.01"
            value={panel.thickness}
            on:change={(e) =>
              mutateConfig((d) => {
                d.panels[i].thickness = num(+e.currentTarget.value, 0.02, 0.3)
              })}
          />
        </label>
      </div>
    </div>
  {/each}

  <div class="section-title">表面纹理</div>
  <div class="card">
    <label>
      网格密度（分格 / 米）：{cfg.gridDensity}
      <input
        type="range" min="1" max="10" step="1"
        value={cfg.gridDensity}
        on:input={(e) =>
          mutateConfig((d) => {
            d.gridDensity = num(+e.currentTarget.value, 1, 10)
          })}
      />
    </label>
  </div>

  <div class="btn-row">
    <button class="primary" disabled={cfg.panels.length >= MAX_PANELS} on:click={addPanel}>
      ＋ 增加一节翼板/铰链
    </button>
  </div>

  <div class="section-title">构型数据</div>
  <div class="card">
    <p class="dim" style="margin:0 0 8px">
      所有构型修改自动保存到浏览器 localStorage，刷新页面后仍然保留。
    </p>
    <div class="btn-row">
      <button on:click={exportConfig}>导出构型 JSON</button>
      <button>
        <label for="import-cfg" style="cursor:pointer;margin:0">导入构型 JSON</label>
      </button>
      <input
        id="import-cfg"
        type="file"
        accept="application/json,.json"
        style="display:none"
        on:change={onImportFile}
      />
      <button class="warn" on:click={restoreDefaults}>恢复出厂默认</button>
    </div>
  </div>
</div>
