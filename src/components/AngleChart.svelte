<script lang="ts">
  import { onMount } from 'svelte'
  import type { CurveSample } from '../lib/types'
  import { hingeColor } from '../lib/ui/colors'
  import { exportCanvasPng } from '../lib/export'

  export let curve: CurveSample[] = []
  export let seriesCount = 0
  export let currentTime = 0
  /** 手动模式下的统一角度（度）；null 表示时序模式 */
  export let manualAngle: number | null = null

  let wrap: HTMLDivElement
  let canvas: HTMLCanvasElement
  let tooltip: HTMLDivElement
  let hoverX: number | null = null
  let cssW = 600
  let cssH = 300

  const PAD = { left: 52, right: 14, top: 16, bottom: 38 }

  onMount(() => {
    const ro = new ResizeObserver(() => {
      cssW = Math.max(280, wrap.clientWidth)
      cssH = 300
    })
    ro.observe(wrap)
    cssW = Math.max(280, wrap.clientWidth)
    return () => ro.disconnect()
  })

  function plotRect() {
    const dpr = window.devicePixelRatio || 1
    return {
      dpr,
      x0: PAD.left,
      y0: PAD.top,
      w: cssW - PAD.left - PAD.right,
      h: cssH - PAD.top - PAD.bottom
    }
  }

  $: maxT = curve.length > 0 ? Math.max(0.1, curve[curve.length - 1].t) : 1
  $: n = seriesCount

  function pxOf(t: number, r: ReturnType<typeof plotRect>) {
    return r.x0 + (t / maxT) * r.w
  }
  function pyOf(deg: number, r: ReturnType<typeof plotRect>) {
    return r.y0 + r.h - (deg / 180) * r.h
  }

  function sampleAt(clientX: number): { t: number; angles: number[] } | null {
    if (curve.length === 0) return null
    const r = plotRect()
    const t = ((clientX - r.x0) / r.w) * maxT
    if (t < 0 || t > maxT) return null
    let best = curve[0]
    for (const s of curve) {
      if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
    }
    return best
  }

  function onMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect()
    hoverX = e.clientX - rect.left
    const hit = sampleAt(hoverX)
    if (!hit || !tooltip) return
    const r = plotRect()
    tooltip.style.left = `${Math.min(hoverX + 12, r.x0 + r.w - 130)}px`
    tooltip.style.top = `${PAD.top + 4}px`
  }

  function onLeave() {
    hoverX = null
  }

  export function savePng() {
    exportCanvasPng(canvas, 'angle-curve')
  }

  $: if (canvas) {
    const r = plotRect()
    const dpr = r.dpr
    canvas.width = cssW * dpr
    canvas.height = cssH * dpr
    canvas.style.height = `${cssH}px`
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cssW, cssH)

    // 网格 + Y 轴刻度（0..180°）
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.fillStyle = '#8fa3b8'
    ctx.lineWidth = 1
    ctx.font = '11px sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let deg = 0; deg <= 180; deg += 30) {
      const y = pyOf(deg, r)
      ctx.beginPath()
      ctx.moveTo(r.x0, y)
      ctx.lineTo(r.x0 + r.w, y)
      ctx.stroke()
      ctx.fillText(`${deg}°`, r.x0 - 8, y)
    }

    // X 轴刻度（时间）
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const tickCount = Math.min(8, Math.max(2, Math.floor(r.w / 90)))
    for (let i = 0; i <= tickCount; i++) {
      const t = (maxT * i) / tickCount
      const x = pxOf(t, r)
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.beginPath()
      ctx.moveTo(x, r.y0)
      ctx.lineTo(x, r.y0 + r.h)
      ctx.stroke()
      ctx.fillStyle = '#8fa3b8'
      ctx.fillText(`${t.toFixed(1)}s`, x, r.y0 + r.h + 6)
    }

    // 坐标轴
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.beginPath()
    ctx.moveTo(r.x0, r.y0)
    ctx.lineTo(r.x0, r.y0 + r.h)
    ctx.lineTo(r.x0 + r.w, r.y0 + r.h)
    ctx.stroke()

    // 轴标题
    ctx.fillStyle = '#8fa3b8'
    ctx.textAlign = 'center'
    ctx.fillText('时间 (s)', r.x0 + r.w / 2, cssH - 8)
    ctx.save()
    ctx.translate(14, r.y0 + r.h / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('展开角 (°)', 0, 0)
    ctx.restore()

    // 手动模式：统一角度参考虚线
    if (manualAngle !== null) {
      const y = pyOf(manualAngle, r)
      ctx.setLineDash([6, 5])
      ctx.strokeStyle = 'rgba(255,183,77,0.85)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(r.x0, y)
      ctx.lineTo(r.x0 + r.w, y)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = '#ffb74d'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(`手动设定 ${manualAngle}°`, r.x0 + 6, y - 3)
    }

    // 各铰链角度曲线
    ctx.lineWidth = 2
    for (let i = 0; i < n; i++) {
      ctx.strokeStyle = hingeColor(i)
      ctx.beginPath()
      curve.forEach((s, idx) => {
        const x = pxOf(s.t, r)
        const y = pyOf(s.angles[i] ?? 0, r)
        if (idx === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()
    }

    // 当前时间游标
    const cursorT = manualAngle !== null ? 0 : Math.min(currentTime, maxT)
    if (manualAngle === null && currentTime >= 0) {
      const x = pxOf(cursorT, r)
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, r.y0)
      ctx.lineTo(x, r.y0 + r.h)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 悬停竖线
    const hover = hoverX !== null ? sampleAt(hoverX) : null
    if (hover) {
      const x = pxOf(hover.t, r)
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.moveTo(x, r.y0)
      ctx.lineTo(x, r.y0 + r.h)
      ctx.stroke()
      hover.angles.forEach((a, i) => {
        ctx.fillStyle = hingeColor(i)
        ctx.beginPath()
        ctx.arc(x, pyOf(a, r), 3.2, 0, Math.PI * 2)
        ctx.fill()
      })
    }
  }

  $: hoverSample = hoverX !== null ? sampleAt(hoverX) : null
</script>

<div class="chart-wrap" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    on:mousemove={onMove}
    on:mouseleave={onLeave}
  ></canvas>
  {#if hoverSample}
    <div class="tooltip" bind:this={tooltip}>
      <div>t = {hoverSample.t.toFixed(2)} s</div>
      {#each hoverSample.angles as a, i}
        <div>
          <span style="color:{hingeColor(i)}">●</span> 铰链{i + 1}：{a.toFixed(1)}°
        </div>
      {/each}
    </div>
  {/if}
</div>
