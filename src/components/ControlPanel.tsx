import { For, Match, Switch } from 'solid-js';
import {
  groove,
  setGroove,
  weld,
  setWeld,
  sectionZ,
  setSectionZ,
  peelLayers,
  setPeelLayers,
  thermalOn,
  setThermalOn,
  clippingOn,
  setClippingOn,
  layout,
  resetAll,
} from '../state/store';
import { THERMAL_BINS } from '../weld/thermal';
import { downloadJson, buildExportPayload } from '../weld/export';
import { thermalMap } from '../state/store';

function Field(props: { label: string; children: any }) {
  return (
    <label class="field">
      <span class="field-label">{props.label}</span>
      {props.children}
    </label>
  );
}

export default function ControlPanel() {
  const exportCurrent = () => {
    const payload = buildExportPayload(
      groove,
      weld,
      layout().beads,
      sectionZ(),
      peelLayers(),
      thermalOn(),
      thermalMap(),
    );
    downloadJson(payload);
  };

  return (
    <div class="panel">
      <h2>工艺参数</h2>

      <section class="group">
        <h3>坡口几何</h3>
        <Field label="坡口形式">
          <select
            value={groove.type}
            onChange={(e) => setGroove('type', e.currentTarget.value as 'V' | 'U')}
          >
            <option value="V">V 型坡口</option>
            <option value="U">U 型坡口</option>
          </select>
        </Field>
        <Field label={`板厚 T = ${groove.thickness} mm`}>
          <input
            type="range"
            min="14"
            max="60"
            step="1"
            value={groove.thickness}
            onInput={(e) => setGroove('thickness', +e.currentTarget.value)}
          />
        </Field>
        <Field label={`顶部开口 = ${groove.topWidth} mm`}>
          <input
            type="range"
            min="10"
            max="40"
            step="0.5"
            value={groove.topWidth}
            onInput={(e) => setGroove('topWidth', +e.currentTarget.value)}
          />
        </Field>
        <Field label={`根部间隙 g = ${groove.rootGap} mm`}>
          <input
            type="range"
            min="1"
            max="8"
            step="0.5"
            value={groove.rootGap}
            onInput={(e) => setGroove('rootGap', +e.currentTarget.value)}
          />
        </Field>
        <Field label={`钝边 h = ${groove.rootLand} mm`}>
          <input
            type="range"
            min="0"
            max="6"
            step="0.5"
            value={groove.rootLand}
            onInput={(e) => setGroove('rootLand', +e.currentTarget.value)}
          />
        </Field>
        <Switch>
          <Match when={groove.type === 'U'}>
            <Field label={`圆弧半径 R = ${groove.uRadius} mm`}>
              <input
                type="range"
                min="2"
                max="8"
                step="0.5"
                value={groove.uRadius}
                onInput={(e) => setGroove('uRadius', +e.currentTarget.value)}
              />
            </Field>
          </Match>
        </Switch>
        <Field label={`焊缝长度 L = ${groove.weldLength} mm`}>
          <input
            type="range"
            min="60"
            max="300"
            step="10"
            value={groove.weldLength}
            onInput={(e) => setGroove('weldLength', +e.currentTarget.value)}
          />
        </Field>
      </section>

      <section class="group">
        <h3>层道配置</h3>
        <Field label={`层数(打底→盖面)= ${weld.layerCount}`}>
          <input
            data-testid="layer-count"
            type="range"
            min="6"
            max="30"
            step="1"
            value={weld.layerCount}
            onInput={(e) => {
              const n = +e.currentTarget.value;
              setWeld('layerCount', n);
              setPeelLayers(Math.min(peelLayers(), n));
            }}
          />
        </Field>
        <Field label="每层道数">
          <select
            data-testid="pass-mode"
            value={weld.passMode}
            onChange={(e) => setWeld('passMode', e.currentTarget.value as 'auto' | 'fixed')}
          >
            <option value="auto">按坡口宽度自动排布</option>
            <option value="fixed">固定道数</option>
          </select>
        </Field>
        <Switch>
          <Match when={weld.passMode === 'fixed'}>
            <Field label={`固定道数 = ${weld.fixedPasses}`}>
              <input
                data-testid="fixed-passes"
                type="range"
                min="1"
                max="8"
                step="1"
                value={weld.fixedPasses}
                onInput={(e) => setWeld('fixedPasses', +e.currentTarget.value)}
              />
            </Field>
          </Match>
        </Switch>
        <Field label={`道间距/直径 = ${weld.passOverlap.toFixed(2)}`}>
          <input
            type="range"
            min="0.6"
            max="1.1"
            step="0.05"
            value={weld.passOverlap}
            onInput={(e) => setWeld('passOverlap', +e.currentTarget.value)}
          />
        </Field>
        <Field label={`直径/层厚 = ${weld.layerOverlap.toFixed(2)}`}>
          <input
            type="range"
            min="1.05"
            max="1.7"
            step="0.05"
            value={weld.layerOverlap}
            onInput={(e) => setWeld('layerOverlap', +e.currentTarget.value)}
          />
        </Field>
        <Field label={`熔深比 p/D = ${weld.penetrationRatio.toFixed(2)}`}>
          <input
            type="range"
            min="0.05"
            max="0.3"
            step="0.01"
            value={weld.penetrationRatio}
            onInput={(e) => setWeld('penetrationRatio', +e.currentTarget.value)}
          />
        </Field>
        <div class="stat-row">
          <span>总道数</span>
          <strong>{layout().beads.length}</strong>
        </div>
        <div class="pass-table">
          <For each={layout().passesPerLayer}>
            {(n, i) => (
              <span class="pass-chip" title={`第 ${i() + 1} 层`}>
                L{i() + 1}:{n}
              </span>
            )}
          </For>
        </div>
      </section>

      <section class="group">
        <h3>剖切与显示</h3>
        <Field label={`剖切面位置 z = ${sectionZ().toFixed(1)} mm`}>
          <input
            data-testid="section-z"
            type="range"
            min={-groove.weldLength / 2}
            max={groove.weldLength / 2}
            step="0.5"
            value={sectionZ()}
            onInput={(e) => setSectionZ(+e.currentTarget.value)}
          />
        </Field>
        <label class="check">
          <input
            type="checkbox"
            checked={clippingOn()}
            onChange={(e) => setClippingOn(e.currentTarget.checked)}
          />
          启用剖切
        </label>
        <Field label={`逐层剥开: 可见前 ${peelLayers()} / ${weld.layerCount} 层`}>
          <input
            data-testid="peel-layers"
            type="range"
            min="1"
            max={weld.layerCount}
            step="1"
            value={peelLayers()}
            onInput={(e) => setPeelLayers(+e.currentTarget.value)}
          />
        </Field>
        <button class="btn" onClick={() => setPeelLayers(1)}>
          只看打底层(根部成形)
        </button>
        <button class="btn" onClick={() => setPeelLayers(weld.layerCount)}>
          恢复全部层
        </button>
        <label class="check">
          <input
            data-testid="thermal-toggle"
            type="checkbox"
            checked={thermalOn()}
            onChange={(e) => setThermalOn(e.currentTarget.checked)}
          />
          道间温度分布叠加
        </label>
        <div class="legend">
          <For each={THERMAL_BINS}>
            {(bin) => (
              <div class="legend-row">
                <span class="legend-swatch" style={{ background: bin.css }} />
                <span>{bin.label}</span>
              </div>
            )}
          </For>
        </div>
      </section>

      <section class="group">
        <button class="btn primary" data-testid="export-json" onClick={exportCurrent}>
          导出剖切位置与层道配置 (JSON)
        </button>
        <button class="btn" onClick={resetAll}>
          恢复默认参数
        </button>
      </section>
    </div>
  );
}
