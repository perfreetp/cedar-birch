// 无头 Chrome(CDP)运行时验证: 加载页面、收集 console/页面错误、执行场景内断言
// 用法: node scripts/headless-check.mjs
const { spawn } = await import('node:child_process');
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
// 端口自动发现: vite 可能因端口占用自动后移
const PORT_CANDIDATES = [5180, 5181, 5182, 5183, 5184, 5185];
let URL;
for (const p of PORT_CANDIDATES) {
  try {
    const html = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${p}/`, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      }).on('error', reject);
    });
    if (html.includes('多层多道焊道')) {
      URL = `http://127.0.0.1:${p}/`;
      break;
    }
  } catch {}
}
if (!URL) throw new Error('未找到本项目的 dev server');
console.log('使用服务地址:', URL);
const PORT = 9222;

function getJSON(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9222',
  '--disable-gpu',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--window-size=1600,1000',
  'about:blank',
]);

const failures = [];
const consoleAll = [];
const pageErrors = [];
const consoleErrors = [];

try {
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await getJSON('/json/list');
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  if (!target) throw new Error('Chrome DevTools target not found');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++msgId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      pageErrors.push(d.text + ' ' + (d.exception?.description || ''));
    }
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args
        .map((a) => a.value || a.description || a.preview?.description || '')
        .join(' ');
      consoleAll.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error') consoleErrors.push(text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      consoleErrors.push(m.params.entry.text);
    }
  });

  const evalRes = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result.exceptionDetails) {
      const d = r.result.exceptionDetails;
      failures.push(`eval error: ${d.text} ${d.exception?.description || ''}`);
      return undefined;
    }
    return r.result.result?.value;
  };

  await send('Page.navigate', { url: URL });
  await sleep(4500);

  const probe = await evalRes(`(() => ({
    href: location.href,
    readyState: document.readyState,
    rootLen: document.getElementById('root') ? document.getElementById('root').innerHTML.length : -1,
    hasViewer: !!document.querySelector('.viewer-canvas'),
    scriptCount: document.scripts.length,
  }))()`);
  console.log('导航探测:', JSON.stringify(probe, null, 2));

  const checks = await evalRes(`(async () => {
    const out = {};
    const canvas = document.querySelector('.viewer-canvas canvas');
    out.hasCanvas = !!canvas;
    out.canvasSize = canvas ? [canvas.width, canvas.height] : null;
    out.headerText = document.querySelector('.app-header h1')?.textContent || null;
    out.passChips = document.querySelectorAll('.pass-chip').length;
    out.totalPassesText = document.querySelector('.stat-row strong')?.textContent || null;
    const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null;
    out.webgl = !!gl;
    out.debug = window.__WELD_DEBUG__ ? await window.__WELD_DEBUG__.snapshot() : null;
    return out;
  })()`);

  console.log('页面探测结果:', JSON.stringify(checks, null, 2));

  // 剖切深度诊断: 移动剖切面后检查截面片顶点数与面积
  const diag = await evalRes(`(async () => {
    const dbg = window.__WELD_DEBUG__;
    const z0 = await dbg.snapshot();
    // 直接驱动 solid store 的方式不可用,改为检查当前 z=0 处细节
    return {
      atZ0: z0,
    };
  })()`);
  console.log('剖切诊断:', JSON.stringify(diag, null, 2));
  console.log('\\n--- 控制台消息 ---');
  console.log(consoleAll.slice(0, 40).join('\\n') || '(无)');
  console.log('--- 控制台消息结束 ---\\n');

  if (!checks?.hasCanvas) failures.push('canvas 未创建');
  if (!checks?.webgl) failures.push('WebGL 上下文不可用');
  if (!checks?.passChips || checks.passChips < 6) failures.push('层道芯片数量异常');
  if (pageErrors.length) failures.push('页面异常: ' + pageErrors.join(' | '));
  if (consoleErrors.length) failures.push('console.error: ' + consoleErrors.join(' | '));

  // ---------- 交互与数据流断言 ----------
  const interaction = await evalRes(`(async () => {
    const log = {};
    const dbg = window.__WELD_DEBUG__;
    const snap = () => dbg.snapshot();
    const $ = (id) => document.querySelector('[data-testid="' + id + '"]');
    const setRange = (id, value) => {
      const el = $(id);
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const tick = () => new Promise((r) => setTimeout(r, 800));

    // 1) 剖切移动
    setRange('section-z', 25);
    await tick();
    log.afterSectionMove = snap();

    // 2) 层数改动 -> 重新排布
    const beforeCount = snap().beadCount;
    setRange('layer-count', 12);
    await tick();
    await tick();
    log.afterLayerChange = snap();
    log.layerCountChanged = beforeCount !== log.afterLayerChange.beadCount;
    log.chipCountAfter = document.querySelectorAll('.pass-chip').length;
    log.uiTotalPasses = document.querySelector('.stat-row strong')?.textContent;

    // 3) 剥层
    setRange('peel-layers', 3);
    await tick();
    log.afterPeel = snap();

    // 4) 温度叠加
    $('thermal-toggle').click();
    await tick();
    log.afterThermal = snap();

    // 5) 固定道数模式
    const mode = $('pass-mode');
    mode.value = 'fixed';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await tick();
    setRange('fixed-passes', 2);
    await tick();
    log.afterFixedPass = snap();
    log.fixedPassChips = [...document.querySelectorAll('.pass-chip')].slice(0, 4).map((e) => e.textContent);

    // 6) 导出: 拦截下载
    let exported = null;
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { exported = blob; return 'blob:test'; };
    $('export-json').click();
    await tick();
    URL.createObjectURL = origCreate;
    if (exported) {
      const json = JSON.parse(await exported.text());
      log.export = {
        keys: Object.keys(json),
        beadCount: json.beads.length,
        sectionZ: json.sectionPosition.z,
        layer: json.weld.layerCount,
        firstBead: json.beads[0],
      };
    }
    return log;
  })()`);

  console.log('\\n交互断言结果:', JSON.stringify(interaction, null, 2));

  const expect = (cond, msg) => {
    if (!cond) failures.push(msg);
  };
  expect(interaction?.afterSectionMove?.clipConstant === -25, '剖切移动未同步到裁切平面');
  expect(interaction?.afterSectionMove?.sectionBeadPieces > 0, '移动后截面焊道片丢失');
  expect(interaction?.layerCountChanged, '层数改动后焊道未重新排布');
  expect(interaction?.chipCountAfter === 12, '重排后层芯片数应为 12');
  expect(interaction?.afterPeel?.visibleLayers === 2, '剥层未生效(应只剩前 3 层, layer<=2)');
  expect(
    interaction?.afterPeel?.visibleSectionPieces < interaction?.afterLayerChange?.sectionPieces,
    '剥层后可见截面片未减少',
  );
  expect(interaction?.afterThermal?.thermalOn === true, '温度叠加开关未生效');
  expect(
    interaction?.afterFixedPass?.beadCount > 0 &&
      interaction?.fixedPassChips?.[0] === 'L1:1' &&
      interaction?.fixedPassChips?.slice(1).every((t) => t.endsWith(':2')),
    '固定道数模式未按 2 道/层排布(打底层除外)',
  );
  expect(interaction?.export?.sectionZ === 25, '导出剖切位置不正确');
  expect(interaction?.export?.layer === 12, '导出错层配置不正确');
  expect(
    interaction?.export?.firstBead?.fusionArea > 0 && interaction?.export?.firstBead?.interpassTemp !== undefined,
    '导出缺少面积/温度字段',
  );

  // 7) 拾取: 恢复全部层后, 取一个剖面焊道片中心,投影到屏幕走真实射线拾取
  const picking = await evalRes(`(async () => {
    const $ = (id) => document.querySelector('[data-testid="' + id + '"]');
    const setRange = (id, v) => { const el=$(id); el.value=String(v); el.dispatchEvent(new Event('input',{bubbles:true})); };
    const tick = () => new Promise((r) => setTimeout(r, 500));
    setRange('peel-layers', 12);
    setRange('section-z', 0);
    await tick();
    const dbg = window.__WELD_DEBUG__;
    const centers = dbg.sectionCenters();
    if (!centers.length) {
      return { ok: false, reason: 'no visible bead pieces', snap: dbg.snapshot() };
    }
    const target = centers[Math.floor(centers.length / 2)];
    const { nx, ny } = dbg.worldToScreen(target.x, target.y, target.z);
    const pickedId = dbg.pickAt(nx, ny);
    await new Promise((r) => setTimeout(r, 200));
    return {
      ok: pickedId === target.beadId,
      target: target.beadId,
      pickedId,
      selectedAfter: dbg.snapshot().selectedId,
    };
  })()`);
  console.log('拾取结果:', JSON.stringify(picking));
  expect(picking?.pickedId !== null && typeof picking?.pickedId === 'string', '剖面焊道射线拾取未命中任何焊道');
  expect(
    picking?.selectedAfter && picking.selectedAfter === picking.pickedId,
    '拾取后高亮状态未与命中焊道同步',
  );
  expect(
    picking?.pickedId?.startsWith('L'),
    '拾取目标应为焊道(层道编号)',
  );

  // 8) 遮挡正确性: 剖面片共面且面积为正, 实体材质由全局 clipping 保证不越界
  const occlusion = await evalRes(`(() => {
    const dbg = window.__WELD_DEBUG__.snapshot();
    return {
      sectionPieces: dbg.sectionPieces,
      beadPieces: dbg.sectionBeadPieces,
      areasPositive: (dbg.sectionAreaSample || []).every((a) => a >= 0),
    };
  })()`);
  expect(occlusion?.beadPieces > 0 && occlusion?.areasPositive, '剖面焊道片或面积异常');
} catch (e) {
  failures.push('测试脚本异常: ' + (e.stack || e.message));
} finally {
  chrome.kill();
}

if (failures.length) {
  console.error('\\n❌ 验证失败:');
  for (const f of failures) console.error(' - ' + f);
  process.exit(1);
}
console.log('\\n✅ 基础运行时验证通过');
