import { createEffect, onCleanup, onMount } from 'solid-js';
import { SimulationEngine, type EngineStats } from '../three/SimulationEngine';
import { state, setPlaying, setStats, markReady } from '../store/appStore';
import { formatSimTime } from '../lib/mathUtils';

export function Viewport(props: { onEngine: (e: SimulationEngine) => void }) {
  let mount!: HTMLDivElement;
  let engine: SimulationEngine | undefined;

  onMount(() => {
    engine = new SimulationEngine(mount, state.params);
    engine.setStatsHandler((s: EngineStats) => setStats(s));
    props.onEngine(engine);
    markReady();
  });

  onCleanup(() => engine?.dispose());

  createEffect(() => {
    engine?.setParams(state.params);
  });

  const togglePlay = () => {
    if (!engine) return;
    if (state.playing) {
      engine.pause();
      setPlaying(false);
    } else {
      if (engine.time >= engine.maxTime) engine.reset();
      engine.play();
      setPlaying(true);
    }
  };

  const reset = () => {
    engine?.reset();
    setPlaying(false);
  };

  return (
    <div class="viewport">
      <div ref={mount} class="canvas-mount" />

      <div class="hud">
        <div class="hud-row">
          <span class="hud-badge" data-phase={state.stats.phase}>
            {state.stats.phase === 'closed' && '罩体闭合'}
            {state.stats.phase === 'opening' && '铰链张开'}
            {state.stats.phase === 'jettison' && '抛离中'}
            {state.stats.phase === 'done' && '分离完成'}
          </span>
          <span class="hud-time">{formatSimTime(state.stats.t)}</span>
        </div>
        <div class="hud-row hud-sub">
          <span>分离设定 t+{state.params.separationTime.toFixed(1)}s</span>
          <span>倍率 {state.rate}×</span>
          <span>碰撞 {state.stats.collisions}</span>
        </div>
      </div>

      <div class="transport">
        <button class="btn btn-primary" onClick={togglePlay}>
          {state.playing ? '⏸ 暂停' : '▶ 播放'}
        </button>
        <button class="btn" onClick={reset}>⏹ 重置</button>
        <input
          class="seek"
          type="range"
          min={0}
          max={40}
          step={0.05}
          value={state.stats.t}
          onInput={(e) => {
            const v = Number(e.currentTarget.value);
            engine?.seek(v);
          }}
        />
        <span class="seek-value">{state.stats.t.toFixed(1)}s</span>
      </div>
    </div>
  );
}
