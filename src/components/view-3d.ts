import { BsrElement } from './base';
import { store } from '../store';
import { SceneEngine } from '../three/scene3d';
import { formatSlope } from '../lib/format';

export class BsrView3d extends BsrElement {
  private engine: SceneEngine | null = null;
  private disposers: Array<() => void> = [];

  protected render(): string {
    return `
      <style>
        ${BsrElement.sharedStyle()}
        :host { position: absolute; inset: 0; }
        #container { position: absolute; inset: 0; }
        #container canvas { display: block; }
        #query-card {
          position: absolute; right: 16px; bottom: 16px; width: 250px;
          background: rgba(23,30,40,.95); border: 1px solid var(--border);
          border-radius: 10px; padding: 12px 14px; display: none;
          box-shadow: var(--shadow); z-index: 20;
        }
        #query-card.visible { display: block; }
        #query-card h4 { margin: 0 0 8px; font-size: 13px; }
        #query-card .kv { display: flex; justify-content: space-between; margin: 4px 0; font-size: 12px; }
        #mode-badge {
          position: absolute; left: 16px; top: 14px; z-index: 10;
          padding: 5px 12px; border-radius: 16px; font-size: 12px;
          background: rgba(23,30,40,.9); border: 1px solid var(--border);
        }
        #edit-badge {
          position: absolute; left: 16px; bottom: 16px; z-index: 10;
          padding: 5px 12px; border-radius: 16px; font-size: 11px;
          background: rgba(23,30,40,.9); border: 1px solid var(--border);
          color: var(--fg-dim);
        }
      </style>
      <div id="container"></div>
      <div id="mode-badge">贴地显示</div>
      <div id="edit-badge">拖拽白色顶点修边 · 双击边线插入顶点 · 点击边界查询</div>
      <div id="query-card"></div>`;
  }

  protected bind(): void {
    const container = this.$('#container');
    this.engine = new SceneEngine(container);

    const refreshTerrain = () => {
      this.engine!.setTerrain(store.state.dem, store.state.imagery);
      if (store.rings) this.engine!.rebuildBoundary(store.rings);
    };
    const refreshBoundary = () => {
      if (store.rings) this.engine!.rebuildBoundary(store.rings);
    };
    const refreshDisplay = () => {
      this.engine!.refreshDisplayMode();
      const badge = this.$('#mode-badge');
      badge.textContent = store.state.display.draped ? '贴地显示' : `抬升显示 (+${store.state.display.liftHeight}m)`;
    };
    const refreshQuery = () => this.renderQueryCard();
    const refreshBurn = () => {
      this.engine!.setBurnIndex(store.burnIndex);
      if (store.rings) this.engine!.rebuildBoundary(store.rings);
    };
    const refreshSeverity = () => {
      if (store.rings) this.engine!.rebuildBoundary(store.rings);
    };

    this.disposers.push(
      store.on('imagery-changed', refreshTerrain),
      store.on('dem-changed', refreshTerrain),
      store.on('boundary-changed', refreshBoundary),
      store.on('display-changed', refreshDisplay),
      store.on('severity-changed', refreshSeverity),
      store.on('burn-changed', refreshBurn),
      store.on('query-changed', refreshQuery),
    );

    // 初始装载（恢复工程时 store 已有数据）
    refreshTerrain();
    this.engine.setBurnIndex(store.burnIndex);
    refreshDisplay();
  }

  getEngine(): SceneEngine | null {
    return this.engine;
  }

  private renderQueryCard(): void {
    const card = this.root.querySelector('#query-card') as HTMLElement;
    const q = store.state.query;
    if (!q) {
      card.classList.remove('visible');
      return;
    }
    card.classList.add('visible');
    card.innerHTML = `
      <h4>边界点查询</h4>
      <div class="kv"><span>坐标 (x, y)</span><span class="mono">${q.point.x.toFixed(1)}, ${q.point.y.toFixed(1)} m</span></div>
      <div class="kv"><span>高程</span><span class="mono">${q.elevation.toFixed(2)} m</span></div>
      <div class="kv"><span>坡度</span><span class="mono">${formatSlope(q.slope)}</span></div>
      <div class="kv"><span>受损指数</span><span class="mono">${(q.damageIndex * 100).toFixed(1)}%</span></div>
      <div class="kv"><span>受损等级</span>
        <span><i class="swatch" style="background:${q.severity.cssColor}"></i>${q.severity.label}</span>
      </div>`;
  }

  disconnectedCallback(): void {
    this.disposers.forEach((d) => d());
    this.engine?.dispose();
    this.engine = null;
  }
}
