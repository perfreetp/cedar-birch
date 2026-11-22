import { BsrElement } from './base';
import { store } from '../store';
import { computeBurnIndex, extractContours, type BurnIndexResult } from '../lib/extraction';
import { unionContours } from '../lib/manifold';
import { ringArea } from '../lib/geometry';

export class PanelExtract extends BsrElement {
  private extracting = false;

  protected render(): string {
    const s = store.state;
    const e = s.extract;
    return `
      <style>${BsrElement.sharedStyle()}</style>
      <div class="section">
        <h3>火烧边界提取</h3>
        <p class="hint" style="margin-top:0">
          基于灾后影像与焦黑参考色的颜色差异计算火烧指数，Marching Squares 追踪等值线，
          再经 manifold 布尔并集消除自交与碎片。
        </p>
        <div class="field">
          <label>参考颜色（焦土色）</label>
          <div class="row">
            <input type="color" id="ref-color" value="${rgbToHex(e.referenceColor)}" />
            <span class="mono muted">rgb(${e.referenceColor.join(', ')})</span>
          </div>
        </div>
        <div class="field">
          <label class="row" style="display:flex">
            <span>Otsu 自动阈值</span>
            <input type="checkbox" id="auto-otsu" ${e.auto ? 'checked' : ''} style="margin-left:auto" />
          </label>
        </div>
        <div class="field">
          <label>火烧指数阈值 <span class="mono" id="thr-label">${e.threshold.toFixed(2)}</span></label>
          <input type="range" id="threshold" min="0.05" max="0.95" step="0.01" value="${e.threshold}" ${e.auto ? 'disabled' : ''} />
        </div>
        <div class="field">
          <label>最小碎片面积 (m²) <span class="mono">${e.minFragmentArea}</span></label>
          <input type="range" id="min-area" min="0" max="5000" step="50" value="${e.minFragmentArea}" />
        </div>
        <div class="field">
          <label>抽稀容差 (m) <span class="mono">${e.simplifyTolerance.toFixed(1)}</span></label>
          <input type="range" id="simplify" min="0" max="20" step="0.5" value="${e.simplifyTolerance}" />
        </div>
        <button class="primary" id="btn-extract" style="width:100%" ${s.imagery ? '' : 'disabled'}>
          ${this.extracting ? '提取中…' : '提取火场边界'}
        </button>
        <div id="extract-info" class="hint" style="margin-top:8px"></div>
      </div>

      <div class="section">
        <h3>提取结果</h3>
        <div id="result-info" class="hint">
          ${s.boundary ? '边界已生成，可在「修边编辑」中调整顶点。' : '尚未提取边界。'}
        </div>
      </div>`;
  }

  protected bind(): void {
    const ensureBurn = (): BurnIndexResult | null => {
      const imagery = store.state.imagery;
      if (!imagery) {
        store.toast('请先在「影像导入」中导入灾后影像', 'error');
        return null;
      }
      if (!store.burnIndex) {
        store.setBurnIndex(
          computeBurnIndex(
            imagery,
            store.state.extract.referenceColor,
            store.state.preImagery,
          ),
        );
      }
      return store.burnIndex;
    };

    this.$('#ref-color').addEventListener('input', (e) => {
      const hex = (e.target as HTMLInputElement).value;
      store.updateExtract({ referenceColor: hexToRgb(hex) });
      store.setBurnIndex(null);
    });

    this.$('#auto-otsu').addEventListener('change', (e) => {
      const auto = (e.target as HTMLInputElement).checked;
      const patch: Partial<typeof store.state.extract> = { auto };
      if (auto && store.burnIndex) patch.threshold = Number(store.burnIndex.otsu.toFixed(2));
      store.updateExtract(patch);
      this.rerender();
    });

    this.$('#threshold').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      store.updateExtract({ threshold: v });
      this.$('#thr-label').textContent = v.toFixed(2);
    });

    this.$('#min-area').addEventListener('input', (e) => {
      store.updateExtract({ minFragmentArea: Number((e.target as HTMLInputElement).value) });
      const label = this.$('#min-area').previousElementSibling?.querySelector('span');
      if (label) label.textContent = `${store.state.extract.minFragmentArea}`;
    });

    this.$('#simplify').addEventListener('input', (e) => {
      store.updateExtract({ simplifyTolerance: Number((e.target as HTMLInputElement).value) });
      const label = this.$('#simplify').previousElementSibling?.querySelector('span');
      if (label) label.textContent = `${store.state.extract.simplifyTolerance.toFixed(1)}`;
    });

    this.$('#btn-extract').addEventListener('click', () => this.runExtract(ensureBurn));
  }

  private async runExtract(ensureBurn: () => BurnIndexResult | null): Promise<void> {
    if (this.extracting) return;
    const burn = ensureBurn();
    if (!burn) return;
    this.extracting = true;
    this.rerender();
    try {
      const { threshold, minFragmentArea, simplifyTolerance, auto } = store.state.extract;
      const effectiveThreshold = auto ? burn.otsu : threshold;
      if (auto) store.updateExtract({ threshold: Number(burn.otsu.toFixed(2)) });

      const contours = extractContours(burn, {
        threshold: effectiveThreshold,
        minFragmentArea,
        simplifyTolerance,
      });

      const info = this.$('#extract-info');
      if (!contours.length) {
        info.textContent = `阈值 ${effectiveThreshold.toFixed(2)} 下未检出火烧区域，请降低阈值或检查参考颜色。`;
        store.setBoundary(null);
        return;
      }

      const totalRaw = contours.reduce((sum, c) => sum + ringArea(c), 0);
      info.innerHTML = `检出 <b>${contours.length}</b> 个斑块，候选总面积约 <b>${(totalRaw / 10000).toFixed(2)} ha</b>，正在执行 manifold 布尔清理…`;

      // manifold 布尔并集：消除自交、合并重叠斑块、simplify 去碎片
      const cleaned = await unionContours(contours, {
        simplifyEpsilon: Math.max(0.5, simplifyTolerance * 0.5),
        minFragmentArea,
      });

      if (cleaned.outer.length < 3) {
        info.textContent = '布尔清理后边界为空，请调小最小碎片面积。';
        store.setBoundary(null);
        return;
      }
      store.setBoundary(cleaned);
      info.innerHTML =
        `Otsu 阈值 <b>${effectiveThreshold.toFixed(2)}</b>，清理后外环 <b>${cleaned.outer.length}</b> 顶点、` +
        `孔洞 <b>${cleaned.holes.length}</b> 个。`;
      store.toast('火场边界提取完成', 'success');
      this.rerender();
    } catch (err) {
      store.toast(`提取失败：${(err as Error).message}`, 'error');
    } finally {
      this.extracting = false;
    }
  }
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
