import { BsrElement } from './base';
import { store } from '../store';
import { formatArea, formatLength, formatPercent, formatSlope } from '../lib/format';
import { downloadText, exportBoundaryGeoJSON, importBoundaryGeoJSON } from '../lib/geojson';
import { SEVERITY_LEVELS } from '../lib/geometry';
import { saveProject } from '../lib/storage';
import type { FlatSampler, TerrainSampler } from '../lib/terrain';

export class PanelStats extends BsrElement {
  protected render(): string {
    const stats = store.state.stats;
    const cut = store.state.severity.cutoffs;
    return `
      <style>${BsrElement.sharedStyle()}</style>
      <div class="section">
        <h3>迹地面积与周长</h3>
        <table>
          <tr><th>指标</th><th style="text-align:right">数值</th></tr>
          <tr><td>平面面积</td><td style="text-align:right" class="mono" id="m-planar">—</td></tr>
          <tr><td>贴地表面积</td><td style="text-align:right" class="mono" id="m-surface">—</td></tr>
          <tr><td>边界周长（贴地）</td><td style="text-align:right" class="mono" id="m-perimeter">—</td></tr>
          <tr><td>平均坡度</td><td style="text-align:right" class="mono" id="m-slope">—</td></tr>
          <tr><td>顶点总数</td><td style="text-align:right" class="mono" id="m-verts">—</td></tr>
        </table>
        <p class="hint" style="margin-bottom:0">修边拖动、增删顶点或调整加密间距时实时重算。</p>
      </div>

      <div class="section">
        <h3>受损分级面积</h3>
        <table>
          ${SEVERITY_LEVELS.map(
            (lv) => `
            <tr>
              <td><i class="swatch" style="background:${lv.cssColor}"></i>${lv.label}</td>
              <td style="text-align:right" class="mono" id="s-area-${lv.level}">—</td>
              <td style="text-align:right" class="mono muted" id="s-pct-${lv.level}">—</td>
            </tr>`,
          ).join('')}
        </table>
      </div>

      <div class="section">
        <h3>分级切点（受损指数）</h3>
        ${cut
          .map(
            (v, i) => `
          <div class="field">
            <label>${SEVERITY_LEVELS[i + 1].label} ≥ <span class="mono" id="cut-label-${i}">${v.toFixed(2)}</span></label>
            <input type="range" id="cut-${i}" min="0.05" max="0.95" step="0.01" value="${v}" />
          </div>`,
          )
          .join('')}
      </div>

      <div class="section">
        <h3>GeoJSON 交换</h3>
        <div class="stack">
          <button class="primary" id="btn-export" ${stats ? '' : 'disabled'}>导出边界为 GeoJSON</button>
          <button id="btn-export-3d" ${stats ? '' : 'disabled'}>导出贴地 3D 边界（含高程）</button>
          <button id="btn-import">导入 GeoJSON 边界</button>
          <input type="file" id="import-file" accept=".geojson,.json,application/geo+json" hidden />
        </div>
      </div>

      <div class="section">
        <h3>本地持久化</h3>
        <div class="stack">
          <button id="btn-save">立即保存工程</button>
          <label class="row" style="display:flex">
            <span>编辑后自动保存</span>
            <input type="checkbox" id="auto-save" checked style="margin-left:auto" />
          </label>
        </div>
      </div>`;
  }

  protected bind(): void {
    const refresh = () => this.updateValues();
    store.on('stats-changed', refresh);
    store.on('boundary-changed', refresh);
    this.updateValues();

    for (let i = 0; i < 4; i++) {
      this.$(`#cut-${i}`).addEventListener('input', (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        const cutoffs = [...store.state.severity.cutoffs] as typeof store.state.severity.cutoffs;
        cutoffs[i] = v;
        // 保持切点升序
        for (let k = 1; k < 4; k++) {
          if (cutoffs[k] <= cutoffs[k - 1]) cutoffs[k] = Math.min(0.95, cutoffs[k - 1] + 0.01);
        }
        store.updateSeverity({ cutoffs });
        this.$(`#cut-label-${i}`).textContent = cutoffs[i].toFixed(2);
      });
    }

    this.$('#btn-export').addEventListener('click', () => this.export(false));
    this.$('#btn-export-3d').addEventListener('click', () => this.export(true));
    this.$('#btn-import').addEventListener('click', () => (this.$('#import-file') as HTMLInputElement).click());
    this.$('#import-file').addEventListener('change', (e) => this.importFile(e));

    this.$('#btn-save').addEventListener('click', async () => {
      await saveProject(store.state);
      store.toast('工程已保存', 'success');
    });

    // 自动保存：边界变化后防抖 1.2s
    let timer: number | null = null;
    store.on('boundary-changed', () => {
      const checked = (this.root.querySelector('#auto-save') as HTMLInputElement | null)?.checked;
      if (!checked || !store.state.boundary) return;
      if (timer !== null) clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await saveProject(store.state);
      }, 1200);
    });
  }

  private updateValues(): void {
    const stats = store.state.stats;
    const set = (id: string, text: string) => {
      const el = this.root.querySelector(id);
      if (el) el.textContent = text;
    };
    if (!stats) return;
    set('#m-planar', formatArea(stats.planarArea));
    set('#m-surface', formatArea(stats.surfaceArea));
    set('#m-perimeter', formatLength(stats.perimeter));
    set('#m-slope', formatSlope(stats.meanSlope));
    set('#m-verts', String(stats.vertexCount));

    const total = stats.levelAreas.reduce((s, v) => s + v, 0) || 1;
    stats.levelAreas.forEach((area, i) => {
      set(`#s-area-${i}`, area > 0 ? formatArea(area) : '—');
      set(`#s-pct-${i}`, area > 0 ? formatPercent(area / total) : '—');
    });
  }

  private export(withElevation: boolean): void {
    const boundary = store.state.boundary;
    if (!boundary) return;
    // 通过场景引擎拿地形采样器；无 DEM 时高程为 0
    const view = this.closest('bsr-app')?.shadowRoot?.querySelector('bsr-view3d') as
      | (HTMLElement & { getEngine?: () => { getSampler?: () => TerrainSampler | FlatSampler } })
      | null;
    const sampler = view?.getEngine?.()?.getSampler?.();
    const elev = withElevation && sampler ? (p: { x: number; y: number }) => sampler.elevationAt(p) : undefined;
    const geojson = exportBoundaryGeoJSON(boundary, store.state.stats, elev);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`burn-scar-boundary${withElevation ? '-3d' : ''}-${stamp}.geojson`, geojson);
    store.toast('GeoJSON 已导出', 'success');
  }

  private async importFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const boundary = importBoundaryGeoJSON(text);
      store.setBoundary(boundary);
      store.toast(`已导入边界：${boundary.outer.length} 个外环顶点`, 'success');
      void store.rebuildNow();
    } catch (err) {
      store.toast(`GeoJSON 导入失败：${(err as Error).message}`, 'error');
    }
  }
}
