// 全局常量与可调参数
export const PARTICLE_COUNT = 120000; // 粒子总量(固定 12 万)

// 场景坐标尺度: 1 场景单位 = 1 km
export const KM = 1;
export const Z_EXAG = 0.6; // 垂直方向视觉夸张系数,让结构层次更易观察

// 三类结构的粒子配额
export const QUOTA = {
  eyewall: 0.22, // 眼壁 22%
  rainband: 0.46, // 螺旋雨带 46%
  outer: 0.32, // 外围环流 32%
};

// 高度切面默认带宽(m)
export const DEFAULT_BAND = 800;

// 相机
export const CAM = {
  fov: 50,
  near: 0.5,
  far: 4000,
  initPos: [260, 300, 260],
  target: [0, 12, 0],
};

// 5 个色阶十六进制(密度 高->低): 眼壁深红 -> 外围浅蓝
export const COLOR_STOPS_HEX = ['#8b0f1c', '#e0532f', '#f0b14e', '#8fd6d6', '#bfe3f5'];

// 数据 schema 版本
export const DATA_SCHEMA = 'typhoon-profile-v1';
