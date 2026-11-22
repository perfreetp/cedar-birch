export function formatArea(m2: number): string {
  if (!isFinite(m2)) return '—';
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(3)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${m2.toFixed(1)} m²`;
}

export function formatLength(m: number): string {
  if (!isFinite(m)) return '—';
  if (m >= 1000) return `${(m / 1000).toFixed(3)} km`;
  return `${m.toFixed(2)} m`;
}

export function formatSlope(deg: number): string {
  if (!isFinite(deg)) return '—';
  return `${deg.toFixed(1)}°`;
}

export function formatPercent(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}
