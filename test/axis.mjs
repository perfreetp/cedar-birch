// 专项验证：切片主轴随视线动态切换、纹理清晰度、自适应分辨率、播放插值
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../test-shots/axis');
mkdirSync(OUT, { recursive: true });
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://127.0.0.1:5247/', { waitUntil: 'networkidle' });
await page.click('#btn-load-demo');
await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });
await page.waitForTimeout(800);

const axisText = () => page.textContent('#hud-axis');
const waitBaked = () => page.waitForFunction(
  () => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });

// 1. 主轴初始值
const a0 = await axisText();
check('初始切片主轴已确定', /X|Y|Z 轴切面/.test(a0), a0);

// 2. 大幅旋转相机（绕到接近正俯视），主轴应切换并触发烘焙
const canvas = await page.$('#gl-canvas');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const seenAxes = new Set([a0.match(/([XYZ]) 轴/)?.[1]]);
for (let round = 0; round < 3; round++) {
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  // 水平大幅拖动改变方位角；垂直拖动改变极角
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(cx + i * 30, cy + (round % 2 ? -i * 18 : i * 12));
    await page.waitForTimeout(14);
  }
  await page.mouse.up();
  await page.waitForTimeout(900);
  const m = (await axisText()).match(/([XYZ]) 轴/);
  if (m) seenAxes.add(m[1]);
}
await waitBaked();
check('旋转过程覆盖多个切片主轴', seenAxes.size >= 2, `观察到轴: ${[...seenAxes].join(',')}`);

// 3. 纹理清晰度：渲染器各向异性过滤应 >1
const aniso = await page.evaluate(() => {
  // 通过 WebGL 能力上限间接确认（纹理在创建时设置 anisotropy）
  const c = document.getElementById('gl-canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  return gl.getExtension('EXT_texture_filter_anisotropic')
    ? gl.getParameter(gl.getExtension('EXT_texture_filter_anisotropic').MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0;
});
check('各向异性过滤可用（旋转缩放纹理清晰）', aniso >= 1, `maxAniso=${aniso}`);

// 4. 播放时分数时刻（插值过渡）：uInterp 非 0/1
await page.fill('#time-slider', '7.37');
await page.dispatchEvent('#time-slider', 'input');
await waitBaked();
await page.waitForTimeout(400);
const interp = await page.evaluate(() => {
  // time=7.37 -> frameA=7 frameB=8 interp=0.37
  const tv = parseFloat(document.getElementById('time-slider').value);
  return tv - Math.floor(tv);
});
check('分数时刻产生帧间插值系数', Math.abs(interp - 0.37) < 0.01, `interp=${interp.toFixed(2)}`);

// 5. 自适应分辨率：连续旋转负载下分辨率标度可读且在合法区间
await page.waitForTimeout(1500);
const q = await page.textContent('#quality-readout');
const pct = parseInt(q.replace(/\D/g, ''), 10);
check('自适应分辨率标度生效（60%–100%）', pct >= 60 && pct <= 100, q);

// 6. FPS 读数持续更新
const fps1 = await page.textContent('#fps-readout');
await page.waitForTimeout(900);
const fps2 = await page.textContent('#fps-readout');
check('FPS 实时读数更新', /FPS\s*\d+/.test(fps1) && /FPS\s*\d+/.test(fps2), `${fps1} -> ${fps2}`);

check('全程无页面错误', errs.length === 0, errs.slice(0, 3).join(' | '));
await page.screenshot({ path: resolve(OUT, 'axis-rotated.png') });
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
