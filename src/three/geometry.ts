import * as THREE from 'three';

export interface FairingDimensions {
  /** 罩体半径 */
  R: number;
  /** 罩体总高 */
  H: number;
  /** 圆柱段高度（剩余为拱形头锥） */
  cylH: number;
}

export const FAIRING_DIMS: FairingDimensions = { R: 0.95, H: 4.6, cylH: 2.6 };
export const ROCKET_RADIUS = 0.62;
export const HINGE_Y = 2.3;

/** 罩体外形轮廓半径（椭圆拱头锥 + 圆柱段） */
function profileRadius(y: number, d: FairingDimensions): number {
  if (y <= d.cylH) return d.R;
  const u = (y - d.cylH) / (d.H - d.cylH); // 0..1
  return Math.max(0.001, d.R * Math.sqrt(Math.max(0, 1 - u * u)));
}

/**
 * 构建单侧瓣状罩壳（绕 Y 轴旋转面的一半，剖开面为 x=0 平面）。
 * side=1 为右瓣（x≥0，铰链边 theta=0 在 z=+R）；
 * side=-1 为左瓣，顶点直接镜像（x≤0，铰链边在 z=-R），不使用负缩放。
 *
 * 罩体局部坐标：罩壳轴线在原点，+Y 向上。
 * 几何为带壁厚的封闭薄壳（外弧面 + 内弧面 + 剖边/底边/拱顶封边），
 * 保证 BVH 距离查询不会因开口边界进入卫星盒内部而误报穿模。
 */
export function createClamshellGeometry(side: 1 | -1): THREE.BufferGeometry {
  const d = FAIRING_DIMS;
  const thickness = 0.06;
  const ny = 46;
  const nt = 26;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 层 0 = 外表面（半径 r），层 1 = 内表面（半径 r - 壁厚）
  for (let layer = 0; layer < 2; layer++) {
    for (let iy = 0; iy <= ny; iy++) {
      const y = (d.H * iy) / ny;
      const rOuter = profileRadius(y, d);
      const r = layer === 0 ? rOuter : Math.max(0.06, rOuter - thickness);
      for (let it = 0; it <= nt; it++) {
        const theta = (Math.PI * it) / nt; // 0..π
        const x = side * r * Math.sin(theta);
        const z = r * Math.cos(theta);
        positions.push(x, y, z);
        uvs.push(it / nt, iy / ny);
      }
    }
  }

  const row = nt + 1;
  const layerSize = (ny + 1) * row;
  const vid = (layer: number, iy: number, it: number) =>
    layer * layerSize + iy * row + it;

  // 外表面与内表面（内表面发序取反，法线朝壳内）
  for (let iy = 0; iy < ny; iy++) {
    for (let it = 0; it < nt; it++) {
      const a = vid(0, iy, it);
      const b = vid(0, iy, it + 1);
      const c = vid(0, iy + 1, it);
      const dd = vid(0, iy + 1, it + 1);
      indices.push(a, c, b, b, c, dd);

      const ai = vid(1, iy, it);
      const bi = vid(1, iy, it + 1);
      const ci = vid(1, iy + 1, it);
      const di = vid(1, iy + 1, it + 1);
      indices.push(ai, bi, ci, bi, di, ci);
    }
  }

  // 两条剖边封边（theta=0 与 theta=π）：连接内外层
  for (const it of [0, nt]) {
    for (let iy = 0; iy < ny; iy++) {
      const o0 = vid(0, iy, it);
      const o1 = vid(0, iy + 1, it);
      const i0 = vid(1, iy, it);
      const i1 = vid(1, iy + 1, it);
      indices.push(o0, i0, o1, o1, i0, i1);
    }
  }

  // 底边（iy=0）与拱顶（iy=ny）环形封边
  for (const iy of [0, ny]) {
    for (let it = 0; it < nt; it++) {
      const o0 = vid(0, iy, it);
      const o1 = vid(0, iy, it + 1);
      const i0 = vid(1, iy, it);
      const i1 = vid(1, iy, it + 1);
      if (iy === 0) indices.push(o0, o1, i0, o1, i1, i0);
      else indices.push(o0, i0, o1, o1, i0, i1);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  if (side === -1) {
    // 镜像顶点后翻转发序，保证法线朝外
    for (let i = 0; i < indices.length; i += 3) {
      const tmp = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = tmp;
    }
    geo.setIndex(indices);
  }
  geo.computeVertexNormals();
  return geo;
}

/** 铰链辅助标识：沿铰链线的细圆柱 + 两个安装座（挂在铰链组原点） */
export function createHingeHelper(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffb020,
    emissive: 0x663c00,
    metalness: 0.6,
    roughness: 0.35,
  });
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 12), mat);
  g.add(pin);
  for (const dy of [-0.32, 0.32]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), mat);
    seat.position.y = dy;
    g.add(seat);
  }
  return g;
}
