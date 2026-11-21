// 热力着色器: 把 0..255 密度码映射到五档配色 + 平滑过渡, 叠加噪声与轮廓
import { DENSITY_ENCODE_MAX } from '../core/format.ts'

export const heatVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// 密度 -> 颜色. 与 JS 侧 DENSITY_BANDS 保持一致 (人/m²).
// 0.5 / 1.5 / 2.6 / 3.8 / 4.9 / 6.0 是分档边界.
export const heatFragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D uDensity;
uniform float uOpacity;
uniform float uMaxDensity;
uniform vec3 uBand0;
uniform vec3 uBand1;
uniform vec3 uBand2;
uniform vec3 uBand3;
uniform vec3 uBand4;
uniform vec3 uOver;
uniform float uThreshold;
uniform float uShowBands;

const float ENC = ${DENSITY_ENCODE_MAX.toFixed(1)};

vec3 bandColor(float d) {
  if (d < 0.5) return vec3(0.0);
  if (d < 1.5) return mix(uBand0, uBand1, clamp((d - 0.5) / 1.0, 0.0, 1.0) * 0.35);
  if (d < 2.6) return mix(uBand1, uBand2, clamp((d - 1.5) / 1.1, 0.0, 1.0) * 0.35);
  if (d < 3.8) return mix(uBand2, uBand3, clamp((d - 2.6) / 1.2, 0.0, 1.0) * 0.35);
  if (d < 4.9) return mix(uBand3, uBand4, clamp((d - 3.8) / 1.1, 0.0, 1.0) * 0.35);
  if (d < 6.0) return uBand4;
  if (d < 8.0) return mix(uBand4, uOver, clamp((d - 6.0) / 2.0, 0.0, 1.0));
  return uOver;
}

// 平滑版: 直接按归一化密度在色带上取色, 用于无档位模式
vec3 smoothColor(float d) {
  float t = clamp(d / 6.0, 0.0, 1.0);
  vec3 c;
  if (t < 0.25) c = mix(uBand0, uBand1, t / 0.25);
  else if (t < 0.5) c = mix(uBand1, uBand2, (t - 0.25) / 0.25);
  else if (t < 0.75) c = mix(uBand2, uBand3, (t - 0.5) / 0.25);
  else c = mix(uBand3, uBand4, (t - 0.75) / 0.25);
  if (t >= 1.0) c = mix(uBand4, uOver, clamp((d - 6.0) / 3.0, 0.0, 1.0));
  return c;
}

void main() {
  float code = texture2D(uDensity, vUv).r;
  float d = code * ENC;
  // 低于第一档 (0.5 人/m²) 不绘制, 避免出现半透明黑色
  if (d < uThreshold || d < 0.5) discard;
  vec3 col = uShowBands > 0.5 ? bandColor(d) : smoothColor(d);
  float a = uOpacity;
  // 低密度区域略微透明, 让底图可读; 高密度保持足量不透明
  a *= mix(0.55, 1.0, clamp(d / 2.2, 0.0, 1.0));
  // 五档模式下做一点档内强化, 使分档边界更清晰
  if (uShowBands > 0.5) {
    float e = d;
    if (e < 1.5) e = (d - 0.5) / 1.0;
    else if (e < 2.6) e = (d - 1.5) / 1.1;
    else if (e < 3.8) e = (d - 2.6) / 1.2;
    else if (e < 4.9) e = (d - 3.8) / 1.1;
    else e = (d - 4.9) / 1.1;
    a *= 0.92 + 0.08 * clamp(e, 0.0, 1.0);
  }
  a = clamp(a, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
  if (a < 0.004) discard;
}
`
