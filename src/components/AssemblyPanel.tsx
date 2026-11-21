import type { SimulationEngine } from '../three/SimulationEngine';
import { state, updateParams } from '../store/appStore';
import { SliderRow, ToggleRow } from './controls';

export function AssemblyPanel(props: { engine: () => SimulationEngine | undefined }) {
  const seekClosed = () => props.engine()?.seek(0);

  return (
    <div class="panel">
      <h3>装配预览</h3>
      <p class="panel-desc">
        两瓣罩体通过纵剖线处的铰链装配在箭体级间环上，卫星位于罩腔内部。
      </p>

      <ToggleRow
        label="爆炸视图（分解装配）"
        checked={state.params.exploded}
        onChange={(v) => {
          updateParams({ exploded: v });
          if (v) props.engine()?.setExploded(true);
        }}
      />
      <SliderRow
        label="分解距离"
        value={state.params.explodeAmount}
        min={0.4}
        max={4}
        step={0.1}
        unit=" m"
        onChange={(v) => updateParams({ explodeAmount: v })}
      />
      <ToggleRow
        label="铰链标识"
        checked={state.params.showHingeHelper}
        onChange={(v) => updateParams({ showHingeHelper: v })}
      />
      <ToggleRow
        label="相机自动环绕"
        checked={state.params.autoRotate}
        onChange={(v) => updateParams({ autoRotate: v })}
      />

      <div class="form-block">
        <h4>相机跟随模式</h4>
        <div class="seg-group">
          {(
            [
              ['rocket', '跟随箭体'],
              ['fairing', '跟随罩体抛离'],
              ['manual', '手动（不跟随）'],
            ] as const
          ).map(([mode, label]) => (
            <button
              class="seg-btn"
              classList={{ active: state.params.followMode === mode }}
              onClick={() => updateParams({ followMode: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        <p class="hint">手动拖拽画面后自动切换为手动模式，重置可恢复跟随。</p>
      </div>

      <button class="btn btn-secondary" onClick={seekClosed}>
        回到闭合装配位姿
      </button>

      <div class="spec-card">
        <h4>装配规格</h4>
        <dl>
          <div><dt>罩体半径</dt><dd>0.95 m</dd></div>
          <div><dt>罩体高度</dt><dd>4.60 m（圆柱段 2.6 m + 拱顶）</dd></div>
          <div><dt>铰链形式</dt><dd>纵剖线单铰链，2 个安装座/瓣</dd></div>
          <div><dt>碰撞检测</dt><dd>three-mesh-bvh 罩体–卫星/箭体</dd></div>
        </dl>
      </div>
    </div>
  );
}
