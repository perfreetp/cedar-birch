import type { SimParams } from '../types';

const STORAGE_KEY = 'fairing-sep-vfx:params:v1';

export const DEFAULT_PARAMS: SimParams = {
  separationTime: 5,
  openDuration: 1.2,
  openAngle: 65,
  jettisonDuration: 2.0,
  jettisonSpeed: 2.2,
  axialSpeed: 1.2,

  particleCount: 260,
  particleSpeed: 4.5,
  particleSpread: 1.1,
  dustCount: 420,
  showParticles: true,

  exploded: false,
  explodeAmount: 1.6,
  showHingeHelper: true,

  followMode: 'fairing',
  autoRotate: false,
};

export function loadParams(): SimParams {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PARAMS };
    const parsed = JSON.parse(raw) as Partial<SimParams>;
    // 与默认值合并，防止旧版本缺字段
    return { ...DEFAULT_PARAMS, ...parsed };
  } catch (err) {
    console.warn('[config] 读取本地配置失败，使用默认值', err);
    return { ...DEFAULT_PARAMS };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** 防抖写入 localStorage，场景数据全部保存在浏览器本地 */
export function saveParams(params: SimParams): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
    } catch (err) {
      console.warn('[config] 写入本地配置失败', err);
    }
  }, 250);
}

export function exportParamsFile(params: SimParams): void {
  const blob = new Blob([JSON.stringify(params, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, `fairing-params-${stamp()}.json`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
