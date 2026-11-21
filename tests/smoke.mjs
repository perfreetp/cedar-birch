// 运行时冒烟测试：无头浏览器加载页面，验证场景初始化、分离流程、粒子、碰撞与导出
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5173/';
const errors = [];
const warnings = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
  if (msg.type() === 'warning') warnings.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`PAGEERROR: ${err.message}`));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(1200);

// 1. 初始状态：闭合、t=0
const initialHud = await page.locator('.hud-time').textContent();
console.log('初始 HUD 时间:', initialHud);

// 2. 切到分离时序，把分离时刻调到 2s 并播放
await page.getByRole('button', { name: /分离时序/ }).click();
await page.waitForTimeout(200);
const sepSlider = page.locator('.slider-row').filter({ hasText: '分离时刻' }).locator('input');
await sepSlider.fill('2');
await page.waitForTimeout(300);

// 0.1x 超慢倍率
await page.getByRole('button', { name: /0.1/ }).click();
await page.waitForTimeout(200);

await page.getByRole('button', { name: /播放/ }).click();
await page.waitForTimeout(2600); // 0.1x 下约推进 0.26s，仍在分离前
const prePhase = await page.locator('.hud-badge').textContent();
console.log('分离前阶段:', prePhase);

// 直接拖动时间轴跨越分离时刻
await page.locator('input.seek').fill('2.6');
await page.waitForTimeout(400);
const openPhase = await page.locator('.hud-badge').textContent();
const statsText = await page.locator('.stat-grid').count();
console.log('seek 到 2.6s 阶段:', openPhase, '| 统计网格存在:', statsText === 1);

// 切到碎片视效模块看活跃粒子数
await page.getByRole('button', { name: /碎片视效/ }).click();
await page.waitForTimeout(300);
const statNums = await page.locator('.stat-cell .stat-num').allInnerTexts();
console.log('碎片/尘雾/碰撞/FPS:', statNums.join(' / '));

// 3. seek 到抛离完成后
await page.locator('input.seek').fill('8');
await page.waitForTimeout(400);
const donePhase = await page.locator('.hud-badge').textContent();
console.log('t=8s 阶段:', donePhase);

// 4. 装配预览模块：爆炸视图
await page.getByRole('button', { name: /装配预览/ }).click();
await page.waitForTimeout(200);
const explodeToggle = page.locator('.toggle-row').filter({ hasText: '爆炸视图' }).locator('input');
await explodeToggle.check();
await page.waitForTimeout(300);

// 5. 导出：画面 PNG 与位姿 JSON（拦截下载）
const downloads = [];
page.on('download', (d) => {
  downloads.push(d.suggestedFilename());
  d.path().catch(() => {});
});
await page.getByRole('button', { name: /导出画面/ }).click();
await page.getByRole('button', { name: /导位姿数据/ }).click();
await page.waitForTimeout(1500);
console.log('下载文件:', downloads.join(', '));

// 6. 重置
await page.getByRole('button', { name: /重置/ }).click();
await page.waitForTimeout(300);
const resetHud = await page.locator('.hud-time').textContent();
console.log('重置后 HUD:', resetHud);

await page.screenshot({ path: 'smoke-final.png' });
await browser.close();

console.log('\n==== 结果 ====');
console.log('console errors:', errors.length ? errors : '无');
console.log('warnings:', warnings.length ? warnings.slice(0, 5) : '无');
if (errors.length) process.exit(1);
if (!downloads.some((f) => f.endsWith('.png')) || !downloads.some((f) => f.endsWith('.json'))) {
  console.error('导出文件缺失');
  process.exit(1);
}
console.log('冒烟测试通过 ✔');
