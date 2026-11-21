// 关键状态截图：闭合装配、张开中、抛离完成（含爆炸视图）
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(1000);

const seek = page.locator('input.seek');
const setter = async (v) => {
  await seek.evaluate((el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, String(val));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
};

await page.screenshot({ path: 'shot-1-closed.png' });

await setter(5.6);
await page.waitForTimeout(500);
await page.screenshot({ path: 'shot-2-opening.png' });

await setter(6.4);
await page.waitForTimeout(500);
await page.screenshot({ path: 'shot-3-jettison.png' });

await setter(9);
await page.waitForTimeout(400);
await page.getByRole('button', { name: /装配预览/ }).click();
await page.waitForTimeout(200);
await page.locator('.toggle-row').filter({ hasText: '爆炸视图' }).locator('input').check();
await page.waitForTimeout(400);
await page.screenshot({ path: 'shot-4-exploded.png' });

await browser.close();
console.log('截图完成');
