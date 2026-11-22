import type { Pt, RasterImage } from '../types';

export interface LoadOptions {
  pixelSize: number;
  origin?: Pt;
  verticalScale?: number;
  /** DEM 解析模式 */
  demMode?: 'grayscale' | 'rgb';
  /** grayscale 模式下的高程量程（米） */
  demMin?: number;
  demMax?: number;
}

function loadImageBitmap(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob);
}

/** 读取完整像素数据（离屏 canvas 中转） */
export function readImageData(img: ImageBitmap | HTMLImageElement): ImageData {
  const w = 'width' in img ? img.width : (img as HTMLImageElement).naturalWidth;
  const h = 'height' in img ? img.height : (img as HTMLImageElement).naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function decodeDem(data: ImageData, mode: 'grayscale' | 'rgb', min: number, max: number): Float32Array {
  const n = data.width * data.height;
  const out = new Float32Array(n);
  const px = data.data;
  const range = Math.max(1e-9, max - min);
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (mode === 'grayscale') {
      // ITU-R BT.601 亮度
      const lum = 0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2];
      out[i] = min + (lum / 255) * range;
    } else {
      // Mapbox/terrain-rgb：高度 = R*65536 + G*256 + B，单位 0.1m
      out[i] = (px[k] * 65536 + px[k + 1] * 256 + px[k + 2]) * 0.1;
    }
  }
  return out;
}

export async function loadImagery(file: File, opts: LoadOptions): Promise<RasterImage> {
  const bitmap = await loadImageBitmap(file);
  return {
    id: `img-${crypto.randomUUID()}`,
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
    pixelSize: opts.pixelSize,
    origin: opts.origin ?? { x: 0, y: 0 },
    image: bitmap,
    blob: file,
    kind: 'post',
    verticalScale: 1,
  };
}

export async function loadPreImagery(file: File, opts: LoadOptions): Promise<RasterImage> {
  const base = await loadImagery(file, opts);
  return { ...base, id: `img-${crypto.randomUUID()}`, kind: 'pre' };
}

export async function loadDem(file: File, opts: LoadOptions): Promise<RasterImage> {
  const bitmap = await loadImageBitmap(file);
  const data = readImageData(bitmap);
  const dem = decodeDem(
    data,
    opts.demMode ?? 'grayscale',
    opts.demMin ?? 0,
    opts.demMax ?? 100,
  );
  return {
    id: `dem-${crypto.randomUUID()}`,
    name: file.name,
    width: bitmap.width,
    height: bitmap.height,
    pixelSize: opts.pixelSize,
    origin: opts.origin ?? { x: 0, y: 0 },
    image: bitmap,
    blob: file,
    kind: 'dem',
    dem,
    verticalScale: opts.verticalScale ?? 1,
  };
}

/** 像素坐标 → 世界平面坐标（米） */
export function pixelToWorld(raster: RasterImage, col: number, row: number): Pt {
  return {
    x: raster.origin.x + col * raster.pixelSize,
    y: raster.origin.y + row * raster.pixelSize,
  };
}

/** 世界平面坐标 → 像素坐标（浮点） */
export function worldToPixel(raster: RasterImage, p: Pt): { col: number; row: number } {
  return {
    col: (p.x - raster.origin.x) / raster.pixelSize,
    row: (p.y - raster.origin.y) / raster.pixelSize,
  };
}

/** 把栅格转成 three.js 纹理（y 翻转由纹理 UV 处理，这里保持原始方向） */
export function rasterToCanvas(raster: RasterImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = raster.width;
  canvas.height = raster.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(raster.image, 0, 0);
  return canvas;
}
