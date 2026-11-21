# 沙尘扩散浓度场体积可视化工具

基于 **Three.js + three-mesh-bvh + Web Worker** 的三维沙尘浓度场体绘制应用。以多层切片叠加（slice-based volume rendering）方式渲染随时间演化的沙尘云团，支持浓度阈值剔除、地形相交裁剪、时间序列插值播放、点击采样与结果导出。

## 功能与四大区域

| 区域 | 位置 | 能力 |
| --- | --- | --- |
| ① 数据加载 | 左侧栏 | 一键加载演示数据 / 导入自定义 `.dustvol`，显示网格、时刻数、浓度范围与加载进度 |
| ② 三维体视图 | 中央视口 | 多层切片 GPU 实例化渲染、视线主轴自适应、地形裁剪、点击浓度采样标注、FPS 与分辨率 HUD |
| ③ 阈值与切片控制 | 左侧栏 | 浓度阈值 5 个等级（L0–L4）、切片层数 32–128（步进 8），调整后重新烘焙纹理并下一帧生效 |
| ④ 时间序列播放 | 左侧栏 | 18 个时刻逐帧切换、帧间着色器插值、0.5×/1×/2×/4× 速度、单步、循环 |

### 关键渲染设计

- **前后向（front-to-back）alpha 合成**：切片按视线方向由近到远排序，使用预乘 alpha 与
  `(ONE, ONE_MINUS_DST_ALPHA)` 混合因子实现标准 over 算子。高浓度区快速趋近不透明，
  避免普通 alpha 混合反复叠加产生的灰雾/发白。
- **切片纹理图集（texture atlas）**：Worker 将体数据按当前视线主轴重采样为紧排 2D 图集，
  双时刻（A/B）各一份，插值在片段着色器内完成，播放过渡无需每帧重传体积数据。
- **阈值烘焙期剔除**：低于阈值的体素在 Worker 烘焙时直接写入 `alpha=0`，不进入 GPU 混合。
- **地形相交裁剪（three-mesh-bvh）**：地形网格构建 BVH，用于点击射线求交；
  同时生成 256² 高度场纹理，切片片段着色器中按世界坐标采样高度并 `discard` 地形以下体素。
- **清晰纹理**：切片纹理线性过滤 + 各向异性过滤（最高 16x），旋转缩放保持清晰。
- **自适应分辨率**：实时监测帧率，低于目标时自动降低渲染分辨率（60%–100%）以维持流畅度。

## 性能说明

- 烘焙在 Web Worker 中进行（典型 35–60ms/次），不阻塞主线程与渲染循环。
- 切片为一次 `InstancedMesh` 绘制调用，实例顺序仅在主轴/朝向/层数变化时重建。
- 工程目标为视口内 **≥55fps**；仓库内自动化测试运行在无 GPU 的 SwiftShader 软件渲染环境，
  帧率读数（10–30fps）不代表独立显卡/核显上的真实表现，自适应降分辨率机制在该环境下会自动生效。

## 数据格式 `.dustvol`

128 字节小端头部 + 紧凑 `Uint16` 体数据（帧优先，帧内 `x` 最快、`z` 最慢）。
完整字段见 `src/volumeFormat.js`。浓度以 `Uint16` 归一化存储，头部记录物理量程与单位。

## 开发与运行

```bash
npm install
npm run gen-data     # 生成 18 时刻演示数据到 public/demo-dust.dustvol（约 20MB）
npm run dev          # 开发服务器（默认 http://127.0.0.1:5247）
npm run build        # 生产构建
npm run preview      # 预览生产构建
```

## 自动化测试（Playwright，需先启动 dev/preview 服务器）

```bash
node test/smoke.mjs     # 端到端：加载、烘焙、五级阈值、层数、播放、拾取、PNG/JSON 导出
node test/axis.mjs      # 主轴动态切换、各向异性、插值系数、自适应分辨率
node test/stress.mjs    # 高频拖动阈值/层数的烘焙调度压测
node test/visual.mjs    # 输出多时刻/阈值/层数对比截图到 test-shots/visual
```

## 目录结构

```
src/
  main.js               UI 编排、烘焙调度、播放循环、拾取、导出
  volumeRenderer.js     场景/相机/实例化切片/FTB 着色器/自适应分辨率/PNG
  sliceBaker.worker.js  体数据切片烘焙、三线性采样、浓度统计
  bakerClient.js        Worker 的 Promise 化客户端
  terrain.js            地形网格 + BVH + 高度场纹理
  terrainHeight.js      地形高度公式（生成器与前端共享）
  colorLUT.js           沙尘配色 LUT 与五级阈值定义
  volumeFormat.js       .dustvol 二进制格式解析
tools/
  generateSampleData.mjs  高斯烟羽演示数据生成器
test/                     Playwright 自动化测试
```
