// three.js 场景搭建与 postprocessing 后期链
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  SMAAEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { CAM, Z_EXAG } from './constants.js';

export function createScene(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false, // 抗锯齿交给 SMAA
    preserveDrawingBuffer: true, // PNG 导出
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setClearColor(0x070b16, 1);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070b16, 0.0016);

  const camera = new THREE.PerspectiveCamera(
    CAM.fov,
    container.clientWidth / container.clientHeight,
    CAM.near,
    CAM.far
  );
  camera.position.set(...CAM.initPos);
  camera.lookAt(new THREE.Vector3(...CAM.target));

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...CAM.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 15;
  controls.maxDistance = 1400;
  controls.maxPolarAngle = Math.PI * 0.92;

  // 灯光(basic material 不受光, 灯光服务于辅助网格/标注)
  scene.add(new THREE.AmbientLight(0x8fa8c8, 1.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.5);
  dir.position.set(200, 400, 120);
  scene.add(dir);

  // 地面参考网格 + 高度环
  const grid = new THREE.GridHelper(900, 45, 0x2a4a6b, 0x16283c);
  grid.position.y = -0.02;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  scene.add(grid);

  const ringGroup = new THREE.Group();
  scene.add(ringGroup);

  // 高度参考层(每 2km 一个淡环)
  for (let z = 2000; z <= 16000; z += 2000) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 0.95, 96),
      new THREE.MeshBasicMaterial({
        color: 0x1d3f5e,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = (z / 1000) * Z_EXAG;
    ring.scale.set(400, 400, 1);
    ringGroup.add(ring);
  }

  // 中心十字标记
  const cross = new THREE.AxesHelper(12);
  cross.position.y = 0.05;
  scene.add(cross);

  // 后期链
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({
    intensity: 0.55,
    luminanceThreshold: 0.25,
    luminanceSmoothing: 0.4,
    mipmapBlur: true,
  });
  const smaa = new SMAAEffect();
  const vignette = new VignetteEffect({ darkness: 0.32, offset: 0.28 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
  composer.addPass(new EffectPass(camera, bloom, smaa, vignette, tone));

  const onResize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  };
  const ro = new ResizeObserver(onResize);
  ro.observe(container);

  return {
    renderer,
    scene,
    camera,
    controls,
    composer,
    ringGroup,
    dispose() {
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
