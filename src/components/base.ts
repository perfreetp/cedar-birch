/** 组件基类：Shadow DOM + 共享暗色样式注入 */
export abstract class BsrElement extends HTMLElement {
  protected root: ShadowRoot;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.root.innerHTML = this.render();
    this.bind();
  }

  /** 重渲染局部内容（保留 Shadow DOM 结构，简单场景足够） */
  protected rerender(): void {
    this.root.innerHTML = this.render();
    this.bind();
  }

  protected abstract render(): string;
  protected abstract bind(): void;

  protected $(selector: string): HTMLElement {
    const el = this.root.querySelector(selector);
    if (!el) throw new Error(`元素未找到: ${selector}`);
    return el as HTMLElement;
  }

  protected $all(selector: string): HTMLElement[] {
    return Array.from(this.root.querySelectorAll(selector)) as HTMLElement[];
  }

  protected static sharedStyle(): string {
    return `
      :host {
        display: block;
        height: 100%;
        color: var(--fg);
        font-size: 13px;
      }
      button {
        font: inherit;
        color: var(--fg);
        background: var(--bg-panel-2);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 6px 10px;
        cursor: pointer;
      }
      button:hover:not(:disabled) { background: #2a384a; border-color: #3d5068; }
      button:disabled { opacity: .4; cursor: not-allowed; }
      button.primary { background: var(--accent); border-color: var(--accent); color: #1a1008; font-weight: 600; }
      button.primary:hover:not(:disabled) { background: #ff9164; }
      button.tiny { padding: 2px 8px; font-size: 12px; }
      input, select {
        background: var(--bg); color: var(--fg);
        border: 1px solid var(--border); border-radius: 5px;
        padding: 5px 7px; font: inherit;
      }
      input[type="range"] { accent-color: var(--accent); padding: 0; }
      input[type="number"] { width: 100%; }
      label { color: var(--fg-dim); }
      .muted { color: var(--fg-dim); }
      .mono { font-family: 'Cascadia Code', Consolas, monospace; }
      h3 {
        margin: 0 0 10px; font-size: 13px; font-weight: 600;
        color: var(--fg); letter-spacing: .5px;
        display: flex; align-items: center; gap: 8px;
      }
      h3::before {
        content: ''; width: 3px; height: 14px;
        background: var(--accent); border-radius: 2px;
      }
      .section {
        background: var(--bg-panel);
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 14px;
      }
      .section + .section { margin-top: 12px; }
      .field { margin-bottom: 10px; }
      .field label { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 12px; }
      .row { display: flex; gap: 8px; align-items: center; }
      .stack { display: flex; flex-direction: column; gap: 8px; }
      .tag {
        display: inline-block; padding: 1px 7px; border-radius: 10px;
        font-size: 11px; background: var(--bg-panel-2);
        border: 1px solid var(--border); color: var(--fg-dim);
      }
      .tag.ok { color: var(--accent-2); border-color: rgba(54,179,126,.5); }
      table { width: 100%; border-collapse: collapse; }
      td, th { padding: 5px 4px; border-bottom: 1px solid var(--border); text-align: left; }
      th { color: var(--fg-dim); font-weight: 500; }
      .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }
      .hint { font-size: 11px; color: var(--fg-dim); line-height: 1.5; }
      .file-name {
        font-size: 11px; color: var(--accent-2);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;
      }
    `;
  }
}
