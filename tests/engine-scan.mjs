// 真实引擎扫描：逐点 seek 整个分离窗口，记录碰撞计数随时间的变化
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForSelector('canvas');
await page.waitForTimeout(800);

const out = await page.evaluate(async () => {
  const seek = document.querySelector('input.seek');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  const rows = [];
  for (let t = 0; t <= 11; t += 0.1) {
    setter.call(seek, String(t));
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 30));
    const sub = document.querySelector('.hud-sub')?.textContent ?? '';
    rows.push(`${t.toFixed(1)}:${sub.replace(/\s+/g, '')}`);
  }
  return rows;
});
const coll = out.filter((r) => !r.endsWith('碰撞0'));
console.log('有碰撞的帧:');
console.log(coll.join('\n') || '（无）');
await browser.close();
