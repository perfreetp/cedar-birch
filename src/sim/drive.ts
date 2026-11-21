import { ringPerimeter, roundedRectPoint, type PathPoint } from "./geom";

/** 键盘手动驾驶输入（W/S/A/D 或方向键）。 */
export class InputController {
  private keys = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  attach(): void {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }

  get forward(): boolean {
    return this.keys.has("KeyW") || this.keys.has("ArrowUp");
  }
  get back(): boolean {
    return this.keys.has("KeyS") || this.keys.has("ArrowDown");
  }
  get left(): boolean {
    return this.keys.has("KeyA") || this.keys.has("ArrowLeft");
  }
  get right(): boolean {
    return this.keys.has("KeyD") || this.keys.has("ArrowRight");
  }
}

/** 沿预设环线的自动循迹（纯追踪 Pure Pursuit）。 */
export class AutoPilot {
  private pts: PathPoint[] = [];
  private spacing = 3;

  constructor(spacing = 3) {
    this.spacing = spacing;
    const P = ringPerimeter();
    const n = Math.ceil(P / spacing);
    for (let i = 0; i < n; i++) this.pts.push(roundedRectPoint((i / n) * P));
  }

  /** 由当前位置与航向计算目标前轮转角（弧度）。 */
  steer(px: number, pz: number, heading: number, lookahead = 9, wheelbase = 2.9): number {
    // 最近路径点
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < this.pts.length; i++) {
      const dx = this.pts[i].x - px;
      const dz = this.pts[i].z - pz;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // 沿路径前推 lookahead 距离取目标点
    const steps = Math.max(1, Math.round(lookahead / this.spacing));
    const t = this.pts[(best + steps) % this.pts.length];
    const dx = t.x - px;
    const dz = t.z - pz;
    // 转换到车体坐标系（前 = localZ，右 = localX）
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const L2 = localX * localX + localZ * localZ;
    if (L2 < 1e-4) return 0;
    const curvature = (2 * localX) / L2;
    return Math.max(-0.6, Math.min(0.6, Math.atan(curvature * wheelbase)));
  }
}
