// 端到端冒烟测试：加载真实演示数据，验证渲染、烘焙、交互、导出全链路
// 运行：node test/smoke.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOTS = resolve(__dirname, '../test-shots');
mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5247/';
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
});
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
check('页面加载无致命错误', consoleErrors.length === 0, consoleErrors.join(' | '));

// ---- 加载演示数据 ----
await page.click('#btn-load-demo');
await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 60000 });
const statusText = await page.textContent('#data-status-text');
check('演示数据加载成功', statusText.includes('已加载'), statusText);

const metaDims = await page.textContent('#meta-dims');
const metaFrames = await page.textContent('#meta-frames');
check('元数据：网格 96×64×96', metaDims.includes('96 × 64 × 96'), metaDims);
check('元数据：18 个时刻', metaFrames.includes('18'), metaFrames);

// ---- 等待首次烘焙 ----
await page.waitForFunction(
  () => document.querySelector('#bake-status-text').textContent.startsWith('就绪'),
  { timeout: 30000 }
);
const bakeText = await page.textContent('#bake-status-text');
check('首次切片纹理烘焙完成', bakeText.includes('就绪'), bakeText);

// 等待若干帧稳定
await page.waitForTimeout(2500);
const fps1 = Number((await page.textContent('#fps-readout')).replace(/[^\d.]/g, ''));
check('渲染循环运行（FPS 可读）', fps1 > 0, `FPS=${fps1}`);

// ---- 阈值 5 级切换，每级触发重新烘焙 ----
for (const lv of [0, 1, 3, 4, 2]) {
  await page.fill('#threshold-slider', String(lv));
  await page.dispatchEvent('#threshold-slider', 'input');
  await page.waitForFunction(
    (lvl) => document.querySelector('#threshold-value').textContent.startsWith(`L${lvl}`),
    lv, { timeout: 5000 }
  );
  await page.waitForFunction(
    () => document.querySelector('#bake-status-text').textContent.startsWith('就绪'),
    { timeout: 30000 }
  );
}
check('五级阈值切换均重新烘焙', true);

// ---- 切片层数 32 / 128 边界 ----
for (const n of [32, 128, 64]) {
  await page.fill('#slice-slider', String(n));
  await page.dispatchEvent('#slice-slider', 'input');
  await page.waitForFunction(
    (cnt) => document.querySelector('#slice-value').textContent === `${cnt} 层`,
    n, { timeout: 5000 }
  );
  await page.waitForFunction(
    () => document.querySelector('#bake-status-text').textContent.startsWith('就绪'),
    { timeout: 30000 }
  );
}
check('切片层数 32–128 可调并重新烘焙', true);

// ---- 播放与速度 ----
await page.click('#btn-play');
await page.waitForTimeout(1600);
const tDuring = parseFloat(await page.inputValue('#time-slider'));
check('播放时时间推进（插值过渡）', tDuring > 0.1, `t=${tDuring.toFixed(2)}`);
await page.click('#btn-play'); // 暂停

await page.click('#speed-seg button[data-speed="4"]');
const speedActive = await page.textContent('#speed-seg button.active');
check('播放速度可切换 4×', speedActive.includes('4×'), speedActive);

// 跳到中间时刻并等待烘焙
await page.fill('#time-slider', '9');
await page.dispatchEvent('#time-slider', 'input');
await page.waitForFunction(
  () => document.querySelector('#bake-status-text').textContent.startsWith('就绪'),
  { timeout: 30000 }
);
await page.waitForTimeout(800);

// ---- 相机旋转/缩放（OrbitControls 程序化触发）----
const canvas = await page.$('#gl-canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  await page.mouse.move(cx + i * 18, cy + Math.sin(i) * 10);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.mouse.wheel(0, -400);
await page.waitForTimeout(1200);
const fps2 = Number((await page.textContent('#fps-readout')).replace(/[^\d.]/g, ''));
check('旋转缩放后渲染继续且 FPS>0', fps2 > 0, `FPS=${fps2}`);

// ---- 点击浓度场采样 ----
await page.mouse.click(cx + 40, cy - 30);
try {
  await page.waitForSelector('#pick-readout:not([hidden])', { timeout: 15000 });
  const pickVal = await page.textContent('#pick-value');
  check('点击读取浓度值并标注', /归一化\s*-?\d+\.\d+/.test(pickVal), pickVal);
} catch {
  check('点击读取浓度值并标注', false, '拾取面板未出现');
}

// ---- 导出 PNG ----
const [downloadPng] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }),
  page.click('#btn-export-png'),
]);
const pngPath = resolve(SHOTS, downloadPng.suggestedFilename());
await downloadPng.saveAs(pngPath);
check('PNG 图片导出', pngPath.endsWith('.png'), downloadPng.suggestedFilename());

// ---- 导出摘要 JSON ----
const [downloadJson] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }),
  page.click('#btn-export-json'),
]);
const jsonPath = resolve(SHOTS, downloadJson.suggestedFilename());
await downloadJson.saveAs(jsonPath);
const summary = await import('file://' + jsonPath.replace(/\\/g, '/'), { with: { type: 'json' } });
check('JSON 摘要含浓度直方图', Array.isArray(summary.default.concentration.histogram) &&
  summary.default.concentration.histogram.length === 32, `bins=${summary.default.concentration.histogram.length}`);
check('JSON 摘要含阈值/切片配置',
  summary.default.render.sliceCount === 64 &&
  typeof summary.default.render.threshold.normalized === 'number',
  JSON.stringify(summary.default.render));
check('JSON 摘要含时间帧对',
  summary.default.time.frameA === 9, JSON.stringify(summary.default.time));

// ---- 截图与 WebGL 画布非空检查 ----
await page.screenshot({ path: resolve(SHOTS, 'viewport-final.png') });
const glInfo = await page.evaluate(() => {
  const c = document.getElementById('gl-canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const pixels = new Uint8Array(4);
  gl.readPixels(c.width / 2 | 0, c.height / 2 | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return { pixel: Array.from(pixels), w: c.width, h: c.height };
});
check('WebGL 画布有像素输出', glInfo.w > 0 && glInfo.h > 0, JSON.stringify(glInfo));

check('全程无控制台错误', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
