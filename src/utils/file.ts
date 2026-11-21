import type { DockLayout } from '../types'

export function downloadLayout(layout: DockLayout) {
  const blob = new Blob([JSON.stringify(layout, null, 2)], {
    type: 'application/json;charset=utf-8'
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const stamp = layout.exportedAt.replace(/[:.]/g, '-').slice(0, 19)
  a.href = url
  a.download = `dock-layout-${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function pickLayoutFile(): Promise<DockLayout | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)) as DockLayout)
        } catch {
          resolve(null)
        }
      }
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    }
    input.click()
  })
}
