// 端到端验证:驱动真实 Chrome(SwiftShader WebGL)走完四页流程
import puppeteer from 'puppeteer-core'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = process.env.FLOWVIZ_URL ?? 'http://127.0.0.1:5174/'
const SHOTS = resolve(process.cwd(), '.e2e-shots')
const DOWNLOADS = resolve(SHOTS, 'downloads')
// 必须放在工作区外:Chrome 会锁定 profile 文件,工作区内会触发 Vite watcher 的 EBUSY
const PROFILE = resolve(tmpdir(), 'flowviz-e2e-profile')
rmSync(SHOTS, { recursive: true, force: true })
rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(DOWNLOADS, { recursive: true })

let failures = 0
function check(cond: boolean, msg: string): void {
  if (cond) console.log(`✓ ${msg}`)
  else {
    failures++
    console.error(`✗ ${msg}`)
  }
}

// 全局看门狗:SwiftShader 慢,但任何单步都不应超过 3 分钟
const watchdog = setTimeout(() => {
  console.error('✗ E2E 全局超时(180s),终止')
  process.exit(2)
}, 180000)
watchdog.unref()

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: PROFILE,
  args: [
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--window-size=1600,950',
  ],
})
const page = await browser.newPage()
await page.setViewport({ width: 1600, height: 950 })

const consoleErrors: string[] = []
page.on('console', (m) => {
  if (m.type() === 'error') {
    consoleErrors.push(m.text())
    console.log(`   [console.error] ${m.text()}`)
  }
})
page.on('pageerror', (e) => {
  consoleErrors.push(`pageerror: ${e.message}`)
  console.log(`   [pageerror] ${e.message}`)
})

// ---------- 第 1 页:平面布局 ----------
async function gotoApp(): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`导航尝试 ${attempt} …`)
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForSelector('.plan-canvas', { timeout: 15000 })
      return
    } catch (e) {
      console.log(`导航失败:${(e as Error).message}`)
      if (attempt === 3) throw e
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}
await gotoApp()
console.log('进入第 1 页')
await page.screenshot({ path: `${SHOTS}/1-plan.png` })

// 改房间尺寸 + 加设备
await page.evaluate(() => {
  const inputs = document.querySelectorAll('.card input[type=number]')
  const set = (el: Element, v: string) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  set(inputs[0], '14') // 宽
  set(inputs[3], '6') // 送风口数量
})
await page.click('.equip-list .btn') // + 添加设备
await page.waitForSelector('.equip-row:nth-child(3)')
const equipCount = await page.$$eval('.equip-row', (r) => r.length)
check(equipCount === 3, `第1页:添加设备后列表为 3(实际 ${equipCount})`)

// ---------- 第 2 页:风口配置(3D 渲染启动) ----------
await page.$$eval('.step', (els) => (els[1] as HTMLButtonElement).click())
await page.waitForSelector('.viewport-canvas canvas')
await new Promise((r) => setTimeout(r, 6000)) // 让仿真预热
await page.screenshot({ path: `${SHOTS}/2-vents.png` })

const statsText = await page.$eval('.stats', (el) => el.textContent)
const fps = Number(/FPS\s*(\d+)/.exec(statsText ?? '')?.[1] ?? 0)
const particleText = /粒子\s*(\d+)/.exec(statsText ?? '')?.[1] ?? '0'
const particles = Number(particleText)
check(fps > 0, `第2页:WebGL 渲染运行,FPS=${fps}`)
check(particles > 3000, `第2页:粒子持续发射,存活=${particles}`)
check(!consoleErrors.length, `第2页:无控制台错误(累计 ${consoleErrors.length} 条)`)

// 列表选择第二个送风口,改档位与角度
await page.$$eval('.vent-row', (els) => (els[1] as HTMLElement).click())
await page.$$eval('.gear', (els) => (els[4] as HTMLButtonElement).click()) // 档位 5
await page.evaluate(() => {
  const ranges = document.querySelectorAll('.card input[type=range]')
  const setRange = (el: Element, v: string) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setRange(ranges[0], '45') // 方位角
  setRange(ranges[1], '30') // 倾角
})
const gearActive = await page.$eval('.gear.active', (el) => el.textContent)
check(gearActive === '5', `第2页:送风档位切换为 5(实际 ${gearActive})`)

// 南墙加回风口
const beforeReturn = await page.$$eval('.return-block', (r) => r.length)
await page.$$eval('.wall-add-row .btn-mini', (els) => (els[3] as HTMLButtonElement).click())
const afterReturn = await page.$$eval('.return-block', (r) => r.length)
check(afterReturn === beforeReturn + 1, `第2页:南墙新增回风口(${beforeReturn} → ${afterReturn})`)

// 视角切换
await page.click('.view-buttons button:nth-child(2)') // 俯视
await new Promise((r) => setTimeout(r, 800))
await page.click('.view-buttons button:nth-child(3)') // 正视
await new Promise((r) => setTimeout(r, 800))
await page.click('.view-buttons button:nth-child(1)') // 透视
await page.screenshot({ path: `${SHOTS}/2-vents-configured.png` })

// ---------- 第 3 页:流场评估 + 切片 ----------
await page.$$eval('.step', (els) => (els[2] as HTMLButtonElement).click())
await new Promise((r) => setTimeout(r, 1500))
await page.$$eval('.switch-row input', (els) => {
  const input = els[0] as HTMLInputElement
  input.click()
})
await page.evaluate(() => {
  const ranges = document.querySelectorAll('.card input[type=range]')
  const setRange = (el: Element, v: string) => {
    const input = el as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, v)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  setRange(ranges[2], '1.2') // 切片高度(前面有粒子上限、流速倍率两个 range)
  setRange(ranges[3], '0.6') // 切片带宽
})
await new Promise((r) => setTimeout(r, 2500))
const stats3 = await page.$eval('.stats', (el) => el.textContent)
check(/切片峰值\s*\d+/.test(stats3 ?? ''), `第3页:切片统计已刷新("${stats3?.trim()}")`)
await page.screenshot({ path: `${SHOTS}/3-slice.png` })

// 暂停/恢复
await page.click('.btn-row .btn')
const pausedText = await page.$eval('.stats', (el) => el.textContent)
check(pausedText?.includes('已暂停') ?? false, '第3页:仿真可暂停')
await page.click('.btn-row .btn')

// ---------- 第 4 页:导出 ----------
// 无头 Chrome 的 Blob 下载落盘不稳定(会 inProgress→canceled),
// 改为拦截 <a>.click(),直接取回 Blob 文本,校验内容后再落盘供导入使用
await page.$$eval('.step', (els) => (els[3] as HTMLButtonElement).click())
await page.waitForSelector('.export-card')

await page.evaluate(() => {
  const w = window as unknown as { __snapshotText: string | null; __originalAnchorClick?: HTMLElement['click'] }
  w.__snapshotText = null
  const proto = HTMLAnchorElement.prototype
  if (!w.__originalAnchorClick) w.__originalAnchorClick = proto.click
  proto.click = function (this: HTMLAnchorElement) {
    const href = this.href
    if (href && href.startsWith('blob:')) {
      void fetch(href)
        .then((r) => r.text())
        .then((text) => {
          ;(window as unknown as { __snapshotText: string | null }).__snapshotText = text
        })
      return
    }
    w.__originalAnchorClick!.call(this)
  }
})

await page.click('.export-card:nth-child(1) .btn.primary')
await page.waitForFunction(() => (window as unknown as { __snapshotText: string | null }).__snapshotText !== null, {
  timeout: 20000,
})
const snapshotText = await page.evaluate(() => (window as unknown as { __snapshotText: string }).__snapshotText)
check(snapshotText.length > 1000, `第4页:导出 Blob 已捕获(${snapshotText.length} 字节)`)

// 还原锚点点击,落盘一份供后续文件导入测试
await page.evaluate(() => {
  const w = window as unknown as { __originalAnchorClick?: HTMLElement['click'] }
  if (w.__originalAnchorClick) HTMLAnchorElement.prototype.click = w.__originalAnchorClick
})
const snapPath = `${DOWNLOADS}/cleanroom-snapshot.e2e.json`
writeFileSync(snapPath, snapshotText, 'utf8')

const snap = JSON.parse(snapshotText)
check(snap.app === 'cleanroom-flowviz' && snap.version === 1, '第4页:快照标识与版本正确')
check(snap.room.width === 14 && snap.room.supplyCount === 6, `第4页:房间改动已写入(${snap.room.width}m, ${snap.room.supplyCount} 风口)`)
check(snap.equipment.length === 3, `第4页:3 台设备已写入(实际 ${snap.equipment.length})`)
check(snap.particles && snap.particles.count > 1000, `第4页:粒子帧已写入(count=${snap.particles?.count})`)
check(typeof snap.images?.viewport === 'string' && snap.images.viewport.startsWith('data:image/png'), '第4页:视口截图已内嵌')

// ---------- 导入还原 ----------
// 先回到第 1 页把设备删掉一台,再导入,验证状态被快照覆盖
await page.$$eval('.step', (els) => (els[0] as HTMLButtonElement).click())
await page.waitForSelector('.equip-row')
await page.click('.equip-row .btn-mini.danger')
await new Promise((r) => setTimeout(r, 300))
const midCount = await page.$$eval('.equip-row', (r) => r.length)
check(midCount === 2, `导入前:手动删除后剩 ${midCount} 台`)

await page.$$eval('.step', (els) => (els[3] as HTMLButtonElement).click())
const fileInput = await page.waitForSelector('input[type=file]')
await fileInput.uploadFile(snapPath)
await page.waitForSelector('.msg-ok', { timeout: 10000 })
const msg = await page.$eval('.msg-ok', (el) => el.textContent)
check(!!msg && msg.includes('3 台设备'), `第4页:导入成功提示("${msg?.trim()}")`)
const summary = await page.$eval('.export-card:last-child', (el) => el.textContent)
check(summary?.includes('设备 3 台') ?? false, '第4页:导入后布局摘要与快照一致')

// 等一个统计周期,验证粒子帧确实还原到重挂载后的引擎实例
await new Promise((r) => setTimeout(r, 1200))
const statsAfterImport = await page.$eval('.stats', (el) => el.textContent)
const restoredCount = Number(/粒子\s*(\d+)/.exec(statsAfterImport ?? '')?.[1] ?? 0)
check(restoredCount > 1000, `第4页:粒子帧已还原到引擎(存活=${restoredCount})`)

check(consoleErrors.length === 0, `全程无控制台错误(实际 ${consoleErrors.length}: ${consoleErrors.join(' | ').slice(0, 200)})`)
await page.screenshot({ path: `${SHOTS}/4-imported.png` })

await browser.close()
console.log(failures === 0 ? '\n全部 E2E 检查通过。' : `\n${failures} 项 E2E 检查失败。`)
process.exit(failures === 0 ? 0 : 1)