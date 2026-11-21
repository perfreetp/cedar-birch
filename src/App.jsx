import { onMount, For, Show } from 'solid-js';
import { state, setState } from './store.js';
import * as S from './three/scene.js';

const STEPS = [
  { n: 1, title: '场景搭建', desc: '建校园 · 放置摄像头' },
  { n: 2, title: '视锥调节', desc: '调角度距离 · 看覆盖高亮' },
  { n: 3, title: '遮挡分析', desc: '拖拽重算 · 标注盲区' },
  { n: 4, title: '数据导出', desc: '保存 · 导出分析 JSON' },
];

function Slider(props) {
  return (
    <label class="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step || 1}
        value={props.value}
        onInput={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
      <b>{props.value}{props.unit}</b>
    </label>
  );
}

export default function App() {
  let canvasRef;
  let fileRef;

  onMount(() => {
    S.initScene(canvasRef);
    const saved = S.loadSaved();
    if (saved && saved.length) {
      S.apiImportCameras(saved);
    } else {
      // 首次使用：围绕中心广场放 4 个演示摄像头
      S.apiAddCamera(-15, -15, { yaw: 135, name: '广场西北' });
      S.apiAddCamera(15, -15, { yaw: 225, name: '广场东北' });
      S.apiAddCamera(15, 15, { yaw: 315, name: '广场东南' });
      S.apiAddCamera(-15, 15, { yaw: 45, name: '广场西南' });
    }
  });

  const sel = () => state.cameras.find((c) => c.id === state.selectedId);
  const selArea = () => (state.selectedId ? state.coverage[state.selectedId]?.area : null);
  const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));

  const upd = (key, v) => {
    setState('cameras', (c) => c.id === state.selectedId, key, v);
    S.apiRefreshCamera(state.selectedId);
    S.saveLocal();
  };

  const doExport = () => {
    const data = S.buildExportJSON();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `campus-coverage-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = (e) => {
    const f = e.currentTarget.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        const cams = Array.isArray(d) ? d : d.cameras;
        if (Array.isArray(cams)) S.apiImportCameras(cams);
      } catch (err) {
        console.error('导入失败：', err);
      }
    };
    r.readAsText(f);
    e.currentTarget.value = '';
  };

  return (
    <>
      <header>
        <h1>校园安防三维可视化</h1>
        <div class="badges">
          <span class="badge">摄像头 {state.cameras.length}</span>
          <span class="badge" classList={{ on: state.bvhActive }}>
            BVH 遮挡加速{state.bvhActive ? '已启用(>50)' : '未启用(≤50)'}
          </span>
          <span class="badge">覆盖 {fmt(state.unionArea)} m²</span>
          <span class="badge warn" style={{ display: state.blind ? 'inline-block' : 'none' }}>
            盲区 {state.blind ? fmt(state.blind.area) : '—'} m²
          </span>
        </div>
        <div class="views">
          <button classList={{ active: state.viewMode === 'top' }} onClick={() => S.apiSetViewMode('top')}>俯视图</button>
          <button classList={{ active: state.viewMode === 'street' }} onClick={() => S.apiSetViewMode('street')}>街景视角</button>
        </div>
      </header>

      <main>
        <div class="viewport">
          <canvas ref={canvasRef} />
          <Show when={state.placeMode}>
            <div class="hint">放置模式：点击地面放置摄像头</div>
          </Show>
          <Show when={state.step === 3}>
            <div class="hint">拖拽摄像头可实时重算覆盖范围</div>
          </Show>
        </div>

        <aside>
          <nav class="steps">
            <For each={STEPS}>
              {(s) => (
                <button
                  classList={{ active: state.step === s.n }}
                  onClick={() => setState('step', s.n)}
                >
                  <b>{s.n}. {s.title}</b>
                  <small>{s.desc}</small>
                </button>
              )}
            </For>
          </nav>

          <div class="panel">
            {/* 模块一：场景搭建 */}
            <Show when={state.step === 1}>
              <h2>场景搭建</h2>
              <p class="tip">校园建筑与道路已建模。开启放置模式后点击地面布置摄像头，或直接点击场景中的摄像头选中。</p>
              <div class="row">
                <button classList={{ primary: state.placeMode }} onClick={() => setState('placeMode', !state.placeMode)}>
                  {state.placeMode ? '退出放置模式' : '放置摄像头'}
                </button>
                <button onClick={() => S.apiAddCamera((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60)}>
                  随机添加
                </button>
              </div>
              <div class="row">
                <button onClick={() => S.apiAddTestCameras(60)}>生成 60 个测试摄像头</button>
                <button class="danger" onClick={() => S.apiClearCameras()}>清空全部</button>
              </div>
              <h3>摄像头列表（{state.cameras.length}）</h3>
              <ul class="camlist">
                <For each={state.cameras}>
                  {(c) => (
                    <li classList={{ sel: c.id === state.selectedId }}>
                      <span onClick={() => S.apiSelectCamera(c.id)}>{c.name}</span>
                      <em>{fmt(state.coverage[c.id]?.area)} m²</em>
                      <button class="del" onClick={() => S.apiDeleteCamera(c.id)}>×</button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>

            {/* 模块二：视锥调节 */}
            <Show when={state.step === 2}>
              <h2>视锥调节</h2>
              <Show when={sel()} fallback={<p class="tip">请先在场景中点击一个摄像头（或在模块一中放置）。</p>}>
                <h3>{sel().name}</h3>
                <Slider label="安装高度" min={2} max={20} step={0.5} unit=" m" value={sel().y} onChange={(v) => upd('y', v)} />
                <Slider label="水平朝向" min={0} max={360} unit="°" value={sel().yaw} onChange={(v) => upd('yaw', v)} />
                <Slider label="俯角" min={5} max={80} unit="°" value={sel().pitch} onChange={(v) => upd('pitch', v)} />
                <Slider label="水平视场角" min={30} max={120} unit="°" value={sel().fov} onChange={(v) => upd('fov', v)} />
                <Slider label="垂直视场角" min={20} max={90} unit="°" value={sel().vfov} onChange={(v) => upd('vfov', v)} />
                <Slider label="可视距离" min={10} max={100} unit=" m" value={sel().range} onChange={(v) => upd('range', v)} />
                <div class="stat">
                  当前覆盖面积：<b>{fmt(selArea())} m²</b>
                </div>
              </Show>
              <label class="check">
                <input
                  type="checkbox"
                  checked={state.showAllCoverage}
                  onChange={(e) => S.apiSetShowAllCoverage(e.currentTarget.checked)}
                />
                显示全部摄像头覆盖（关闭后仅看选中）
              </label>
            </Show>

            {/* 模块三：遮挡分析 */}
            <Show when={state.step === 3}>
              <h2>遮挡分析</h2>
              <p class="tip">建筑遮挡后视锥自动裁剪。在场景中<b>拖拽摄像头</b>可实时重算覆盖；盲区以红色网格标出。</p>
              <div class="row">
                <button class="primary" onClick={() => S.apiComputeBlind()}>重新分析盲区</button>
                <label class="check inline">
                  <input
                    type="checkbox"
                    checked={state.blindVisible}
                    onChange={(e) => S.apiSetBlindVisible(e.currentTarget.checked)}
                  />
                  显示盲区
                </label>
              </div>
              <Show when={state.blindStale}>
                <p class="stale">参数已变更，盲区结果可能过期，请重新分析。</p>
              </Show>
              <div class="stats">
                <div><span>并集覆盖面积</span><b>{fmt(state.unionArea)} m²</b></div>
                <div><span>盲区面积</span><b class="red">{state.blind ? fmt(state.blind.area) : '—'} m²</b></div>
                <div><span>覆盖率</span><b>{state.blind ? (state.coverageRate * 100).toFixed(1) + ' %' : '—'}</b></div>
                <div><span>盲区网格数</span><b>{state.blind ? state.blind.count : '—'}</b></div>
              </div>
            </Show>

            {/* 模块四：数据导出 */}
            <Show when={state.step === 4}>
              <h2>数据导出</h2>
              <p class="tip">摄像头参数与覆盖分析自动保存在浏览器本地，可导出 JSON 分享，也可导入他人分享的 JSON 还原场景。</p>
              <div class="row">
                <button class="primary" onClick={doExport}>导出分析 JSON</button>
                <button onClick={() => fileRef.click()}>导入 JSON</button>
                <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
              </div>
              <div class="row">
                <button onClick={() => S.saveLocal()}>保存到浏览器</button>
                <button class="danger" onClick={() => S.clearLocal()}>清除本地数据</button>
              </div>
              <h3>覆盖统计</h3>
              <div class="stats">
                <div><span>摄像头总数</span><b>{state.cameras.length}</b></div>
                <div><span>并集覆盖面积</span><b>{fmt(state.unionArea)} m²</b></div>
                <div><span>盲区面积</span><b class="red">{state.blind ? fmt(state.blind.area) : '—'} m²</b></div>
                <div><span>覆盖率</span><b>{state.blind ? (state.coverageRate * 100).toFixed(1) + ' %' : '—'}</b></div>
              </div>
              <table>
                <thead>
                  <tr><th>摄像头</th><th>覆盖面积 (m²)</th></tr>
                </thead>
                <tbody>
                  <For each={state.cameras}>
                    {(c) => (
                      <tr classList={{ sel: c.id === state.selectedId }} onClick={() => S.apiSelectCamera(c.id)}>
                        <td>{c.name}</td>
                        <td>{fmt(state.coverage[c.id]?.area)}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        </aside>
      </main>
    </>
  );
}
