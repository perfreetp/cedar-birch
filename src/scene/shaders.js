/**
 * 管段 / 流向箭头的自定义着色器。
 *
 * 管段：thin instance 渲染，逐实例属性：
 *   pipeData  = (条纹相位, 流速强度 0..1, 透明度, 沿管纹理重复数)
 *   pipeColor = (r, g, b, 高亮)
 *   pipeState = (充满度 0..1, 流量档位 0..5, 关闭标志, 隔离暗化标志)
 *
 * 条纹贴图按相位沿管轴滚动，实现“贴图偏移随流速/流向变化”。
 */

export const PIPE_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 pipeData;
attribute vec4 pipeColor;
attribute vec4 pipeState;

attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;

varying vec2 vUV;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vData;
varying vec4 vColor;
varying vec4 vState;

void main(void) {
  mat4 finalWorld = mat4(world0, world1, world2, world3);
  vec4 worldPos = finalWorld * vec4(position, 1.0);
  gl_Position = viewProjection * worldPos;
  vUV = uv;
  vNormalW = normalize(mat3(finalWorld) * normal);
  vPosW = worldPos.xyz;
  vData = pipeData;
  vColor = pipeColor;
  vState = pipeState;
}
`;

export const PIPE_FRAGMENT = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

varying vec2 vUV;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec4 vData;
varying vec4 vColor;
varying vec4 vState;

uniform sampler2D uStripe;
uniform vec3 uTierColors[6];
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform float uGlobalAlpha;

void main(void) {
  vec3 base = vColor.rgb;
  float highlight = vColor.a;

  float phase = vData.x;
  float intensity = vData.y;
  float alpha = vData.z;
  float uvScale = vData.w;

  float fill = vState.x;
  int tier = int(vState.y + 0.5);
  float closed = vState.z;
  float dimmed = vState.w;

  vec3 flowColor = uTierColors[0];
  if (tier == 1) flowColor = uTierColors[1];
  else if (tier == 2) flowColor = uTierColors[2];
  else if (tier == 3) flowColor = uTierColors[3];
  else if (tier == 4) flowColor = uTierColors[4];
  else if (tier == 5) flowColor = uTierColors[5];

  // 圆柱 UV：u 为环向、v 为轴向。条纹沿管轴滚动，故用 v 采样贴图的 x 方向
  vec2 suv = vec2(vUV.y * uvScale - phase, vUV.x);
  // 用梯度衰减远处的高频条纹，避免远景出现摩尔纹/虚线感
  float fw = fwidth(suv.x);
  float lod = smoothstep(0.22, 0.65, fw);
  float stripe = texture2D(uStripe, suv).r;
  float stripeSoft = 0.55;
  stripe = mix(stripe, stripeSoft, lod);

  vec3 n = normalize(vNormalW);
  float ndl = max(dot(n, normalize(uLightDir)), 0.0);
  // 环境光托底，远景时管段不会显得发黑
  vec3 col = base * (0.62 + 0.42 * ndl) + base * 0.18;

  // 条纹叠加：低负荷偏冷白，高负荷偏热色
  vec3 tint = mix(vec3(0.94, 0.98, 1.0), flowColor, 0.5 + 0.4 * fill);
  float streakBoost = 0.30 + 0.85 * intensity;
  col += tint * stripe * streakBoost * (0.5 + 0.5 * fill);
  // 条纹亮核：让滚动方向更易读
  col += vec3(1.0) * pow(stripe, 3.0) * 0.18 * intensity;

  // 边缘光，让圆管更有体积
  vec3 viewDir = normalize(uCameraPos - vPosW);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  col += rim * base * 0.35;

  // 高亮路径
  col += highlight * vec3(1.0, 0.86, 0.42) * (0.25 + 0.85 * stripe);
  col += highlight * vec3(1.0, 0.75, 0.25) * rim * 0.9;

  // 隔离时其余管段降透明并去饱和（dimmed 为 0..1 过渡值）
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 dimCol = mix(vec3(grey), vec3(0.22, 0.28, 0.36), 0.65) * 0.55;
  col = mix(col, dimCol, dimmed);

  // 关闭管段：冷灰、弱化
  vec3 closedCol = vec3(0.20, 0.23, 0.28);
  col = mix(col, closedCol, closed * 0.85);

  float outAlpha = alpha * uGlobalAlpha;
  outAlpha = mix(outAlpha, 0.18, closed);
  outAlpha *= mix(1.0, 0.14, dimmed);

  gl_FragColor = vec4(col, outAlpha);
}
`;

/** 流向箭头：逐实例属性 arrowTint = (r, g, b, a) */
export const ARROW_VERTEX = /* glsl */ `
precision highp float;

attribute vec3 position;
attribute vec3 normal;
attribute vec4 arrowTint;

attribute vec4 world0;
attribute vec4 world1;
attribute vec4 world2;
attribute vec4 world3;

uniform mat4 viewProjection;

varying vec3 vNormalW;
varying vec4 vTint;

void main(void) {
  mat4 finalWorld = mat4(world0, world1, world2, world3);
  vec4 worldPos = finalWorld * vec4(position, 1.0);
  gl_Position = viewProjection * worldPos;
  vNormalW = normalize(mat3(finalWorld) * normal);
  vTint = arrowTint;
}
`;

export const ARROW_FRAGMENT = /* glsl */ `
precision highp float;

varying vec3 vNormalW;
varying vec4 vTint;

uniform vec3 uLightDir;

void main(void) {
  vec3 n = normalize(vNormalW);
  float ndl = max(dot(n, normalize(uLightDir)), 0.3);
  vec3 col = vTint.rgb * (0.82 + 0.32 * ndl);
  gl_FragColor = vec4(min(col, vec3(1.0)), vTint.a);
}
`;
