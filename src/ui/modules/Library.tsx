import { useEffect, useState } from 'react'
import type { StationDoc } from '../../core/types.ts'
import { Modal, Empty, fmtBytes, fmtTime } from '../components/controls.tsx'
import { deleteStation, loadStationList, loadRunList, deleteRun, storageEstimate, type StoredRunMeta } from '../dataActions.ts'
import { useSim } from '../../state/store.ts'

export function StationLibrary({ onClose, onOpen }: { onClose: () => void; onOpen: (doc: StationDoc) => void }) {
  const [items, setItems] = useState<StationDoc[] | null>(null)
  const [usage, setUsage] = useState('—')
  useEffect(() => {
    let alive = true
    loadStationList().then((l) => alive && setItems(l))
    storageEstimate().then(({ usage, quota }) => {
      if (alive) setUsage(`${fmtBytes(usage)} / ${quota ? fmtBytes(quota) : '—'}`)
    })
    return () => {
      alive = false
    }
  }, [])
  return (
    <Modal title="站点库" onClose={onClose} narrow footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="hint">浏览器本地存储占用: {usage}</div>
      {items === null && <Empty>读取中…</Empty>}
      {items && items.length === 0 && <Empty>尚无已保存站点。在侧栏「数据」中点「保存到本地」。</Empty>}
      <div className="list">
        {items?.map((d) => (
          <div key={d.id} className="list-item" onClick={() => onOpen(d)}>
            <span className="dot" style={{ background: '#38bdf8' }} />
            <span className="grow">
              <div className="title">{d.meta.name}</div>
              <div className="sub">
                {d.meta.line || '未标注线路'} · {d.zones.length} 区块 · {d.obstacles.length} 障碍 · 更新 {new Date(d.updatedAt).toLocaleString()}
              </div>
            </span>
            <button
              className="btn sm danger"
              onClick={async (e) => {
                e.stopPropagation()
                await deleteStation(d.id)
                setItems(await loadStationList())
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function ReplayLibrary({
  onClose,
  onOpen,
  highlightId,
}: {
  onClose: () => void
  onOpen: (run: StoredRunMeta) => void
  highlightId?: string | null
}) {
  const [items, setItems] = useState<StoredRunMeta[] | null>(null)
  const refresh = () => loadRunList().then(setItems)
  useEffect(() => {
    refresh()
  }, [])
  return (
    <Modal title="回放库" onClose={onClose} footer={<button className="btn" onClick={onClose}>关闭</button>}>
      <div className="hint">导入的仿真包会保存在这里，可随时离线回放、拖动时间轴与修改闸机权重联动重算。</div>
      {items === null && <Empty>读取中…</Empty>}
      {items && items.length === 0 && <Empty>暂无回放。导入 .zip 仿真包后会自动存入。</Empty>}
      <div className="list">
        {items?.map((r) => (
          <div key={r.id} className={`list-item ${highlightId === r.id ? 'selected' : ''}`} onClick={() => onOpen(r)}>
            <span className="dot" style={{ background: '#f72585' }} />
            <span className="grow">
              <div className="title">{r.name}</div>
              <div className="sub">
                {r.stationName} · {r.frameCount} 帧 · {fmtTime(r.duration)} · {new Date(r.createdAt).toLocaleString()}
              </div>
            </span>
            <button
              className="btn sm danger"
              onClick={async (e) => {
                e.stopPropagation()
                await deleteRun(r.id)
                refresh()
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </Modal>
  )
}

/** 全局忙碌进度 */
export function BusyOverlay() {
  const busy = useSim((s) => s.busy)
  const progress = useSim((s) => s.busyProgress)
  if (!busy) return null
  return (
    <div className="loading" style={{ zIndex: 150 }}>
      <div className="loading-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="spinner" />
          <span>{busy}</span>
        </div>
        {progress > 0 && (
          <div className="progress">
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
