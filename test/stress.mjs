import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport:{width:1440,height:900} });
const errs=[];
page.on('pageerror', e=>errs.push(e.message));
await page.goto('http://127.0.0.1:5247/',{waitUntil:'networkidle'});
await page.click('#btn-load-demo');
await page.waitForSelector('#loading-overlay',{state:'hidden',timeout:60000});
await page.waitForFunction(()=>document.querySelector('#bake-status-text').textContent.startsWith('就绪'),{timeout:30000});

// 快速连续切换阈值 + 层数，模拟用户狂拖
for (let i=0;i<24;i++){
  const lv=i%5;
  await page.fill('#threshold-slider',String(lv));
  await page.dispatchEvent('#threshold-slider','input');
  if(i%3===0){
    await page.fill('#slice-slider',String(32+(i%5)*24));
    await page.dispatchEvent('#slice-slider','input');
  }
  await page.waitForTimeout(35);
}
// 最终停在 L4 / 128
await page.fill('#threshold-slider','4');
await page.dispatchEvent('#threshold-slider','input');
await page.fill('#slice-slider','128');
await page.dispatchEvent('#slice-slider','input');
await page.waitForFunction(()=>document.querySelector('#bake-status-text').textContent.startsWith('就绪'),{timeout:30000});
await page.waitForTimeout(800);
const th=await page.textContent('#threshold-value');
const sl=await page.textContent('#slice-value');
const bake=await page.textContent('#bake-status-text');
const ok = th.startsWith('L4') && sl==='128 层' && bake.startsWith('就绪');
console.log(ok?'PASS':'FAIL', '高频调整后最终状态正确:', th, sl, '|', bake);
console.log(errs.length?'FAIL errors: '+errs.join(';'):'PASS 无错误');
await browser.close();
process.exit(ok&&!errs.length?0:1);
