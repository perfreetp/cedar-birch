// 光线步进体渲染 + 切片的 GLSL3 着色器

export const raymarchVert = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const raymarchFrag = /* glsl */ `
precision highp sampler3D;

in vec2 vUv;

uniform sampler3D uVol;        // 烘焙后的 RGBA:rgb=发射色,a=消光系数
uniform sampler2D uSliceColor; // 切面场景颜色
uniform sampler2D uSliceDepth; // 切面场景深度
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCamPos;
uniform mat4 uInvViewProj;
uniform vec3 uLightPos;
uniform vec3 uLightColor;      // 颜色 × 强度
uniform float uAmbient;
uniform float uSteps;
uniform float uDensity;        // 全局消光缩放
uniform float uHasVolume;

vec2 rayBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (bmin - ro) * inv;
  vec3 t1 = (bmax - ro) * inv;
  vec3 mn = min(t0, t1);
  vec3 mx = max(t0, t1);
  return vec2(max(max(mn.x, mn.y), mn.z), min(min(mx.x, mx.y), mx.z));
}

// 单散射近似:从采样点向光源走固定步数,估计透射率(体积阴影)
float lightTransmittance(vec3 p) {
  vec3 ld = uLightPos - p;
  float dist = length(ld);
  ld /= max(dist, 1e-5);
  float tmax = min(dist, rayBox(p, ld, uBoxMin, uBoxMax).y);
  if (tmax <= 0.0) return 1.0;
  float dt = tmax / 6.0;
  float tau = 0.0;
  for (int i = 0; i < 6; i++) {
    vec3 sp = p + ld * (dt * (float(i) + 0.5));
    vec3 uvw = (sp - uBoxMin) / (uBoxMax - uBoxMin);
    tau += texture(uVol, uvw).a * dt;
  }
  return exp(-tau * uDensity);
}

void main() {
  vec4 far4 = uInvViewProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 farP = far4.xyz / far4.w;
  vec3 ro = uCamPos;
  vec3 rd = normalize(farP - ro);

  vec4 sliceC = texture(uSliceColor, vUv);

  // 切面(及包围盒线框、光源手柄)的深度 → 射线截断点
  float tSlice = 1e9;
  float depth = texture(uSliceDepth, vUv).x;
  if (depth < 0.999999) {
    vec4 wp4 = uInvViewProj * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec3 wp = wp4.xyz / wp4.w;
    tSlice = dot(wp - ro, rd);
  }

  vec3 col = sliceC.rgb;

  if (uHasVolume > 0.5) {
    vec2 tb = rayBox(ro, rd, uBoxMin, uBoxMax);
    float t0 = max(tb.x, 0.0);
    float t1 = min(tb.y, tSlice);
    if (t1 > t0) {
      float steps = uSteps;
      float dt = (t1 - t0) / steps;
      vec3 acc = vec3(0.0);
      float T = 1.0;
      // 前向合成:采样顺序即前后顺序,天然正确排序,无穿插错误
      for (int i = 0; i < 640; i++) {
        if (float(i) >= steps || T < 0.02) break;
        vec3 p = ro + rd * (t0 + dt * (float(i) + 0.5));
        vec3 uvw = (p - uBoxMin) / (uBoxMax - uBoxMin);
        vec4 s = texture(uVol, uvw);
        float a = s.a * uDensity;
        float tr = exp(-a * dt);
        vec3 light = vec3(uAmbient) + uLightColor * lightTransmittance(p);
        acc += T * s.rgb * light * (1.0 - tr);
        T *= tr;
      }
      col = acc + T * sliceC.rgb; // 剩余透射率透出背后的切面/背景
    }
  }

  gl_FragColor = vec4(col, 1.0);
}
`

export const sliceVert = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const sliceFrag = /* glsl */ `
precision highp sampler3D;

in vec3 vWorld;

uniform sampler3D uRaw;   // RG:归一化 temp/speed
uniform sampler2D uLut;   // 256×2:上行为温度 LUT,下行为流速 LUT
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uChannel;   // 0=温度 1=流速

void main() {
  vec3 uvw = (vWorld - uBoxMin) / (uBoxMax - uBoxMin);
  if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) discard;
  vec2 field = texture(uRaw, uvw).rg;
  float v = uChannel < 0.5 ? field.r : field.g;
  vec4 c = texture(uLut, vec2(v, uChannel < 0.5 ? 0.25 : 0.75));
  gl_FragColor = vec4(c.rgb, 1.0);
}
`
