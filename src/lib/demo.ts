import type { Pt, RasterImage } from '../types';

const W = 512;
const H = 512;

/** 主火场斑块（像素坐标，不规则多边形） */
const FIRE_PATCHES: Pt[][] = [
  [
    { x: 120, y: 140 }, { x: 180, y: 96 }, { x: 268, y: 110 }, { x: 330, y: 150 },
    { x: 372, y: 220 }, { x: 356, y: 300 }, { x: 300, y: 356 }, { x: 214, y: 372 },
    { x: 146, y: 332 }, { x: 104, y: 256 }, { x: 96, y: 190 },
  ],
  // 孤立小斑块（用于碎片剔除演示）
  [
    { x: 410, y: 400 }, { x: 432, y: 392 }, { x: 448, y: 408 }, { x: 440, y: 432 }, { x: 414, y: 430 },
  ],
  [
    { x: 60, y: 420 }, { x: 74, y: 414 }, { x: 86, y: 424 }, { x: 78, y: 440 }, { x: 60, y: 436 },
  ],
];

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inFire(x: number, y: number): number {
  const p = { x, y };
  let depth = 0;
  for (const poly of FIRE_PATCHES) if (pointInPoly(p, poly)) depth++;
  return depth;
}

/** 到斑块边界的粗略归一化距离（0..1，中心高） */
function burnIntensity(x: number, y: number): number {
  if (!inFire(x, y)) return 0;
  let best = Infinity;
  for (const poly of FIRE_PATCHES) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((x - a.x) * dx + (y - a.y) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
      best = Math.min(best, d);
    }
  }
  return Math.max(0, Math.min(1, 1 - best / 110));
}

function noise(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return [canvas, canvas.getContext('2d')!];
}

/** 灾后影像：林地绿底 + 焦黑/褐火烧斑块（强度渐变 + 噪声） */
export function makeDemoPostImagery(): { canvas: HTMLCanvasElement; blob: Promise<Blob> } {
  const [canvas, ctx] = makeCanvas();
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = noise(x, y, 1) * 0.16 - 0.08;
      const intensity = burnIntensity(x, y);
      let r: number;
      let g: number;
      let b: number;
      if (intensity > 0) {
        // 焦黑 → 焦褐渐变
        r = 34 + intensity * 96 + n * 40;
        g = 26 + intensity * 48 + n * 30;
        b = 22 + intensity * 22 + n * 20;
      } else {
        // 健康林地：深绿底 + 纹理
        r = 38 + n * 26;
        g = 92 + n * 60;
        b = 40 + n * 24;
      }
      img.data[k] = Math.max(0, Math.min(255, r));
      img.data[k + 1] = Math.max(0, Math.min(255, g));
      img.data[k + 2] = Math.max(0, Math.min(255, b));
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, blob: new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png')) };
}

/** 灾前影像：全域健康林地（用于植被差值） */
export function makeDemoPreImagery(): { canvas: HTMLCanvasElement; blob: Promise<Blob> } {
  const [canvas, ctx] = makeCanvas();
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 4;
      const n = noise(x, y, 2) * 0.16 - 0.08;
      img.data[k] = Math.max(0, Math.min(255, 40 + n * 26));
      img.data[k + 1] = Math.max(0, Math.min(255, 96 + n * 60));
      img.data[k + 2] = Math.max(0, Math.min(255, 42 + n * 24));
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, blob: new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png')) };
}

/**
 * 高程图：一座缓坡山丘（灰度编码，0..300m）+ 噪声。
 * 高程函数同时以 Float32Array 返回，避免二次解码误差。
 */
export function makeDemoDem(): {
  canvas: HTMLCanvasElement;
  blob: Promise<Blob>;
  dem: Float32Array;
  min: number;
  max: number;
} {
  const [canvas, ctx] = makeCanvas();
  const img = ctx.createImageData(W, H);
  const dem = new Float32Array(W * H);
  const min = 0;
  const max = 300;
  const cx = W * 0.42;
  const cy = H * 0.38;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy) / (W * 0.7);
      const hill = 1 - Math.min(1, d);
      const h = 40 + 260 * hill * hill + (noise(x, y, 3) - 0.5) * 8;
      dem[y * W + x] = h;
      const v = Math.round(((h - min) / (max - min)) * 255);
      const k = (y * W + x) * 4;
      img.data[k] = v;
      img.data[k + 1] = v;
      img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return {
    canvas,
    blob: new Promise((res) => canvas.toBlob((b) => res(b!), 'image/png')),
    dem,
    min,
    max,
  };
}

export function canvasToRaster(
  canvas: HTMLCanvasElement,
  blob: Blob,
  kind: RasterImage['kind'],
  pixelSize: number,
  extra?: Partial<RasterImage>,
): RasterImage {
  const id = `${kind}-${crypto.randomUUID()}`;
  return {
    id,
    name: kind === 'dem' ? 'demo-dem.png' : kind === 'pre' ? 'demo-pre-fire.png' : 'demo-post-fire.png',
    width: canvas.width,
    height: canvas.height,
    pixelSize,
    origin: { x: 0, y: 0 },
    image: canvas as unknown as HTMLCanvasElement,
    blob,
    kind,
    verticalScale: 1,
    ...extra,
  };
}

export const DEMO_SIZE = { width: W, height: H };
