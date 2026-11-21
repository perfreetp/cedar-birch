import * as THREE from 'three';
import {
  MeshBVH,
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from 'three-mesh-bvh';

let patched = false;

/** 启用 three-mesh-bvh 对 Raycaster/Geometry 原型的加速 */
export function patchBVH(): void {
  if (patched) return;
  const gp = THREE.BufferGeometry.prototype as unknown as Record<string, unknown>;
  gp.computeBoundsTree = computeBoundsTree;
  gp.disposeBoundsTree = disposeBoundsTree;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  patched = true;
}

export function buildBVH(geometry: THREE.BufferGeometry): MeshBVH {
  const bvh = new MeshBVH(geometry);
  (geometry as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
  return bvh;
}

export function bvhOf(geometry: THREE.BufferGeometry): MeshBVH {
  return (geometry as unknown as { boundsTree: MeshBVH }).boundsTree;
}

const _tmpMat = new THREE.Matrix4();

/**
 * 两个已构建 BVH 的网格在世界空间是否相交（避免穿模）。
 *
 * 注意：不能直接用 BVH.intersectsGeometry —— 罩体是带开口剖边的半壳，
 * 卫星盒落在其 BVH 包围体内时会被误判为包含相交。这里改用
 * closestPointToGeometry 做真实三角面距离判定，距离小于阈值才算接触。
 */
export function meshesIntersect(
  a: THREE.Mesh,
  b: THREE.Mesh,
  epsilon = 0.01,
): boolean {
  a.updateWorldMatrix(true, false);
  b.updateWorldMatrix(true, false);
  // geometryToBvh：把 b 的几何变换到 a 的 BVH 局部空间（本项目网格无缩放，距离不变）
  _tmpMat.copy(a.matrixWorld).invert().multiply(b.matrixWorld);
  const hit = bvhOf(a.geometry).closestPointToGeometry(b.geometry, _tmpMat);
  return hit !== null && hit.distance < epsilon;
}

const _tmpVec = new THREE.Vector3();

/** 世界空间点到网格表面的最近距离，用于碎片与舱体的碰撞 */
export function distanceToMesh(point: THREE.Vector3, mesh: THREE.Mesh): number {
  mesh.updateWorldMatrix(true, false);
  _tmpVec.copy(point).applyMatrix4(_tmpMat.copy(mesh.matrixWorld).invert());
  const hit = bvhOf(mesh.geometry).closestPointToPoint(_tmpVec);
  // 刚体变换下距离不变（本项目网格无缩放）
  return hit ? hit.distance : Number.POSITIVE_INFINITY;
}
