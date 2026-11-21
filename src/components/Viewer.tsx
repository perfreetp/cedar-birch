import { useEffect, useRef, useState } from 'react';
import { SceneManager } from '../lib/SceneManager';
import { gapToBin, binLabel } from '../lib/heat';
import { useStore } from '../store';
import type { WeldRecord } from '../types';

interface HoverState {
  weld: WeldRecord;
  x: number;
  y: number;
}

interface ViewerProps {
  onReady: (mgr: SceneManager) => void;
}

export default function Viewer({ onReady }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mgrRef = useRef<SceneManager | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const hoverIdRef = useRef<string | null>(null);

  const welds = useStore((s) => s.welds);
  const plates = useStore((s) => s.plates);
  const palette = useStore((s) => s.palette);
  const threshold = useStore((s) => s.threshold);
  const gapFilter = useStore((s) => s.gapFilter);
  const sectionEnabled = useStore((s) => s.sectionEnabled);
  const sectionPosition = useStore((s) => s.sectionPosition);
  const ghostSide = useStore((s) => s.ghostSide);
  const selectedWeldId = useStore((s) => s.selectedWeldId);
  const focusNonce = useStore((s) => s.focusNonce);
  const selectWeld = useStore((s) => s.selectWeld);
  const setSectionPosition = useStore((s) => s.setSectionPosition);
  const loadState = useStore((s) => s.loadState);
  const errorMessage = useStore((s) => s.errorMessage);

  // 场景创建（仅一次）
  useEffect(() => {
    if (!containerRef.current) return;
    const mgr = new SceneManager(containerRef.current);
    mgrRef.current = mgr;
    onReady(mgr);
    mgr.onPick = (info) => selectWeld(info ? info.weld.id : null);
    mgr.onHover = (info) => {
      const id = info ? info.weld.id : null;
      if (id !== hoverIdRef.current) {
        hoverIdRef.current = id;
        setHover(info ? { weld: info.weld, x: info.x, y: info.y } : null);
      } else if (info) {
        setHover({ weld: info.weld, x: info.x, y: info.y });
      }
    };
    mgr.onSectionDrag = (x) => setSectionPosition(Math.round(x * 100) / 100);
    return () => {
      mgr.dispose();
      mgrRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 数据集装载
  useEffect(() => {
    const mgr = mgrRef.current;
    if (!mgr || !welds.length) return;
    mgr.loadWelds(welds, palette, threshold, gapFilter);
    if (plates.length) mgr.loadPlates(plates);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [welds]);

  // 热力参数（滑块高频路径）
  useEffect(() => {
    mgrRef.current?.setColorParams(palette, threshold, gapFilter);
  }, [palette, threshold, gapFilter]);

  // 剖切状态
  useEffect(() => {
    mgrRef.current?.setSection(sectionEnabled, sectionPosition, ghostSide);
  }, [sectionEnabled, sectionPosition, ghostSide]);

  // 选中标记
  useEffect(() => {
    mgrRef.current?.selectWeld(selectedWeldId);
  }, [selectedWeldId]);

  // 列表定位飞行
  useEffect(() => {
    if (focusNonce > 0 && selectedWeldId) {
      mgrRef.current?.focusWeld(selectedWeldId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const bin = hover ? gapToBin(hover.weld.gap) : 0;
  const heatColor = hover ? palette[bin] : '#888';

  return (
    <div className="viewport" ref={containerRef}>
      {loadState === 'idle' && (
        <div className="empty-state">
          <div className="title">船体分段焊缝间隙可视化平台</div>
          <div>
            点击左上角「加载示例分段」可立即载入含 3 万条焊缝的演示数据，
            <br />
            或导入焊缝 JSON / GLB 分段模型开始分析。
          </div>
        </div>
      )}
      {loadState === 'loading' && <div className="load-banner">正在装载数据…</div>}
      {loadState === 'error' && <div className="error-banner">{errorMessage}</div>}
      {hover && (
        <div
          className="tooltip"
          style={{
            left: Math.min(hover.x + 14, (containerRef.current?.clientWidth ?? 800) - 230),
            top: Math.min(hover.y + 14, (containerRef.current?.clientHeight ?? 600) - 150),
          }}
        >
          <div className="tt-id">{hover.weld.id}</div>
          <div className="tt-row">
            <span className="k">所属区域</span>
            <span>{hover.weld.region}</span>
          </div>
          <div className="tt-row">
            <span className="k">板厚</span>
            <span>{hover.weld.thickness.toFixed(1)} mm</span>
          </div>
          <div className="tt-row">
            <span className="k">焊缝长度</span>
            <span>{hover.weld.length.toFixed(2)} m</span>
          </div>
          <div className="tt-row">
            <span className="k">间隙读数</span>
            <span className="gap-value" style={{ color: heatColor }}>
              {hover.weld.gap.toFixed(1)} mm
            </span>
          </div>
          <div className="tt-row">
            <span className="k">热力档位</span>
            <span>
              <span
                className="legend-swatch"
                style={{ display: 'inline-block', marginRight: 6, background: heatColor }}
              />
              {binLabel(bin)}
              {hover.weld.gap > threshold && <strong style={{ color: 'var(--danger)' }}> · 超差</strong>}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
