# 浏览器测试

需要先在另一个终端启动开发服务器：

```bash
npm run dev          # http://127.0.0.1:5173
npm run test:e2e     # 默认指向 dev server
```

默认脚本指向 `http://localhost:5199/`（开发时若端口不同，可直接传参）：

```bash
node tests/e2e/smoke.mjs http://localhost:5173/
```

覆盖：画布加载 → 多边形圈区块 → 放置障碍物 → 仿真出帧 → 五档图例 →
时间轴拖动 → 闸机联动重算 → 导出 zip → 导入回放 → 无运行时错误。
截图写入 `tests/screenshots/`（已在 .gitignore 中忽略）。
