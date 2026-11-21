import type { RendererSettings } from '../types';

interface Props {
  settings: RendererSettings;
  playing: boolean;
  exporting: boolean;
  onPatch: (patch: Partial<RendererSettings>) => void;
  onTogglePlay: () => void;
  onImportClick: () => void;
  onExportFrame: () => void;
  onExportSequence: () => void;
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span className="dot" />
      {label}
    </button>
  );
}

export default function ControlPanel({
  settings, playing, exporting, onPatch, onTogglePlay, onImportClick, onExportFrame, onExportSequence,
}: Props) {
  return (
    <aside className="panel">
      <div className="panel-section">
        <h2>回放</h2>
        <div className="row">
          <button className="btn primary" onClick={onTogglePlay}>
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button
            className="btn"
            onClick={() => onPatch({ speed: settings.speed === 1 ? 0.5 : 1 })}
            title="在 1× 与 0.5× 慢放之间切换"
          >
            速度 {settings.speed}×
          </button>
        </div>
        <div className="row">
          <button
            className={`btn seg ${settings.cameraMode === 'follow' ? 'active' : ''}`}
            onClick={() => onPatch({ cameraMode: 'follow' })}
          >
            跟随视角
          </button>
          <button
            className={`btn seg ${settings.cameraMode === 'ground' ? 'active' : ''}`}
            onClick={() => onPatch({ cameraMode: 'ground' })}
          >
            地面固定
          </button>
        </div>
      </div>

      <div className="panel-section">
        <h2>图层开关</h2>
        <Toggle label="马赫环" on={settings.showMach} onChange={(v) => onPatch({ showMach: v })} />
        <Toggle label="烟羽" on={settings.showSmoke} onChange={(v) => onPatch({ showSmoke: v })} />
        <Toggle label="泛光 Bloom" on={settings.bloom} onChange={(v) => onPatch({ bloom: v })} />
      </div>

      <div className="panel-section">
        <h2>风场（地面段）</h2>
        <div className="slider-row">
          <input
            type="range"
            min={0}
            max={40}
            step={1}
            value={settings.wind}
            onChange={(e) => onPatch({ wind: Number(e.target.value) })}
          />
          <span className="value">{settings.wind} m/s</span>
        </div>
      </div>

      <div className="panel-section">
        <h2>数据与导出</h2>
        <button className="btn wide" onClick={onImportClick}>导入弹道 JSON</button>
        <div className="row">
          <button className="btn" onClick={onExportFrame} disabled={exporting}>当前帧 PNG</button>
          <button className="btn" onClick={onExportSequence} disabled={exporting}>
            {exporting ? '生成中…' : '关键帧序列'}
          </button>
        </div>
        <p className="hint">序列：沿弹道等距抽取 24 帧 PNG，自动错峰下载。</p>
      </div>
    </aside>
  );
}
