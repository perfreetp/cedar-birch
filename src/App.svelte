<script lang="ts">
  import BabylonScene from './components/BabylonScene.svelte'
  import DeployBar from './components/DeployBar.svelte'
  import AssemblyPanel from './components/AssemblyPanel.svelte'
  import TimingPanel from './components/TimingPanel.svelte'
  import CurvePanel from './components/CurvePanel.svelte'
  import { configStore } from './lib/stores'

  type TabId = 'assembly' | 'timing' | 'curve'

  const validTabs: TabId[] = ['assembly', 'timing', 'curve']
  const urlTab = new URLSearchParams(window.location.search).get('tab') as TabId | null
  let tab: TabId = urlTab && validTabs.includes(urlTab) ? urlTab : 'assembly'

  const tabs: { id: TabId; label: string }[] = [
    { id: 'assembly', label: '构型装配' },
    { id: 'timing', label: '展开时序' },
    { id: 'curve', label: '角度曲线' }
  ]

  let scene: BabylonScene
  const captureScene = (): string => scene?.capture() ?? ''

  $: panelCount = $configStore.panels.length
</script>

<div class="app-shell">
  <header class="app-header">
    <h1>🛰️ 太阳翼多节铰链展开姿态渲染工具</h1>
    <span class="sub">基板 + {panelCount} 节翼板铰链装配体 · 层级变换驱动 · Babylon.js</span>
  </header>

  <div class="app-body">
    <div class="scene-pane">
      <BabylonScene bind:this={scene}></BabylonScene>
      <div class="hint">鼠标左键环绕 · 滚轮缩放 · 右键平移</div>
      <DeployBar {captureScene}></DeployBar>
    </div>

    <aside class="side-pane">
      <div class="tabs">
        {#each tabs as t (t.id)}
          <button class={tab === t.id ? 'active' : ''} on:click={() => (tab = t.id)}>
            {t.label}
          </button>
        {/each}
      </div>
      <div class="tab-body">
        {#if tab === 'assembly'}
          <AssemblyPanel />
        {:else if tab === 'timing'}
          <TimingPanel />
        {:else}
          <CurvePanel />
        {/if}
      </div>
    </aside>
  </div>
</div>
