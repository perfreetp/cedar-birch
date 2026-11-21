import { DynamicTexture, Scene } from "@babylonjs/core";

type Ctx = CanvasRenderingContext2D;

/**
 * 覆盖层管理：
 *  - coverage：扫刷扫过区域累积的覆盖强度（canvas alpha 通道，'lighter' 叠加，饱和于 1）
 *  - wet：喷水湿痕（随时间指数衰减），同时用作路面 specularTexture 控制反射强度
 *  - heat：由 coverage 派生的热力色纹理（俯视模式）
 *
 * 世界坐标映射（与 CreateGround 的 UV + DynamicTexture 默认 invertY 行为一致）：
 *   u = x/size + 0.5，v = z/size + 0.5，canvasY = (1 - v) * res
 */
export class CoverageLayer {
  readonly dt: DynamicTexture;
  private ctx: Ctx;
  readonly wetDt: DynamicTexture;
  private wetCtx: Ctx;
  readonly heatDt: DynamicTexture;
  private heatCtx: Ctx;

  private sprite: HTMLCanvasElement;
  private wetSprite: HTMLCanvasElement;
  stampRadius = 1.05;

  private imgData: ImageData | null = null;
  private dataDirty = true;
  private texDirty = false;
  private timer = 0;
  private heatTimer = 0;
  heatMode = false;

  readonly wetRes = 512;
  readonly heatRes = 512;

  constructor(scene: Scene, readonly worldSize: number, readonly res = 1024) {
    this.dt = new DynamicTexture("coverage", { width: res, height: res }, scene, false);
    this.ctx = this.dt.getContext() as unknown as Ctx;
    this.dt.hasAlpha = true;

    this.wetDt = new DynamicTexture("wet", { width: this.wetRes, height: this.wetRes }, scene, false);
    this.wetCtx = this.wetDt.getContext() as unknown as Ctx;
    this.wetDt.hasAlpha = true;

    this.heatDt = new DynamicTexture("heat", { width: this.heatRes, height: this.heatRes }, scene, false);
    this.heatCtx = this.heatDt.getContext() as unknown as Ctx;

    this.sprite = this.makeSprite(0.5);
    this.wetSprite = this.makeSprite(0.4);
  }

  private makeSprite(alpha: number): HTMLCanvasElement {
    const s = 128;
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.65, `rgba(255,255,255,${alpha * 0.6})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    return c;
  }

  private px(x: number, res: number): number {
    return (x / this.worldSize + 0.5) * res;
  }
  private py(z: number, res: number): number {
    return (0.5 - z / this.worldSize) * res;
  }

  /** 扫刷覆盖戳记（软边圆斑，加法累积）。 */
  stamp(x: number, z: number): void {
    const s = ((this.stampRadius * 2) / this.worldSize) * this.res;
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.drawImage(this.sprite, this.px(x, this.res) - s / 2, this.py(z, this.res) - s / 2, s, s);
    this.texDirty = true;
    this.dataDirty = true;
  }

  /** 喷水湿痕戳记。 */
  stampWet(x: number, z: number, radius: number): void {
    const s = ((radius * 2) / this.worldSize) * this.wetRes;
    this.wetCtx.globalCompositeOperation = "lighter";
    this.wetCtx.drawImage(
      this.wetSprite,
      this.px(x, this.wetRes) - s / 2,
      this.py(z, this.wetRes) - s / 2,
      s,
      s
    );
  }

  /** 采样前调用一次：有戳记时才重新读回像素（限制读回频率，保证长时间作业流畅）。 */
  beginSampling(): void {
    if (this.dataDirty) {
      this.imgData = this.ctx.getImageData(0, 0, this.res, this.res);
      this.dataDirty = false;
    }
  }

  /** 世界坐标处的覆盖强度 0..1。 */
  sample(x: number, z: number): number {
    if (!this.imgData) return 0;
    const ix = Math.min(this.res - 1, Math.max(0, Math.floor(this.px(x, this.res))));
    const iy = Math.min(this.res - 1, Math.max(0, Math.floor(this.py(z, this.res))));
    return this.imgData.data[(iy * this.res + ix) * 4 + 3] / 255;
  }

  /** 覆盖像素数（alpha > 30），调用前需 beginSampling。 */
  coveredPixels(): number {
    if (!this.imgData) return 0;
    const d = this.imgData.data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 30) n++;
    return n;
  }

  /** 每帧调用；内部限频，避免长时间作业下纹理上传成为瓶颈。 */
  update(dt: number): void {
    this.timer += dt;
    this.heatTimer += dt;
    if (this.timer >= 1 / 15) {
      this.timer = 0;
      if (this.texDirty) {
        this.dt.update();
        this.texDirty = false;
      }
      // 湿痕指数衰减（destination-out 每 tick 去掉约 3%）
      this.wetCtx.globalCompositeOperation = "destination-out";
      this.wetCtx.fillStyle = "rgba(0,0,0,0.03)";
      this.wetCtx.fillRect(0, 0, this.wetRes, this.wetRes);
      this.wetDt.update();
    }
    if (this.heatMode && this.heatTimer >= 0.4) {
      this.heatTimer = 0;
      this.rebuildHeat();
    }
  }

  private rebuildHeat(): void {
    this.beginSampling();
    if (!this.imgData) return;
    const src = this.imgData.data;
    const out = this.heatCtx.createImageData(this.heatRes, this.heatRes);
    const od = out.data;
    const scale = this.res / this.heatRes;
    for (let y = 0; y < this.heatRes; y++) {
      for (let x = 0; x < this.heatRes; x++) {
        const sx = Math.min(this.res - 1, Math.floor(x * scale));
        const sy = Math.min(this.res - 1, Math.floor(y * scale));
        const v = src[(sy * this.res + sx) * 4 + 3] / 255;
        const [r, g, b] = heatColor(v);
        const o = (y * this.heatRes + x) * 4;
        od[o] = r;
        od[o + 1] = g;
        od[o + 2] = b;
        od[o + 3] = 255;
      }
    }
    this.heatCtx.putImageData(out, 0, 0);
    this.heatDt.update();
  }

  clear(): void {
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, this.res, this.res);
    this.texDirty = true;
    this.dataDirty = true;
  }

  toDataURL(): string {
    return this.ctx.canvas.toDataURL("image/png");
  }

  /** 载入历史覆盖图（替换当前层），之后继续行驶即可继续叠加。 */
  loadImage(img: HTMLImageElement): void {
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.clearRect(0, 0, this.res, this.res);
    this.ctx.drawImage(img, 0, 0, this.res, this.res);
    this.texDirty = true;
    this.dataDirty = true;
  }
}

/** 热力色带：0 深蓝 → 0.35 青绿 → 0.65 黄 → 1 红。 */
function heatColor(t: number): [number, number, number] {
  t = Math.min(1, Math.max(0, t));
  const stops: [number, [number, number, number]][] = [
    [0, [18, 28, 88]],
    [0.35, [0, 158, 118]],
    [0.65, [238, 198, 40]],
    [1, [218, 40, 30]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * k),
        Math.round(c0[1] + (c1[1] - c0[1]) * k),
        Math.round(c0[2] + (c1[2] - c0[2]) * k),
      ];
    }
  }
  return [218, 40, 30];
}
