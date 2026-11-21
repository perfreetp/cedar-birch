import * as THREE from 'three';
import { FAIRING_DIMS, HINGE_Y } from './geometry';

/**
 * 罩瓣装配约定（局部几何原点 = 罩壳轴线）：
 * - 右瓣铰链线在世界 z = +R，左瓣在 z = -R；
 * - 网格相对铰链组偏移 (0, -HINGE_Y, -side·R)，使罩壳轴线与箭体轴线重合；
 * - 张开 = 铰链组绕局部 Y 轴旋转；抛离 = 铰链组沿 ±X（垂直结合面）平移。
 */
/**
 * 张开角旋转符号：两瓣在各自局部坐标下都绕 -Y 旋转外摆。
 * 左瓣顶点已直接镜像（x 取反 + winding 翻转），其局部外摆方向
 * 经坐标映射后在世界空间自然指向 -X 侧，无需对旋转角取反。
 */
export function hingeAngleSign(_side: -1 | 1): number {
  return -1;
}

/** 网格在铰链组内的局部偏移（抵消铰链线相对罩壳轴线的偏心） */
export function meshLocalOffset(side: -1 | 1): THREE.Vector3 {
  return new THREE.Vector3(0, -HINGE_Y, -side * FAIRING_DIMS.R);
}

export interface PoseOffset {
  x: number;
  y: number;
  z: number;
}

const NO_OFFSET: PoseOffset = { x: 0, y: 0, z: 0 };

/** 闭合位姿下铰链组的世界位置 */
export function fairingClosedPosition(
  side: -1 | 1,
  baseY: number,
  off: PoseOffset = NO_OFFSET,
): THREE.Vector3 {
  return new THREE.Vector3(
    off.x,
    baseY + HINGE_Y + off.y,
    side * FAIRING_DIMS.R + off.z,
  );
}

/** 关键帧采样后的目标位姿（径向斜向抛离，轴向沿 +Y） */
export function fairingTargetPosition(
  side: -1 | 1,
  baseY: number,
  radial: number,
  axial: number,
  off: PoseOffset = NO_OFFSET,
): THREE.Vector3 {
  // 抛离方向在 XZ 平面斜向展开，默认斜视角下两瓣清晰左右分离
  const dirX = 0.82;
  const dirZ = 0.57;
  return new THREE.Vector3(
    side * radial * dirX + off.x,
    baseY + HINGE_Y + axial + off.y,
    side * FAIRING_DIMS.R + side * radial * dirZ + off.z,
  );
}
