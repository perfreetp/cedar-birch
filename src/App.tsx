import { useEffect } from 'react'
import { Stage } from './scene/Stage'
import { Toolbar } from './components/Toolbar'
import { TransferFunctionEditor } from './components/TransferFunctionEditor'
import { SlicePanel } from './components/SlicePanel'
import { LightPanel } from './components/LightPanel'
import { Hud } from './components/Hud'
import { importFile } from './io/importFlow'
import { loadStoredDataset } from './io/database'
import { services } from './scene/services'
import { useStore } from './state/store'

export default function App() {
  // 启动时从 IndexedDB 恢复上次的数据集
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const loaded = await loadStoredDataset().catch(() => null)
      if (!loaded || cancelled) return
      await services.whenVolume()
      if (cancelled) return
      services.volume!.setData(loaded.stored.meta, loaded.chunks)
      useStore.getState().setMeta(loaded.stored.meta)
      useStore.getState().setHistograms(loaded.stored.histograms)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f) importFile(f).catch((err) => alert(`导入失败:${err instanceof Error ? err.message : err}`))
  }

  return (
    <div className="app">
      <Toolbar />
      <div className="main">
        <aside className="side">
          <TransferFunctionEditor />
          <SlicePanel />
          <LightPanel />
        </aside>
        <div className="viewport" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <Stage />
          <Hud />
        </div>
      </div>
    </div>
  )
}
