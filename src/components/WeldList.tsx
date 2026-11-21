import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { gapToBin } from '../lib/heat';
import type { WeldRecord } from '../types';

type Row =
  | { kind: 'header'; region: string; count: number; over: number }
  | { kind: 'weld'; weld: WeldRecord };

const HEADER_H = 34;
const ROW_H = 30;
const OVERSCAN = 8;

export default function WeldList() {
  const s = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { rows, totalH } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Row[] = [];
    let height = 0;
    for (const rs of s.regionStats) {
      const items = s.welds.filter(
        (w) =>
          w.region === rs.region &&
          w.gap >= s.gapFilter[0] &&
          w.gap <= s.gapFilter[1] &&
          (!q || w.id.toLowerCase().includes(q)),
      );
      if (!items.length) continue;
      const over = items.filter((w) => w.gap > s.threshold).length;
      out.push({ kind: 'header', region: rs.region, count: items.length, over });
      height += HEADER_H;
      if (!collapsed.has(rs.region)) {
        // 区域内按间隙降序，超差焊缝排最前
        items.sort((a, b) => b.gap - a.gap);
        for (const w of items) out.push({ kind: 'weld', weld: w });
        height += items.length * ROW_H;
      }
    }
    return { rows: out, totalH: height };
  }, [s.welds, s.regionStats, s.gapFilter, s.threshold, collapsed, query]);

  // 计算可视窗口内的行
  const visible = useMemo(() => {
    let acc = 0;
    const start = scrollTop;
    const end = scrollTop + viewH;
    const shown: { row: Row; top: number; h: number }[] = [];
    for (const row of rows) {
      const h = row.kind === 'header' ? HEADER_H : ROW_H;
      if (acc + h >= start - OVERSCAN * ROW_H && acc <= end + OVERSCAN * ROW_H) {
        shown.push({ row, top: acc, h });
      }
      acc += h;
      if (acc > end + OVERSCAN * ROW_H && shown.length) break;
    }
    return shown;
  }, [rows, scrollTop, viewH]);

  const toggle = (region: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '100%', marginBottom: 0 }}>
      <h2>焊缝列表（按区域分组）</h2>
      <input
        type="text"
        placeholder="按编号搜索…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <div
        ref={scrollRef}
        data-region-count={rows.filter((r) => r.kind === 'header').length}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}
      >
        <div style={{ height: totalH, position: 'relative' }}>
          {visible.map(({ row, top, h }) =>
            row.kind === 'header' ? (
              <button
                key={`h-${row.region}`}
                className="region-head"
                style={{ position: 'absolute', top, height: h, left: 0, right: 0 }}
                onClick={() => toggle(row.region)}
              >
                <span>{collapsed.has(row.region) ? '▶' : '▼'}</span>
                <span>{row.region}</span>
                <span className={`badge ${row.over ? 'over' : ''}`}>
                  {row.count}
                  {row.over ? ` · 超差 ${row.over}` : ''}
                </span>
              </button>
            ) : (
              <div
                key={row.weld.id}
                className={`weld-row ${s.selectedWeldId === row.weld.id ? 'selected' : ''}`}
                style={{ position: 'absolute', top, height: h, left: 0, right: 0 }}
                onClick={() => s.focusWeld(row.weld.id)}
                title={`${row.weld.id}｜板厚 ${row.weld.thickness}mm｜间隙 ${row.weld.gap}mm`}
              >
                <span
                  className="gap-dot"
                  style={{ background: s.palette[gapToBin(row.weld.gap)] }}
                />
                <span>{row.weld.id}</span>
                <span className="meta">
                  {row.weld.gap.toFixed(1)} mm
                  {row.weld.gap > s.threshold && <span style={{ color: 'var(--danger)' }}> ⚠</span>}
                </span>
              </div>
            ),
          )}
          {!rows.length && (
            <div className="hint" style={{ padding: 16, textAlign: 'center' }}>
              当前筛选条件下没有焊缝
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
