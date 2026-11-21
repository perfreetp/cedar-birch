import { useStore } from '../state/store'

const PHASE_LABEL: Record<string, string> = {
  idle: '',
  parsing: '解析文件',
  extract: 'Worker 提取体素',
  bake: '烘焙并上传体纹理',
  ready: '就绪',
}

/** 视口右上角:帧率 + 体素上传进度 + 数据集信息 */
export function Hud() {
  const fps = useStore((s) => s.fps)
  const progress = useStore((s) => s.progress)
  const meta = useStore((s) => s.meta)

  const busy = progress.phase !== 'idle' && progress.phase !== 'ready'
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="hud">
      <div className="hud-line">
        <span className="hud-fps">{fps} FPS</span>
        {meta && (
          <span className="hud-dims">
            {meta.header.dims.join(' × ')} · {meta.name}
          </span>
        )}
      </div>
      {busy && (
        <div className="hud-progress">
          <div className="hud-progress-label">
            {PHASE_LABEL[progress.phase]} {progress.done}/{progress.total}
          </div>
          <div className="hud-bar">
            <div className="hud-bar-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {!meta && !busy && <div className="hud-empty">导入 .lcf 数据文件开始(可拖拽到视口)</div>}
    </div>
  )
}
