import { createStore } from 'solid-js/store';
import type { EngineStats } from '../three/SimulationEngine';
import type { SimParams, SlowMotionRate } from '../types';
import { DEFAULT_PARAMS, loadParams, saveParams } from '../lib/config';

export type ModuleTab = 'assembly' | 'timeline' | 'particles';

interface AppState {
  params: SimParams;
  stats: EngineStats;
  tab: ModuleTab;
  playing: boolean;
  rate: SlowMotionRate;
  ready: boolean;
}

export const [state, setState] = createStore<AppState>({
  params: loadParams(),
  stats: { t: 0, phase: 'closed', collisions: 0, debris: 0, dust: 0, fps: 0 },
  tab: 'assembly',
  playing: false,
  rate: 1,
  ready: false,
});

export function updateParams(patch: Partial<SimParams>): void {
  setState('params', (prev) => {
    const next = { ...prev, ...patch };
    saveParams(next);
    return next;
  });
}

export function resetParams(): void {
  setState('params', { ...DEFAULT_PARAMS });
  saveParams(DEFAULT_PARAMS);
}

export function setStats(stats: EngineStats): void {
  setState('stats', stats);
}

export function setTab(tab: ModuleTab): void {
  setState('tab', tab);
}

export function setPlaying(playing: boolean): void {
  setState('playing', playing);
}

export function setRate(rate: SlowMotionRate): void {
  setState('rate', rate);
}

export function markReady(): void {
  setState('ready', true);
}
