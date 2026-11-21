// 视觉回归：固定相机与时刻，输出多阈值/多层数对比截图
import { chromium } from 'playwright';
import { resolve, dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../test-shots/visual');
mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:5247/';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.click('#btn-load-demo');
await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });

async function gotoTime(t) {
  await page.fill('#time-slider', String(t));
  await page.dispatchEvent('#time-slider', 'input');
  await page.waitForFunction(() => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });
  await page.waitForTimeout(600);
}
async function setThreshold(lv) {
  await page.fill('#threshold-slider', String(lv));
  await page.dispatchEvent('#threshold-slider', 'input');
  await page.waitForFunction(() => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });
  await page.waitForTimeout(400);
}
async function setSlices(n) {
  await page.fill('#slice-slider', String(n));
  await page.dispatchEvent('#slice-slider', 'input');
  await page.waitForFunction(() => document.querySelector('#bake-status-text').textContent.startsWith('就绪'), { timeout: 30000 });
  await page.waitForTimeout(400);
}

await gotoTime(12);
await page.waitForTimeout(800);
await page.screenshot({ path: resolve(OUT, '01-t12-default.png') });

await setThreshold(0);
await page.screenshot({ path: resolve(OUT, '02-t12-L0.png') });
await setThreshold(4);
await page.screenshot({ path: resolve(OUT, '03-t12-L4.png') });
await setThreshold(2);

await setSlices(32);
await page.screenshot({ path: resolve(OUT, '04-t12-32slices.png') });
await setSlices(128);
await page.screenshot({ path: resolve(OUT, '05-t12-128slices.png') });
await setSlices(64);

await gotoTime(2);
await page.screenshot({ path: resolve(OUT, '06-t2-early.png') });
await gotoTime(16);
await page.screenshot({ path: resolve(OUT, '07-t16-late.png') });

const fps = await page.textContent('#fps-readout');
console.log('done', fps);
await browser.close();
