// 设置(传输函数 + 相机 + 切面 + 光源)的导出与导入
import type { SavedSettings } from '../types'
import { cameraBridge, useStore } from '../state/store'

export function exportSettings(): void {
  const s = useStore.getState()
  const camera = cameraBridge.get?.() ?? {
    position: [3, 3, 3] as [number, number, number],
    target: [0, 0, 0] as [number, number, number],
    up: [0, 0, 1] as [number, number, number],
  }
  const settings: SavedSettings = {
    app: 'lcf-volume-viewer',
    version: 1,
    tf: s.tf,
    activeChannel: s.activeChannel,
    slices: s.slices,
    light: s.light,
    camera,
  }
  const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'lcf-viewer-settings.json'
  a.click()
  URL.revokeObjectURL(url)
}

export async function importSettings(file: File): Promise<void> {
  const text = await file.text()
  const obj = JSON.parse(text) as SavedSettings
  if (obj.app !== 'lcf-volume-viewer' || obj.version !== 1)
    throw new Error('不是有效的设置文件')
  const s = useStore.getState()
  if (obj.tf?.temp && obj.tf?.speed) {
    s.setTF('temp', obj.tf.temp)
    s.setTF('speed', obj.tf.speed)
  }
  if (obj.activeChannel) {
    s.setActiveChannel(obj.activeChannel)
    s.setVolumeChannel(obj.activeChannel)
  }
  if (obj.slices) s.setSlices(obj.slices)
  if (obj.light) s.setLight(obj.light)
  if (obj.camera) cameraBridge.set?.(obj.camera)
}
