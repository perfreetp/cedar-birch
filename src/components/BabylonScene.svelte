<script lang="ts">
  import { onMount } from 'svelte'
  import { WingScene } from '../lib/babylon/wingScene'
  import { configStore, currentAngles, tick } from '../lib/stores'

  let canvas: HTMLCanvasElement
  let wing: WingScene | null = null
  let resizeObs: ResizeObserver | null = null

  onMount(() => {
    wing = new WingScene(canvas)
    wing.rebuild($configStore, $currentAngles)

    // 构型变化 → 按当前角度重建装配体
    const unsubCfg = configStore.subscribe((cfg) => {
      wing?.rebuild(cfg, $currentAngles)
    })
    // 角度变化（播放/滑杆）→ 驱动层级变换
    const unsubAngles = currentAngles.subscribe((angles) => wing?.applyAngles(angles))

    wing.engine.runRenderLoop(() => {
      const dt = wing!.engine.getDeltaTime() / 1000
      // 首帧或长卡顿后的异常大 dt 不参与推进
      if (dt > 0 && dt < 0.25) tick(dt)
      wing!.frameEase(performance.now())
      wing!.scene.render()
    })

    resizeObs = new ResizeObserver(() => wing?.engine.resize())
    resizeObs.observe(canvas)

    return () => {
      unsubCfg()
      unsubAngles()
      resizeObs?.disconnect()
      wing?.dispose()
      wing = null
    }
  })

  /** 供父组件调用：截取当前姿态 PNG Data URL */
  export function capture(): string {
    return wing?.capture() ?? ''
  }
</script>

<canvas class="babylon" bind:this={canvas}></canvas>
