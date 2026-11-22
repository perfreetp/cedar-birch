# 台风结构三维可视化工具

基于 **three.js + postprocessing + troika-three-text** 的台风三维粒子可视化系统。读取台风中心气压与风速的层级数据，将**眼壁、螺旋雨带、外围环流**渲染为可旋转的 12 万粒子实例化场，支持高度切面、时间轴回放、框选放大与结果导出。

## 快速开始

```bash
npm install          # 安装 three / postprocessing / troika / playwright(测试)
npm start            # 启动静态服务器 → http://localhost:8080/
```

浏览器打开后，点击左上角 **「载入示例数据」** 即可看到完整效果。无需联网，所有依赖与字体均已本地化到 `vendor/`。

生成示例层级数据文件：

```bash
npm run gen-sample   # 输出 data/sample-typhoon.json
```

端到端冒烟测试（无头 Chromium）：

```bash
npm test
```

## 四大功能区域

| 区域 | 位置 | 功能 |
| --- | --- | --- |
| **数据加载** | 顶部栏 | 载入 JSON 层级数据 / 示例数据，导出 PNG 与统计 JSON |
| **三维视图** | 中央 | OrbitControls 旋转缩放的粒子场、HUD、拾取提示、框选 |
| **高度切面控制** | 左侧 | 切面中心高度滑块、带宽滑块、5 色阶图例、视图操作、粒子信息、性能 |
| **时间轴回放** | 底部 | 24 时刻播放/暂停、进度拖动、0.5×–4× 变速、循环开关 |

## 核心实现要点

- **12 万粒子 InstancedMesh**：单 draw call 批量绘制，软圆点纹理 + billboard 实例矩阵。
- **三类结构**：眼壁（22%，贴 RMW 的高耸环）、3 条对数螺旋雨带（46%）、外围环流（32%），粒子生成用确定性随机种子，结果可复现。
- **高度切面**：按中心高度 ± 半带宽过滤，只显示该高度附近粒子；拖动滑块即触发密度重算。
- **密度 5 色阶**：柱坐标密度栅格（36 方位 × 24 径向 × 14 高度）统计可见粒子，按分位阈值映射为离散 5 档——眼壁深红 `#8b0f1c` → 外围浅蓝 `#bfe3f5`。
- **每帧深度排序**：2048 桶计数排序（O(n)），实例槽位按相机距离**远→近**排列，配合 `depthWrite:false` 的正常透明混合，杜绝半透明叠加黑边。
- **24 时刻回放插值**：关键帧间线性插值气压/风速/风圈，涡旋角动量积分驱动粒子方位角，粒子位置连续过渡；切面与色阶联动更新。
- **物理场**：Rankine 涡旋切向风廓线 + Holland 型气压场，点击任意粒子实时反演该点风速与气压。
- **troika 三维标注**：中文字体（Noto Sans SC woff 本地化）标注眼壁最大风速位置，文字始终面向相机。
- **框选放大**：屏幕矩形反投影求可见粒子包围球，调整相机取景而**保留切面状态**，可逐级恢复视角。
- **后期链**：Bloom + SMAA 抗锯齿 + Vignette + AgX 色调映射（postprocessing）。
- **导出**：当前视角 PNG（`preserveDrawingBuffer`），以及含粒子总量/分区计数/风压极值/色阶/相机参数的统计 JSON。

## 数据 Schema（`typhoon-profile-v1`）

```jsonc
{
  "meta": { "name": "...", "schema": "typhoon-profile-v1",
            "unit": { "distance": "km", "pressure": "hPa", "wind": "m/s", "altitude": "m" } },
  "levels": [0, 500, 1500, 3000, 5500, 7500, 10000, 13000, 16000],
  "steps": [
    {
      "t": 0, "time": "T+00h", "name": "T00",
      "center": { "lon": 132.0, "lat": 12.0 },
      "centralPressure": 985.0,        // 地面中心气压 hPa
      "maxSustainedWind": 28.0,        // 近中心最大风速 m/s
      "rmw": 52.0,                     // 最大风速半径 km
      "radiusOuter": 180.0,            // 外围环流半径 km
      "pressureProfile": [ /* 长度 = levels.length, 各层中心气压 hPa */ ],
      "windProfile":     [ /* 长度 = levels.length, 各层最大风速 m/s */ ],
      "heading": 300
    }
    // ... 共 24 个时刻
  ]
}
```

页面载入时会校验 `levels` 与各 `profile` 长度一致性，不符合会提示具体原因。完整示例见 `data/sample-typhoon.json`。

## 目录结构

```
├── index.html              # 主页面(四区域布局 + importmap)
├── server.js               # 零依赖静态服务器(正确 MIME)
├── src/
│   ├── main.js             # 主编排: 动画循环/回放/UI 联动
│   ├── core/
│   │   ├── constants.js    # 粒子配额/色阶/相机常量
│   │   ├── util.js         # 确定性随机/插值/分位数
│   │   ├── sample-data.js  # 24 时刻示例数据生成
│   │   ├── typhoon.js      # 物理场/角动量积分/关键帧插值
│   │   ├── particle-field.js # 12 万粒子生成/切面/密度着色/深度排序
│   │   ├── scene.js        # 场景与 postprocessing 后期链
│   │   ├── annotation.js   # troika 眼壁最大风速标注
│   │   ├── interactions.js # 射线拾取/框选放大/视角恢复
│   │   └── exporter.js     # PNG / JSON 导出
│   └── ui/styles.css
├── vendor/                 # 本地化 ESM 依赖与中文字体
├── scripts/gen-sample.mjs  # 示例数据导出
└── test/smoke.mjs          # Playwright 端到端冒烟测试(21 项)
```

## 操作提示

- 鼠标左键旋转、右键平移、滚轮缩放；**空格键**播放/暂停。
- 点击「框选放大区域」后在视图中拖拽矩形，仅改变相机、切面保持不变。
- 关闭「启用切面」可查看全部高度的 12 万粒子整体结构。
