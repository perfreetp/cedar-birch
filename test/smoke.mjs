// 端到端冒烟测试(无头 Chromium + SwiftShader 软件渲染):
//   node test/smoke.mjs
// 说明: CI 无头环境用软件 GL, 全量 12 万粒子时 rAF 帧率受限,
// 因此对时序相关断言采用"同步驱动应用更新"的确定性方式, 不依赖实时帧率。
import { chromium } from 'playwright';

const BASE = 'http://localhost:8080/';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(400);
check('页面初始加载无 JS 错误', errors.length === 0, errors.join(' | ').slice(0, 300));

// 1) 载入示例数据
await page.locator('#loadSampleBtn').evaluate((el) => el.click());
await page.waitForTimeout(1200);
const meta = await page.textContent('#datasetMeta');
check('示例数据加载(24 时刻 9 层)', /24 时刻.*9 高度层/.test(meta), meta);

// 2) InstancedMesh 12 万实例
const inst = await page.evaluate(() => {
  const a = window.__app;
  return {
    isInst: a.field?.mesh?.isInstancedMesh === true,
    count: a.field?.mesh?.count,
    visible: a.field?.visibleCount,
  };
});
check('InstancedMesh 实例总量 120000', inst.isInst && inst.count === 120000, JSON.stringify(inst));
check('默认 800m 切面下存在数千可见粒子', inst.visible > 1000, `visible=${inst.visible}`);

// 2b) 渲染循环存活: FPS 读数大于 0 即证明 rAF 主循环在持续调度渲染
await page.waitForTimeout(600);
const fpsNow = Number(await page.textContent('#fps'));
check('渲染循环持续调度(FPS 读数>0)', fpsNow > 0, `fps=${fpsNow}`);

// 3) 五档离散颜色
const colorLevels = await page.evaluate(() => {
  const arr = window.__app.field.mesh.instanceColor.array;
  const set = new Set();
  for (let i = 0; i < arr.length; i += 3)
    if (arr[i] || arr[i + 1] || arr[i + 2])
      set.add(`${arr[i].toFixed(2)},${arr[i + 1].toFixed(2)},${arr[i + 2].toFixed(2)}`);
  return set.size;
});
check('实例颜色缓冲含 5 个离散色阶', colorLevels === 5, `levels=${colorLevels}`);

// 4) 切面滑块联动(同步驱动)
const slice = await page.evaluate(() => {
  const app = window.__app;
  const before = app.field.visibleCount;
  const el = document.getElementById('sliceZ');
  el.value = '15000';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  app._updateField(true);
  const after = app.field.visibleCount;
  const zApplied = app.sliceZ === 15000;
  // 色阶仍 5 档
  const arr = app.field.mesh.instanceColor.array;
  const set = new Set();
  for (let i = 0; i < arr.length; i += 3)
    if (arr[i] || arr[i + 1] || arr[i + 2])
      set.add(`${arr[i].toFixed(2)},${arr[i + 1].toFixed(2)},${arr[i + 2].toFixed(2)}`);
  return { before, after, zApplied, levels: set.size };
});
check('切面高度写入应用并改变可见粒子数', slice.zApplied && slice.after !== slice.before && slice.after > 0,
  `${slice.before} -> ${slice.after}`);
check('切面拖动后密度色阶实时重算(仍 5 档)', slice.levels === 5, `levels=${slice.levels}`);

// 5) 关闭切面 -> 12 万全量(同步驱动)
const toggle = await page.evaluate(() => {
  const app = window.__app;
  const el = document.getElementById('sliceEnable');
  el.checked = false;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  app._updateField(true);
  const off = app.field.visibleCount;
  el.checked = true;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  app._updateField(true);
  const on = app.field.visibleCount;
  return { off, on };
});
check('关闭切面显示全部 120000 粒子', toggle.off === 120000, `off=${toggle.off}`);
check('重新启用切面恢复过滤', toggle.on < 120000 && toggle.on > 0, `on=${toggle.on}`);

// 6) 回放插值: 手动设置时间位置并同步更新, 比较粒子坐标
const interp = await page.evaluate(() => {
  const app = window.__app;
  app.frameF = 2.0;
  app._updateField(true);
  const xa = app.field.px[7];
  const za = app.field.pz[7];
  app.frameF = 7.5; // 两个关键帧之间
  app._updateField(true);
  const xb = app.field.px[7];
  const zb = app.field.pz[7];
  // 验证中间态确实介于关键帧之间(再算两端)
  app.frameF = 7;
  app._updateField(true);
  const x7 = app.field.px[7];
  app.frameF = 8;
  app._updateField(true);
  const x8 = app.field.px[7];
  const between = (Math.min(x7, x8) - 1e-4 <= xb && xb <= Math.max(x7, x8) + 1e-4);
  return { moved: Math.hypot(xb - xa, zb - za), between };
});
check('回放时粒子位置随时间变化', interp.moved > 0.01, `delta=${interp.moved.toFixed(2)}`);
check('关键帧间粒子位置为插值过渡', interp.between, '中间态落在相邻关键帧坐标区间内');

// 7) 深度排序: 2048 桶计数排序后, 实例槽位 0..n 应为 远->近(透明混合要求的绘制顺序)
const sort = await page.evaluate(() => {
  const app = window.__app;
  app.frameF = 3;
  app._updateField(true);
  const cam = app.three.camera.position;
  const f = app.field;
  const distOf = (k) => {
    const id = f.renderSlot[k];
    return (f.px[id] - cam.x) ** 2 + (f.py[id] - cam.y) ** 2 + (f.pz[id] - cam.z) ** 2;
  };
  // 实例槽 0(先画)应更远, 末尾槽位(后画)应更近 => 远->近
  const n = Math.min(2000, f.visibleCount);
  let head = 0;
  let tail = 0;
  for (let k = 0; k < n / 4; k++) head += distOf(k);
  for (let k = (3 * n) / 4; k < n; k++) tail += distOf(k);
  head /= n / 4;
  tail /= n / 4;
  return { farToNear: head > tail, head, tail, sorted: app._sortedN };
});
check('每帧按相机距离深度排序(实例槽 远->近)', sort.farToNear,
  `slot0..n/4=${Math.sqrt(sort.head).toFixed(1)}km 后段=${Math.sqrt(sort.tail).toFixed(1)}km n=${sort.sorted}`);

// 8) 粒子拾取
const pick = await page.evaluate(() => {
  const app = window.__app;
  const id = app.field.slotToId[Math.floor(app.field.visibleCount / 2)]; // 过滤结果中取一个可见粒子
  app._onPick(id);
  return document.getElementById('pickInfo').textContent;
});
check('点击粒子展示风速与气压', /风速/.test(pick) && /气压/.test(pick) && /m\/s/.test(pick),
  pick.replace(/\s+/g, ' ').slice(0, 110));

// 9) 框选放大: 相机改变 + 切面状态保留
const mq = await page.evaluate(() => {
  const app = window.__app;
  const sliceBefore = { z: app.sliceZ, band: app.band, en: app.sliceEnabled };
  const camBefore = app.three.camera.position.toArray().join(',');
  const it = app.interactions;
  it.marqueeMode = true;
  const r = app.three.renderer.domElement.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  it._onDown({ button: 0, clientX: cx - 120, clientY: cy - 80 });
  it._onUp({ button: 0, clientX: cx + 120, clientY: cy + 80 });
  const sliceAfter = { z: app.sliceZ, band: app.band, en: app.sliceEnabled };
  const camAfter = app.three.camera.position.toArray().join(',');
  return {
    sliceKept: JSON.stringify(sliceBefore) === JSON.stringify(sliceAfter),
    camChanged: camBefore !== camAfter,
  };
});
check('框选放大后切面状态保持不变', mq.sliceKept);
check('框选改变相机位置实现放大', mq.camChanged);
const restored = await page.evaluate(() => window.__app.interactions.restoreView());
check('恢复上一视角', restored === true);

// 10) PNG 导出 Blob
const png = await page.evaluate(async () => {
  document.getElementById('exportPngBtn').click();
  const blob = await window.__app._lastPNG;
  return blob ? { type: blob.type, size: blob.size } : null;
});
check('导出当前视角 PNG(image/png 非空)', png?.type === 'image/png' && png.size > 10000, JSON.stringify(png));

// 11) JSON 统计
const jsonInfo = await page.evaluate(async () => {
  document.getElementById('exportJsonBtn').click();
  const blob = window.__app._lastJSON;
  const o = JSON.parse(await blob.text());
  return {
    total: o.particleStats?.totalParticles,
    visible: o.particleStats?.visibleParticles,
    regions: Object.keys(o.particleStats?.byRegion || {}),
    wind: typeof o.particleStats?.wind?.maxMs,
    pressure: typeof o.particleStats?.pressure?.minHPa,
    colors: o.colorStops?.length,
    camera: !!o.camera,
  };
});
check('导出含粒子统计的 JSON(总量/分区/风压/5 色/相机)',
  jsonInfo.total === 120000 && jsonInfo.visible > 0 && jsonInfo.regions.length === 3 &&
  jsonInfo.wind === 'number' && jsonInfo.pressure === 'number' && jsonInfo.colors === 5 && jsonInfo.camera,
  JSON.stringify(jsonInfo));

// 12) troika 三维标注
const ann = await page.evaluate(() => ({
  visible: window.__app.annotation.group.visible,
  text: window.__app.annotation.text.text || '',
}));
check('troika 标注眼壁最大风速位置', ann.visible && /眼壁最大风速/.test(ann.text),
  ann.text.replace(/\n/g, ' / ').slice(0, 80));

// 13) 全程无错误(PNG 导出已验证画布实际出图)
check('全程无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));

// troika 的 SDF worker 可能拖住 browser.close, 带超时的强制关闭兜底
try {
  await Promise.race([
    browser.close(),
    new Promise((res) => setTimeout(res, 3500)),
  ]);
} catch {
  /* 强制退出即可 */
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
// 确保无头浏览器进程不残留
process.exit(failed.length ? 1 : 0);
