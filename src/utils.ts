export function fmtTime(tAbs: number): string {
  const h = Math.floor(tAbs / 60) % 24;
  const m = Math.floor(tAbs % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}
