import { createStore } from 'solid-js/store';

export const STORAGE_KEY = 'campus-security-3d:v1';

export const [state, setState] = createStore({
  step: 1,               // 当前流程模块 1-4
  viewMode: 'top',       // 'top' 俯视 | 'street' 街景
  placeMode: false,      // 放置模式：点击地面添加摄像头
  showAllCoverage: true, // 是否显示全部摄像头覆盖（否则仅选中）
  blindVisible: true,    // 盲区红色图层开关
  cameras: [],           // {id,name,x,y,z,yaw,pitch,fov,vfov,range}
  selectedId: null,
  coverage: {},          // id -> { area }
  blind: null,           // { cells, count, area, cellSize }
  blindStale: false,     // 参数变更后盲区结果过期
  unionArea: 0,          // 并集覆盖面积（由盲区网格估算）
  coverageRate: 0,
  bvhActive: false,      // 摄像头 > 50 时启用 BVH 加速
});
