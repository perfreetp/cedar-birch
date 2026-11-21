// 零依赖 CDP 冒烟测试：启动无头 Chrome -> 加载应用 -> 采集错误 -> 交互验证 -> 截图
import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const TARGET_URL = 'http://127.0.0.1:5180/'
const PORT = 9222
const SHOT = new URL('../tmp/smoke/screenshot.png', import.meta.url).pathname.replace(/^\//, '')

mkdirSync(new URL('../tmp/smoke/', import.meta.url), { recursive: true })

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--use-angle=swiftshader',
    '--enable-unsafe-webgpu',
    '--enable-dawn-features=allow_unsafe_apis',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1600,1000',
    '--user-data-dir=C:\\Users\\Administrator\\AppData\\Local\\Temp\\dock-cdp-profile',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

const errors = []
let msgId = 0
const pending = new Map()

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Chrome DevTools endpoint not reachable')
}

const ws = new WebSocket(await getWsUrl())
await new Promise((res, rej) => {
  ws.onopen = res
  ws.onerror = rej
})

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(JSON.stringify(msg.error)))
    else resolve(msg.result)
  } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description).join(' '))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    errors.push('exception: ' + JSON.stringify(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
  } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
    errors.push('log: ' + msg.params.entry.text)
  }
}

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails))
  return r.result.value
}

await send('Runtime.enable')
await send('Log.enable')
await send('Page.enable')
await send('Page.navigate', { url: TARGET_URL })

// 等待应用初始化（WebGPU 初始化 + 首轮评估）
let debug = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  debug = await evalJs('window.__dockDebug ? JSON.stringify(window.__dockDebug) : "null"')
  if (debug && debug !== 'null') {
    debug = JSON.parse(debug)
    if (debug.meshes > 0) break
  }
}

console.log('初始状态:', JSON.stringify(debug, null, 2))

// ---- 交互验证：参数变更触发实时重算 ----
const v0 = debug.evalVersion
await evalJs(`(() => {
  const st = window.__dockStore
  const c = st.cranes[0]
  st.updateCrane(c.id, { x: c.x + 5, z: c.z - 3 })
})()`)
await sleep(300)
const v1 = await evalJs('window.__dockDebug.evalVersion')
console.log('拖拽吊车后 evalVersion:', v0, '->', v1, v1 > v0 ? 'PASS' : 'FAIL')

// 改臂架角度 -> 域体重算
await evalJs(`(() => {
  const st = window.__dockStore
  const p = st.cranes.find((c) => c.kind === 'portal')
  st.updateCrane(p.id, { boomAngle: p.boomAngle + 0.2 })
})()`)
await sleep(300)
const v2 = await evalJs('window.__dockDebug.evalVersion')
console.log('臂架角度变更后重算:', v2 > v1 ? 'PASS' : 'FAIL')

// 分段重量调到超过单机容量 -> 出现红色不足单元
await evalJs(`(() => {
  const st = window.__dockStore
  const seg = st.segments[0]
  st.updateSegment(seg.id, { weightT: 200 })
})()`)
await sleep(300)
const afterHeavy = JSON.parse(await evalJs('JSON.stringify(window.__dockDebug)'))
console.log('超重分段后 不足单元数:', afterHeavy.insufficient, afterHeavy.insufficient > 0 ? 'PASS' : 'FAIL')

// 吊走分段 -> 阻挡/不足单元应下降，域体联动
const blockedBefore = afterHeavy.blocked
await evalJs(`window.__dockStore.markRemoved(window.__dockStore.segments[0].id, true)`)
await sleep(300)
const afterLift = JSON.parse(await evalJs('JSON.stringify(window.__dockDebug)'))
console.log('吊走后 blocked:', blockedBefore, '->', afterLift.blocked, '; segments:', afterLift.segments)

// 导出 -> 导入 往返
const roundtrip = await evalJs(`
  (() => {
    const s = window.__dockStore;
    const layout = s.exportLayout();
    const json = JSON.stringify(layout);
    const restored = JSON.parse(json);
    const ok = s.importLayout(restored);
    return JSON.stringify({ ok, cranes: restored.cranes.length, segments: restored.segments.length, grid: restored.gridSize });
  })()
`)
console.log('导出/导入往返:', roundtrip, JSON.parse(roundtrip).ok ? 'PASS' : 'FAIL')

// 协同区统计
const coop = await evalJs('window.__dockDebug.coop')
console.log('协同吊装区单元数:', coop, Number(coop) > 0 ? 'PASS' : 'WARN(可能布局无交叠)')

// 截图
const shot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(SHOT, Buffer.from(shot.data, 'base64'))
console.log('截图已保存:', SHOT)

console.log('\n=== 控制台/页面错误 ===')
if (errors.length === 0) console.log('无错误 PASS')
else {
  console.log(errors.join('\n'))
  process.exitCode = 1
}

ws.close()
chrome.kill()
setTimeout(() => process.exit(process.exitCode ?? 0), 300)
