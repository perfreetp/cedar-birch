import { useMemo, useState } from 'react';
import { world } from '../sim/world';
import { bump, useStore } from '../state/store';
import { fmtTime, hexColor } from '../utils';
import { TIERS } from '../three/builders';

function VehicleCard({ vid, tAbs }: { vid: number; tAbs: number }) {
  const [open, setOpen] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const set = useStore((s) => s.set);
  const v = world.vehicles[vid];
  const sched = world.schedules[vid];
  const order = world.orders[vid] || [];
  const st = world.positionAt(vid, tAbs);
  const load = st?.load ?? 0;
  const frac = Math.min(1, load / v.capacity);

  const arrivals = useMemo(() => {
    const m = new Map<number, number>();
    sched?.loadEvents.forEach((e) => {
      if (e.pointId !== undefined && !m.has(e.pointId)) m.set(e.pointId, e.t);
    });
    return m;
  }, [sched]);

  const move = (from: number, to: number) => {
    if (from === to || from === null) return;
    const o = [...order];
    const [it] = o.splice(from, 1);
    o.splice(to, 0, it);
    world.setOrder(vid, o); // 拖拽后重算最短收运路径
    bump('routesVersion');
  };

  const stateText: Record<string, string> = {
    parked: '待出发',
    travel: '行驶中',
    service: '作业中',
    unload: '卸载中',
    done: '已收车',
  };

  return (
    <div className="vehicle-card">
      <div className="vehicle-head" onClick={() => setOpen(!open)}>
        <span className="dot" style={{ background: hexColor(v.color) }} />
        <span className="vname">{v.name}</span>
        <span className="vstate">{st ? stateText[st.state] : ''}</span>
        <button
          className="mini"
          onClick={(e) => {
            e.stopPropagation();
            set({ cameraMode: 'follow', followVehicle: vid });
          }}
        >
          跟车
        </button>
      </div>
      <div className="loadbar" title={`装载 ${Math.round(load)} / ${v.capacity}`}>
        <div
          className="loadfill"
          style={{
            width: `${frac * 100}%`,
            background: frac > world.params.threshold ? '#e23b3b' : frac > 0.5 ? '#f5d90a' : '#37d67a',
          }}
        />
      </div>
      <div className="vstats">
        <span>
          装载 {Math.round(load)}/{v.capacity}
        </span>
        <span>点位 {order.length}</span>
        <span>里程 {(sched ? sched.totalDist / 1000 : 0).toFixed(1)}km</span>
      </div>
      <div className="vstats">
        <span>出发 {sched ? fmtTime(sched.departTime) : '--'}</span>
        <span>收车 {sched ? fmtTime(sched.endTime) : '--'}</span>
        <button
          className="mini"
          onClick={() => {
            world.optimize(vid);
            bump('routesVersion');
          }}
        >
          优化路线
        </button>
      </div>
      {open && (
        <ul className="route-list">
          {order.map((pid, i) => {
            const p = world.pointMap.get(pid);
            if (!p) return null;
            return (
              <li
                key={pid}
                draggable
                className={dragIdx === i ? 'dragging' : ''}
                onDragStart={() => setDragIdx(i)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) move(dragIdx, i);
                  setDragIdx(null);
                }}
                onDragEnd={() => setDragIdx(null)}
                onClick={() => set({ infoPoint: pid, selectedIds: [pid] })}
              >
                <span className="idx">{i + 1}</span>
                <span>#{pid}</span>
                <span className="amt">量 {Math.round(world.eff(p))}</span>
                <span className="arr">{arrivals.has(pid) ? fmtTime(arrivals.get(pid)!) : ''}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function SidePanel() {
  const routesVersion = useStore((s) => s.routesVersion);
  const simTime = useStore((s) => s.simTime);
  void routesVersion;
  const tAbs = world.params.dayStart + simTime;
  return (
    <div className="side">
      <div className="side-title">车辆与路线（拖拽调整顺序）</div>
      {world.vehicles.map((v) => (
        <VehicleCard key={v.id} vid={v.id} tAbs={tAbs} />
      ))}
      <div className="legend">
        <div className="side-title">点位分层</div>
        {TIERS.map((t) => (
          <div key={t.label} className="legend-row">
            <span className="dot" style={{ background: `#${t.color.getHexString()}` }} />
            <span>{t.label}</span>
          </div>
        ))}
        <div className="side-title">拥堵色带</div>
        <div className="legend-row">
          <span className="dot" style={{ background: '#2ecc71' }} />
          <span>畅通</span>
          <span className="dot" style={{ background: '#f1c40f' }} />
          <span>缓行</span>
          <span className="dot" style={{ background: '#e74c3c' }} />
          <span>拥堵</span>
        </div>
      </div>
    </div>
  );
}
