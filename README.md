# 火烧迹地边界重建工具

面向灾后林地评估的火烧迹地（burn scar）边界重建与受损分级工具。纯前端实现，
基于 **TypeScript + 原生 Web Components + three.js + manifold-3d（WASM）**，
数据全部保存在浏览器本地，无需后端。

## 功能模块

应用分为四个模块（顶部导航切换）：

1. **影像导入**
   - 导入灾后影像、可选灾前影像（用于植被差值）、灰度/terrain-RGB 高程图（DEM）
   - 设置地面分辨率（米/像素）、DEM 高程量程与垂直显示倍率
   - 一键生成合成演示数据（焦黑斑块影像 + 山丘高程），无真实数据也能走通全流程
   - 工程保存/恢复/清空：影像 Blob 存 IndexedDB，矢量与设置存 localStorage
2. **边界提取**
   - 以焦土参考色为基准计算火烧指数（gamma 校正 + 分位拉伸），有灾前影像时改用两期植被差值
   - Otsu 大津法自动阈值，也可手动调节
   - Marching Squares 追踪等值线 → Douglas–Peucker 抽稀 → 最小碎片面积剔除
   - manifold `CrossSection` 布尔并集：消除自交、合并重叠斑块、清理碎片，输出带孔洞的有效多边形
3. **修边编辑**
   - 拖动顶点实时重建多边形（three.js earcut 即时三角化），松手后 manifold 防抖布尔重建
   - 双击边线插入顶点、右键手柄删除顶点、撤销/重做（Ctrl+Z / Ctrl+Y）
   - 贴地显示 / 抬升显示切换，坡度自适应加密间距与不透明度可调
4. **面积统计**
   - 实时计算平面面积、贴地表面积、贴地周长、平均坡度、顶点总数
   - 边界内按植被/火烧差值做 5 级受损分级填色并统计各级面积，切点可调
   - 点击边界任意位置查询该处高程、坡度、受损指数与等级
   - 导出 2D / 含高程 3D 的 GeoJSON，支持导入 GeoJSON 边界

## 技术要点

| 需求 | 实现 |
| --- | --- |
| 颜色差异提取边界 | `lib/extraction.ts`：火烧指数 + Otsu + Marching Squares |
| 布尔消除自交/碎片 | `lib/manifold.ts`：manifold-3d `CrossSection`（Positive 填充 + simplify） |
| 拖动顶点实时三角化 | `three/scene3d.ts`：编辑态 earcut 三角化，防抖后切换 manifold 结果 |
| 顶点投影贴地 + 坡度加密 | `lib/terrain.ts`：DEM 双线性插值、中心差分坡度、`lib/geometry.ts` 自适应加密 |
| 受损分级填充 | `lib/severity.ts`：边界内规则网格采样 + 5 级分级 |
| 贴地/抬升切换 | 显示设置 `draped` / `liftHeight`，场景整体重建 |
| 点击查询坡度/等级 | 射线求交 + `nearestOnBoundary` 最近边投影 |
| 面积/周长实时统计 | 平面鞋带公式 + 加密三角网 3D 表面积 + 3D 边长周长 |
| GeoJSON 导入导出 | `lib/geojson.ts`（Polygon 含孔洞、CRS、统计属性） |
| 浏览器本地存储 | `lib/storage.ts`：IndexedDB（Blob）+ localStorage（矢量/设置） |

> manifold-3d 的 WASM 包装方法（接受 `[x,y]` 元组的 `CrossSection` 工厂等）需在初始化后
> 显式调用 `Module.setup()` 安装，见 `src/lib/manifold.ts`。

## 开发

```bash
npm install
npm run dev        # 开发服务器（默认 http://127.0.0.1:5173）
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
npm run typecheck  # 仅 TypeScript 类型检查
npm run test:unit  # 提取算法与 manifold 布尔/几何单元测试（Node 内运行 WASM）
```

### 端到端冒烟测试

`scripts/e2e-check.mjs` 通过 Chrome DevTools Protocol 驱动无头 Edge/Chrome，
在生产构建上验证「演示数据 → 边界提取 → 修边重建 → 显示切换 → 分级 → GeoJSON → 本地存储」全链路：

```bash
npm run build && npm run preview          # 启动 preview（默认 4173）
# 另起：以远程调试端口启动浏览器
msedge --headless=new --remote-debugging-port=9334 --remote-allow-origins=* about:blank
CDP_PORT=9334 APP_HOST=http://127.0.0.1:4173/ node scripts/e2e-check.mjs
```

## 目录结构

```
src/
  components/   Web Components（应用外壳、3D 视图、四个功能面板）
  three/        three.js 场景引擎（地形、边界渲染、顶点编辑、查询、统计）
  lib/          几何、manifold 封装、DEM 采样、提取、分级、GeoJSON、存储、演示数据
  store.ts      中央状态仓库（事件总线、修边历史、manifold 重建调度）
  types.ts      共享数据模型
scripts/        Node 单元测试与 CDP 端到端测试
```

## 坐标约定

世界平面坐标单位为米，`x = origin.x + col × pixelSize`，
`y = origin.y + row × pixelSize`（y 轴向下，与影像行方向一致）。
GeoJSON 以 EPSG:3857 标注 CRS；若源数据为其它投影，导入前需先投影到米制平面坐标系。
