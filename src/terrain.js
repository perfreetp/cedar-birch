// 地形网格 + BVH 加速结构 + 高度场纹理
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { terrainHeight } from './terrainHeight.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export class Terrain {
  // bounds: THREE.Box3，体数据的世界包围盒
  constructor(bounds, resolution = 128) {
    this.bounds = bounds.clone();
    this.resolution = resolution;
    this.group = new THREE.Group();
    this._buildMesh();
    this._buildHeightTexture();
  }

  _buildMesh() {
    const { min, max } = this.bounds;
    const seg = this.resolution;
    const positions = [];
    const uvs = [];
    const indices = [];

    for (let iz = 0; iz <= seg; iz++) {
      const wz = min.z + (max.z - min.z) * (iz / seg);
      for (let ix = 0; ix <= seg; ix++) {
        const wx = min.x + (max.x - min.x) * (ix / seg);
        const wy = terrainHeight(wx, wz);
        positions.push(wx, wy, wz);
        uvs.push(ix / seg, iz / seg);
      }
    }
    for (let iz = 0; iz < seg; iz++) {
      for (let ix = 0; ix < seg; ix++) {
        const a = iz * (seg + 1) + ix;
        const b = a + 1;
        const c = a + (seg + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // three-mesh-bvh：加速射线求交（点击采样）与裁剪相关查询
    geo.computeBoundsTree({ strategy: undefined });
    this.bvh = geo.boundsTree;

    const mat = new THREE.MeshStandardMaterial({
      color: 0x4d4034,
      roughness: 1.0,
      metalness: 0.0,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = 'terrain-bvh-mesh';
    this.group.add(this.mesh);

    // 地形侧裙（封到底部，避免从低处看穿）
    const skirt = this._buildSkirt(positions, seg);
    this.group.add(skirt);
  }

  _buildSkirt(topPositions, seg) {
    const bottom = this.bounds.min.y - 200;
    const ring = [];
    for (let ix = 0; ix <= seg; ix++) ring.push(ix);                       // 前边
    for (let iz = 1; iz <= seg; iz++) ring.push(iz * (seg + 1) + seg);    // 右边
    for (let ix = seg - 1; ix >= 0; ix--) ring.push(seg * (seg + 1) + ix); // 后边
    for (let iz = seg - 1; iz >= 1; iz--) ring.push(iz * (seg + 1));      // 左边

    const pos = [];
    const idx = [];
    for (const vi of ring) {
      const x = topPositions[vi * 3];
      const y = topPositions[vi * 3 + 1];
      const z = topPositions[vi * 3 + 2];
      pos.push(x, y, z, x, bottom, z);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      const a = i * 2, b = i * 2 + 1, c = j * 2, d = j * 2 + 1;
      idx.push(a, b, c, c, b, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a3d2f, roughness: 1 });
    return new THREE.Mesh(geo, mat);
  }

  // 高度场纹理：R 通道存归一化高度，供切片 shader 剔除地形以下片元
  _buildHeightTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    const { min, max } = this.bounds;
    const rangeY = max.y - min.y;
    let p = 0;
    for (let iz = 0; iz < size; iz++) {
      const wz = min.z + (max.z - min.z) * (iz / (size - 1));
      for (let ix = 0; ix < size; ix++) {
        const wx = min.x + (max.x - min.x) * (ix / (size - 1));
        const h = (terrainHeight(wx, wz) - min.y) / rangeY;
        const v = Math.round(Math.min(1, Math.max(0, h)) * 255);
        data[p++] = v; data[p++] = v; data[p++] = v; data[p++] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    this.heightTexture = tex;
    this.heightRange = { minY: min.y, invRangeY: 1 / rangeY };
  }

  // 世界坐标 -> 地形表面高度
  heightAt(wx, wz) {
    return terrainHeight(wx, wz);
  }

  // BVH 射线求交（点击拾取时使用）
  raycast(ray, target) {
    return this.bvh.raycastFirst(ray, THREE.DoubleSide, 0, Infinity);
  }

  dispose() {
    this.mesh.geometry.disposeBoundsTree?.();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.heightTexture.dispose();
  }
}
