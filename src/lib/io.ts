import type { ViewConfigFile, WeldDataFile } from '../types';

/** 触发浏览器下载 */
function download(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function exportConfig(config: ViewConfigFile): void {
  download(
    `weld-view-config-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
    JSON.stringify(config, null, 2),
    'application/json',
  );
}

export function exportWeldData(data: WeldDataFile): void {
  download(`${data.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json`, JSON.stringify(data), 'application/json');
}

function readText(file: File): Promise<string> {
  return file.text();
}

/** 解析焊缝数据文件（.json） */
export async function importWeldData(file: File): Promise<WeldDataFile> {
  const text = await readText(file);
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.welds)) {
    throw new Error('文件格式不正确：缺少 welds 数组');
  }
  const welds = raw.welds.map((w: Record<string, unknown>, i: number) => {
    const pos = w.position as number[];
    const dir = w.direction as number[];
    if (!pos || pos.length !== 3 || !dir || dir.length !== 3) {
      throw new Error(`第 ${i + 1} 条焊缝的 position/direction 必须是三维数组`);
    }
    return {
      id: String(w.id ?? `W-IMP-${i + 1}`),
      region: String(w.region ?? '未分区'),
      thickness: Number(w.thickness) || 0,
      gap: Number(w.gap) || 0,
      position: pos as [number, number, number],
      direction: dir as [number, number, number],
      length: Number(w.length) || 0.5,
    };
  });
  return {
    name: String(raw.name ?? file.name.replace(/\.json$/i, '')),
    version: Number(raw.version) || 1,
    welds,
    plates: Array.isArray(raw.plates) ? (raw.plates as WeldDataFile['plates']) : undefined,
  };
}

/** 解析视图配置文件 */
export async function importConfig(file: File): Promise<ViewConfigFile> {
  const raw = JSON.parse(await readText(file));
  if (raw?.type !== 'weld-gap-view-config') {
    throw new Error('不是有效的焊缝视图配置文件');
  }
  if (!Array.isArray(raw.palette) || raw.palette.length !== 9) {
    throw new Error('配置中的调色板必须包含 9 个颜色');
  }
  return raw as ViewConfigFile;
}
