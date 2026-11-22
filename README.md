# 焊接接头多层多道焊道工艺剖切可视化工具

在三维焊接接头上按焊接工艺堆叠多层多道焊道(打底 → 盖面,约 20 层),用可拖动的
剖切面实时切出焊道截面,逐层显示焊道截面、熔深与层间边界,支持剥层、道间温度
分布叠加与配置导出。

技术栈:**TypeScript + SolidJS + three.js + three-mesh-bvh + earcut**。

## 功能

| 模块 | 说明 |
| --- | --- |
| 坡口几何 | V 型 / U 型坡口,板厚、开口、根部间隙、钝边、U 型圆弧、焊缝长度可调 |
| 多层多道排布 | 层优先自根部向上堆叠;每层道数按坡口宽度自适应,或固定道数;约 20 层 |
| 层间区分 | 每层一个颜色(打底冷色 → 盖面暖色 HSL 渐变) |
| 实时剖切 | 拖动剖切平面(或滑杆),基于 three-mesh-bvh `shapecast` 加速,截面随 z 实时重算 |
| 截面重建 | 跨面三角形交线段 → 顶点焊接 → 闭合轮廓追踪 → earcut 三角化,得到真实共面截面 |
| 熔深/边界 | 每道按熔深比生成熔合边界,剖面显示名义坡口壁虚线与焊道熔合区 |
| 拾取信息 | 点剖面任意一道,高亮该道并显示层号、道号、施焊顺序、半径、熔深、截面积 |
| 遮挡正确 | 实体统一受全局 clipping plane 裁切,剖面填充用 polygonOffset + renderOrder 分层,后层不会错盖前层 |
| 逐层剥开 | 隐藏上方若干层,只留根部几层观察根部成形 |
| 道间温度 | 五档温度色(<100 / 100–150 / 150–200 / 200–250 / ≥250 °C),实体与剖面同步叠加 |
| 重新排布 | 层数/道数/坡口参数改动后整个堆叠自动重排,剖切截面随之重算 |
| 导出 | 把当前剖切位置、坡口/层道配置、每道几何与面积/温度导出为 JSON |

## 快速开始

```bash
npm install
npm run dev        # 开发服务器(终端打印实际端口, 默认 5180)
```

```bash
npm run build      # 类型检查 + 生产构建到 dist/
npm run preview    # 预览生产构建
npm run typecheck  # 仅类型检查
```

## 无头自动化验证

需要本机安装 Chrome(脚本中路径可改)。验证脚本会启动无头 Chrome、加载页面、
驱动真实 DOM 控件并通过 three.js 射线/调试钩子断言内部状态:

```bash
npm run dev &              # 先起 dev server
node scripts/headless-check.mjs
node scripts/screenshot.mjs   # 输出关键状态截图到 scripts/shots/
```

覆盖断言:WebGL 初始化、剖切移动同步、层数改动重排、剥层可见性、温度开关、
固定道数模式、射线拾取高亮、JSON 导出字段。

## 目录结构

```
src/
  types.ts                 公共类型与导出 payload
  state/store.ts           SolidJS 全局状态(signals/store + 排布/温度 memo)
  weld/
    polygon2d.ts           凸多边形偏置、Sutherland-Hodgman 裁剪、面积
    groove.ts              V/U 坡口与基板轮廓
    layout.ts              多层多道排布核心、层颜色
    thermal.ts             道间温度模型与五档着色
    loft.ts                沿焊缝放样(摆动+粗细波动)、基板拉伸
    export.ts              JSON 导出
  three/
    materials.ts           焊道 shader(剥层 discard / 高亮 / 温度纹理)
    section.ts             BVH 剖切、轮廓重建、earcut 三角化
    sceneManager.ts        场景、相机、光照、拖拽、拾取、状态联动
  components/              SolidJS UI(控制面板、3D 视图、信息面板)
scripts/
  headless-check.mjs       无头运行时断言
  screenshot.mjs           无头截图
```

## 关键实现说明

- **剖切不用网格布尔运算**。每个焊道/母材各建一份 `MeshBVH`,剖切时用
  `shapecast` 只下钻与平面相交的包围盒,收集跨面三角形与平面的交线段;
  再在切平面的二维正交基里焊接顶点、追踪闭合环、用 earcut 三角化出共面截面。
- **为什么实体焊道不做几何钳制**:早期把焊道圆强行夹进熔合多边形会使边缘焊道
  退化,截面交点坍缩成单点。熔合关系改由排布层的熔深偏置与面积裁剪表达,
  几何保持完整圆柱放样,剖切结果稳定。
- **温度模型为工艺可视化用途**(根部热积累高、向盖面降低,同层后焊道略高),
  非真实热模拟结果。
