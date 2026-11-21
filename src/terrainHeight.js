// 地形高度场（世界坐标 y，单位：米）。数据生成器与前端渲染共用同一公式。
// 高度范围约 40–360m，保证沙尘源（y≈480m）与抬升云团始终位于地形之上。
export function terrainHeight(wx, wz) {
  const h =
    95 * Math.sin(wx * 0.00042 + 1.3) * Math.cos(wz * 0.00036 - 0.5) +
    65 * Math.sin((wx + wz) * 0.00025 + 2.1) +
    38 * Math.cos(wz * 0.0007 + 0.8) +
    150; // 基准抬升
  return Math.max(40, h);
}
