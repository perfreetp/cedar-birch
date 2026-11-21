import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1500, height: 920 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(1000);
await page.locator('input.seek').evaluate((el) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, '6.15');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'shot-5-wide-open.png' });
await page.locator('input.seek').evaluate((el) => {
  const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  s.call(el, '8.7');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(600);
await page.screenshot({ path: 'shot-6-far-jettison.png' });
await browser.close();
console.log('ok');
