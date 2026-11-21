interface Props {
  trajName: string;
  time: number;
  altitude: number;
  speed: number;
  throttle: number;
  tier: string;
}

function fmt(v: number, digits = 0): string {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export default function Hud({ trajName, time, altitude, speed, throttle, tier }: Props) {
  return (
    <div className="hud">
      <div className="hud-title">{trajName}</div>
      <div className="hud-grid">
        <div><label>T+</label><b>{time.toFixed(1)} s</b></div>
        <div><label>高度</label><b>{fmt(altitude)} m</b></div>
        <div><label>速度</label><b>{fmt(speed)} m/s</b></div>
        <div><label>油门</label><b>{Math.round(throttle * 100)}%</b></div>
      </div>
      <div className="hud-tier">粒子档位：{tier}</div>
    </div>
  );
}
