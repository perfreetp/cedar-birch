import { create } from 'zustand';

export type CameraMode = 'top' | 'follow';

interface UIState {
  simTime: number; // 自 dayStart 起的分钟数
  playing: boolean;
  playSpeed: number; // 仿真分钟 / 真实秒
  cameraMode: CameraMode;
  followVehicle: number;
  selectMode: boolean;
  selectedIds: number[];
  infoPoint: number | null;
  routesVersion: number;
  pointsVersion: number;
  networkVersion: number;
  set: (p: Partial<UIState>) => void;
}

export const useStore = create<UIState>()((set) => ({
  simTime: 0,
  playing: false,
  playSpeed: 15,
  cameraMode: 'top',
  followVehicle: 0,
  selectMode: false,
  selectedIds: [],
  infoPoint: null,
  routesVersion: 0,
  pointsVersion: 0,
  networkVersion: 0,
  set: (p) => set(p),
}));

export const bump = (key: 'routesVersion' | 'pointsVersion' | 'networkVersion'): void =>
  useStore.setState((s) => ({ [key]: s[key] + 1 }) as Partial<UIState>);

export const bumpAll = (): void =>
  useStore.setState((s) => ({
    networkVersion: s.networkVersion + 1,
    pointsVersion: s.pointsVersion + 1,
    routesVersion: s.routesVersion + 1,
    selectedIds: [],
    infoPoint: null,
  }));
