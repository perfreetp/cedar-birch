# 船厂坞区吊车可达域体渲染工具

基于 **TypeScript + Vue 3 + Babylon.js（WebGPU 优先、WebGL2 自动回退）** 的船厂坞区吊装可达域体可视化工具。

## 启动

```bash
npm install
npm run dev        # 开发服务器 http://127.0.0.1:5173
npm run build      # 类型检查 + 生产构建
npm run preview    # 预览生产包
```

无头浏览器冒烟测试（需要本机 Chrome）：

```bash
node scripts/smoke.mjs        # 功能断言 + 截图 tmp/smoke/screenshot.png
node scripts/camera-test.mjs webgl2   # 相机穿入域体内部渲染验证
```

## 功能与实现对照

| 需求 | 实现 |
| --- | --- |
| 龙门吊 / 门座吊摆放 | `src/domain/geometry.ts` 两套解析几何：龙门吊为轨道-跨距长方体 OBB；门座吊为回转扇区 + 半径环，臂架俯角同时决定最大半径与吊钩高度 |
| 半透明可达域体、颜色随剩余起重量五档变化（100t→10t） | `src/domain/tiers.ts` 五档分色（青/绿/黄/橙/红），`VoxelVolumeLayer` 以 thin-instance 体素按网格逐单元着色，容量随半径/轨道位置线性折减 |
| 拖拽吊车 / 改臂架角度实时重算 | 3D 拾取 → `store.updateCrane` → 网格全量重评估 → 体素缓冲重建，全链路响应式；滑杆与拖拽等价 |
| 多机交叠颜色加深、协同区标注 | 交叠单元按覆盖机数压暗，并叠加紫色协同层（`coopMinCranes=2`）；分段报告输出单机/协同可行性与容量合计 |
| 分段落入判定、不足变红与缺口 | 分段 footprint 采样网格，逐点判定可达吊车与容量；不满足起重量的单元标红（`insufficientCells`），被其他分段阻挡处生成琥珀色线框缺口 |
| 透明体深度正确排序、相机入体不错乱 | 体素材质 `disableDepthWrite + backFaceCulling=false`，另建只写深度的预处理网格（renderingGroup 0），透明体在 group 1 按深度绘制；双面渲染保证入体可见内壁 |
| 吊装顺序联动 | 序列面板排序、逐段"吊走"；分段移走后其占用单元立即从障碍集中移除，域体与碰撞提示联动重算，可一键复位 |
| 碰撞提示 | SAT 有向盒检测分段间、分段与门架/回转底座的平面投影冲突 |
| 布局导出 / 导入恢复 | JSON 文件（坞区尺寸、网格精度、全部吊车与分段参数），导入后全量重算恢复所有域体 |

## 目录结构

```
src/
├── domain/          # 纯算法层（无渲染依赖，可单测）
│   ├── geometry.ts  # 龙门吊/门座吊可达几何、OBB/SAT 碰撞
│   ├── tiers.ts     # 五档起重量配色
│   └── evaluation.ts# 网格评估：覆盖/容量/阻挡/协同/分段报告
├── state/store.ts   # 响应式仓库：吊车、分段、序列、碰撞、导入导出
├── babylon/         # 渲染层
│   ├── DockScene.ts        # 引擎初始化(WebGPU→WebGL2)、拾取拖拽、标签投影
│   ├── VoxelVolumeLayer.ts # thin-instance 体素体 + 深度预处理
│   ├── CraneViews.ts       # 龙门吊/门座吊实体模型
│   ├── SegmentView.ts      # 分段实体
│   └── materials.ts        # 透明/深度/实体材质
├── components/      # Vue 面板（吊车参数、分段、吊装序列、图例）
└── App.vue          # 三栏布局与视口组装
```

## 关键建模约定

- **龙门吊容量**：沿轨道方向从额定值线性折减到 `endFactor × 额定`。
- **门座吊容量**：最小半径处为额定值，最大半径处折减到 10%（100t 臂尖约 10t，呼应五档区间）。
- **阻挡语义**：分段只阻挡"其他分段"的可达判定，不阻挡自身；移走后自动释放。
- **协同判定**：同一单元 ≥2 台吊车可达即标协同；分段重量超过任一单机但不超过同点容量合计时，报告建议多机协同。
- 网格精度可在顶栏调整（1–8m），精度越高体素越细、评估量按平方增长。
