import * as THREE from 'three';

/**
 * 黑体辐射温度查表（LUT）。
 * 温度 -> RGB 采用 Tanner Helland 黑体近似算法（sRGB 空间），
 * 写入 512x1 DataTexture，着色器中先转线性再参与 HDR 泛光。
 * 表轴覆盖 TEMP_MIN..TEMP_MAX K，越界由 ClampToEdge 钳制。
 */
export const TEMP_MIN = 400;
export const TEMP_MAX = 2800;
export const LUT_SIZE = 512;

function clamp255(v: number): number {
  return Math.min(255, Math.max(0, v));
}

/** Tanner Helland 黑体色温近似，输入开尔文，输出 sRGB 0..1 */
export function kelvinToSRGB(kelvin: number): [number, number, number] {
  const T = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;

  if (T <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(Math.max(T, 1e-3)) - 161.1195681661;
    b = T <= 19 ? 0 : 138.5177312231 * Math.log(T - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(T - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(T - 60, -0.0755148492);
    b = 255;
  }
  return [clamp255(r) / 255, clamp255(g) / 255, clamp255(b) / 255];
}

export function createBlackbodyLUT(): THREE.DataTexture {
  const data = new Uint8Array(LUT_SIZE * 4);
  for (let i = 0; i < LUT_SIZE; i++) {
    const u = i / (LUT_SIZE - 1);
    const kelvin = TEMP_MIN + u * (TEMP_MAX - TEMP_MIN);
    const [r, g, b] = kelvinToSRGB(kelvin);
    data[i * 4 + 0] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, LUT_SIZE, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  // ShaderMaterial 不做自动色彩空间转换，着色器内手动 pow(2.2) 转线性
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}
