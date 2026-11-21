import { create } from 'zustand';
import { BIN_COUNT, DEFAULT_PALETTE_HEX, gapToBin } from './lib/heat';
import type { GapBin, PlateRecord, ViewConfigFile, WeldRecord } from './types';

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';

interface ViewerState {
  datasetName: string;
  welds: WeldRecord[];
  plates: PlateRecord[];
  loadState: LoadState;
  errorMessage: string;

  palette: string[];
  threshold: number;
  gapFilter: [number, number];

  sectionEnabled: boolean;
  sectionPosition: number;
  sectionRange: [number, number];
  ghostSide: 'positive' | 'negative';

  selectedWeldId: string | null;
  /** 列表点击定位请求，自增序号驱动场景飞行 */
  focusNonce: number;
  hoveredWeldId: string | null;

  bins: GapBin[];
  overThresholdCount: number;
  regionStats: { region: string; count: number; over: number }[];

  setDataset: (name: string, welds: WeldRecord[], plates: PlateRecord[]) => void;
  setLoadState: (s: LoadState, msg?: string) => void;
  setPaletteColor: (index: number, hex: string) => void;
  resetPalette: () => void;
  setThreshold: (t: number) => void;
  setGapFilter: (f: [number, number]) => void;
  setSectionEnabled: (v: boolean) => void;
  setSectionPosition: (x: number) => void;
  setGhostSide: (s: 'positive' | 'negative') => void;
  selectWeld: (id: string | null) => void;
  focusWeld: (id: string) => void;
  setHovered: (id: string | null) => void;
  applyConfig: (cfg: ViewConfigFile) => void;
  recompute: () => void;
}

function computeStats(welds: WeldRecord[], threshold: number, palette: string[]) {  const counts = new Array<number>(BIN_COUNT).fill(0);
  let over = 0;
  const regionMap = new Map<string, { count: number; over: number }>();
  for (const w of welds) {
    counts[gapToBin(w.gap)] += 1;
    const isOver = w.gap > threshold;
    if (isOver) over += 1;
    const r = regionMap.get(w.region) ?? { count: 0, over: 0 };
    r.count += 1;
    if (isOver) r.over += 1;
    regionMap.set(w.region, r);
  }
  const bins: GapBin[] = counts.map((count, index) => ({
    index,
    min: index,
    max: index + 1,
    label: index === BIN_COUNT - 1 ? '≥8 mm' : `${index}–${index + 1} mm`,
    color: palette[index],
    count,
  }));
  const regionStats = [...regionMap.entries()]
    .map(([region, v]) => ({ region, ...v }))
    .sort((a, b) => b.count - a.count);
  return { bins, overThresholdCount: over, regionStats };
}

export const useStore = create<ViewerState>((set, get) => ({
  datasetName: '',
  welds: [],
  plates: [],
  loadState: 'idle',
  errorMessage: '',

  palette: [...DEFAULT_PALETTE_HEX],
  threshold: 6,
  gapFilter: [0, 12],

  sectionEnabled: false,
  sectionPosition: 0,
  sectionRange: [-16, 16],
  ghostSide: 'positive',

  selectedWeldId: null,
  focusNonce: 0,
  hoveredWeldId: null,

  bins: [],
  overThresholdCount: 0,
  regionStats: [],

  setDataset: (name, welds, plates) => {
    const xs = welds.map((w) => w.position[0]);
    const range: [number, number] = xs.length
      ? [Math.floor(Math.min(...xs) - 1), Math.ceil(Math.max(...xs) + 1)]
      : [-16, 16];
    set({
      datasetName: name,
      welds,
      plates,
      loadState: 'ready',
      errorMessage: '',
      sectionEnabled: false,
      sectionPosition: (range[0] + range[1]) / 2,
      sectionRange: range,
      gapFilter: [0, Math.max(12, ...welds.map((w) => Math.ceil(w.gap)))],
      selectedWeldId: null,
      hoveredWeldId: null,
    });
    get().recompute();
  },

  setLoadState: (s, msg = '') => set({ loadState: s, errorMessage: msg }),

  setPaletteColor: (index, hex) => {
    const palette = [...get().palette];
    palette[index] = hex;
    set({ palette });
    scheduleRecompute();
  },
  resetPalette: () => {
    set({ palette: [...DEFAULT_PALETTE_HEX] });
    scheduleRecompute();
  },
  setThreshold: (t) => {
    set({ threshold: t });
    scheduleRecompute();
  },
  setGapFilter: (f) => set({ gapFilter: f }),
  setSectionEnabled: (v) => set({ sectionEnabled: v }),
  setSectionPosition: (x) => set({ sectionPosition: x }),
  setGhostSide: (s) => set({ ghostSide: s }),
  selectWeld: (id) => set({ selectedWeldId: id }),
  focusWeld: (id) => set({ selectedWeldId: id, focusNonce: get().focusNonce + 1 }),
  setHovered: (id) => set({ hoveredWeldId: id }),

  applyConfig: (cfg) =>
    set({
      palette: [...cfg.palette],
      threshold: cfg.threshold,
      gapFilter: cfg.gapFilter,
      sectionEnabled: cfg.section.enabled,
      sectionPosition: cfg.section.position,
      sectionRange: cfg.section.range,
      ghostSide: cfg.section.ghostSide,
    }),

  recompute: () => {
    const { welds, threshold, palette } = get();
    set(computeStats(welds, threshold, palette));
  },
}));

/**
 * 统计重算的 rAF 合帧：滑块一帧内可触发多次 input，
 * 合并为一次 3 万条遍历，避免高频路径上的重复计算。
 */
let recomputeQueued = false;
function scheduleRecompute(): void {
  if (recomputeQueued) return;
  recomputeQueued = true;
  requestAnimationFrame(() => {
    recomputeQueued = false;
    useStore.getState().recompute();
  });
}
