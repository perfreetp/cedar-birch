import { createSignal, type JSX } from 'solid-js';
import { Viewport } from './components/Viewport';
import { AssemblyPanel } from './components/AssemblyPanel';
import { TimelinePanel } from './components/TimelinePanel';
import { ParticlesPanel } from './components/ParticlesPanel';
import type { SimulationEngine } from './three/SimulationEngine';
import { state, setTab, resetParams } from './store/appStore';
import { exportParamsFile } from './lib/config';

const TABS = [
  { id: 'assembly', label: '装配预览', icon: '🔧' },
  { id: 'timeline', label: '分离时序', icon: '⏱' },
  { id: 'particles', label: '碎片视效', icon: '✨' },
] as const;

export default function App(): JSX.Element {
  const [engine, setEngine] = createSignal<SimulationEngine>();
  const [toast, setToast] = createSignal('');

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  const snapshot = () => {
    engine()?.exportSnapshot();
    notify('已导出分离瞬间画面 PNG');
  };

  const exportPoses = () => {
    engine()?.exportPoseData(30);
    notify('已导出两瓣罩体位姿数据 JSON（30Hz）');
  };

  const exportConfig = () => {
    exportParamsFile(state.params);
    notify('已导出场景参数 JSON');
  };

  return (
    <div class="app-shell">
      <header class="app-header">
        <div class="brand">
          <span class="brand-mark">🛰</span>
          <div>
            <h1>整流罩分离视效仿真</h1>
            <small>Fairing Separation VFX · SolidJS + three.js + three-mesh-bvh</small>
          </div>
        </div>
        <div class="header-actions">
          <button class="btn" onClick={snapshot}>📸 导出画面</button>
          <button class="btn" onClick={exportPoses}>📐 导位姿数据</button>
          <button class="btn" onClick={exportConfig}>💾 导出场景</button>
          <button
            class="btn btn-ghost"
            onClick={() => {
              resetParams();
              notify('参数已恢复默认（仍保存在本地）');
            }}
          >
            恢复默认
          </button>
        </div>
      </header>

      <main class="app-main">
        <Viewport onEngine={setEngine} />

        <aside class="side-panel">
          <nav class="tabs">
            {TABS.map((tab) => (
              <button
                class="tab-btn"
                classList={{ active: state.tab === tab.id }}
                onClick={() => setTab(tab.id)}
              >
                <span class="tab-icon">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>

          <div class="tab-body">
            {state.tab === 'assembly' && <AssemblyPanel engine={engine} />}
            {state.tab === 'timeline' && <TimelinePanel engine={engine} />}
            {state.tab === 'particles' && <ParticlesPanel engine={engine} />}
          </div>
        </aside>
      </main>

      {toast() && <div class="toast">{toast()}</div>}
    </div>
  );
}
