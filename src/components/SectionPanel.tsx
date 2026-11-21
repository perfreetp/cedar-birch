import { useStore } from '../store';

export default function SectionPanel() {
  const s = useStore();
  const [lo, hi] = s.sectionRange;

  return (
    <div className="card">
      <h2>剖切模块</h2>
      <label className="section-toggle">
        <input
          type="checkbox"
          checked={s.sectionEnabled}
          onChange={(e) => s.setSectionEnabled(e.target.checked)}
        />
        启用船长向剖切平面
      </label>

      <div className="filter-row">
        <input
          type="range"
          min={lo}
          max={hi}
          step={0.1}
          value={s.sectionPosition}
          disabled={!s.sectionEnabled}
          onChange={(e) => s.setSectionPosition(Number(e.target.value))}
        />
        <strong style={{ width: 64, textAlign: 'right' }}>
          X {s.sectionPosition.toFixed(1)} m
        </strong>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="hint" style={{ marginTop: 0, marginBottom: 4 }}>
          半透明显示一侧：
        </div>
        <div className="filter-row">
          <button
            style={{ flex: 1 }}
            className={s.ghostSide === 'positive' ? 'primary' : ''}
            onClick={() => s.setGhostSide('positive')}
          >
            艏部 +X 侧
          </button>
          <button
            style={{ flex: 1 }}
            className={s.ghostSide === 'negative' ? 'primary' : ''}
            onClick={() => s.setGhostSide('negative')}
          >
            艉部 −X 侧
          </button>
        </div>
      </div>

      <div className="hint">
        也可直接在三维视图中拖动青色剖切平面。半透明侧板材与焊缝关闭深度写入、按渲染次序混合，
        实体侧正确遮挡；切开的板边通过 stencil 封边露出内部结构截面。
      </div>
    </div>
  );
}
