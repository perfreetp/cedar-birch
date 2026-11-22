// SolidJS 全局状态: 坡口/焊接工艺参数、剖切位置、选中焊道、剥层与温度开关
import { createMemo, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { GrooveConfig, WeldConfig, LayoutResult } from '../types';
import { layoutBeads } from '../weld/layout';
import { computeThermalMap } from '../weld/thermal';

export const DEFAULT_GROOVE: GrooveConfig = {
  type: 'V',
  thickness: 28,
  topWidth: 22,
  rootGap: 3,
  rootLand: 2,
  uRadius: 4,
  weldLength: 120,
  plateWidth: 90,
};

export const DEFAULT_WELD: WeldConfig = {
  layerCount: 20,
  passMode: 'auto',
  fixedPasses: 3,
  passOverlap: 0.9,
  layerOverlap: 1.35,
  penetrationRatio: 0.12,
};

export const [groove, setGroove] = createStore<GrooveConfig>({ ...DEFAULT_GROOVE });
export const [weld, setWeld] = createStore<WeldConfig>({ ...DEFAULT_WELD });

export const [sectionZ, setSectionZ] = createSignal(0);
export const [selectedBeadId, setSelectedBeadId] = createSignal<string | null>(null);
export const [peelLayers, setPeelLayers] = createSignal(DEFAULT_WELD.layerCount); // 可见层数(自根部起)
export const [thermalOn, setThermalOn] = createSignal(false);
export const [clippingOn, setClippingOn] = createSignal(true);

/** 排布结果随坡口/工艺参数自动重算 -> 整个焊道堆叠重新排布 */
export const layout: () => LayoutResult = createMemo(() => layoutBeads(groove, weld));

/** 层间温度表(随排布重算) */
export const thermalMap = createMemo(() =>
  computeThermalMap(layout().beads, layout().passesPerLayer, weld.layerCount),
);

export function resetAll() {
  setGroove({ ...DEFAULT_GROOVE });
  setWeld({ ...DEFAULT_WELD });
  setSectionZ(0);
  setSelectedBeadId(null);
  setPeelLayers(DEFAULT_WELD.layerCount);
  setThermalOn(false);
  setClippingOn(true);
}
