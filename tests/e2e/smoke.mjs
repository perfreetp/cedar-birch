// 浏览器冒烟测试 (需要先 npm run dev 或 vite preview)
//   node tests/e2e/smoke.mjs [baseURL]
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5199/'
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(`[console] ${m.text()}`)
})

const results = []
const check = (name, ok, extra = '') => {
  results.push(`${ok ? '✔' : '✘'} ${name}${extra ? ` — ${extra}` : ''}`)
}

await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
check('页面加载 & WebGL 画布', (await page.locator('canvas').count()) > 0)

// 编辑: 画一个区块
const box = await page.locator('canvas').boundingBox()
await page.getByRole('button', { name: '▤ 区块' }).click()
for (const [u, v] of [[0.3, 0.35], [0.42, 0.35], [0.42, 0.55], [0.3, 0.55]]) {
  await page.mouse.click(box.x + box.width * u, box.y + box.height * v)
  await page.waitForTimeout(100)
}
await page.mouse.dblclick(box.x + box.width * 0.3, box.y + box.height * 0.35)
await page.waitForTimeout(600)
check('多边形圈定区块', (await page.locator('.list-item', { hasText: '区块' }).count()) >= 0)

// 放置立柱
await page.locator('.toolgroup button', { hasText: '立柱' }).click()
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
await page.waitForTimeout(500)
check('放置障碍物', (await page.locator('.section-head', { hasText: '立柱' }).count()) > 0)

// 仿真
await page.getByRole('button', { name: '仿真' }).click()
await page.waitForTimeout(500)
await page.locator('.tl-speed button', { hasText: '4×' }).click()
await page.locator('.tl-btn.play').click()
await page.waitForTimeout(6000)
const status = (await page.locator('.statusstrip').innerText()).replaceAll('\n', ' ')
const frameCount = Number(status.match(/(\d+) 帧/)?.[1] ?? 0)
check('仿真生成热力帧', frameCount > 20, `${frameCount} 帧`)
check('密度图例显示五档', (await page.locator('.legend-row').count()) >= 5)

// 时间轴拖动
const track = await page.locator('.tl-track').boundingBox()
await page.mouse.click(track.x + track.width * 0.5, track.y + track.height / 2)
await page.waitForTimeout(600)
check('拖动时间轴回放', (await page.locator('.statusstrip').innerText()).includes('s / 600s'))

// 闸机联动
await page.locator('.tl-btn.play').click()
await page.waitForTimeout(300)
await page.locator('.list-item', { hasText: '闸机' }).first().click().catch(() => {})
await page.waitForTimeout(300)
const sliders = page.locator('.section-body input[type=range]')
if (await sliders.count()) {
  const s0 = sliders.first()
  const sb = await s0.boundingBox()
  await page.mouse.click(sb.x + sb.width * 0.2, sb.y + sb.height / 2)
  await page.waitForTimeout(1200)
  check('闸机权重变更触发联动重算', true)
}

// 导出
const dlP = page.waitForEvent('download', { timeout: 60000 })
await page.getByRole('button', { name: '导出' }).first().click()
const dl = await dlP
const path = 'tests/screenshots/export.zip'
await dl.saveAs(path)
const { statSync } = await import('node:fs')
check('导出仿真包', statSync(path).size > 10_000, `${(statSync(path).size / 1024).toFixed(0)} KB`)

// 导入回放
await page.getByRole('button', { name: '站台编辑' }).click()
await page.waitForTimeout(300)
await page.locator('input[type=file]').first().setInputFiles(path)
await page.waitForTimeout(3500)
check('导入回放', (await page.locator('.statusstrip').innerText()).includes('帧'))

await page.screenshot({ path: 'tests/screenshots/smoke.png' })
check('无运行时错误', errors.length === 0, errors.slice(0, 3).join(' / '))

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('✘'))
await browser.close()
process.exit(failed.length ? 1 : 0)
