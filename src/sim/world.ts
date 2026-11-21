import {
  Color3,
  LinesMesh,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";
import { CoverageLayer } from "./coverage";
import { RING, ringPerimeter, roundedRectPoint } from "./geom";
import { makeDirtTexture, makeRoadTexture } from "./textures";

export interface Decal {
  mesh: Mesh;
  mat: StandardMaterial;
  x: number;
  z: number;
}

export interface WorldRefs {
  ground: Mesh;
  overlay: Mesh;
  overlayMat: StandardMaterial;
  decals: Decal[];
}

/**
 * 透明层排序约定（避免多层叠加闪烁）：
 *  - 路面：renderingGroupId 0（不透明）
 *  - 覆盖层 / 湿痕层 / 污渍贴花：renderingGroupId 1，全部 disableDepthWrite，
 *    用 alphaIndex 固定绘制顺序（覆盖 0 < 湿痕 1 < 污渍 2 < 轨迹 3），
 *    配合微小的高度差，深度冲突与排序抖动都不会发生。
 */
export function buildWorld(scene: Scene, coverage: CoverageLayer, worldSize: number): WorldRefs {
  // 路面
  const ground = MeshBuilder.CreateGround("ground", { width: worldSize, height: worldSize, subdivisions: 2 }, scene);
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseTexture = makeRoadTexture(scene, worldSize);
  // 湿痕纹理作为高光贴图：湿处反射强、干处无反射
  groundMat.specularTexture = coverage.wetDt;
  groundMat.specularColor = new Color3(0.55, 0.6, 0.68);
  groundMat.specularPower = 48;
  ground.material = groundMat;

  // 覆盖层（清扫过的区域显示为更干净的路面色）
  const overlay = MeshBuilder.CreateGround("coverageOverlay", { width: worldSize, height: worldSize, subdivisions: 2 }, scene);
  overlay.position.y = 0.035;
  overlay.renderingGroupId = 1;
  overlay.alphaIndex = 0;
  const overlayMat = new StandardMaterial("overlayMat", scene);
  overlayMat.disableLighting = true;
  overlayMat.diffuseColor = new Color3(0.6, 0.64, 0.68);
  overlayMat.opacityTexture = coverage.dt;
  overlayMat.disableDepthWrite = true;
  overlay.material = overlayMat;

  // 湿痕层（喷水后的深色湿斑，叠加在覆盖层之上）
  const wetOverlay = MeshBuilder.CreateGround("wetOverlay", { width: worldSize, height: worldSize, subdivisions: 2 }, scene);
  wetOverlay.position.y = 0.055;
  wetOverlay.renderingGroupId = 1;
  wetOverlay.alphaIndex = 1;
  const wetMat = new StandardMaterial("wetMat", scene);
  wetMat.disableLighting = true;
  wetMat.diffuseColor = new Color3(0.03, 0.045, 0.07);
  wetMat.opacityTexture = coverage.wetDt;
  wetMat.alpha = 0.6;
  wetMat.disableDepthWrite = true;
  wetOverlay.material = wetMat;

  // 预设路线（虚线）
  const routePts: Vector3[] = [];
  const P = ringPerimeter();
  const N = Math.ceil(P / 4);
  for (let i = 0; i <= N; i++) {
    const p = roundedRectPoint((i / N) * P);
    routePts.push(new Vector3(p.x, 0.12, p.z));
  }
  const route = MeshBuilder.CreateDashedLines("route", { points: routePts, dashSize: 2.2, gapSize: 1.6 }, scene);
  route.color = new Color3(1, 0.8, 0.2);
  route.alpha = 0.55;
  route.renderingGroupId = 1;
  route.alphaIndex = 0;

  // 污渍贴花：70% 散布在环路上，30% 散布在广场任意处
  const dirtTex = [makeDirtTexture(scene, 0), makeDirtTexture(scene, 1), makeDirtTexture(scene, 2)];
  const decals: Decal[] = [];
  const half = worldSize / 2 - 12;
  for (let i = 0; i < 160; i++) {
    let x: number, z: number;
    if (Math.random() < 0.7) {
      const p = roundedRectPoint(Math.random() * P);
      const off = (Math.random() - 0.5) * (RING.band - 2);
      x = p.x + -p.tz * off;
      z = p.z + p.tx * off;
    } else {
      x = (Math.random() - 0.5) * 2 * half;
      z = (Math.random() - 0.5) * 2 * half;
    }
    const size = 0.9 + Math.random() * 1.8;
    const m = MeshBuilder.CreateGround(`dirt${i}`, { width: size, height: size }, scene);
    m.position.set(x, 0.07 + Math.random() * 0.03, z);
    m.rotation.y = Math.random() * Math.PI * 2;
    m.renderingGroupId = 1;
    m.alphaIndex = 2;
    const mat = new StandardMaterial(`dirtMat${i}`, scene);
    const tex = dirtTex[i % dirtTex.length];
    mat.diffuseTexture = tex;
    mat.opacityTexture = tex;
    mat.specularColor = Color3.Black();
    mat.disableDepthWrite = true;
    m.material = mat;
    decals.push({ mesh: m, mat, x, z });
  }

  return { ground, overlay, overlayMat, decals };
}

/** 按覆盖强度淡出污渍；返回仍可见的污渍数。调用前需 coverage.beginSampling()。 */
export function updateDecals(decals: Decal[], coverage: CoverageLayer): number {
  let visible = 0;
  for (const d of decals) {
    if (!d.mesh.isEnabled()) continue;
    const cov = coverage.sample(d.x, d.z);
    const alpha = Math.min(1, Math.max(0, 1 - cov * 1.6));
    if (alpha <= 0.02) {
      d.mesh.setEnabled(false); // 覆盖饱和的污渍彻底隐藏，未覆盖的保持原色
      continue;
    }
    d.mat.alpha = alpha;
    visible++;
  }
  return visible;
}

/** 切换覆盖层显示模式：热力色（俯视）或正常覆盖色。 */
export function setHeatMode(refs: WorldRefs, coverage: CoverageLayer, on: boolean): void {
  const m = refs.overlayMat;
  if (on) {
    m.opacityTexture = null;
    m.diffuseColor = Color3.Black();
    m.emissiveTexture = coverage.heatDt;
    m.emissiveColor = Color3.White();
    m.alpha = 0.92;
  } else {
    m.emissiveTexture = null;
    m.emissiveColor = Color3.Black();
    m.diffuseColor = new Color3(0.6, 0.64, 0.68);
    m.opacityTexture = coverage.dt;
    m.alpha = 1;
  }
  coverage.heatMode = on;
}
