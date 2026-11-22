import { createSignal } from 'solid-js';
import Viewer3D from './components/Viewer3D';
import ControlPanel from './components/ControlPanel';
import InfoPanel from './components/InfoPanel';
import { SelectionInfo } from './three/sceneManager';
import {
  layout,
  sectionZ,
  groove,
  weld,
  selectedBeadId,
  setSelectedBeadId,
} from './state/store';

export default function App() {
  const [selection, setSelection] = createSignal<SelectionInfo | null>(null);

  const handleSelection = (info: SelectionInfo | null) => {
    setSelection(info);
    setSelectedBeadId(info ? info.bead.id : null);
  };

  return (
    <div class="app">
      <header class="app-header">
        <h1>焊接接头多层多道焊道工艺剖切可视化</h1>
        <div class="header-meta">
          <span>{groove.type} 型坡口 · T{groove.thickness}</span>
          <span>{weld.layerCount} 层 / 共 {layout().beads.length} 道</span>
          <span>
            剖切 z = {sectionZ().toFixed(1)} / {groove.weldLength} mm
          </span>
          {selectedBeadId() && <span class="header-sel">选中 {selectedBeadId()}</span>}
        </div>
      </header>
      <main class="app-main">
        <ControlPanel />
        <Viewer3D onSelection={handleSelection} />
        <InfoPanel info={selection()} />
      </main>
    </div>
  );
}
