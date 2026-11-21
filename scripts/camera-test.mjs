// 验证：1) WebGPU 能否初始化 2) 相机穿入域体内部不报错且正常渲染
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const mode = process.argv[2] || 'webgpu'
const port = mode === 'webgpu' ? 9224 : 9225
const profile = `C:\\Users\\Administrator\\AppData\\Local\\Temp\\dock-${mode}`

const args = [
  '--headless=new',
  '--no-sandbox',
  '--remote-debugging-port=' + port,
  '--window-size=1600,1000',
  '--user-data-dir=' + profile,
  'about:blank'
]
if (mode === 'webgpu') {
  args.splice(1, 0, '--enable-unsafe-webgpu', '--enable-dawn-features=allow_unsafe_apis', '--use-angle=swiftshader')
} else {
  args.splice(1, 0, '--disable-gpu')
}

const chrome = spawn(CHROME, args, { stdio: 'ignore' })
const errors = []
let wsUrl
for (let i = 0; i < 40; i++) {
  try {
    const l = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())
    if (l[0]?.webSocketDebuggerUrl) {
      wsUrl = l[0].webSocketDebuggerUrl
      break
    }
  } catch {}
  await sleep(200)
}
const ws = new WebSocket(wsUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const pend = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m.result)
    pend.delete(m.id)
  } else if (m.method === 'Runtime.exceptionThrown') {
    errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)
  } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    errors.push('console: ' + m.params.args.map((a) => a.value ?? a.description).join(' '))
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id
    pend.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
  return r.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: 'http://127.0.0.1:5180/' })

let engine = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  engine = await evalJs('window.__dockDebug?.engine ?? null')
  if (engine) break
}
console.log(`[${mode}] 实际引擎:`, engine)

// 相机穿入域体内部：目标点在 G1 体素内部（G1 中心 x=-16、高 26m），
// beta 接近 90° 为平视，半径 1.5m，相机即位于体素内部
await evalJs(`window.__dockScene.debugSetCamera(1.5, -Math.PI/2.4, Math.PI/2.02, -16, 12, 0)`)
await sleep(600)
const camInfo = await evalJs(`(() => {
  const cam = window.__dockScene.getScene().cameras[0]
  const p = cam.globalPosition
  return JSON.stringify({ radius: cam.radius, alpha: cam.alpha, beta: cam.beta, pos: [p.x.toFixed(2), p.y.toFixed(2), p.z.toFixed(2)] })
})()`)
console.log('相机实际参数:', camInfo)
await sleep(1500)
const insideShot = await send('Page.captureScreenshot', { format: 'png' })
writeFileSync(`D:/ccfb/runs/1000181/workspace/tmp/smoke/inside-${mode}.png`, Buffer.from(insideShot.data, 'base64'))

// 恢复俯瞰
await evalJs(`window.__dockScene.debugRestoreCamera()`)
await evalJs(`window.__dockScene.debugSetCamera(95, -Math.PI/2.4, Math.PI/3.2, 0, 0, 0)`)
await sleep(800)
const ok = await evalJs('JSON.stringify({ engine: window.__dockDebug.engine, meshes: window.__dockDebug.meshes })')
console.log(`[${mode}] 相机入体后状态:`, ok)
console.log(`[${mode}] 异常数:`, errors.length, errors.length ? errors.join(' | ') : '无错误')

ws.close()
chrome.kill()
setTimeout(() => process.exit(errors.length ? 1 : 0), 300)
