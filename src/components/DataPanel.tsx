import { useRef } from 'react';
import { useStore } from '../store';
import { binLabel } from '../lib/heat';
import { generateSampleDataset } from '../lib/sampleData';
import { importConfig, importWeldData } from '../lib/io';
import type { ViewConfigFile } from '../types';

interface Props {
  onImportModel: (file: File) => Promise<void>;
  onApplyConfig: (cfg: ViewConfigFile) => void;
}

export default function DataPanel({ onImportModel, onApplyConfig }: Props) {
  const weldInputRef = useRef<HTMLInputElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const configInputRef = useRef<HTMLInputElement>(null);

  const s = useStore();
  const total = s.welds.length;
  const visibleCount = s.welds.filter(
    (w) => w.gap >= s.gapFilter[0] && w.gap <= s.gapFilter[1],
  ).length;

  const loadSample = () => {
    const ds = generateSampleDataset(30000);
    s.setDataset(ds.name, ds.welds, ds.plates ?? []);
  };

  const handleWeldFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      s.setLoadState('loading');
      const ds = await importWeldData(file);
      s.setDataset(ds.name, ds.welds, ds.plates ?? []);
    } catch (err) {
      s.setLoadState('error', err instanceof Error ? err.message : '导入失败');
    }
  };

  const handleConfigFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const cfg = await importConfig(file);
      s.applyConfig(cfg);
      s.recompute();
      onApplyConfig(cfg);
    } catch (err) {
      s.setLoadState('error', err instanceof Error ? err.message : '配置导入失败');
    }
  };

  return (
    <>
      <div className="card">
        <h2>数据导入</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="primary" onClick={loadSample} disabled={s.loadState === 'loading'}>
            加载示例分段（3 万条焊缝）
          </button>
          <button onClick={() => weldInputRef.current?.click()}>导入焊缝数据 (JSON)</button>
          <button onClick={() => modelInputRef.current?.click()}>导入分段模型 (GLB/GLTF)</button>
          <button onClick={() => configInputRef.current?.click()}>导入视图配置</button>
          <input
            ref={weldInputRef}
            className="file-input"
            type="file"
            accept=".json,application/json"
            onChange={(e) => handleWeldFile(e.target.files?.[0])}
          />
          <input
            ref={modelInputRef}
            className="file-input"
            type="file"
            accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportModel(f);
              e.target.value = '';
            }}
          />
          <input
            ref={configInputRef}
            className="file-input"
            type="file"
            accept=".json,application/json"
            onChange={(e) => handleConfigFile(e.target.files?.[0])}
          />
        </div>
        {s.datasetName && (
          <div className="hint">
            当前数据集：<strong>{s.datasetName}</strong>
          </div>
        )}
      </div>

      <div className="card">
        <h2>间隙统计</h2>
        <div className="stat-big">{total.toLocaleString()}</div>
        <div className="stat-sub">焊缝总数（筛选后 {visibleCount.toLocaleString()} 条）</div>
        <div style={{ height: 10 }} />
        <div className={`stat-big ${s.overThresholdCount ? 'over' : 'ok'}`}>
          {s.overThresholdCount.toLocaleString()}
        </div>
        <div className="stat-sub">
          超差焊缝（间隙 &gt; {s.threshold.toFixed(1)} mm）
        </div>
      </div>

      <div className="card">
        <h2>热力色阶（0–8 mm / 9 档）</h2>
        {s.bins.map((b) => (
          <div className="legend-row" key={b.index}>
            <div className="color-edit">
              <input
                type="color"
                value={b.color}
                title="自定义该档颜色"
                onChange={(e) => s.setPaletteColor(b.index, e.target.value)}
              />
            </div>
            <span className="legend-label">{binLabel(b.index)}</span>
            <span className="legend-count">{b.count.toLocaleString()}</span>
          </div>
        ))}
        <button style={{ marginTop: 8, width: '100%' }} onClick={s.resetPalette}>
          恢复默认调色板
        </button>
      </div>

      <div className="card">
        <h2>超差阈值</h2>
        <div className="filter-row">
          <input
            type="range"
            min={0}
            max={8}
            step={0.1}
            value={s.threshold}
            onChange={(e) => s.setThreshold(Number(e.target.value))}
          />
          <strong style={{ width: 52, textAlign: 'right' }}>{s.threshold.toFixed(1)} mm</strong>
        </div>
        <div className="hint">
          超过阈值的焊缝以脉动高亮标出；拖动时颜色与统计实时重算（GPU 实例缓冲更新）。
        </div>
        <div style={{ height: 10 }} />
        <h2>间隙区间筛选</h2>
        <div className="filter-row">
          <input
            type="number"
            min={0}
            step={0.1}
            value={s.gapFilter[0]}
            onChange={(e) => s.setGapFilter([Number(e.target.value), s.gapFilter[1]])}
          />
          <span>—</span>
          <input
            type="number"
            min={0}
            step={0.1}
            value={s.gapFilter[1]}
            onChange={(e) => s.setGapFilter([s.gapFilter[0], Number(e.target.value)])}
          />
          <span className="hint" style={{ marginTop: 0 }}>
            mm
          </span>
        </div>
        <button
          style={{ marginTop: 8, width: '100%' }}
          onClick={() => s.setGapFilter([0, Math.max(12, ...s.welds.map((w) => Math.ceil(w.gap)))])}
        >
          清除筛选
        </button>
      </div>
    </>
  );
}
