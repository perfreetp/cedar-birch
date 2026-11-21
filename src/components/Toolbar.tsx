import { useRef } from 'react'
import { importFile } from '../io/importFlow'
import { exportSettings, importSettings } from '../io/settingsIO'
import { clearStoredDataset } from '../io/database'
import { services } from '../scene/services'
import { useStore } from '../state/store'

export function Toolbar() {
  const dataInput = useRef<HTMLInputElement>(null)
  const settingsInput = useRef<HTMLInputElement>(null)
  const setMeta = useStore((s) => s.setMeta)
  const setHistograms = useStore((s) => s.setHistograms)
  const setProgress = useStore((s) => s.setProgress)

  const onDataFile = async (f: File | undefined) => {
    if (!f) return
    try {
      await importFile(f)
    } catch (e) {
      alert(`导入失败:${e instanceof Error ? e.message : e}`)
      setProgress({ phase: 'idle', done: 0, total: 0 })
    }
  }

  const onSettingsFile = async (f: File | undefined) => {
    if (!f) return
    try {
      await importSettings(f)
    } catch (e) {
      alert(`设置导入失败:${e instanceof Error ? e.message : e}`)
    }
  }

  const onClear = async () => {
    await clearStoredDataset()
    services.volume?.clear()
    setMeta(null)
    setHistograms(null)
    setProgress({ phase: 'idle', done: 0, total: 0 })
  }

  return (
    <header className="toolbar">
      <span className="title">液冷机柜流场体渲染</span>
      <button onClick={() => dataInput.current?.click()}>导入数据</button>
      <button onClick={exportSettings}>导出设置</button>
      <button onClick={() => settingsInput.current?.click()}>导入设置</button>
      <button onClick={onClear}>清除数据</button>
      <input
        ref={dataInput}
        type="file"
        accept=".lcf,.bin,application/octet-stream"
        hidden
        onChange={(e) => {
          onDataFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={settingsInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          onSettingsFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <span className="hint">左键旋转 · 滚轮缩放 · Shift+拖拽框选放大</span>
    </header>
  )
}
