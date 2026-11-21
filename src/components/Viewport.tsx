import { useEffect, useRef, useState } from 'react';
import { SceneManager } from '../three/SceneManager';
import { useStore } from '../state/store';
import { world } from '../sim/world';
import { fmtTime } from '../utils';

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export default function Viewport() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mgrRef = useRef<SceneManager | null>(null);
  const selectMode = useStore((s) => s.selectMode);
  const infoPoint = useStore((s) => s.infoPoint);
  const set = useStore((s) => s.set);
  const [rect, setRect] = useState<Rect | null>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const mgr = new SceneManager(canvasRef.current!);
    mgrRef.current = mgr;
    return () => mgr.dispose();
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = local(e);
    dragStart.current = p;
    if (selectMode) {
      setRect({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!rect || !dragStart.current) return;
    const p = local(e);
    setRect({
      x0: Math.min(dragStart.current.x, p.x),
      y0: Math.min(dragStart.current.y, p.y),
      x1: Math.max(dragStart.current.x, p.x),
      y1: Math.max(dragStart.current.y, p.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (rect && mgrRef.current) {
      const r = rect;
      setRect(null);
      if (r.x1 - r.x0 > 4 && r.y1 - r.y0 > 4) {
        const ids = mgrRef.current.boxSelect(r);
        set({ selectedIds: ids, infoPoint: null });
      }
      return;
    }
    // 普通点击拾取（位移小于阈值）
    if (start && !selectMode && mgrRef.current) {
      const p = local(e);
      if (Math.hypot(p.x - start.x, p.y - start.y) < 5) {
        const id = mgrRef.current.pick(e.clientX, e.clientY);
        set(id !== null ? { selectedIds: [id], infoPoint: id } : { selectedIds: [], infoPoint: null });
      }
    }
  };

  const info = infoPoint !== null ? world.pointMap.get(infoPoint) : null;
  const infoVehicle = info
    ? world.orders.findIndex((o) => o.includes(info.id))
    : -1;
  const infoArrival =
    info && infoVehicle >= 0
      ? world.schedules[infoVehicle]?.loadEvents.find((ev) => ev.pointId === info.id)?.t
      : undefined;

  return (
    <div
      className="viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <canvas ref={canvasRef} />
      {rect && (
        <div
          className="select-rect"
          style={{ left: rect.x0, top: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 }}
        />
      )}
      {info && (
        <div className="info-card">
          <div className="info-title">点位 #{info.id}</div>
          <div>产生量：{info.amount}（权重 ×{info.weight} → 有效 {Math.round(world.eff(info))}）</div>
          <div>
            所属：{infoVehicle >= 0 ? world.vehicles[infoVehicle].name : '未分配'}
            {infoArrival !== undefined && ` · 预计 ${fmtTime(infoArrival)} 到达`}
          </div>
          <div>
            坐标：({info.x.toFixed(1)}, {info.z.toFixed(1)})
          </div>
        </div>
      )}
    </div>
  );
}
