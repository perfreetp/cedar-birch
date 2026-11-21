/** 全局类型定义 */

/** 单块翼板（基板除外）的几何参数 */
export interface PanelConfig {
  id: string
  /** 沿展开方向的板长（米） */
  length: number
  /** 沿铰链轴方向的板宽（米） */
  width: number
  /** 板厚（米） */
  thickness: number
}

/** 单节铰链的时序参数 */
export interface HingeConfig {
  id: string
  /** 启动延迟（秒）：相对展开开始时刻 */
  delay: number
  /** 转动速率（度/秒） */
  rate: number
}

/** 完整构型数据 */
export interface WingConfig {
  /** 基板（固定端）几何 */
  base: {
    length: number
    width: number
    thickness: number
  }
  /** 翼板列表，数组顺序即展开链路上的父子顺序 */
  panels: PanelConfig[]
  /** 铰链列表，铰链 i 连接 翼板 i 与上级构件，长度与 panels 相同 */
  hinges: HingeConfig[]
  /** 网格纹理密度（每米分格数） */
  gridDensity: number
}

/** 某一时刻各铰链的展开角度（度，0 = 折叠，180 = 全展开） */
export type AngleState = number[]

/** 角度曲线采样点 */
export interface CurveSample {
  /** 时间（秒） */
  t: number
  /** 各铰链角度（度） */
  angles: number[]
}

/** 导出文件的载荷格式 */
export interface ExportPayload {
  format: 'solar-wing-deploy'
  version: 1
  exportedAt: string
  config: WingConfig
  /** 导出瞬间的仿真时间（秒） */
  time: number
  /** 导出瞬间各铰链角度（度） */
  angles: number[]
  /** 完整角度曲线采样 */
  curve: CurveSample[]
}
