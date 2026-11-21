// 导出验证：校验 PNG 画面文件与位姿 JSON 的结构、采样数和位姿合理性
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(800);

const captured = [];
page.on('download', async (d) => {
  const path = await d.path();
  const fs = await import('node:fs');
  captured.push({ name: d.suggestedFilename(), path, size: fs.statSync(path).size });
});

await page.locator('input.seek').evaluate((el) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, '6.2');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(500);
await page.getByRole('button', { name: /导出画面/ }).click();
await page.getByRole('button', { name: /导位姿数据/ }).click();
await page.waitForTimeout(2000);

console.log('捕获下载:');
for (const f of captured) console.log(`  ${f.name} (${f.size} B)`);

const png = captured.find((f) => f.name.endsWith('.png'));
const jsonFile = captured.find((f) => f.name.endsWith('.json'));
if (!png || png.size < 50000) throw new Error('PNG 导出异常');

const fs = await import('node:fs');
const data = JSON.parse(fs.readFileSync(jsonFile.path, 'utf8'));
console.log('\nPoseExport 顶层字段:', Object.keys(data).join(', '));
console.log('采样率:', data.sampleRateHz, 'Hz');
console.log('左瓣采样数:', data.poses.left.length, '| 右瓣采样数:', data.poses.right.length);
const s0 = data.poses.left[0];
const sEnd = data.poses.left.at(-1);
console.log('首样本:', JSON.stringify(s0));
console.log('末样本 state:', sEnd.state, '位置:', sEnd.position.map((v) => +v.toFixed(2)).join(','));

// 校验：两瓣末位姿关于 X=0 镜像；四元数为单位四元数
const q = s0.quaternion;
const qn = Math.hypot(...q);
const mirrorOK = Math.abs(sEnd.position[0] - -data.poses.right.at(-1).position[0]) < 1e-6;
const qOK = Math.abs(qn - 1) < 1e-6;
console.log('四元数归一:', qOK, '| 两瓣 X 镜像:', mirrorOK);

await browser.close();
if (errors.length || !qOK || !mirrorOK) {
  console.error('校验失败', errors);
  process.exit(1);
}
console.log('\n导出校验通过 ✔');
