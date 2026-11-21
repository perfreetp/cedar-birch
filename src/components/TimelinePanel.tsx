import type { SimulationEngine } from '../three/SimulationEngine';
import type { SlowMotionRate } from '../types';
import { setRate, state, updateParams } from '../store/appStore';
import { SliderRow } from './controls';

const RATES: SlowMotionRate[] = [1, 0.5, 0.25, 0.1];
const RATE_LABEL: Record<SlowMotionRate, string> = {
  1: '1× 正常',
  0.5: '0.5× 慢放',
  0.25: '0.25× 慢放',
  0.1: '0.1× 超慢',
};

export function TimelinePanel(props: { engine: () => SimulationEngine | undefined }) {
  const phaseText: Record<string, string> = {
    closed: '罩体闭合',
    opening: '铰链张开中',
    jettison: '沿分离方向抛离',
    done: '分离完成',
  };

  return (
    <div class="panel">
      <h3>分离时序</h3>
      <p class="panel-desc">
        分离时刻可在起飞后 2–20 秒内调节；触发后罩体先绕铰链张开，再沿分离方向抛离。
      </p>

      <SliderRow
        label="分离时刻"
        value={state.params.separationTime}
        min={2}
        max={20}
        step={0.5}
        unit=" s"
        hint="起飞后"
        onChange={(v) => updateParams({ separationTime: v })}
      />
      <SliderRow
        label="张开时长"
        value={state.params.openDuration}
        min={0.3}
        max={4}
        step={0.1}
        unit=" s"
        onChange={(v) => updateParams({ openDuration: v })}
      />
      <SliderRow
        label="最终张开角"
        value={state.params.openAngle}
        min={20}
        max={110}
        step={1}
        unit=" °"
        onChange={(v) => updateParams({ openAngle: v })}
      />
      <SliderRow
        label="抛离时长"
        value={state.params.jettisonDuration}
        min={0.5}
        max={6}
        step={0.1}
        unit=" s"
        onChange={(v) => updateParams({ jettisonDuration: v })}
      />
      <SliderRow
        label="径向抛离速度"
        value={state.params.jettisonSpeed}
        min={0.5}
        max={8}
        step={0.1}
        unit=" m/s"
        onChange={(v) => updateParams({ jettisonSpeed: v })}
      />
      <SliderRow
        label="轴向速度"
        value={state.params.axialSpeed}
        min={0}
        max={5}
        step={0.1}
        unit=" m/s"
        onChange={(v) => updateParams({ axialSpeed: v })}
      />

      <div class="form-block">
        <h4>慢放倍率</h4>
        <div class="seg-group">
          {RATES.map((r) => (
            <button
              class="seg-btn"
              classList={{ active: state.rate === r }}
              onClick={() => {
                props.engine()?.setRate(r);
                setRate(r);
              }}
            >
              {RATE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      <div class="phase-card">
        <div class="phase-dot" data-phase={state.stats.phase} />
        <div>
          <div class="phase-name">{phaseText[state.stats.phase]}</div>
          <div class="phase-meta">
            t = {state.stats.t.toFixed(2)} s · 碰撞事件 {state.stats.collisions} 次
          </div>
        </div>
      </div>
      <p class="hint">
        若轨迹参数导致罩体与卫星/箭体穿模，BVH 检测会自动回退罩体位姿并在此记录碰撞事件。
      </p>
    </div>
  );
}
