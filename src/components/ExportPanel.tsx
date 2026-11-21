import { useStore } from '../store';
import { exportConfig } from '../lib/io';
import type { ViewConfigFile } from '../types';

export default function ExportPanel() {
  const s = useStore();

  const doExport = () => {
    const cfg: ViewConfigFile = {
      type: 'weld-gap-view-config',
      version: 1,
      datasetName: s.datasetName,
      palette: s.palette,
      threshold: s.threshold,
      gapFilter: s.gapFilter,
      section: {
        enabled: s.sectionEnabled,
        position: s.sectionPosition,
        range: s.sectionRange,
        ghostSide: s.ghostSide,
      },
      exportedAt: new Date().toISOString(),
    };
    exportConfig(cfg);
  };

  return (
    <div className="card">
      <h2>视图方案导出</h2>
      <div className="hint" style={{ marginTop: 0 }}>
        导出当前 9 档着色方案、超差阈值、间隙筛选与剖切状态为 JSON；他人在本机导入同一配置文件后，
        即可还原相同的热力图与剖切视图。
      </div>
      <button className="primary" style={{ width: '100%', marginTop: 8 }} onClick={doExport} disabled={!s.welds.length}>
        导出配置文件
      </button>
    </div>
  );
}
