# 整流罩分离视效仿真工具（Fairing Separation VFX）

面向卫星发射仿真岗位的整流罩分离可视化工具：两瓣罩体按铰链装配在箭体上，触发分离后
先绕铰链张开、再沿分离方向抛离，配套分离瞬间碎片粒子扩散、BVH 防穿模碰撞检测、
慢放观察与画面/位姿数据导出。

## 技术栈

- **TypeScript + SolidJS** — 响应式 UI 与状态管理（`solid-js/store`）
- **three.js** — WebGL 场景、参数化罩壳几何、实例化粒子、自定义点云着色器
- **three-mesh-bvh** — 罩体–卫星/箭体三角面级碰撞检测，碎块外包球反弹
- **Vite** — 开发服务器与生产构建
- **Playwright** — 无头浏览器冒烟、碰撞扫描与导出校验

## 启动

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建
npm run typecheck  # 仅类型检查
```

## 三大功能模块

| 模块 | 能力 |
| --- | --- |
| 装配预览 | 铰链装配关系、爆炸分解视图、铰链标识、相机跟随模式、自动环绕 |
| 分离时序 | 分离时刻（起飞后 2–20s 可调）、张开时长/角度、抛离时长/速度、1×/0.5×/0.25×/0.1× 慢放 |
| 碎片视效 | 实例化金属碎块（独立线速度+自旋）、GPU 尘雾点云、数量/速度/锥角调节、实时统计 |

## 仿真模型

### 复合轨迹（转动 + 平动）

`src/lib/timeline.ts` 由参数生成三条关键帧通道（张开角、径向位移、轴向位移），
运行时经 smootherstep 缓动插值驱动铰链组位姿：

1. **闭合段** `t < separationTime`：两瓣拼合包住箭体与卫星；
2. **张开段**：罩瓣仅绕铰链线旋转（纵剖线处 Y 轴），自由边向外摆出；
3. **抛离段**：旋转缓慢继续，铰链组沿斜向分离方向（垂直结合面为主）平移抛离。

罩壳为带 6cm 壁厚的**封闭薄壳**（外弧面 + 内弧面 + 剖边/底边/拱顶封边），
左瓣顶点直接镜像生成，避免负缩放嵌套导致的旋转轴歧义。

### 碎片粒子

- `DebrisSystem`：`InstancedMesh` 四面体碎块，分离瞬间沿两条结合缝按冲量向两侧扩散，
  每块独立自旋，受重力与气动阻尼，与卫星/箭体做 BVH 球检测反弹；
- `DustSystem`：自定义 ShaderMaterial 的 `Points` 尘雾，随生命衰减尺寸与透明度。

### BVH 防穿模

`src/three/bvh.ts` 的 `meshesIntersect` 基于 `closestPointToGeometry` 做真实三角面距离
判定（阈值 1cm）。不能直接用 `intersectsGeometry`——开口/薄壁壳的 BVH 包围体会把
内部目标误判为包含相交。检测到碰撞时引擎在闭合位姿与目标位姿之间二分回退到最近的
无碰撞位姿，并在 UI 记录碰撞事件。

### 相机

跟随模式下镜头锁定在分离事件中心（用户仍可鼠标环绕，拖拽后转手动，重置恢复跟随），
保证两瓣反向抛离全程都在取景范围内。

## 数据与导出

- 场景参数防抖写入 `localStorage`（key：`fairing-sep-vfx:params:v1`），刷新不丢失；
- **导出画面**：当前 WebGL 画布 PNG（`preserveDrawingBuffer`）；
- **导位姿数据**：分离窗口 30Hz 采样的两瓣位置/铰链角/单位四元数 JSON；
- **导出场景**：当前参数 JSON，可留档分享。

## 自动化测试（需先 `npm run dev`）

```bash
node tests/smoke.mjs         # 端到端冒烟：交互流程、粒子、下载导出
node tests/engine-scan.mjs   # 全时间轴碰撞计数扫描
node tests/trajectory-diag.mjs # 轨迹级 BVH 最小间距离线核算
node tests/export-check.mjs  # 导出文件结构/镜像对称性/四元数归一校验
```

## 目录结构

```
src/
├─ components/   SolidJS 面板（装配/时序/碎片）、视口与播放条
├─ lib/          参数持久化、关键帧轨迹、数学工具
├─ store/        Solid store 全局状态
├─ three/        几何、BVH 封装、粒子系统、场景工厂、仿真引擎
└─ types.ts      共享类型
```
