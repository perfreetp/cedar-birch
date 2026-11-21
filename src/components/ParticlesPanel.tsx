import type { SimulationEngine } from '../three/SimulationEngine';
import { state, updateParams } from '../store/appStore';
import { SliderRow, ToggleRow } from './controls';

export function ParticlesPanel(props: { engine: () => SimulationEngine | undefined }) {
  const replayBurst = () => {
    const eng = props.engine();
    if (!eng) return;
    eng.seek(state.params.separationTime);
  };

  return (
    <div class="panel">
      <h3>碎片视效</h3>
      <p class="panel-desc">
        分离瞬间沿两瓣结合面迸发实例化碎片，按分离冲量向两侧扩散并带自旋；
        尘雾点云同步扩散，碎块与卫星/箭体通过 BVH 外包球检测反弹。
      </p>

      <ToggleRow
        label="启用碎片粒子"
        checked={state.params.showParticles}
        onChange={(v) => updateParams({ showParticles: v })}
      />
      <SliderRow
        label="碎块数量"
        value={state.params.particleCount}
        min={40}
        max={500}
        step={10}
        unit=" 块"
        onChange={(v) => updateParams({ particleCount: v })}
      />
      <SliderRow
        label="扩散速度"
        value={state.params.particleSpeed}
        min={1}
        max={10}
        step={0.1}
        unit=" m/s"
        onChange={(v) => updateParams({ particleSpeed: v })}
      />
      <SliderRow
        label="扩散锥角"
        value={state.params.particleSpread}
        min={0.2}
        max={2.4}
        step={0.05}
        unit=" rad"
        onChange={(v) => updateParams({ particleSpread: v })}
      />
      <SliderRow
        label="尘雾点数"
        value={state.params.dustCount}
        min={0}
        max={800}
        step={20}
        unit=" 点"
        onChange={(v) => updateParams({ dustCount: v })}
      />

      <button class="btn btn-secondary" onClick={replayBurst}>
        跳转分离时刻重放迸发
      </button>

      <div class="stat-grid">
        <div class="stat-cell">
          <span class="stat-num">{state.stats.debris}</span>
          <span class="stat-label">活跃碎块</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num">{state.stats.dust}</span>
          <span class="stat-label">活跃尘雾点</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num">{state.stats.collisions}</span>
          <span class="stat-label">碰撞事件</span>
        </div>
        <div class="stat-cell">
          <span class="stat-num">{state.stats.fps}</span>
          <span class="stat-label">FPS</span>
        </div>
      </div>
    </div>
  );
}
