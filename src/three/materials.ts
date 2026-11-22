// three.js 材质工厂。焊道合并网格通过 onBeforeCompile 注入:
// 1) layerIndex uniform 实现逐层剥开(discard)
// 2) beadIndex uniform 实现选中焊道高亮(漫反射混色)
// 3) 温度 DataTexture 按 beadIndex 查色, 实现实体焊道的道间温度叠加
import * as THREE from 'three';

export interface WeldMaterialHandle {
  material: THREE.MeshStandardMaterial;
  setMaxLayer: (n: number) => void;
  setHighlight: (beadIndex: number) => void; // -1 表示无高亮
  setThermal: (on: boolean, beadColors: Uint8Array) => void; // RGB 逐焊道
}

const MAX_BEADS = 1024;

export function makeWeldMaterial(): WeldMaterialHandle {
  const uniforms = {
    uMaxLayer: { value: 1e6 },
    uHighlightBead: { value: -1 },
    uThermalOn: { value: 0 },
    uThermalTexture: {
      value: (() => {
        const tex = new THREE.DataTexture(
          new Uint8Array(MAX_BEADS * 4),
          MAX_BEADS,
          1,
          THREE.RGBAFormat,
        );
        tex.needsUpdate = true;
        return tex;
      })(),
    },
  };
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.28,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMaxLayer = uniforms.uMaxLayer;
    shader.uniforms.uHighlightBead = uniforms.uHighlightBead;
    shader.uniforms.uThermalOn = uniforms.uThermalOn;
    shader.uniforms.uThermalTexture = uniforms.uThermalTexture;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float beadIndex;
         attribute float layerIndex;
         varying float vBeadIndex;
         varying float vLayerIndex;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vBeadIndex = beadIndex;
         vLayerIndex = layerIndex;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vBeadIndex;
         varying float vLayerIndex;
         uniform float uMaxLayer;
         uniform float uHighlightBead;
         uniform float uThermalOn;
         uniform sampler2D uThermalTexture;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if (vLayerIndex > uMaxLayer + 0.5) discard;
         if (uThermalOn > 0.5) {
           vec2 uv = vec2((vBeadIndex + 0.5) / ${MAX_BEADS.toFixed(1)}, 0.5);
           vec3 thermalColor = texture2D(uThermalTexture, uv).rgb;
           diffuseColor.rgb = mix(diffuseColor.rgb, thermalColor, 0.82);
         }
         if (abs(vBeadIndex - uHighlightBead) < 0.5) {
           diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.84, 0.22), 0.72);
         }`,
      );
  };
  material.customProgramCacheKey = () => 'weld-peel-highlight-thermal-v2';
  return {
    material,
    setMaxLayer: (n) => (uniforms.uMaxLayer.value = n),
    setHighlight: (i) => (uniforms.uHighlightBead.value = i),
    setThermal: (on, beadColors) => {
      uniforms.uThermalOn.value = on ? 1 : 0;
      const data = uniforms.uThermalTexture.value.image.data as Uint8Array;
      data.fill(0);
      const n = Math.min(beadColors.length / 3, MAX_BEADS);
      for (let i = 0; i < n; i++) {
        data[i * 4] = beadColors[i * 3];
        data[i * 4 + 1] = beadColors[i * 3 + 1];
        data[i * 4 + 2] = beadColors[i * 3 + 2];
        data[i * 4 + 3] = 255;
      }
      uniforms.uThermalTexture.value.needsUpdate = true;
    },
  };
}

/** 剖面填充材质(平面、不受光照、polygonOffset 防闪烁) */
export function makeSectionFillMaterial(color: number, beadFill = false): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    polygonOffset: true,
    // 焊道填充片需盖过母材/盖面金属片, 给更强的负向偏移
    polygonOffsetFactor: beadFill ? -4 : -1,
    polygonOffsetUnits: beadFill ? -4 : -1,
    transparent: true,
    opacity: 0.97,
    depthWrite: true,
  });
  // 剖面填充不参与全局剖切(它本身就在剖面上)
  mat.clippingPlanes = [];
  return mat;
}

export function makeMetalMaterial(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.35,
    side: THREE.DoubleSide,
  });
}
