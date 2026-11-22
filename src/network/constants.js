/**
 * 管网公共常量：管径分档配色、流量档位、设计输送能力等。
 * 供数据生成、水力求解、3D 渲染和界面共用。
 */

export const DESIGN_VELOCITY = 40; // m/s，用于计算管段设计输送能力的参考流速（高流速放空管线）
export const GAS_DENSITY = 1.2; // kg/m3
export const WATER_DENSITY = 1000; // kg/m3
export const GRAVITY = 9.81;

/** 管径分档 —— 管段主体配色 */
export const DN_TIERS = [
  { key: 'd150', max: 200, label: 'DN≤200', color: '#e8a33d' },
  { key: 'd250', max: 350, label: 'DN250–350', color: '#dd6f3f' },
  { key: 'd400', max: 500, label: 'DN400–500', color: '#c9b041' },
  { key: 'd600', max: 800, label: 'DN600–800', color: '#58b47a' },
  { key: 'd900', max: 1100, label: 'DN900–1100', color: '#3f9dc6' },
  { key: 'd1200', max: 99999, label: 'DN≥1200', color: '#8d81db' },
];

export function dnTierIndex(dn) {
  for (let i = 0; i < DN_TIERS.length; i++) if (dn <= DN_TIERS[i].max) return i;
  return DN_TIERS.length - 1;
}

export function dnColor(dn) {
  return DN_TIERS[dnTierIndex(dn)].color;
}

/** 流量档位（按“充满度/负荷率”划分） */
export const FLOW_TIERS = [
  { key: 0, label: '停流', min: 0, color: '#5b6675' },
  { key: 1, label: '低负荷', min: 0.1, color: '#3d8fbe' },
  { key: 2, label: '中负荷', min: 15, color: '#3fbfa0' },
  { key: 3, label: '较高负荷', min: 35, color: '#c9c04a' },
  { key: 4, label: '高负荷', min: 60, color: '#e0903f' },
  { key: 5, label: '超负荷', min: 85, color: '#e15353' },
];

/**
 * @param {number} fillPercent 充满度（%）
 */
export function flowTierIndex(fillPercent) {
  if (fillPercent < 0.1) return 0;
  for (let i = FLOW_TIERS.length - 1; i >= 0; i--) {
    if (fillPercent >= FLOW_TIERS[i].min) return i;
  }
  return 0;
}

export function flowTierLabel(fillPercent) {
  return FLOW_TIERS[flowTierIndex(fillPercent)].label;
}

/** 圆管截面积 m2 */
export function pipeArea(dnMm) {
  const d = dnMm / 1000;
  return Math.PI * d * d / 4;
}

/** 设计输送能力 m3/h（按 DESIGN_VELOCITY） */
export function designCapacity(dnMm) {
  return pipeArea(dnMm) * DESIGN_VELOCITY * 3600;
}

/** 管段流速 m/s */
export function velocityOf(flowM3h, dnMm) {
  return Math.abs(flowM3h) / 3600 / pipeArea(dnMm);
}

/**
 * 充满度（负荷率）%：以该管径的工程常用输送量为 100%，不是“满管”。
 * 放空管线正常流速 5~25 m/s，取 18 m/s 作为 100% 参照。
 */
const FILL_REF_VELOCITY = 18;
export function fillPercentOf(flowM3h, dnMm) {
  const cap = pipeArea(dnMm) * FILL_REF_VELOCITY * 3600;
  return cap > 0 ? (Math.abs(flowM3h) / cap) * 100 : 0;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export const CONDITION_META = {
  normal: { name: '正常排放', short: '正常', color: '#4fc3a1', description: '装置正常运行，各排放源按设计泄放量排放，2# 火炬处于备用状态。' },
  emergency: { name: '事故排放', short: '事故', color: '#e46a4a', description: '事故工况，全部排放源按事故泄放量排放，两座火炬同时投用。' },
  maintenance: { name: '检修', short: '检修', color: '#d5a94a', description: '部分支路切出检修，装置降负荷运行，2# 火炬承担排放。' },
};
