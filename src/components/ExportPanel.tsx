import { useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore'
import { getEngine } from '../engine/bridge'
import { downloadTextFile } from '../lib/geometry'
import type { Snapshot } from '../types'
import { MAX_PARTICLES } from '../types'

/** 第 4 页:布局 + 流场快照导出 / 再导入还原 */
export function ExportPanel(): React.JSX.Element {
  const store = useAppStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [includeParticles, setIncludeParticles] = useState(true)
  const [includeImage, setIncludeImage] = useState(true)

  function buildSnapshot(): Snapshot {
    const engine = getEngine()
    const snap: Snapshot = {
      app: 'cleanroom-flowviz',
      version: 1,
      exportedAt: new Date().toISOString(),
      room: structuredClone(store.room),
      equipment: structuredClone(store.equipment),
      supplies: structuredClone(store.supplies),
      returns: structuredClone(store.returns),
      settings: structuredClone(store.settings),
    }
    if (includeParticles && engine) snap.particles = engine.captureParticles()
    if (includeImage && engine) {
      const canvas = document.querySelector('.viewport-canvas canvas') as HTMLCanvasElement | null
      if (canvas) snap.images = { viewport: canvas.toDataURL('image/png') }
    }
    return snap
  }

  function onExport(): void {
    try {
      const snap = buildSnapshot()
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      downloadTextFile(`cleanroom-snapshot-${stamp}.json`, JSON.stringify(snap, null, 2), 'application/json')
      const n = snap.particles?.count ?? 0
      setMessage({ kind: 'ok', text: `已导出:${snap.equipment.length} 台设备、${snap.supplies.length} 个送风口、${n} 个粒子帧` })
    } catch (e) {
      setMessage({ kind: 'err', text: `导出失败:${(e as Error).message}` })
    }
  }

  function onImportClick(): void {
    fileRef.current?.click()
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const snap = JSON.parse(String(reader.result)) as Snapshot
        if (snap.app !== 'cleanroom-flowviz' || snap.version !== 1) {
          throw new Error('文件标识或版本不匹配')
        }
        if (!snap.room || !Array.isArray(snap.equipment) || !Array.isArray(snap.supplies)) {
          throw new Error('缺少必要字段')
        }
        if (snap.settings.targetCount > MAX_PARTICLES) snap.settings.targetCount = MAX_PARTICLES
        store.loadSnapshot(snap)
        // 场景重建后再回填粒子帧(下一帧引擎已 syncLayout)
        if (snap.particles) {
          requestAnimationFrame(() => getEngine()?.restoreParticles(snap.particles!))
        }
        setMessage({ kind: 'ok', text: `已还原 ${snap.equipment.length} 台设备、${snap.supplies.length} 个送风口的布局` })
      } catch (err) {
        setMessage({ kind: 'err', text: `导入失败:${(err as Error).message}` })
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="export-layout">
      <section className="card export-card">
        <h3>导出快照</h3>
        <p className="hint">JSON 文件包含房间尺寸、设备轮廓与位姿、送/回风口参数、仿真设置,以及可选的粒子帧与视口截图。</p>
        <label className="switch-row">
          <input type="checkbox" checked={includeParticles} onChange={(e) => setIncludeParticles(e.target.checked)} />
          包含当前粒子流场帧(位置 + 停留时间)
        </label>
        <label className="switch-row">
          <input type="checkbox" checked={includeImage} onChange={(e) => setIncludeImage(e.target.checked)} />
          包含三维视口截图(Base64 PNG)
        </label>
        <button className="btn primary wide" onClick={onExport}>导出 JSON 快照</button>
      </section>

      <section className="card export-card">
        <h3>导入还原</h3>
        <p className="hint">选择此前导出的快照文件,将完整还原布局与流场;若文件含粒子帧则同时恢复粒子状态。</p>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
        <button className="btn wide" onClick={onImportClick}>选择快照文件…</button>
      </section>

      {message && (
        <section className={`card export-card ${message.kind === 'ok' ? 'msg-ok' : 'msg-err'}`}>
          {message.text}
        </section>
      )}

      <section className="card export-card">
        <h3>当前布局摘要</h3>
        <ul className="note-list">
          <li>房间:{store.room.width} × {store.room.depth} × {store.room.height} m</li>
          <li>送风口 {store.supplies.length} 个 · 回风口 {store.returns.length} 个</li>
          <li>设备 {store.equipment.length} 台 · 粒子上限 {store.settings.targetCount}</li>
          <li>切片:
            {store.settings.sliceEnabled
              ? `开启 @ ${store.settings.sliceHeight.toFixed(2)} m,带宽 ${store.settings.sliceBand.toFixed(2)} m`
              : '关闭'}
          </li>
        </ul>
      </section>
    </div>
  )
}
