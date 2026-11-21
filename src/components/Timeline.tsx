import { world } from '../sim/world';
import { useStore } from '../state/store';
import { fmtTime, hexColor } from '../utils';

export default function Timeline() {
  const simTime = useStore((s) => s.simTime);
  const playing = useStore((s) => s.playing);
  const playSpeed = useStore((s) => s.playSpeed);
  const routesVersion = useStore((s) => s.routesVersion);
  const set = useStore((s) => s.set);
  void routesVersion; // 调度变化时重算时间轴长度
  const dayLen = world.dayLength;
  const tAbs = world.params.dayStart + simTime;

  return (
    <div className="timeline">
      <button className="play" onClick={() => set({ playing: !playing })}>
        {playing ? '⏸' : '▶'}
      </button>
      <select value={playSpeed} onChange={(e) => set({ playSpeed: Number(e.target.value) })}>
        <option value={1}>1x</option>
        <option value={5}>5x</option>
        <option value={15}>15x</option>
        <option value={60}>60x</option>
      </select>
      <span className="clock">{fmtTime(tAbs)}</span>
      <div className="slider-wrap">
        <input
          type="range"
          min={0}
          max={dayLen}
          step={0.5}
          value={simTime}
          onChange={(e) => set({ simTime: Number(e.target.value), playing: false })}
        />
        <div className="vehicle-ranges">
          {world.schedules.map((s, i) => {
            const l = ((s.departTime - world.params.dayStart) / dayLen) * 100;
            const w = ((s.endTime - s.departTime) / dayLen) * 100;
            return (
              <div
                key={i}
                className="range"
                style={{ left: `${l}%`, width: `${w}%`, background: hexColor(world.vehicles[i].color) }}
                title={`${world.vehicles[i].name} ${fmtTime(s.departTime)}-${fmtTime(s.endTime)}`}
              />
            );
          })}
        </div>
      </div>
      <span className="clock">{fmtTime(world.params.dayStart + dayLen)}</span>
    </div>
  );
}
