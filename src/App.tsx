import { useCallback, useRef } from 'react';
import Viewer from './components/Viewer';
import DataPanel from './components/DataPanel';
import SectionPanel from './components/SectionPanel';
import WeldList from './components/WeldList';
import ExportPanel from './components/ExportPanel';
import { useStore } from './store';
import type { SceneManager } from './lib/SceneManager';
import type { ViewConfigFile } from './types';

export default function App() {
  const mgrRef = useRef<SceneManager | null>(null);
  const setLoadState = useStore((s) => s.setLoadState);

  const handleReady = useCallback((mgr: SceneManager) => {
    mgrRef.current = mgr;
  }, []);

  const handleImportModel = useCallback(
    async (file: File) => {
      const mgr = mgrRef.current;
      if (!mgr) {
        setLoadState('error', '请先导入焊缝数据');
        return;
      }
      try {
        setLoadState('loading');
        await mgr.loadModelFile(file);
        setLoadState('ready');
      } catch (err) {
        setLoadState('error', err instanceof Error ? err.message : '模型导入失败');
      }
    },
    [setLoadState],
  );

  const handleApplyConfig = useCallback((_cfg: ViewConfigFile) => {
    // 剖切范围与全部视图参数由 store 订阅自动同步到场景，这里保留扩展点
  }, []);

  const datasetName = useStore((s) => s.datasetName);
  const total = useStore((s) => s.welds.length);

  return (
    <div className="app">
      <header className="topbar">
        <h1>船体分段焊缝间隙可视化平台</h1>
        <span className="hint" style={{ marginTop: 0 }}>
          {datasetName ? `${datasetName}｜${total.toLocaleString()} 条焊缝` : '未装载数据'}
        </span>
        <span className="spacer" />
        <span className="hint" style={{ marginTop: 0 }}>
          左键旋转 · 右键平移 · 滚轮缩放 · 点击焊缝查看读数
        </span>
      </header>

      <aside className="sidebar left">
        <DataPanel onImportModel={handleImportModel} onApplyConfig={handleApplyConfig} />
      </aside>

      <Viewer onReady={handleReady} />

      <aside className="sidebar right" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <SectionPanel />
        <ExportPanel />
        <div style={{ flex: 1, minHeight: 240, display: 'flex' }}>
          <WeldList />
        </div>
      </aside>
    </div>
  );
}
