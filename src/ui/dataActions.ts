// 导入导出与本地库的编排逻辑
import { useCallback } from 'react'
import type { StationDoc } from '../core/types.ts'
import type { ImportedRun } from '../core/export.ts'
import { buildExportZip, parseExportZip } from '../core/export.ts'
import { getRun, listRuns, listStations, saveRun, saveStation, storageEstimate, deleteRun, deleteStation, type StoredRunMeta } from '../core/storage.ts'
import type { LiveClient } from '../state/liveClient.ts'
import { useApp, useSim } from '../state/store.ts'

export function downloadBlob(data: Uint8Array | Blob, filename: string) {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function safeFilename(name: string): string {
  return (name || 'station').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
}

export function useDataActions(client: LiveClient | null) {
  const toast = useApp((s) => s.toast)

  const exportRun = useCallback(async () => {
    if (!client) {
      toast('仿真尚未初始化', 'error')
      return
    }
    const doc = useApp.getState().doc
    useSim.setState({ busy: '正在打包导出…', busyProgress: 0 })
    try {
      const payload = await client.exportData()
      if (payload.frames.length === 0) {
        toast('还没有生成任何热力帧, 请先播放仿真', 'error')
        useSim.setState({ busy: null })
        return
      }
      const zip = buildExportZip({
        doc: payload.doc ?? doc,
        frames: payload.frames.map((f) => ({ time: f.time, compressed: f.compressed, stats: f.stats })),
        agentsSnapshots: payload.agentsSnapshots,
        frameStart: payload.frameStart,
      })
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
      downloadBlob(zip, `${safeFilename(doc.meta.name)}_${stamp}.phs.zip`)
      toast(`已导出 ${payload.frames.length} 帧 (${(zip.length / 1024 / 1024).toFixed(1)} MB)`, 'success')
    } catch (err) {
      toast(`导出失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    } finally {
      useSim.setState({ busy: null })
    }
  }, [client, toast])

  const importRun = useCallback(
    async (file: File) => {
      useSim.setState({ busy: `正在读取 ${file.name}…`, busyProgress: 0 })
      try {
        const buf = new Uint8Array(await file.arrayBuffer())
        const run = parseExportZip(buf)
        // 存到 IndexedDB 并切到回放
        const id = await saveRun(run, file.name.replace(/\.(zip|phs|phsx)$/i, ''))
        useApp.getState().loadStation(run.doc)
        useSim.setState({ imported: true, importName: run.manifest.station.name, busy: null })
        toast(`已导入 ${run.frames.length} 帧, 已存入回放库 (#${id.slice(-5)})`, 'success')
        window.dispatchEvent(new CustomEvent('phs:open-replay', { detail: { id } }))
      } catch (err) {
        toast(`导入失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
        useSim.setState({ busy: null })
      }
    },
    [toast],
  )

  const saveCurrentStation = useCallback(async () => {
    const doc = useApp.getState().doc
    try {
      await saveStation(doc)
      useApp.setState({ dirty: false })
      toast('站点已保存到浏览器', 'success')
    } catch (err) {
      toast(`保存失败: ${err instanceof Error ? err.message : String(err)}`, 'error')
    }
  }, [toast])

  return { exportRun, importRun, saveCurrentStation }
}

export async function loadStationList(): Promise<StationDoc[]> {
  try {
    return await listStations()
  } catch {
    return []
  }
}

export async function loadRunList(): Promise<StoredRunMeta[]> {
  try {
    return await listRuns()
  } catch {
    return []
  }
}

export { getRun, deleteRun, deleteStation, storageEstimate }
export type { StoredRunMeta, ImportedRun }
