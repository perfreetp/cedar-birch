/** PNG 下载与关键帧截图序列工具 */

export function downloadDataURL(dataURL: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

/**
 * 从弹道关键帧时间轴上等距抽取截图时刻，最多 maxFrames 张，
 * 始终包含首末两帧。
 */
export function buildSequenceTimes(keyframeTimes: number[], maxFrames = 24): number[] {
  if (keyframeTimes.length <= maxFrames) return [...keyframeTimes];
  const last = keyframeTimes.length - 1;
  const times: number[] = [];
  for (let i = 0; i < maxFrames; i++) {
    const idx = Math.round((i / (maxFrames - 1)) * last);
    times.push(keyframeTimes[idx]);
  }
  return times;
}
