import * as THREE from 'three';
import {
  FAIRING_DIMS,
  HINGE_Y,
  ROCKET_RADIUS,
  createClamshellGeometry,
  createHingeHelper,
} from './geometry';
import { buildBVH, patchBVH } from './bvh';

export interface FairingHalf {
  side: -1 | 1;
  /** 铰链组：位置 = 铰链点，绕局部 Y 轴旋转实现张开 */
  hinge: THREE.Group;
  /** 罩壳网格（铰链组子节点，局部原点即铰链点） */
  mesh: THREE.Mesh;
  hingeHelper: THREE.Group;
}

export interface SceneRefs {
  scene: THREE.Scene;
  rocket: THREE.Group;
  rocketBody: THREE.Mesh;
  satellite: THREE.Group;
  satelliteCore: THREE.Mesh;
  fairings: FairingHalf[];
  /** 所有需要参与 BVH 碰撞检测的静态/动态网格 */
  collisionMeshes: THREE.Mesh[];
  baseFairingY: number;
}

function makeStarfield(): THREE.Points {
  const n = 1400;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = 60 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi) * 0.7 + 10;
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xbfd4ff,
    size: 0.35,
    sizeAttenuation: true,
    depthWrite: false,
  });
  return new THREE.Points(geo, mat);
}

function buildRocket(): { group: THREE.Group; body: THREE.Mesh } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8ec,
    metalness: 0.55,
    roughness: 0.35,
  });
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(ROCKET_RADIUS, ROCKET_RADIUS, 14, 40),
    bodyMat,
  );
  body.position.y = -3;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // 级间环（罩体安装面）
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x9aa0a8,
    metalness: 0.8,
    roughness: 0.28,
  });
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(ROCKET_RADIUS * 1.06, ROCKET_RADIUS * 1.06, 0.35, 40),
    ringMat,
  );
  ring.position.y = 4.1;
  group.add(ring);

  // 引擎喷管装饰
  const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.4 });
  for (const [x, z] of [[0, 0], [0.32, 0], [-0.32, 0], [0, 0.32], [0, -0.32]] as const) {
    const nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.2, 0.7, 20),
      nozzleMat,
    );
    nozzle.position.set(x, -10.35, z);
    group.add(nozzle);
  }
  return { group, body };
}

function buildSatellite(): { group: THREE.Group; core: THREE.Mesh } {
  const group = new THREE.Group();
  // 顶面留出与罩体拱顶收窄段的安全间隙（罩内圆柱段顶 y=6.875）
  group.position.y = 5.85;

  const coreMat = new THREE.MeshStandardMaterial({
    color: 0xd9a441,
    metalness: 0.7,
    roughness: 0.3,
  });
  // 星体包络必须小于罩体内部净空，且避开两瓣结合面的封边条（z≈0 平面）
  const core = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.42), coreMat);
  core.castShadow = true;
  group.add(core);

  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x274a8f,
    metalness: 0.35,
    roughness: 0.45,
  });
  // 太阳翼发射段处于折叠状态，外缘不超过罩体半径
  for (const s of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.42), panelMat);
    panel.position.x = s * 0.42;
    panel.castShadow = true;
    group.add(panel);
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8),
      coreMat,
    );
    boom.rotation.z = Math.PI / 2;
    boom.position.x = s * 0.27;
    group.add(boom);
  }
  return { group, core };
}

function buildFairingHalf(side: -1 | 1, baseY: number): FairingHalf {
  const hinge = new THREE.Group();
  // 铰链线位于结合面背侧：右瓣 z=+R、左瓣 z=-R
  hinge.position.set(0, baseY + HINGE_Y, side * FAIRING_DIMS.R);

  const geo = createClamshellGeometry(side);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xf2f2f5,
    metalness: 0.5,
    roughness: 0.32,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // 偏移抵消铰链偏心，使罩壳轴线与箭体轴线重合
  mesh.position.set(0, -HINGE_Y, -side * FAIRING_DIMS.R);
  hinge.add(mesh);

  const hingeHelper = createHingeHelper();
  hinge.add(hingeHelper);
  buildBVH(geo);

  return { side, hinge, mesh, hingeHelper };
}

export function createScene(): SceneRefs {
  patchBVH();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a14);
  scene.fog = new THREE.FogExp2(0x070a14, 0.008);

  const hemi = new THREE.HemisphereLight(0x9db8ff, 0x1a1a26, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.1);
  sun.position.set(14, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -12;
  sun.shadow.camera.right = 12;
  sun.shadow.camera.top = 16;
  sun.shadow.camera.bottom = -16;
  sun.shadow.camera.far = 80;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x5577ff, 0.7);
  rim.position.set(-10, 4, -12);
  scene.add(rim);

  scene.add(makeStarfield());

  // 地面网格（发射工位）
  const grid = new THREE.GridHelper(60, 60, 0x335577, 0x1c2a40);
  grid.position.y = -10;
  scene.add(grid);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(30, 64),
    new THREE.MeshStandardMaterial({ color: 0x0d1422, roughness: 0.95, metalness: 0.1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -10.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const { group: rocket, body: rocketBody } = buildRocket();
  scene.add(rocket);

  const { group: satellite, core: satelliteCore } = buildSatellite();
  scene.add(satellite);

  const baseFairingY = 4.275; // 罩体底面（级间环顶面）
  const fairings = [buildFairingHalf(1, baseFairingY), buildFairingHalf(-1, baseFairingY)];
  for (const f of fairings) scene.add(f.hinge);

  const collisionMeshes: THREE.Mesh[] = [];
  for (const f of fairings) collisionMeshes.push(f.mesh);
  collisionMeshes.push(rocketBody, satelliteCore);
  buildBVH(rocketBody.geometry);
  buildBVH(satelliteCore.geometry);

  return {
    scene,
    rocket,
    rocketBody,
    satellite,
    satelliteCore,
    fairings,
    collisionMeshes,
    baseFairingY,
  };
}
