/** 天空穹顶（梯度 + 太阳辉光）与程序化网格地面着色器 */

export const skyVertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // 深度推到远平面，保证永远被地面/实体遮挡关系正确（天空垫底）
    gl_Position.z = gl_Position.w;
  }
`;

export const skyFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform vec3 uSunDir;

  void main() {
    float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 horizon = vec3(0.55, 0.62, 0.72);
    vec3 zenith  = vec3(0.05, 0.10, 0.22);
    vec3 col = mix(horizon, zenith, pow(h, 0.85));

    float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
    col += vec3(1.0, 0.75, 0.45) * pow(sun, 350.0) * 3.0;   // 日盘
    col += vec3(1.0, 0.65, 0.35) * pow(sun, 12.0) * 0.35;   // 大气辉光
    gl_FragColor = vec4(col, 1.0);
  }
`;

export const groundVertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const groundFragmentShader = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform vec3 uCamPos;

  float gridLine(vec2 p, float scale) {
    vec2 g = abs(fract(p / scale - 0.5) - 0.5) / fwidth(p / scale);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float minor = gridLine(p, 100.0) * 0.25;
    float major = gridLine(p, 1000.0) * 0.6;
    vec3 base = vec3(0.08, 0.09, 0.11);
    vec3 col = base + vec3(0.35, 0.45, 0.55) * (minor + major);

    // 距离雾化：完全融入天空地平线色，消除平面边缘的黑色硬边
    float dist = length(vWorld - uCamPos);
    float fog = smoothstep(1200.0, 4500.0, dist);
    col = mix(col, vec3(0.42, 0.50, 0.61), fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;
