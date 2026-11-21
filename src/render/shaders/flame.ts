/**
 * 火焰 GPU 实例化粒子着色器。
 * 粒子生命周期完全在顶点着色器内由 uTime + 随机种子推进，CPU 零回读。
 * 温度经黑体 LUT 查色；马赫环为沿喷流轴向的周期性驻波亮度调制。
 */

export const flameVertexShader = /* glsl */ `
  attribute vec4 aSeed;     // 四个独立随机数 0..1
  attribute float aLife;    // 粒子寿命（秒）
  attribute float aSize;    // 基础尺寸（米）

  uniform float uTime;
  uniform vec3 uOrigin;     // 喷口世界坐标
  uniform vec3 uAxis;       // 喷流轴向（单位向量，指向尾焰后方）
  uniform vec3 uSide1;
  uniform vec3 uSide2;
  uniform float uActiveCount;
  uniform float uThrottle;
  uniform float uExhaustSpeed;
  uniform float uSizeScale;

  varying float vAge01;
  varying float vAxial;
  varying float vTemp;
  varying float vAlpha;
  varying vec2 vCorner;

  void main() {
    float id = float(gl_InstanceID);
    float aliveMask = step(id + 0.5, uActiveCount);

    float life = aLife;
    float age01 = fract(uTime / life + aSeed.x);
    float age = age01 * life;

    // 喷口截面圆盘上随机出生
    float spawnR = sqrt(aSeed.y) * 0.4;
    float ang = aSeed.z * 6.2831853;
    vec3 radial = uSide1 * cos(ang) + uSide2 * sin(ang);
    vec3 spawn = uOrigin + radial * spawnR;

    // 轴向推进（粒子间速度随机），锥形扩张 + 正弦湍流
    float speedJ = 0.82 + 0.36 * aSeed.w;
    float s = age * uExhaustSpeed * speedJ;
    float turb = sin(age * 8.0 + aSeed.x * 43.0) * 0.55
               + sin(age * 17.0 + aSeed.z * 21.0) * 0.25;
    vec3 center = spawn
      + uAxis * s
      + radial * (s * 0.13)
      + (uSide1 * sin(aSeed.x * 91.0) + uSide2 * cos(aSeed.y * 77.0)) * turb * s * 0.06;

    // 温度随寿命衰减，油门影响整体温域
    float tBase = mix(2650.0, 480.0, pow(age01, 0.85));
    vTemp = tBase * (0.72 + 0.28 * uThrottle) * (0.92 + 0.16 * aSeed.z);

    float size = aSize * (1.0 + age01 * 2.4) * uSizeScale;
    vAlpha = aliveMask * pow(1.0 - age01, 2.1) * (0.4 + 0.5 * uThrottle);
    vAge01 = age01;
    vAxial = s;
    vCorner = position.xy;

    // 相机对齐广告牌
    vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp    = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 worldPos = center + (camRight * position.x + camUp * position.y) * size;
    gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
  }
`;

export const flameFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uLUT;
  uniform float uTempMin;
  uniform float uTempMax;
  uniform float uMachEnabled;
  uniform float uMachFreq;
  uniform float uTime;
  uniform float uIntensity;

  varying float vAge01;
  varying float vAxial;
  varying float vTemp;
  varying float vAlpha;
  varying vec2 vCorner;

  void main() {
    float d = length(vCorner);
    if (d > 1.0) discard;
    float soft = smoothstep(1.0, 0.1, d);

    // 黑体温度查表（LUT 存的是 sRGB，转线性后参与 HDR 累加）
    float u = clamp((vTemp - uTempMin) / (uTempMax - uTempMin), 0.0, 1.0);
    vec3 srgb = texture2D(uLUT, vec2(u, 0.5)).rgb;
    vec3 col = pow(srgb, vec3(2.2));

    // 马赫环：沿喷流轴向的周期性驻波亮度调制，带空间包络与轻微闪烁
    float mach = 1.0;
    if (uMachEnabled > 0.5) {
      float ring = pow(0.5 + 0.5 * sin(vAxial * uMachFreq), 3.0);
      float env = smoothstep(1.0, 4.0, vAxial)
                * (1.0 - smoothstep(28.0, 55.0, vAxial));
      float flicker = 0.85 + 0.15 * sin(uTime * 23.0 + vAxial * 1.7);
      mach += ring * env * 1.7 * flicker;
    }

    float a = soft * vAlpha;
    // 远端火焰快速衰减，让中性灰烟羽成为主导，抑制加性暖色穿透造成的粉红
    float axialFade = 1.0 - smoothstep(18.0, 42.0, vAxial);
    vec3 hdr = col * mach * uIntensity * a * (0.35 + 0.65 * axialFade);
    gl_FragColor = vec4(hdr, a);
  }
`;
