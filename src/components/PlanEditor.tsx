import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import type { Equipment } from '../types'
import { clamp, returnVentWorldPos } from '../lib/geometry'

/**
 * 第 1 页:二维车间平面图。
 * Canvas 俯视绘制,支持设备拖拽移动、R/Shift+滚轮调整朝向、右键删除。
 */
export function PlanEditor(): React.JSX.Element {
  const room = useAppStore((s) => s.room)
  const equipment = useAppStore((s) => s.equipment)
  const supplies = useAppStore((s) => s.supplies)
  const returns = useAppStore((s) => s.returns)
  const updateEquipment = useAppStore((s) => s.updateEquipment)
  const removeEquipment = useAppStore((s) => s.removeEquipment)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const stateRef = useRef({ room, equipment, supplies, returns, selectedId })
  stateRef.current = { room, equipment, supplies, returns, selectedId }

  const dragRef = useRef<{
    id: string
    offX: number
    offZ: number
    moved: boolean
  } | null>(null)

  // 世界米 -> 画布像素
  function scale(): number {
    const wrap = wrapRef.current
    if (!wrap) return 40
    const pad = 48
    return Math.min((wrap.clientWidth - pad) / room.width, (wrap.clientHeight - pad) / room.depth)
  }

  function toScreen(x: number, z: number): [number, number] {
    const wrap = wrapRef.current!
    const k = scale()
    const ox = (wrap.clientWidth - room.width * k) / 2
    const oz = (wrap.clientHeight - room.depth * k) / 2
    return [ox + (x + room.width / 2) * k, oz + (z + room.depth / 2) * k]
  }

  function toWorld(px: number, pz: number): [number, number] {
    const wrap = wrapRef.current!
    const k = scale()
    const ox = (wrap.clientWidth - room.width * k) / 2
    const oz = (wrap.clientHeight - room.depth * k) / 2
    return [px / k - room.width / 2 - ox / k, pz / k - oz / k]
  }

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    function resize(): void {
      const wrap = wrapRef.current!
      const dpr = Math.min(window.devicePixelRatio, 2)
      canvas.width = wrap.clientWidth * dpr
      canvas.height = wrap.clientHeight * dpr
      canvas.style.width = `${wrap.clientWidth}px`
      canvas.style.height = `${wrap.clientHeight}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrapRef.current!)

    function draw(): void {
      const { room: rm, equipment: eqs, supplies: svs, returns: rvs, selectedId: sel } = stateRef.current
      const wrap = wrapRef.current!
      ctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight)
      const k = scale()
      const ox = (wrap.clientWidth - rm.width * k) / 2
      const oz = (wrap.clientHeight - rm.depth * k) / 2

      // 房间
      ctx.fillStyle = '#131c2b'
      ctx.fillRect(ox, oz, rm.width * k, rm.depth * k)
      ctx.strokeStyle = '#8fb8e8'
      ctx.lineWidth = 2
      ctx.strokeRect(ox, oz, rm.width * k, rm.depth * k)

      // 米制栅格
      ctx.strokeStyle = 'rgba(120,150,190,0.14)'
      ctx.lineWidth = 1
      for (let gx = 1; gx < rm.width; gx++) {
        ctx.beginPath()
        ctx.moveTo(ox + gx * k, oz)
        ctx.lineTo(ox + gx * k, oz + rm.depth * k)
        ctx.stroke()
      }
      for (let gz = 1; gz < rm.depth; gz++) {
        ctx.beginPath()
        ctx.moveTo(ox, oz + gz * k)
        ctx.lineTo(ox + rm.width * k, oz + gz * k)
        ctx.stroke()
      }

      // 送风口投影(网格位置预览)
      for (const sv of svs) {
        const [sx, sy] = toScreen(sv.x, sv.z)
        ctx.beginPath()
        ctx.arc(sx, sy, 7, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(53,224,232,0.85)'
        ctx.fill()
        ctx.strokeStyle = '#c8fbff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // 回风口(贴墙,俯视投影到墙线)
      for (const rv of rvs) {
        const [rx, , rz] = returnVentWorldPos(rv, rm)
        const [sx, sy] = toScreen(rx, rz)
        ctx.fillStyle = '#ff7a45'
        ctx.fillRect(sx - 5, sy - 5, 10, 10)
        ctx.strokeStyle = '#ffc2a8'
        ctx.lineWidth = 1
        ctx.strokeRect(sx - 5, sy - 5, 10, 10)
      }

      // 设备 OBB
      for (const eq of eqs) {
        const [cx, cy] = toScreen(eq.x, eq.z)
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(-eq.rotation) // 屏幕 y 向下,旋转取反
        const w = eq.w * k
        const d = eq.d * k
        const selected = eq.id === sel
        ctx.fillStyle = selected ? 'rgba(110,170,255,0.85)' : 'rgba(74,144,217,0.65)'
        ctx.strokeStyle = selected ? '#ffe14d' : '#d7e8ff'
        ctx.lineWidth = selected ? 2.5 : 1.5
        ctx.fillRect(-w / 2, -d / 2, w, d)
        ctx.strokeRect(-w / 2, -d / 2, w, d)
        // 朝向标记:本地 -Z(前方)
        ctx.beginPath()
        ctx.moveTo(0, -d / 2)
        ctx.lineTo(-6, -d / 2 + 9)
        ctx.lineTo(6, -d / 2 + 9)
        ctx.closePath()
        ctx.fillStyle = '#ffe14d'
        ctx.fill()
        ctx.restore()

        ctx.fillStyle = '#cfe0f5'
        ctx.font = '11px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(eq.name, cx, cy + 3)
      }

      // 尺寸标注
      ctx.fillStyle = '#7d93b2'
      ctx.font = '11px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${rm.width.toFixed(1)} m`, ox + (rm.width * k) / 2, oz - 8)
      ctx.save()
      ctx.translate(ox - 12, oz + (rm.depth * k) / 2)
      ctx.rotate(-Math.PI / 2)
      ctx.fillText(`${rm.depth.toFixed(1)} m`, 0, 0)
      ctx.restore()
    }

    let raf = 0
    function loop(): void {
      raf = requestAnimationFrame(loop)
      draw()
    }
    loop()

    function pickEq(wx: number, wz: number): Equipment | null {
      for (let i = stateRef.current.equipment.length - 1; i >= 0; i--) {
        const eq = stateRef.current.equipment[i]
        const c = Math.cos(eq.rotation)
        const s = Math.sin(eq.rotation)
        const dx = wx - eq.x
        const dz = wz - eq.z
        const lx = dx * c - dz * s
        const lz = dx * s + dz * c
        if (Math.abs(lx) <= eq.w / 2 && Math.abs(lz) <= eq.d / 2) return eq
      }
      return null
    }

    function pointerWorld(e: PointerEvent | WheelEvent): [number, number] {
      const rect = canvas.getBoundingClientRect()
      return toWorld(e.clientX - rect.left, e.clientY - rect.top)
    }

    function onDown(e: PointerEvent): void {
      if (e.button === 2) return
      const [wx, wz] = pointerWorld(e)
      const hit = pickEq(wx, wz)
      if (hit) {
        setSelectedId(hit.id)
        dragRef.current = { id: hit.id, offX: hit.x - wx, offZ: hit.z - wz, moved: false }
        canvas.setPointerCapture(e.pointerId)
      } else {
        setSelectedId(null)
      }
    }

    function onMove(e: PointerEvent): void {
      const drag = dragRef.current
      if (!drag) return
      const [wx, wz] = pointerWorld(e)
      const eq = stateRef.current.equipment.find((q) => q.id === drag.id)
      if (!eq) return
      const nx = clamp(wx + drag.offX, -room.width / 2 + eq.w / 2 + 0.05, room.width / 2 - eq.w / 2 - 0.05)
      const nz = clamp(wz + drag.offZ, -room.depth / 2 + eq.d / 2 + 0.05, room.depth / 2 - eq.d / 2 - 0.05)
      drag.moved = true
      updateEquipment(drag.id, { x: nx, z: nz })
    }

    function onUp(e: PointerEvent): void {
      if (dragRef.current) {
        try {
          canvas.releasePointerCapture(e.pointerId)
        } catch {
          /* ignore */
        }
        dragRef.current = null
      }
    }

    function onWheel(e: WheelEvent): void {
      const sel = stateRef.current.selectedId
      if (!sel || !e.shiftKey) return
      e.preventDefault()
      const eq = stateRef.current.equipment.find((q) => q.id === sel)
      if (!eq) return
      const step = (e.deltaY > 0 ? 1 : -1) * 0.0873 // 5°
      updateEquipment(sel, { rotation: eq.rotation + step })
    }

    function onKey(e: KeyboardEvent): void {
      const sel = stateRef.current.selectedId
      if (!sel) return
      const eq = stateRef.current.equipment.find((q) => q.id === sel)
      if (!eq) return
      if (e.key === 'r' || e.key === 'R') {
        updateEquipment(sel, { rotation: eq.rotation + 0.1309 })
      } else if (e.key === 'Delete') {
        removeEquipment(sel)
        setSelectedId(null)
      }
    }

    function onContext(e: MouseEvent): void {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const [wx, wz] = toWorld(e.clientX - rect.left, e.clientY - rect.top)
      const hit = pickEq(wx, wz)
      if (hit) {
        removeEquipment(hit.id)
        if (selectedId === hit.id) setSelectedId(null)
      }
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContext)
    window.addEventListener('keydown', onKey)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContext)
      window.removeEventListener('keydown', onKey)
    }
  }, [room.width, room.depth, updateEquipment, removeEquipment])

  // 朝向滑块等表单控件使用
  const selected = equipment.find((e) => e.id === selectedId) ?? null

  // 防止旋转后设备角点越界的统一夹紧
  function clampEquipment(eq: Equipment, patch: Partial<Equipment>): void {
    const next = { ...eq, ...patch }
    const c = Math.abs(Math.cos(next.rotation))
    const s = Math.abs(Math.sin(next.rotation))
    const hx = (next.w * c + next.d * s) / 2 + 0.05
    const hz = (next.w * s + next.d * c) / 2 + 0.05
    next.x = clamp(next.x, -room.width / 2 + hx, room.width / 2 - hx)
    next.z = clamp(next.z, -room.depth / 2 + hz, room.depth / 2 - hz)
    updateEquipment(eq.id, { ...patch, x: next.x, z: next.z })
  }

  return (
    <div className="plan-layout">
      <div ref={wrapRef} className="plan-canvas-wrap">
        <canvas ref={canvasRef} className="plan-canvas" />
      </div>
      <div className="side-panel">
        <section className="card">
          <h3>房间参数</h3>
          <RoomFields />
        </section>
        <section className="card">
          <h3>设备列表</h3>
          <div className="equip-list">
            {equipment.map((eq) => (
              <div
                key={eq.id}
                className={`equip-row ${eq.id === selectedId ? 'selected' : ''}`}
                onClick={() => setSelectedId(eq.id)}
              >
                <span>{eq.name}</span>
                <button className="btn-mini danger" onClick={() => removeEquipment(eq.id)}>删除</button>
              </div>
            ))}
            <AddEquipmentButton />
          </div>
        </section>
        {selected && (
          <section className="card">
            <h3>选中设备</h3>
            <label className="field">
              名称
              <input
                value={selected.name}
                onChange={(e) => clampEquipment(selected, { name: e.target.value })}
              />
            </label>
            <label className="field">
              宽 W(m)
              <input
                type="number"
                step={0.1}
                min={0.4}
                value={selected.w}
                onChange={(e) => clampEquipment(selected, { w: Math.max(0.4, Number(e.target.value)) })}
              />
            </label>
            <label className="field">
              深 D(m)
              <input
                type="number"
                step={0.1}
                min={0.4}
                value={selected.d}
                onChange={(e) => clampEquipment(selected, { d: Math.max(0.4, Number(e.target.value)) })}
              />
            </label>
            <label className="field">
              高 H(m)
              <input
                type="number"
                step={0.1}
                min={0.4}
                max={room.height - 0.1}
                value={selected.h}
                onChange={(e) =>
                  clampEquipment(selected, { h: clamp(Number(e.target.value), 0.4, room.height - 0.1) })
                }
              />
            </label>
            <label className="field">
              朝向 {(selected.rotation * 180 / Math.PI).toFixed(0)}°
              <input
                type="range"
                min={-180}
                max={180}
                value={Math.round(selected.rotation * 180 / Math.PI)}
                onChange={(e) => {
                  const rad = Number(e.target.value) * Math.PI / 180
                  clampEquipment(selected, { rotation: rad })
                }}
              />
            </label>
            <p className="hint">拖拽移动 · R 键 / Shift+滚轮转向 · 右键删除</p>
          </section>
        )}
      </div>
    </div>
  )
}

function RoomFields(): React.JSX.Element {
  const room = useAppStore((s) => s.room)
  const setRoom = useAppStore((s) => s.setRoom)
  return (
    <>
      <label className="field">
        宽 X(m)
        <input
          type="number"
          step={0.5}
          value={room.width}
          onChange={(e) => setRoom({ width: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        深 Z(m)
        <input
          type="number"
          step={0.5}
          value={room.depth}
          onChange={(e) => setRoom({ depth: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        层高 Y(m)
        <input
          type="number"
          step={0.1}
          value={room.height}
          onChange={(e) => setRoom({ height: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        送风口数量
        <input
          type="number"
          min={1}
          max={24}
          value={room.supplyCount}
          onChange={(e) => setRoom({ supplyCount: Number(e.target.value) })}
        />
      </label>
    </>
  )
}

function AddEquipmentButton(): React.JSX.Element {
  const addEquipment = useAppStore((s) => s.addEquipment)
  return (
    <button className="btn" onClick={addEquipment}>+ 添加设备</button>
  )
}
