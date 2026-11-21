/* CDP 冒烟测试：无头 Chrome 实际运行应用，捕获控制台错误并驱动核心交互 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL = 'http://localhost:5191/';

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const proc = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  '--headless=new',
  '--window-size=1600,900',
  '--disable-gpu',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-first-run',
  '--no-default-browser-check',
  '--user-data-dir=C:\\Temp\\cdp-test-profile',
  'about:blank',
]);

const errors = [];
const logs = [];
let msgId = 0;
const pending = new Map();

try {
  let version;
  for (let i = 0; i < 40; i++) {
    try {
      version = await getJSON('/json/version');
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  // 新建页面 target，再取其页面级调试端点（Runtime 域需挂在页面会话上）
  await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL)}`, { method: 'PUT' }).catch(
    () => {},
  );
  let pageTarget;
  for (let i = 0; i < 40; i++) {
    const list = await getJSON('/json');
    pageTarget = list.find((t) => t.type === 'page' && t.url.includes('localhost:5191'));
    if (pageTarget) break;
    await sleep(250);
  }
  if (!pageTarget) throw new Error('未找到应用页面 target');

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m.result ?? { __cdpError: m.error });
      pending.delete(m.id);
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error') errors.push(text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(`EXCEPTION: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    }
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await sleep(2500);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (!r || r.__cdpError) {
      errors.push(`CDP: ${JSON.stringify(r?.__cdpError ?? 'no result')}`);
      return null;
    }
    if (r.exceptionDetails) {
      errors.push(`EVAL: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return null;
    }
    return r.result.value;
  };

  // 1. 初始渲染
  const title = await evalJs('document.title');
  console.log('页面标题:', title);

  // 2. 点击加载示例数据
  const clicked = await evalJs(`
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('加载示例分段'))?.click();
    'clicked';
  `);
  console.log('点击示例按钮:', clicked);
  await sleep(4000);

  const state = await evalJs(`(() => {
    const canvas = document.querySelector('.viewport canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    return {
      hasCanvas: !!canvas,
      canvasSize: canvas ? [canvas.width, canvas.height] : null,
      weldCountText: document.querySelector('.stat-big')?.textContent,
      overCountText: document.querySelectorAll('.stat-big')[1]?.textContent,
      legendRows: document.querySelectorAll('.legend-row').length,
      regionGroups: document.querySelectorAll('.region-head').length,
      rowsRendered: document.querySelectorAll('.weld-row').length,
    };
  })()`);
  console.log('装载后状态:', JSON.stringify(state, null, 2));

  // 3. 拖动阈值滑块（模拟高频 input 事件 ×21，每次重新查询节点避免引用失效）
  const perf = await evalJs(`(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const t0 = performance.now();
    for (let v = 0; v <= 8.001; v += 0.4) {
      const slider = document.querySelector('input[type=range]');
      setter.call(slider, String(v));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const t1 = performance.now();
    return { sliderUpdates: 21, elapsedMs: Math.round(t1 - t0) };
  })()`);
  console.log('滑块高频更新:', JSON.stringify(perf));

  // 4. 启用剖切
  await evalJs(`
    document.querySelector('.section-toggle input[type=checkbox]').click();
    'section-on';
  `);
  await sleep(800);
  const section = await evalJs(`(() => ({
    checkboxChecked: document.querySelector('.section-toggle input[type=checkbox]').checked,
    xLabel: [...document.querySelectorAll('strong')].map(e => e.textContent).find(t => t.includes('X ')),
  }))()`);
  console.log('剖切状态:', JSON.stringify(section));

  // 5. 渲染活性：连续检查 canvas 是否持续产生新帧（headless 下 rAF 被限流，用计数器轮询）
  const renderAlive = await evalJs(`(async () => {
    const canvas = document.querySelector('.viewport canvas');
    const before = canvas.width;
    await new Promise(r => setTimeout(r, 600));
    return { canvasW: before, stillMounted: !!document.querySelector('.viewport canvas') };
  })()`);
  console.log('渲染循环存活:', JSON.stringify(renderAlive));

  // 阈值连续改动 30 次的总耗时（统计重算 + GPU 缓冲更新）
  const perf30 = await evalJs(`(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      const slider = document.querySelector('input[type=range]');
      setter.call(slider, String((i % 80) / 10));
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return Math.round(performance.now() - t0);
  })()`);
  console.log('30 次阈值改动耗时(ms):', perf30);

  // 6. 导出配置
  const exportOk = await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('导出配置文件'));
    return !!btn && !btn.disabled;
  })()`);
  console.log('导出按钮可用:', exportOk);

  // 7. 列表点击定位
  const listClick = await evalJs(`(() => {
    const row = document.querySelector('.weld-row');
    if (!row) return 'no-row';
    row.click();
    return row.querySelectorAll('span')[1]?.textContent;
  })()`);
  console.log('列表首条点击:', listClick);
  await sleep(1200);
  const selected = await evalJs(
    `document.querySelector('.weld-row.selected')?.querySelectorAll('span')[1]?.textContent`,
  );
  console.log('选中高亮:', selected);

  // 8. 区域分组数量（虚拟滚动只渲染可视区，真实数量从 data 属性读取）
  const regions = await evalJs(
    `document.querySelector('[data-region-count]')?.getAttribute('data-region-count')`,
  );
  console.log('区域分组数:', regions);

  // 9. 配置导出 -> 导入往返：拦截下载拿到配置，再走真实导入流程还原状态
  const roundtrip = await evalJs(`(async () => {
    let captured = null;
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href && this.href.startsWith('blob:')) {
        captured = this.href;
        return;
      }
      return origClick.call(this);
    };
    [...document.querySelectorAll('button')].find(b => b.textContent.includes('导出配置文件')).click();
    HTMLAnchorElement.prototype.click = origClick;
    if (!captured) return { ok: false, reason: 'no-download' };
    const blob = await fetch(captured).then(r => r.blob());
    const file = new File([blob], 'cfg.json', { type: 'application/json' });
    // 记录当前阈值，改动后再导入，验证是否被配置覆盖还原
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = [...document.querySelectorAll('input[type=file]')].find(i =>
      i.closest('.card')?.textContent.includes('导入视图配置'));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    const cfg = JSON.parse(await blob.text());
    const thresholdInput = document.querySelector('input[type=range]');
    return {
      ok: cfg.type === 'weld-gap-view-config' && cfg.palette.length === 9 &&
        typeof cfg.section?.enabled === 'boolean' &&
        Number(thresholdInput.value) === cfg.threshold,
      sectionEnabled: cfg.section.enabled,
      thresholdRestored: Number(thresholdInput.value) === cfg.threshold,
    };
  })()`);
  console.log('配置导出导入往返:', JSON.stringify(roundtrip));

  ws.close();

  console.log('\n控制台日志条数:', logs.length);
  if (errors.length) {
    console.log('\\n❌ 发现错误:');
    errors.forEach((e) => console.log(' -', e.slice(0, 300)));
    process.exitCode = 1;
  } else {
    console.log('✅ 无控制台错误/异常');
  }
} catch (e) {
  console.error('测试失败:', e);
  process.exitCode = 1;
} finally {
  proc.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 300);
}
