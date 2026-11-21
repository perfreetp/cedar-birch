/** 单条焊缝记录 —— 焊缝数据导入的标准结构 */
export interface WeldRecord {
  /** 焊缝编号，全局唯一，如 W-102-00017 */
  id: string;
  /** 所属装配区域 */
  region: string;
  /** 板厚 (mm) */
  thickness: number;
  /** 装配间隙 (mm) */
  gap: number;
  /** 焊缝中点，单位米（船长向为 X） */
  position: [number, number, number];
  /** 焊缝方向单位向量 */
  direction: [number, number, number];
  /** 焊缝长度 (m) */
  length: number;
}

/** 板材（分段模型）定义，sample/JSON 导入使用；GLB 导入时直接取网格几何 */
export interface PlateRecord {
  id: string;
  /** 板厚 (mm)，仅用于展示/着色 */
  thickness: number;
  /** 中心坐标 (m) */
  position: [number, number, number];
  /** 半尺寸 (m) */
  size: [number, number, number];
}

export interface WeldDataFile {
  /** 数据集名称（分段名） */
  name: string;
  /** 数据格式版本 */
  version: number;
  welds: WeldRecord[];
  plates?: PlateRecord[];
}

/** 间隙档位（0..8mm 共 9 档） */
export interface GapBin {
  index: number;
  /** 档位下界 (mm)，含 */
  min: number;
  /** 档位上界 (mm)，不含（最后一档无上界） */
  max: number;
  label: string;
  /** 该档颜色（线性 sRGB hex） */
  color: string;
  count: number;
}

/** 配置导出文件：着色方案 + 阈值 + 剖切状态 */
export interface ViewConfigFile {
  type: 'weld-gap-view-config';
  version: 1;
  datasetName: string;
  /** 9 档颜色 hex */
  palette: string[];
  /** 超差阈值 (mm) */
  threshold: number;
  /** 间隙筛选区间 (mm) */
  gapFilter: [number, number];
  section: {
    enabled: boolean;
    /** 剖切平面 X 坐标 (m) */
    position: number;
    /** 船长向范围，用于导入后还原滑块 */
    range: [number, number];
    /** 被切一侧（+X 半段 / -X 半段）半透明显示 */
    ghostSide: 'positive' | 'negative';
  };
  exportedAt: string;
}
