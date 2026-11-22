import { BsrElement } from './base';
import { store } from '../store';
import { loadDem, loadImagery, loadPreImagery } from '../lib/raster';
import { canvasToRaster, makeDemoDem, makeDemoPostImagery, makeDemoPreImagery } from '../lib/demo';
import { clearProject, hasSavedProject, loadPersistedState, restoreBlob, saveProject } from '../lib/storage';
import { getManifold } from '../lib/manifold';

export class PanelImport extends BsrElement {
  protected render(): string {
    const s = store.state;
    return `
      <style>${BsrElement.sharedStyle()}</style>
      <div class="section">
        <h3>数据导入</h3>
        <div class="field">
          <label>地面分辨率（米/像素）</label>
          <input type="number" id="pixel-size" value="1" min="0.01" step="0.1" />
        </div>
        <div class="field">
          <label>灾后影像（PNG / JPG / WebP）</label>
          <input type="file" id="post-file" accept="image/*" />
          <div class="file-name" id="post-name">${s.imagery ? s.imagery.name : '未导入'}</div>
        </div>
        <div class="field">
          <label>灾前影像（可选，用于植被差值）</label>
          <input type="file" id="pre-file" accept="image/*" />
          <div class="file-name" id="pre-name">${s.preImagery ? s.preImagery.name : '未导入'}</div>
        </div>
        <div class="field">
          <label>高程图 / DEM（灰度图，亮度编码高程）</label>
          <input type="file" id="dem-file" accept="image/*" />
          <div class="file-name" id="dem-name">${s.dem ? s.dem.name : '未导入'}</div>
        </div>
        <div class="row" style="margin-bottom:10px">
          <div style="flex:1">
            <label>DEM 最低高程 (m)</label>
            <input type="number" id="dem-min" value="0" step="1" />
          </div>
          <div style="flex:1">
            <label>DEM 最高高程 (m)</label>
            <input type="number" id="dem-max" value="300" step="1" />
          </div>
        </div>
        <div class="field">
          <label>高程垂直显示倍率：<span id="vs-label" class="mono">1.0×</span></label>
          <input type="range" id="vertical-scale" min="0.5" max="3" step="0.1" value="${s.dem?.verticalScale ?? 1}" />
        </div>
        <button class="primary" id="btn-demo" style="width:100%">生成演示数据（合成影像 + 高程）</button>
        <p class="hint" style="margin:8px 0 0">
          无真实数据时可一键生成带焦黑斑块的合成灾后/灾前影像与山丘高程，用于验证完整流程。
        </p>
      </div>

      <div class="section">
        <h3>本地存储</h3>
        <div class="stack">
          <button id="btn-save">保存工程到浏览器</button>
          <button id="btn-restore" ${hasSavedProject() ? '' : 'disabled'}>恢复上次工程</button>
          <button id="btn-clear" class="ghost">清空本地数据</button>
        </div>
        <p class="hint" style="margin:8px 0 0">
          影像 Blob 存于 IndexedDB，边界、设置与统计存于 localStorage，关闭页面后仍可恢复。
        </p>
      </div>`;
  }

  protected bind(): void {
    const pixelSize = () => Math.max(0.01, Number((this.$('#pixel-size') as HTMLInputElement).value) || 1);

    this.$('#post-file').addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raster = await loadImagery(file, { pixelSize: pixelSize() });
        store.setImagery(raster);
        store.toast(`灾后影像已导入：${file.name}`, 'success');
        this.rerender();
      } catch (err) {
        store.toast(`影像导入失败：${(err as Error).message}`, 'error');
      }
    });

    this.$('#pre-file').addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const raster = await loadPreImagery(file, { pixelSize: pixelSize() });
        store.setPreImagery(raster);
        store.toast(`灾前影像已导入：${file.name}`, 'success');
        this.rerender();
      } catch (err) {
        store.toast(`灾前影像导入失败：${(err as Error).message}`, 'error');
      }
    });

    this.$('#dem-file').addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const dem = await loadDem(file, {
          pixelSize: pixelSize(),
          demMode: 'grayscale',
          demMin: Number((this.$('#dem-min') as HTMLInputElement).value),
          demMax: Number((this.$('#dem-max') as HTMLInputElement).value),
          verticalScale: Number((this.$('#vertical-scale') as HTMLInputElement).value),
        });
        store.setDem(dem);
        store.toast(`DEM 已导入：${file.name}`, 'success');
        this.rerender();
      } catch (err) {
        store.toast(`DEM 导入失败：${(err as Error).message}`, 'error');
      }
    });

    this.$('#vertical-scale').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.$('#vs-label').textContent = `${v.toFixed(1)}×`;
      if (store.state.dem) {
        store.state.dem.verticalScale = v;
        store.emitDemChanged();
      }
    });

    this.$('#btn-demo').addEventListener('click', async () => {
      const ps = pixelSize();
      const post = makeDemoPostImagery();
      const pre = makeDemoPreImagery();
      const dem = makeDemoDem();
      const [postBlob, preBlob, demBlob] = await Promise.all([post.blob, pre.blob, dem.blob]);
      store.setImagery(canvasToRaster(post.canvas, postBlob, 'post', ps));
      store.setPreImagery(canvasToRaster(pre.canvas, preBlob, 'pre', ps));
      store.setDem(
        canvasToRaster(dem.canvas, demBlob, 'dem', ps, {
          dem: dem.dem,
          verticalScale: 1,
        }),
      );
      store.toast('演示数据已生成，可切换到「边界提取」', 'success');
      this.rerender();
    });

    this.$('#btn-save').addEventListener('click', async () => {
      try {
        await saveProject(store.state);
        store.toast('工程已保存到浏览器本地', 'success');
        this.rerender();
      } catch (err) {
        store.toast(`保存失败：${(err as Error).message}`, 'error');
      }
    });

    this.$('#btn-restore').addEventListener('click', () => this.restore());
    this.$('#btn-clear').addEventListener('click', async () => {
      await clearProject();
      store.setBoundary(null);
      store.setImagery(null);
      store.setPreImagery(null);
      store.setDem(null);
      store.toast('本地数据已清空', 'info');
      this.rerender();
    });
  }

  private async restore(): Promise<void> {
    const persisted = loadPersistedState();
    if (!persisted) {
      store.toast('没有可恢复的工程', 'error');
      return;
    }
    await getManifold();
    for (const meta of persisted.rasterMeta) {
      const blob = await restoreBlob(meta.id);
      if (!blob) continue;
      const file = new File([blob], meta.name, { type: blob.type });
      const opts = { pixelSize: meta.pixelSize, origin: meta.origin, verticalScale: meta.verticalScale };
      if (meta.kind === 'dem') {
        const dem = await loadDem(file, { ...opts, demMode: 'grayscale' });
        store.setDem(dem);
      } else if (meta.kind === 'pre') {
        store.setPreImagery(await loadPreImagery(file, opts));
      } else {
        store.setImagery(await loadImagery(file, opts));
      }
    }
    Object.assign(store.state.extract, persisted.extract);
    Object.assign(store.state.display, persisted.display);
    Object.assign(store.state.severity, persisted.severity);
    if (persisted.boundary) store.setBoundary(persisted.boundary);
    store.toast(`已恢复 ${new Date(persisted.savedAt).toLocaleString()} 的工程`, 'success');
    this.rerender();
  }
}
