// 火烧迹地边界重建工具 —— 共享数据模型

export interface Pt {
  x: number;
  y: number;
}

/** 清理后的边界：外环（逆时针）+ 孔洞（顺时针），坐标为影像平面世界坐标（米） */
export interface Boundary {
  outer: Pt[];
  holes: Pt[][];
}

/** 正在编辑的边界环（外环 + 孔洞），修边直接修改此结构，再经 manifold 重建 */
export interface Rings {
  outer: Pt[];
  holes: Pt[][];
}

export interface RasterImage {
  id: string;
  name: string;
  width: number;
  height: number;
  /** 单像素地面尺寸（米），来自影像元数据或手工设置 */
  pixelSize: number;
  /** 左上角世界原点（米），默认 (0,0)；y 轴向下与图像一致，世界坐标 y 即“向南为正” */
  origin: Pt;
  image: ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  /** 缩略数据（可序列化存 IndexedDB） */
  blob: Blob;
  kind: 'post' | 'pre' | 'dem';
  /** DEM 专用：高程数组（行优先，米） */
  dem?: Float32Array;
  /** DEM 高程显示倍率 */
  verticalScale: number;
}

export interface ExtractSettings {
  /** 0..1 火烧指数阈值 */
  threshold: number;
  /** Otsu 自动阈值 */
  auto: boolean;
  /** 最小碎片面积（平方米），低于此值的轮廓被剔除 */
  minFragmentArea: number;
  /** Douglas-Peucker 抽稀容差（米） */
  simplifyTolerance: number;
  /** 参考颜色（0..255 RGB），默认焦黑土色 */
  referenceColor: [number, number, number];
}

export interface DisplaySettings {
  /** true = 贴地显示；false = 抬升显示 */
  draped: boolean;
  /** 抬升模式相对地形的抬高量（米） */
  liftHeight: number;
  /** 坡度加密的最小采样间距（米） */
  densifySpacing: number;
  /** 边界不透明度 */
  fillOpacity: number;
}

export type SeverityLevel = 0 | 1 | 2 | 3 | 4;

export interface SeverityLevelInfo {
  level: SeverityLevel;
  label: string;
  color: number;
  cssColor: string;
}

export interface SeveritySettings {
  /** 分级切点（受损指数 0..1），长度 4，升序 */
  cutoffs: [number, number, number, number];
}

export interface Stats {
  /** 平面面积（平方米） */
  planarArea: number;
  /** 贴地表面积（平方米，无 DEM 时等于平面面积） */
  surfaceArea: number;
  /** 贴地周长（米，无 DEM 时为平面周长） */
  perimeter: number;
  /** 各级受损面积（平方米，平面口径），索引为等级 */
  levelAreas: [number, number, number, number, number];
  /** 平均坡度（度） */
  meanSlope: number;
  vertexCount: number;
}

export interface QueryInfo {
  point: Pt;
  elevation: number;
  slope: number;
  severity: SeverityLevelInfo;
  damageIndex: number;
}

export interface AppState {
  imagery: RasterImage | null;
  preImagery: RasterImage | null;
  dem: RasterImage | null;
  boundary: Boundary | null;
  extract: ExtractSettings;
  display: DisplaySettings;
  severity: SeveritySettings;
  stats: Stats | null;
  query: QueryInfo | null;
  hasData: boolean;
}

export type AppEventType =
  | 'imagery-changed'
  | 'pre-imagery-changed'
  | 'dem-changed'
  | 'boundary-changed'
  | 'extract-changed'
  | 'display-changed'
  | 'severity-changed'
  | 'stats-changed'
  | 'query-changed'
  | 'burn-changed'
  | 'edit-history-changed'
  | 'toast';

export interface ToastMessage {
  kind: 'info' | 'error' | 'success';
  text: string;
}
