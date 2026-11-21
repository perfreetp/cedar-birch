import { useRef, useState } from 'react';
import { world } from '../sim/world';
import { downloadSampleNetwork, exportToFile, normalizeNetwork, parseImport } from '../sim/exchange';
import { bump, bumpAll, useStore } from '../state/store';

export default function Toolbar() {
  const cameraMode = useStore((s) => s.cameraMode);
  const followVehicle = useStore((s) => s.followVehicle);
  const selectMode = useStore((s) => s.selectMode);
  const selectedIds = useStore((s) => s.selectedIds);
  const networkVersion = useStore((s) => s.networkVersion);
  const set = useStore((s) => s.set);
  const [pointCount, setPointCount] = useState(1200);
  const [vehicleCount, setVehicleCount] = useState(3);
  const [weightFactor, setWeightFactor] = useState(1.5);
  const netInput = useRef<HTMLInputElement>(null);
  const saveInput = useRef<HTMLInputElement>(null);

  const regenerate = () => {
    world.generateDemo(pointCount, vehicleCount);
    set({ simTime: 0, playing: false });
    bumpAll();
  };

  const onNetworkFile = async (f: File) => {
    try {
      const net = normalizeNetwork(JSON.parse(await f.text()));
      world.setNetwork(net);
      set({ simTime: 0, playing: false });
      bumpAll();
    } catch (err) {
      alert(`导入路网失败：${(err as Error).message}`);
    }
  };

  const onSaveFile = async (f: File) => {
    try {
      const data = parseImport(await f.text());
      world.import(data);
      set({ simTime: Math.min(data.simTime ?? 0, world.dayLength), playing: false });
      bumpAll();
    } catch (err) {
      alert(`导入存档失败：${(err as Error).message}`);
    }
  };

  const applyWeight = () => {
    if (selectedIds.length === 0) return;
    world.applyWeight(selectedIds, weightFactor);
    bump('pointsVersion');
    bump('routesVersion');
  };

  void networkVersion; // 车辆数量变化时触发重渲染

  return (
    <div className="toolbar">
      <span className="brand">垃圾收运三维仿真</span>

      <label>点位</label>
      <input
        type="number"
        min={50}
        max={5000}
        step={50}
        value={pointCount}
        onChange={(e) => setPointCount(Number(e.target.value))}
      />
      <label>车辆</label>
      <input
        type="number"
        min={1}
        max={8}
        value={vehicleCount}
        onChange={(e) => setVehicleCount(Number(e.target.value))}
      />
      <button onClick={regenerate}>生成演示数据</button>

      <span className="sep" />
      <button onClick={() => netInput.current?.click()}>导入路网</button>
      <button onClick={downloadSampleNetwork}>示例路网</button>
      <button onClick={() => saveInput.current?.click()}>导入存档</button>
      <button onClick={() => exportToFile(world, useStore.getState().simTime)}>导出存档</button>
      <input
        ref={netInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onNetworkFile(f);
          e.target.value = '';
        }}
      />
      <input
        ref={saveInput}
        type="file"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onSaveFile(f);
          e.target.value = '';
        }}
      />

      <span className="sep" />
      <button onClick={() => { world.optimize(); bump('routesVersion'); }}>优化全部路线</button>

      <span className="sep" />
      <button
        className={cameraMode === 'top' ? 'active' : ''}
        onClick={() => set({ cameraMode: 'top' })}
      >
        俯视
      </button>
      <button
        className={cameraMode === 'follow' ? 'active' : ''}
        onClick={() => set({ cameraMode: 'follow' })}
      >
        跟车
      </button>
      {cameraMode === 'follow' && (
        <select
          value={followVehicle}
          onChange={(e) => set({ followVehicle: Number(e.target.value) })}
        >
          {world.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      )}

      <span className="sep" />
      <button
        className={selectMode ? 'active' : ''}
        onClick={() => set({ selectMode: !selectMode, selectedIds: [] })}
      >
        框选
      </button>
      {selectedIds.length > 0 && (
        <>
          <span className="sel-count">已选 {selectedIds.length} 点</span>
          <label>权重 ×{weightFactor.toFixed(1)}</label>
          <input
            type="range"
            min={0.2}
            max={3}
            step={0.1}
            value={weightFactor}
            onChange={(e) => setWeightFactor(Number(e.target.value))}
          />
          <button onClick={applyWeight}>应用权重</button>
          <button onClick={() => set({ selectedIds: [] })}>清除</button>
        </>
      )}
    </div>
  );
}
