# 火箭尾焰辐射渲染器

基于 **TypeScript + React 18 + three.js + postprocessing** 的火箭发射尾焰 GPU 渲染与弹道回放应用。

## 功能

| 模块 | 实现 |
| --- | --- |
| 弹道回放 | 导入 JSON 弹道关键帧，按时间轴插值回放箭体位置/速度/姿态（Y 轴向上，发射点在原点） |
| GPU 粒子尾焰 | `InstancedBufferGeometry` 实例化粒子，生命周期完全在顶点着色器推进，CPU 零逐粒子更新 |
| 三档粒子数 | 按高度自动切换：低空 12000+4000 / 中空 6000+1500 / 高空 2500+400 |
| 黑体辐射色带 | Tanner Helland 色温算法生成 512 项 LUT，片元着色器按粒子温度查表（sRGB→线性→HDR） |
| 马赫环 | 沿喷流轴向的正弦驻波亮度调制，带空间包络与闪烁，可独立开关 |
| 烟羽风场 | 地面段烟羽受风场剪切形成弯曲扩散，fBm 噪声絮状纹理，高空按高度淡出 |
| 相机 | 跟随箭体（平滑阻尼）/ 地面固定机位（朝向跟踪）两视角 |
| 时间轴 | 可拖动 scrub，播放/暂停，1× 与 0.5× 慢放 |
| 后处理 | postprocessing 库 Bloom + ACES Filmic 色调映射 + 暗角，Bloom 可开关 |
| 导出 | 当前帧 PNG；弹道关键帧等距抽取 24 帧截图序列（错峰自动下载） |

## 快速开始

```bash
npm install
npm run gen:sample   # 生成内置示例弹道 public/sample-trajectory.json
npm run dev          # 启动开发服务器
npm run build        # 类型检查 + 生产构建
```

## 弹道 JSON 格式

```json
{
  "name": "示例弹道",
  "unit": "metric",
  "keyframes": [
    { "t": 0, "x": 0, "y": 0, "z": 0,
      "vx": 0, "vy": 0, "vz": 0,
      "pitch": 90, "heading": 0, "throttle": 1 }
  ]
}
```

- 位置/速度单位：米、米/秒；`t` 单位：秒，关键帧按时间升序
- `pitch`/`heading`（度）可选，缺省时由速度方向推算姿态
- `throttle` 0..1 可选，为 0 时尾焰熄火（滑行段）

## 目录结构

```
src/
  render/
    blackbody.ts          黑体温度 LUT 生成
    trajectory.ts         弹道采样/插值/姿态推算
    RocketScene.ts        three.js 场景、粒子系统、相机、后处理、截图
    export.ts             PNG 下载与关键帧序列工具
    shaders/              flame / smoke / environment GLSL
  components/             ControlPanel、Timeline、Hud
  App.tsx                 回放状态机与渲染主循环
```

## 渲染说明

- 火焰粒子：加性混合 + HDR 强度输出，Bloom 阈值以上自发光形成泛光晕；高空气压降低时粒子尺寸按 `pressureExpand` 膨胀
- 温度场：`2650K → 480K` 随寿命衰减，油门与随机种子叠加扰动
- 马赫环：`pow(0.5+0.5·sin(axial·freq), 3)` 驻波，仅在喷流 4–55 m 包络内生效
- 烟羽：普通透明混合，漂移量含 `uWind·age²` 二次项，产生随距离加剧的弯曲
