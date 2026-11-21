import { DynamicTexture, Scene } from "@babylonjs/core";
import { RING } from "./geom";

type Ctx = CanvasRenderingContext2D;

function ctx2d(dt: DynamicTexture): Ctx {
  return dt.getContext() as unknown as Ctx;
}

/** 街区路面纹理：混凝土基底 + 环形沥青路 + 车道虚线 + 人行道边带。 */
export function makeRoadTexture(scene: Scene, worldSize: number): DynamicTexture {
  const res = 1024;
  const dt = new DynamicTexture("road", { width: res, height: res }, scene, true);
  const c = ctx2d(dt);
  const px = (x: number) => (x / worldSize + 0.5) * res;
  const py = (z: number) => (0.5 - z / worldSize) * res;
  const m = (v: number) => (v / worldSize) * res; // 米 → 像素

  // 混凝土基底
  c.fillStyle = "#5b5e64";
  c.fillRect(0, 0, res, res);
  for (let i = 0; i < 12000; i++) {
    const g = 78 + Math.random() * 28;
    c.fillStyle = `rgba(${g},${g},${g + 4},${0.18 + Math.random() * 0.25})`;
    c.fillRect(Math.random() * res, Math.random() * res, 2, 2);
  }
  // 混凝土伸缩缝
  c.strokeStyle = "rgba(30,32,36,0.25)";
  c.lineWidth = 1.5;
  for (let i = 1; i < 8; i++) {
    c.beginPath();
    c.moveTo((i * res) / 8, 0);
    c.lineTo((i * res) / 8, res);
    c.moveTo(0, (i * res) / 8);
    c.lineTo(res, (i * res) / 8);
    c.stroke();
  }

  const rr = (half: number, radius: number) => {
    c.beginPath();
    c.roundRect(px(-half), py(half), m(half * 2), m(half * 2), m(radius));
  };

  // 人行道边带（环路外侧）
  c.strokeStyle = "#71747b";
  c.lineWidth = m(7);
  rr(RING.hx + RING.band / 2 + 3.5, RING.r + RING.band / 2 + 3.5);
  c.stroke();

  // 环形沥青路
  c.strokeStyle = "#33363c";
  c.lineWidth = m(RING.band);
  rr(RING.hx, RING.r);
  c.stroke();

  // 沥青颗粒
  c.save();
  c.lineWidth = m(RING.band);
  rr(RING.hx, RING.r);
  c.clip();
  for (let i = 0; i < 6000; i++) {
    const g = 42 + Math.random() * 22;
    c.fillStyle = `rgba(${g},${g},${g + 5},${0.3 + Math.random() * 0.3})`;
    c.fillRect(Math.random() * res, Math.random() * res, 2, 2);
  }
  c.restore();

  // 车道中心虚线
  c.strokeStyle = "rgba(228,220,168,0.85)";
  c.lineWidth = 3;
  c.setLineDash([16, 14]);
  rr(RING.hx, RING.r);
  c.stroke();
  c.setLineDash([]);

  // 路面修补斑块
  for (let i = 0; i < 14; i++) {
    c.fillStyle = `rgba(20,22,26,${0.05 + Math.random() * 0.06})`;
    c.beginPath();
    c.ellipse(
      Math.random() * res,
      Math.random() * res,
      20 + Math.random() * 60,
      15 + Math.random() * 40,
      Math.random() * Math.PI,
      0,
      Math.PI * 2
    );
    c.fill();
  }

  dt.update();
  return dt;
}

/** 污渍贴花纹理（带 alpha 的不规则深色斑块）。 */
export function makeDirtTexture(scene: Scene, variant: number): DynamicTexture {
  const res = 128;
  const dt = new DynamicTexture(`dirt${variant}`, { width: res, height: res }, scene, true);
  const c = ctx2d(dt);
  c.clearRect(0, 0, res, res);

  const blobs = 9 + variant * 3;
  for (let i = 0; i < blobs; i++) {
    const x = res / 2 + (Math.random() - 0.5) * res * 0.62;
    const y = res / 2 + (Math.random() - 0.5) * res * 0.62;
    const r = 8 + Math.random() * 26;
    const cr = 42 + Math.random() * 22;
    const cg = 32 + Math.random() * 16;
    const cb = 20 + Math.random() * 12;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${cr},${cg},${cb},${0.5 + Math.random() * 0.35})`);
    g.addColorStop(0.7, `rgba(${cr},${cg},${cb},${0.25 + Math.random() * 0.2})`);
    g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, res, res);
  }
  // 颗粒点
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * res * 0.45;
    const x = res / 2 + Math.cos(a) * d;
    const y = res / 2 + Math.sin(a) * d;
    c.fillStyle = `rgba(30,22,14,${0.2 + Math.random() * 0.4})`;
    c.fillRect(x, y, 1.6, 1.6);
  }

  dt.hasAlpha = true;
  dt.update();
  return dt;
}

/** 径向光斑纹理（喷水粒子、车灯辉光用）。 */
export function makeFlareTexture(scene: Scene): DynamicTexture {
  const res = 64;
  const dt = new DynamicTexture("flare", { width: res, height: res }, scene, false);
  const c = ctx2d(dt);
  const g = c.createRadialGradient(res / 2, res / 2, 0, res / 2, res / 2, res / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, res, res);
  dt.hasAlpha = true;
  dt.update();
  return dt;
}
