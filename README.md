# 溃坝洪水演进三维渲染系统

基于浏览器的溃坝洪水演进可视化系统:读入地形与多时刻洪水水深栅格序列,将每帧水深贴合地形生成水膜层,时间轴播放时洪水前锋沿河谷向下游推进。

## 技术栈

- **TypeScript + Vue 3**(组合式 API)
- **three.js**:地形网格、自定义 GLSL 水膜着色器
- **postprocessing**:Bloom 泛光(前锋线发光)+ Vignette
- **IndexedDB**:栅格序列分块持久化,刷新后自动恢复
- **Vite** 构建

## 运行

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5173
npm run build      # 生产构建 → dist/
npm run preview    # 预览构建产物
```

首次打开无本地数据时自动生成演示数据集(256×256 峡谷地形 + 48 帧溃坝洪水过程)。

## 功能

| 功能 | 说明 |
| --- | --- |
| 地形+水深序列渲染 | 水深贴地生成水膜,帧间线性插值平滑推进 |
| 六级深度色带 | 0.5 / 1.0 / 1.5 / 2.0 / 3.0 / 5.0 m 渐变,>5m 继续加深 |
| 前锋线发光 | 水深接近 0.05m 阈值处青色发光,经 Bloom 增强 |
| 播放控制 | 播放/暂停、逐帧前进/后退、3 档速度(×0.5 / ×1 / ×2) |
| 视角切换 | 俯视 / 斜视,带平滑过渡动画,OrbitControls 可自由旋转缩放 |
| 点位查询 | 点击任意位置显示坐标、高程、当前水深、洪水到达时间 |
| 淹没面积 | 时间轴上方实时显示当前时刻淹没面积,附全过程曲线 |
| 导出 | 当前时刻水深栅格(ESRI .asc)与淹没范围(GeoJSON 多边形,Marching Squares 提取) |
| 分块加载与缓存 | 帧序列按 8 帧/块存储,CPU 块级 LRU + GPU 纹理级 LRU 缓存,播放方向预取 |
| 本地持久化 | 数据集(地形、帧块、到达时间、统计)保存于 IndexedDB,刷新自动恢复 |

## 数据格式

支持 **ESRI ASCII Grid (.asc)** 与 **GeoTIFF (.tif)**:

- 地形:单个栅格文件(高程,米)
- 水深序列:多个栅格文件(每个文件一帧,水深,米),按文件名自然排序,帧间隔在导入时指定(秒)
- 所有帧尺寸必须与地形一致;`NODATA_value` / GDAL NoData 视为干区

面板中「导入自定义栅格」选择文件即可导入;也可点击「加载演示数据」体验内置峡谷溃坝过程。

## 测试

```bash
npm run typecheck    # TS 类型检查
npm run test:smoke   # 核心逻辑冒烟测试(地形/序列/统计/范围提取/ASC 解析)
npm run test:e2e     # 浏览器端到端测试(需先 npm run preview,使用本机 Chrome)
```

## 目录结构

```
src/
  types.ts              栅格/数据集类型,深度阈值与六级色带定义
  core/
    raster.ts           ASC/GeoTIFF 解析,演示地形与洪水序列生成
    analysis.ts         淹没面积统计、到达时间、Marching Squares 范围提取
    frameCache.ts       帧序列分块加载 + CPU/GPU 两级 LRU 缓存
    idb.ts              IndexedDB 持久化(meta + 8 帧/块)
    store.ts            全局响应式状态与播放控制
    exporter.ts         水深 .asc 与淹没范围 .geojson 导出
  three/
    FloodScene.ts       three.js 场景:地形网格、水膜着色器、Bloom 合成、拾取
  components/
    Viewport.vue        三维视口(点击查询)
    Timeline.vue        时间轴:面积显示、进度、播放/步进/速度/视角
    ControlPanel.vue    数据导入、点位查询结果、导出、图例
```
