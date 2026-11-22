// 焊接接头多层多道焊道可视化 —— 公共类型定义
// 坐标约定: x 横向(垂直焊缝), y 竖直向上(板厚方向), z 沿焊缝长度方向
// 单位: mm

export type GrooveType = 'V' | 'U';

export interface GrooveConfig {
  type: GrooveType;
  thickness: number; // 板厚 T
  topWidth: number; // 坡口顶部开口宽度
  rootGap: number; // 根部间隙 g
  rootLand: number; // 钝边高度 h
  uRadius: number; // U 型坡口底部圆弧半径
  weldLength: number; // 焊缝长度 L
  plateWidth: number; // 整块试板宽度(横向)
}

export type PassMode = 'auto' | 'fixed';

export interface WeldConfig {
  layerCount: number; // 总层数(打底 -> 盖面)
  passMode: PassMode; // 每层道数: 自动排布 / 固定道数
  fixedPasses: number; // fixed 模式下每层(除打底层)道数
  passOverlap: number; // 道间间距 / 焊道直径 (越小重叠越大)
  layerOverlap: number; // 焊道直径 / 层厚 ( >1 表示层间熔合重叠)
  penetrationRatio: number; // 熔深 p / 焊道直径
}

export interface Bead {
  id: string;
  order: number; // 施焊顺序(层优先),0 起
  layer: number; // 层号,0 起(0 = 打底层)
  pass: number; // 层内道号,0 起
  cx: number; // 截面圆心 x
  cy: number; // 截面圆心 y
  r: number; // 焊道半径
  nominalArea: number; // 标称截面积 πr²
  fusionArea: number; // 熔合边界内实际截面积 mm²
  penetrationDepth: number; // 相对名义坡口壁的熔深 mm
}

export interface LayoutResult {
  beads: Bead[];
  passesPerLayer: number[];
  beadDiameter: number;
  layerHeight: number;
  rootRadius: number;
}

export interface ThermalBin {
  index: number;
  min: number;
  max: number;
  color: number;
  css: string;
  label: string;
}

export interface ExportPayload {
  tool: string;
  version: string;
  exportedAt: string;
  sectionPosition: { z: number; weldLength: number };
  groove: GrooveConfig;
  weld: WeldConfig;
  peelVisibleLayers: number;
  thermalOverlay: boolean;
  beads: Array<
    Pick<Bead, 'id' | 'order' | 'layer' | 'pass' | 'cx' | 'cy' | 'r'> & {
      nominalArea: number;
      fusionArea: number;
      penetrationDepth: number;
      interpassTemp: number | null;
    }
  >;
}
