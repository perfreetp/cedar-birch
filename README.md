# 液冷机柜流场体渲染工具

TypeScript + React + three.js + postprocessing 实现的规则网格流场(速度 + 温度)体渲染器。

## 运行

```bash
npm install
npm run gen:sample   # 生成样例数据 sample-data/cabinet.lcf(128×96×160)
npm run dev          # http://localhost:5173
```

打开页面后点「导入数据」选择 `sample-data/cabinet.lcf`(或直接拖拽文件到视口)。数据集解析后会存入 IndexedDB,刷新页面自动恢复。

## 数据格式(.lcf)

```
[0..3]    magic "LCF1"
[4..7]    uint32 LE,JSON 头长度 H
[8..8+H)  JSON 头:{ dims:[nx,ny,nz], spacing:[dx,dy,dz], origin:[x,y,z], channels:["u","v","w","t"] }
[8+H..)   Float32 LE payload,通道主序 u|v|w|t,每通道 nx*ny*nz 个,x 方向最快
```

参考生成器:`scripts/gen_sample.mjs`。

## 功能

- **分块并行解析**:体素按 64³ 切块,Worker 池并行提取(temp/speed)、统计值域、归一化;主线程只负责 `texSubImage3D` 逐块上传与渲染,HUD 显示上传进度。
- **光线步进体渲染**:前向(front-to-back)合成,采样顺序即前后顺序,天然避免半透明穿插;单散射近似光照(向点光源走 6 步阴影射线产生体积阴影)。
- **双传输函数**:温度 / 流速两套,色标控件支持拖动颜色/不透明度停靠点、双击增删;改动后重算 LUT 并由 Worker 重新烘焙体纹理(原始场常驻内存,不重解析文件)。
- **切面**:X/Y/Z 三个正交切面 + 一个自由朝向切面(滑块或视口内拖动/旋转);切面先渲染到带深度的 RT,体渲染按深度截断并做 under-blending,保证叠加正确。
- **光源**:可拖动的点光源手柄,移动只改 shader uniform,不重建体纹理。
- **视口**:左键旋转、滚轮缩放、Shift+拖拽框选放大;HUD 显示帧率与进度。
- **导出/导入设置**:传输函数、相机视角、切面、光源存为 JSON 文件,导入即恢复。

## 持久化

数据集(归一化后的原始场块 + 元信息 + 直方图)保存在 IndexedDB(`lcf-volume-viewer`)。「清除数据」会清空。

## 目录结构

```
src/
  io/         格式解析、IndexedDB、设置导入导出、导入流程编排
  workers/    chunkWorker(提取/归一化/烘焙)+ 线程池
  volume/     VolumeManager(3D 纹理、分块上传)、LUT、GLSL 着色器
  scene/      Stage(渲染循环、相机、控制器、框选)、services 单例
  components/ 传输函数编辑器、切面/光源面板、HUD、工具栏
  state/      zustand store
```
