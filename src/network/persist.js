/** 浏览器本地持久化：管网拓扑、支路阻力、工况参数 */

const KEY = 'flare-network-config-v1';

export const STORAGE_KEY = KEY;

export function loadStoredConfig() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.nodes || !parsed.segments) return null;
    return { config: parsed, savedAt: parsed.savedAt || null };
  } catch (err) {
    console.warn('读取本地管网配置失败', err);
    return null;
  }
}

export function saveStoredConfig(config) {
  const payload = { ...config, savedAt: new Date().toISOString() };
  localStorage.setItem(KEY, JSON.stringify(payload));
  return payload.savedAt;
}

export function clearStoredConfig() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function storedConfigSize() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? raw.length : 0;
  } catch {
    return 0;
  }
}
