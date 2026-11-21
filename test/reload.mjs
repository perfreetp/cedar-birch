import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport:{width:1440,height:900} });
const errs=[];
page.on('pageerror', e=>errs.push(e.message));
page.on('console', m=>{if(m.type()==='error')errs.push(m.text());});
await page.goto('http://127.0.0.1:5247/',{waitUntil:'networkidle'});
const waitBaked=()=>page.waitForFunction(()=>document.querySelector('#bake-status-text').textContent.startsWith('就绪'),{timeout:30000});
const waitHidden=()=>page.waitForSelector('#loading-overlay',{state:'hidden',timeout:60000});
for(let round=0; round<3; round++){
  await page.click('#btn-load-demo');
  await waitHidden();
  await waitBaked();
  await page.waitForTimeout(300);
}
const bake=await page.textContent('#bake-status-text');
const ok = bake.startsWith('就绪') && errs.length===0;
console.log(ok?'PASS':'FAIL','连续3次加载无错误:', bake, errs.join('|'));
await browser.close();
process.exit(ok?0:1);
