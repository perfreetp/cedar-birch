// 无头截图: 输出默认视角与几个关键状态的画面, 供视觉检查
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import http from 'node:http';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT_CANDIDATES = [5180, 5181, 5182, 5183, 5184, 5185];
let base;
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
      base = `http://127.0.0.1:${p}`;
      break;
    }
  } catch {}
}
if (!base) throw new Error('dev server not found');

const getJSON = (p) =>
  new Promise((res, rej) => {
    http.get('http://127.0.0.1:9240' + p, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => res(JSON.parse(d)));
    }).on('error', rej);
  });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=9240',
  '--disable-gpu',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--no-sandbox',
  '--window-size=1600,1000',
  '--hide-scrollbars',
  'about:blank',
]);

try {
  let target;
  for (let i = 0; i < 40; i++) {
    try {
      target = (await getJSON('/json/list')).find((t) => t.type === 'page');
      if (target) break;
    } catch {}
    await sleep(250);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pend = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pend.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Page.enable');
  await send('Page.navigate', { url: base + '/' });
  await sleep(4500);

  const shots = [
    { name: '01-default', setup: 'null' },
    {
      name: '02-thermal',
      setup: `() => { document.querySelector('[data-testid="thermal-toggle"]').click(); return new Promise(r=>setTimeout(r,500)); }`,
    },
    {
      name: '03-peel-root',
      setup: `async () => {
        const el = document.querySelector('[data-testid="peel-layers"]');
        el.value='3'; el.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(r=>setTimeout(r,600));
      }`,
    },
    {
      name: '04-section-offset',
      setup: `async () => {
        const el = document.querySelector('[data-testid="section-z"]');
        el.value='30'; el.dispatchEvent(new Event('input',{bubbles:true}));
        await new Promise(r=>setTimeout(r,600));
      }`,
    },
  ];

  fs.mkdirSync('scripts/shots', { recursive: true });
  for (const shot of shots) {
    if (shot.setup !== 'null') {
      await send('Runtime.evaluate', {
        expression: `(${shot.setup})()`,
        awaitPromise: true,
      });
      await sleep(400);
    }
    const img = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`scripts/shots/${shot.name}.png`, Buffer.from(img.result.data, 'base64'));
    console.log('saved', shot.name);
  }
} finally {
  chrome.kill();
}
