/**
 * 烟羽 GPU 实例化粒子着色器。
 * 地面段浓密、受风场剪切弯曲扩散；高空段由 uGroundFade 整体淡出。
 * 普通透明混合（非加性），片段内 fbm 噪声塑造絮状纹理。
 */

export const smokeVertexShader = /* glsl */ `
  attribute vec4 aSeed;
  attribute float aLife;
  attribute float aSize;

  uniform float uTime;
  uniform vec3 uOrigin;
  uniform vec3 uAxis;
  uniform vec3 uSide1;
  uniform vec3 uSide2;
  uniform vec3 uWind;       // 风场速度（米/秒）
  uniform float uActiveCount;
  uniform float uGroundFade; // 1=地面段, 0=高空（JS 按高度计算）
  uniform float uSizeScale;

  varying float vAge01;
  varying float vAlpha;
  varying vec2 vCorner;
  varying vec3 vSeed3;

  void main() {
    float id = float(gl_InstanceID);
    float aliveMask = step(id + 0.5, uActiveCount);

    float life = aLife;
    float age01 = fract(uTime / life + aSeed.x * 0.731);
    float age = age01 * life;

    float spawnR = sqrt(aSeed.y) * 0.9;
    float ang = aSeed.z * 6.2831853;
    vec3 radial = uSide1 * cos(ang) + uSide2 * sin(ang);
    vec3 spawn = uOrigin + radial * spawnR;

    // 初始随喷流向下游漂移，随后被风场加速剪切 —— 弯曲扩散的来源
    float s = age * (240.0 + 160.0 * aSeed.w);
    vec3 drift = uAxis * s
      + uWind * (age * age * 0.42)
      + vec3(0.0, 1.0, 0.0) * (age * 14.0);                 // 浮力抬升
    float wobble = sin(age * 2.3 + aSeed.x * 30.0) * age * 2.0;
    vec3 center = spawn + drift + radial * (s * 0.28 + wobble);

    float size = aSize * (1.0 + age01 * 2.0) * uSizeScale;
    float fadeIn = smoothstep(0.0, 0.12, age01);
    float fadeOut = 1.0 - smoothstep(0.55, 1.0, age01);
    vAlpha = aliveMask * fadeIn * fadeOut * uGroundFade * 0.28;
    vAge01 = age01;
    vCorner = position.xy;
    vSeed3 = vec3(aSeed.x * 53.0, aSeed.y * 37.0, aSeed.z * 61.0);

    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 worldPos = center + (camRight * position.x + camUp * position.y) * size;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

export const smokeFragmentShader = /* glsl */ `
  precision highp float;

  uniform float uTime;

  varying float vAge01;
  varying float vAlpha;
  varying vec2 vCorner;
  varying vec3 vSeed3;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      v += amp * noise(p);
      p = p * 2.03 + vec2(11.7, 7.3);
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    float d = length(vCorner);
    if (d > 1.0) discard;
    // 宽柔边：消除硬四边形轮廓
    float shape = smoothstep(1.0, 0.0, d);
    shape = pow(shape, 1.6);

    vec2 uv = vCorner * 2.2 + vSeed3.xy;
    float n = fbm(uv + uTime * 0.05);
    n = 0.45 + 0.55 * n;

    // 中性灰，避免被加性火焰暖光叠加后产生明显色偏
    vec3 warm = vec3(0.34, 0.34, 0.345);
    vec3 cold = vec3(0.38, 0.385, 0.395);
    vec3 col = mix(warm, cold, smoothstep(0.0, 0.6, vAge01));

    float a = shape * n * vAlpha;
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
  }
`;
