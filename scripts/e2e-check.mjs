// 端到端冒烟测试（适配生产构建）：UI 点击 + window.__BSR_STORE__ 状态断言
const PORT = process.env.CDP_PORT || '9334';
const HOST = process.env.APP_HOST || 'http://127.0.0.1:4173/';

const res = await fetch(`http://127.0.0.1:${PORT}/json/new?` + encodeURIComponent(HOST), { method: 'PUT' });
const tab = await res.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let msgId = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  }
};
function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
await send('Runtime.enable');
await send('Page.enable');
await new Promise((r) => setTimeout(r, 4000));

async function ev(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) {
    errors.push('EVAL: ' + (res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
    return null;
  }
  return res.result.value;
}
const S = 'window.__BSR_STORE__';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const app = () => `document.querySelector('bsr-app').shadowRoot`;

const results = {};

// 1. 组件挂载
results.appMounted = await ev(`!!${app()}.querySelector('nav')`);
results.panelMounted = await ev(`${app()}.querySelectorAll('bsr-panel-import').length === 1`);

// 2. manifold 预热
await sleep(1500);

// 3. 生成演示数据（UI 点击）
await ev(`${app()}.querySelector('bsr-panel-import').shadowRoot.querySelector('#btn-demo').click()`);
await sleep(1500);
results.imageryLoaded = await ev(`Boolean(${S}.state.imagery && ${S}.state.dem && ${S}.state.preImagery)`);

// 4. 切到提取页，执行提取
await ev(`${app()}.querySelector('[data-tab="extract"]').click()`);
await sleep(300);
await ev(`${app()}.querySelector('bsr-panel-extract').shadowRoot.querySelector('#btn-extract').click()`);
for (let i = 0; i < 30; i++) {
  await sleep(500);
  if (await ev(`Boolean(${S}.state.boundary)`)) break;
}
results.boundaryExtracted = await ev(`Boolean(${S}.state.boundary)`);
results.outerVertices = await ev(`(${S}.state.boundary?.outer.length ?? 0)`);
results.holes = await ev(`(${S}.state.boundary?.holes.length ?? 0)`);
results.statsGenerated = await ev(`Boolean(${S}.state.stats)`);
if (results.statsGenerated) {
  results.planarArea = await ev(`(${S}.state.stats.planarArea)`);
  results.perimeter = await ev(`(${S}.state.stats.perimeter)`);
  results.surfaceArea = await ev(`(${S}.state.stats.surfaceArea)`);
  results.meanSlope = await ev(`(${S}.state.stats.meanSlope)`);
}

// 5. 修边：编辑顶点 + manifold 重建
if (results.boundaryExtracted) {
  await ev(`(function(){
    const s = window.__BSR_STORE__;
    const p = s.rings.outer[0];
    s.editRings(rings => { rings.outer[0] = { x: p.x + 5, y: p.y + 5 }; });
  })()`);
  await ev(`window.__BSR_STORE__.rebuildNow()`);
  await sleep(800);
  results.undoAvailable = await ev(`(${S}.canUndo)`);
  results.boundaryStillValid = await ev(`Boolean(${S}.state.boundary) && ${S}.state.boundary.outer.length >= 3`);

  // 撤销
  await ev(`window.__BSR_STORE__.undo()`);
  await sleep(400);
  results.undoWorks = await ev(`(${S}.canRedo)`);
}

// 6. 显示模式切换
await ev(`window.__BSR_STORE__.updateDisplay({ draped: false })`);
await sleep(300);
results.liftMode = await ev(`(${S}.state.display.draped === false)`);
await ev(`window.__BSR_STORE__.updateDisplay({ draped: true })`);

// 7. 分级切点调整
await ev(`window.__BSR_STORE__.updateSeverity({ cutoffs: [0.15,0.35,0.55,0.75] })`);
await sleep(400);
results.severityLevels = await ev(`(${S}.state.stats ? ${S}.state.stats.levelAreas.length : 0)`);

// 8. GeoJSON 导出内容校验
if (results.boundaryExtracted) {
  const gj = await ev(`(function(){
    const text = window.__BSR_DEBUG__.exportGeoJSON();
    const fc = JSON.parse(text);
    const f = fc.features[0];
    return {
      type: f.geometry.type,
      ringCount: f.geometry.coordinates.length,
      closed: f.geometry.coordinates[0][0][0] === f.geometry.coordinates[0][f.geometry.coordinates[0].length-1][0],
      hasArea: typeof f.properties.planarArea_m2 === 'number',
      hasCrs: !!fc.crs
    };
  })()`);
  results.geojson = gj;
}

// 9. 本地存储往返
await ev(`window.__BSR_DEBUG__.save()`);
await sleep(300);
results.localStorageSaved = await ev(`(localStorage.getItem('bsr-state-v1') !== null)`);
const persisted = await ev(`(JSON.parse(localStorage.getItem('bsr-state-v1')).rasterMeta.length)`);
results.persistedRasterCount = persisted;

console.log(JSON.stringify({ results, errors }, null, 2));
ws.close();
const failed = errors.length > 0 ||
  !results.appMounted || !results.imageryLoaded || !results.boundaryExtracted ||
  !results.statsGenerated || !results.boundaryStillValid ||
  !results.geojson || results.geojson.type !== 'Polygon' ||
  !results.localStorageSaved;
process.exit(failed ? 1 : 0);
