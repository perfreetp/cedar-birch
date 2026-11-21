<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Simulation, type SimParams, type SimStats } from "./sim/Simulation";

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let sim: Simulation | null = null;
  let ready = false;
  let error = "";
  let importMsg = "";

  const params: SimParams = {
    driveMode: "manual",
    speedGear: 2,
    brushGear: 2,
    brushAngleDeg: 0,
    water: true,
    night: false,
    topView: false,
    heatView: false,
  };

  let stats: SimStats = {
    engine: "初始化…",
    fps: 0,
    speedKmh: 0,
    coveragePct: 0,
    areaM2: 0,
    dirtLeft: 0,
    x: 0,
    z: 0,
  };

  onMount(async () => {
    sim = new Simulation(canvas);
    try {
      await sim.init(params, (s) => (stats = s));
      ready = true;
    } catch (e) {
      error = String(e);
    }
  });

  onDestroy(() => sim?.dispose());

  function exportRun() {
    sim?.exportRun();
  }

  async function onImport() {
    const f = fileInput?.files?.[0];
    if (!f || !sim) return;
    try {
      await sim.importRun(f);
      importMsg = "已载入历史作业，覆盖层将继续叠加";
    } catch (e) {
      importMsg = String(e);
    }
    fileInput.value = "";
    setTimeout(() => (importMsg = ""), 4000);
  }
</script>

<canvas bind:this={canvas} id="view"></canvas>

{#if error}
  <div class="error">引擎初始化失败：{error}</div>
{/if}

<div class="panel controls">
  <h2>清扫车作业控制</h2>

  <div class="row">
    <span class="label">驾驶模式</span>
    <div class="seg">
      <button class:active={params.driveMode === "manual"} on:click={() => (params.driveMode = "manual")}>手动</button>
      <button class:active={params.driveMode === "auto"} on:click={() => (params.driveMode = "auto")}>自动循线</button>
    </div>
  </div>

  <div class="row">
    <span class="label">车速档位</span>
    <div class="seg">
      {#each [0, 1, 2, 3] as g}
        <button class:active={params.speedGear === g} on:click={() => (params.speedGear = g)}>{g}</button>
      {/each}
    </div>
  </div>

  <div class="row">
    <span class="label">扫刷宽度</span>
    <div class="seg">
      {#each [1, 2, 3] as g}
        <button class:active={params.brushGear === g} on:click={() => (params.brushGear = g)}>
          {g === 1 ? "窄" : g === 2 ? "标准" : "宽"}
        </button>
      {/each}
    </div>
  </div>

  <div class="row">
    <span class="label">扫刷偏角</span>
    <input type="range" min="-30" max="30" step="1" bind:value={params.brushAngleDeg} />
    <span class="val">{params.brushAngleDeg}°</span>
  </div>

  <div class="row toggles">
    <label><input type="checkbox" bind:checked={params.water} /> 喷水</label>
    <label><input type="checkbox" bind:checked={params.night} /> 夜间</label>
    <label><input type="checkbox" bind:checked={params.topView} /> 俯视</label>
    <label>
      <input
        type="checkbox"
        bind:checked={params.heatView}
        on:change={() => {
          if (params.heatView) params.topView = true;
        }}
      />
      热力图
    </label>
  </div>

  <div class="row actions">
    <button on:click={exportRun} disabled={!ready}>导出作业</button>
    <button on:click={() => fileInput.click()} disabled={!ready}>载入作业</button>
    <button on:click={() => sim?.clearCoverage()} disabled={!ready}>清空覆盖</button>
    <input bind:this={fileInput} type="file" accept=".json,application/json" style="display:none" on:change={onImport} />
  </div>
  {#if importMsg}<div class="msg">{importMsg}</div>{/if}

  <div class="help">手动驾驶：W/S 前进·倒车，A/D 转向（也可用方向键）</div>
</div>

<div class="panel stats">
  <div><span>渲染引擎</span><b>{stats.engine}</b></div>
  <div><span>帧率</span><b>{stats.fps} fps</b></div>
  <div><span>车速</span><b>{stats.speedKmh.toFixed(1)} km/h</b></div>
  <div><span>路线覆盖率</span><b>{stats.coveragePct.toFixed(1)} %</b></div>
  <div><span>覆盖面积</span><b>{stats.areaM2.toFixed(0)} m²</b></div>
  <div><span>剩余污渍</span><b>{stats.dirtLeft}</b></div>
  <div><span>位置</span><b>({stats.x.toFixed(1)}, {stats.z.toFixed(1)})</b></div>
</div>

<style>
  #view {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }
  .panel {
    position: absolute;
    background: rgba(12, 16, 24, 0.82);
    border: 1px solid rgba(120, 150, 200, 0.25);
    border-radius: 10px;
    color: #dfe6f2;
    padding: 12px 14px;
    font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    font-size: 13px;
    backdrop-filter: blur(6px);
  }
  .controls {
    top: 14px;
    left: 14px;
    width: 300px;
  }
  .controls h2 {
    margin: 0 0 10px;
    font-size: 15px;
    color: #8fc3ff;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 9px;
  }
  .label {
    width: 60px;
    flex: none;
    color: #9fb0c8;
  }
  .seg {
    display: flex;
    gap: 4px;
    flex: 1;
  }
  .seg button {
    flex: 1;
    padding: 4px 0;
    background: #1b2333;
    color: #c8d4e8;
    border: 1px solid #2c3a55;
    border-radius: 6px;
    cursor: pointer;
  }
  .seg button.active {
    background: #2f6fd0;
    border-color: #5b9bf5;
    color: #fff;
  }
  input[type="range"] {
    flex: 1;
  }
  .val {
    width: 36px;
    text-align: right;
    color: #8fc3ff;
  }
  .toggles {
    gap: 12px;
    flex-wrap: wrap;
  }
  .toggles label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }
  .actions button {
    padding: 5px 10px;
    background: #1b2333;
    color: #c8d4e8;
    border: 1px solid #2c3a55;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions button:hover:not(:disabled) {
    background: #273350;
  }
  .actions button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .msg {
    color: #7fe0a8;
    margin-bottom: 6px;
  }
  .help {
    color: #7c8ba3;
    font-size: 12px;
    margin-top: 4px;
  }
  .stats {
    top: 14px;
    right: 14px;
    min-width: 180px;
    font-family: "Cascadia Code", Consolas, monospace;
  }
  .stats div {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 5px;
  }
  .stats span {
    color: #9fb0c8;
  }
  .stats b {
    color: #8fc3ff;
    font-weight: 600;
  }
  .error {
    position: absolute;
    top: 40%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #ff8a8a;
    background: rgba(40, 10, 10, 0.9);
    padding: 16px 24px;
    border-radius: 8px;
    font-family: monospace;
  }
</style>
