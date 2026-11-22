import { BsrElement } from './base';
import { store } from '../store';
import { SEVERITY_LEVELS } from '../lib/geometry';

export class PanelEdit extends BsrElement {
  protected render(): string {
    const d = store.state.display;
    const hasBoundary = !!store.state.boundary;
    return `
      <style>${BsrElement.sharedStyle()}</style>
      <div class="section">
        <h3>修边编辑</h3>
        <div class="stack">
          <div class="row">
            <button id="btn-undo" ${store.canUndo ? '' : 'disabled'} style="flex:1">↶ 撤销</button>
            <button id="btn-redo" ${store.canRedo ? '' : 'disabled'} style="flex:1">↷ 重做</button>
          </div>
          <button id="btn-rebuild" class="primary" ${hasBoundary ? '' : 'disabled'}>立即执行 manifold 重建</button>
        </div>
        <p class="hint" style="margin-bottom:0">
          · 拖动白色顶点：实时 earcut 重新三角化，松手后 manifold 布尔清理自交<br/>
          · 双击边界边线：在该处插入新顶点<br/>
          · 右键点击顶点手柄：删除该顶点<br/>
          · 快捷键：Ctrl+Z 撤销，Ctrl+Y / Ctrl+Shift+Z 重做
        </p>
      </div>

      <div class="section">
        <h3>显示模式</h3>
        <div class="row" style="margin-bottom:12px">
          <button id="mode-draped" class="${d.draped ? 'primary' : ''}" style="flex:1">贴地显示</button>
          <button id="mode-lift" class="${d.draped ? '' : 'primary'}" style="flex:1">抬升显示</button>
        </div>
        <div class="field">
          <label>抬升高度 (m) <span class="mono" id="lift-label">${d.liftHeight}</span></label>
          <input type="range" id="lift" min="5" max="200" step="1" value="${d.liftHeight}" ${d.draped ? 'disabled' : ''} />
        </div>
        <div class="field">
          <label>坡度加密间距 (m) <span class="mono" id="dens-label">${d.densifySpacing}</span></label>
          <input type="range" id="densify" min="2" max="60" step="1" value="${d.densifySpacing}" />
        </div>
        <div class="field">
          <label>边界不透明度 <span class="mono" id="op-label">${Math.round(d.fillOpacity * 100)}%</span></label>
          <input type="range" id="opacity" min="0.1" max="1" step="0.05" value="${d.fillOpacity}" />
        </div>
      </div>

      <div class="section">
        <h3>受损分级图例</h3>
        <table>
          ${SEVERITY_LEVELS.map(
            (lv) => `
            <tr>
              <td><i class="swatch" style="background:${lv.cssColor}"></i>${lv.label}</td>
              <td style="text-align:right" class="muted mono" id="lv-area-${lv.level}">—</td>
            </tr>`,
          ).join('')}
        </table>
        <p class="hint" style="margin-bottom:0">分级切点可在「面积统计」中调整。</p>
      </div>`;
  }

  protected bind(): void {
    this.$('#btn-undo').addEventListener('click', () => store.undo());
    this.$('#btn-redo').addEventListener('click', () => store.redo());

    this.$('#btn-rebuild').addEventListener('click', () => {
      void store.rebuildNow().then(() => store.toast('manifold 布尔重建完成', 'success'));
    });

    this.$('#mode-draped').addEventListener('click', () => store.updateDisplay({ draped: true }));
    this.$('#mode-lift').addEventListener('click', () => store.updateDisplay({ draped: false }));

    this.$('#lift').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.$('#lift-label').textContent = `${v}`;
      store.updateDisplay({ liftHeight: v });
    });
    this.$('#densify').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.$('#dens-label').textContent = `${v}`;
      store.updateDisplay({ densifySpacing: v });
    });
    this.$('#opacity').addEventListener('input', (e) => {
      const v = Number((e.target as HTMLInputElement).value);
      this.$('#op-label').textContent = `${Math.round(v * 100)}%`;
      store.updateDisplay({ fillOpacity: v });
    });

    store.on('edit-history-changed', () => this.rerender());
    store.on('display-changed', () => this.rerender());
    store.on('stats-changed', () => this.updateLevelAreas());
    this.updateLevelAreas();

    // 键盘快捷键（局部，避免输入框中触发）
    window.addEventListener('keydown', this.onKey);
  }

  private onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) store.redo();
      else store.undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      store.redo();
    }
  };

  private updateLevelAreas(): void {
    const stats = store.state.stats;
    if (!stats) return;
    stats.levelAreas.forEach((area, i) => {
      const el = this.root.querySelector(`#lv-area-${i}`);
      if (el) {
        el.textContent = area > 0 ? `${(area / 10000).toFixed(2)} ha` : '—';
      }
    });
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.onKey);
  }
}
