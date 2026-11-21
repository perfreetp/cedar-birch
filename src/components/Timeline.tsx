interface Props {
  time: number;
  duration: number;
  onScrub: (t: number) => void;
  formatTime: (t: number) => string;
}

export default function Timeline({ time, duration, onScrub, formatTime }: Props) {
  const pct = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <div className="timeline">
      <span className="tl-time">{formatTime(time)}</span>
      <div className="tl-track">
        <div className="tl-fill" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={0}
          max={duration}
          step={duration / 500}
          value={time}
          onChange={(e) => onScrub(Number(e.target.value))}
          aria-label="时间轴拖动"
        />
      </div>
      <span className="tl-time dim">{formatTime(duration)}</span>
    </div>
  );
}
