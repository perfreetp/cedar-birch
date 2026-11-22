import { BsrElement } from './base';
import { store } from '../store';
import type { ToastMessage } from '../types';
import './panel-import';
import './panel-extract';
import './panel-edit';
import './panel-stats';
import './view-3d';

const TABS = [
  { id: 'import', label: '影像导入', icon: '①' },
  { id: 'extract', label: '边界提取', icon: '②' },
  { id: 'edit', label: '修边编辑', icon: '③' },
  { id: 'stats', label: '面积统计', icon: '④' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export class BsrApp extends BsrElement {
  private activeTab: TabId = 'import';
  private toasts: Array<{ id: number; msg: ToastMessage }> = [];
  private toastSeq = 0;

  connectedCallback(): void {
    super.connectedCallback();
    store.onToast((msg) => this.pushToast(msg));
  }

  private pushToast(msg: ToastMessage): void {
    const id = ++this.toastSeq;
    this.toasts.push({ id, msg });
    this.renderToasts();
    setTimeout(() => {
      this.toasts = this.toasts.filter((t) => t.id !== id);
      this.renderToasts();
    }, 3600);
  }

  private renderToasts(): void {
    const host = this.root.querySelector('#toasts');
    if (!host) return;
    host.innerHTML = this.toasts
      .map(
        (t) => `
        <div class="toast toast-${t.msg.kind}">${t.msg.text}</div>`,
      )
      .join('');
  }

  protected render(): string {
    return `
      <style>
        ${BsrElement.sharedStyle()}
        :host { display: grid; grid-template-rows: 52px 1fr; height: 100vh; }
        header {
          display: flex; align-items: center; gap: 18px;
          padding: 0 18px;
          background: linear-gradient(90deg, #1a2230, #141b26);
          border-bottom: 1px solid var(--border);
        }
        .brand { font-weight: 700; font-size: 15px; letter-spacing: 1px; }
        .brand em { color: var(--accent); font-style: normal; }
        nav { display: flex; gap: 4px; margin-left: 12px; }
        nav button {
          background: transparent; border: 1px solid transparent;
          border-radius: 8px; padding: 7px 14px; color: var(--fg-dim);
        }
        nav button.active {
          color: var(--fg); background: var(--bg-panel-2);
          border-color: var(--border);
        }
        nav button .icon { color: var(--accent); margin-right: 5px; }
        main {
          display: grid;
          grid-template-columns: 340px 1fr;
          min-height: 0;
        }
        aside {
          background: var(--bg);
          border-right: 1px solid var(--border);
          padding: 14px;
          overflow-y: auto;
        }
        .view-wrap { position: relative; min-width: 0; min-height: 0; }
        #toasts {
          position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
          display: flex; flex-direction: column; gap: 8px; z-index: 40;
          pointer-events: none;
        }
        .toast {
          padding: 8px 16px; border-radius: 8px;
          background: rgba(23,30,40,.96); border: 1px solid var(--border);
          box-shadow: var(--shadow); font-size: 12px;
          animation: slide-in .2s ease-out;
        }
        .toast-error { border-color: var(--danger); color: #ffb3c1; }
        .toast-success { border-color: var(--accent-2); color: #9be3c4; }
        @keyframes slide-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; } }
      </style>
      <header>
        <div class="brand">火烧迹地<em>边界重建</em>工具</div>
        <nav>
          ${TABS.map(
            (t) => `
            <button data-tab="${t.id}" class="${t.id === this.activeTab ? 'active' : ''}">
              <span class="icon">${t.icon}</span>${t.label}
            </button>`,
          ).join('')}
        </nav>
        <div class="spacer" style="flex:1"></div>
        <span class="tag" id="data-tag">未装载数据</span>
      </header>
      <main>
        <aside id="panel-slot">${this.panelMarkup()}</aside>
        <div class="view-wrap">
          <bsr-view3d></bsr-view3d>
          <div id="toasts"></div>
        </div>
      </main>`;
  }

  private panelMarkup(): string {
    switch (this.activeTab) {
      case 'import':
        return '<bsr-panel-import></bsr-panel-import>';
      case 'extract':
        return '<bsr-panel-extract></bsr-panel-extract>';
      case 'edit':
        return '<bsr-panel-edit></bsr-panel-edit>';
      case 'stats':
        return '<bsr-panel-stats></bsr-panel-stats>';
    }
  }

  protected bind(): void {
    this.root.querySelectorAll('nav button').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = (btn as HTMLElement).dataset.tab as TabId;
        this.rerender();
      });
    });
    const refreshTag = () => {
      const tag = this.root.querySelector('#data-tag');
      if (!tag) return;
      const s = store.state;
      const parts: string[] = [];
      if (s.imagery) parts.push('灾后影像');
      if (s.preImagery) parts.push('灾前影像');
      if (s.dem) parts.push('DEM');
      if (s.boundary) parts.push('边界');
      tag.textContent = parts.length ? parts.join(' · ') : '未装载数据';
      tag.classList.toggle('ok', parts.length > 0);
    };
    store.on('imagery-changed', refreshTag);
    store.on('pre-imagery-changed', refreshTag);
    store.on('dem-changed', refreshTag);
    store.on('boundary-changed', refreshTag);
    refreshTag();
  }
}
