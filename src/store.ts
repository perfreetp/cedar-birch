import type {
  AppEventType,
  AppState,
  Boundary,
  DisplaySettings,
  ExtractSettings,
  Pt,
  QueryInfo,
  RasterImage,
  Rings,
  SeveritySettings,
  Stats,
  ToastMessage,
} from './types';
import { cleanBoundary } from './lib/manifold';
import type { BurnIndexResult } from './lib/extraction';

type Listener = () => void;
type ToastListener = (t: ToastMessage) => void;

const DEFAULT_EXTRACT: ExtractSettings = {
  threshold: 0.5,
  auto: true,
  minFragmentArea: 200,
  simplifyTolerance: 2,
  referenceColor: [38, 30, 26],
};

const DEFAULT_DISPLAY: DisplaySettings = {
  draped: true,
  liftHeight: 30,
  densifySpacing: 12,
  fillOpacity: 0.55,
};

const DEFAULT_SEVERITY: SeveritySettings = {
  cutoffs: [0.2, 0.4, 0.6, 0.8],
};

const EMPTY_STATS: Stats = {
  planarArea: 0,
  surfaceArea: 0,
  perimeter: 0,
  levelAreas: [0, 0, 0, 0, 0],
  meanSlope: 0,
  vertexCount: 0,
};

export class Store {
  readonly state: AppState = {
    imagery: null,
    preImagery: null,
    dem: null,
    boundary: null,
    extract: { ...DEFAULT_EXTRACT },
    display: { ...DEFAULT_DISPLAY },
    severity: { cutoffs: [...DEFAULT_SEVERITY.cutoffs] as SeveritySettings['cutoffs'] },
    stats: null,
    query: null,
    hasData: false,
  };

  /** 正在编辑的环（修边作用于此结构） */
  rings: Rings | null = null;

  /** 最近一次计算的火烧指数网格（非持久化，供场景分级渲染与查询） */
  burnIndex: BurnIndexResult | null = null;

  setBurnIndex(burn: BurnIndexResult | null): void {
    this.burnIndex = burn;
    this.emit('burn-changed');
  }

  private listeners = new Map<AppEventType, Set<Listener>>();
  private toastListeners = new Set<ToastListener>();
  private undoStack: Rings[] = [];
  private redoStack: Rings[] = [];
  private rebuildTimer: number | null = null;
  private rebuilding = false;

  on(event: AppEventType, fn: Listener): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  onToast(fn: ToastListener): () => void {
    this.toastListeners.add(fn);
    return () => this.toastListeners.delete(fn);
  }

  private emit(event: AppEventType): void {
    this.listeners.get(event)?.forEach((fn) => fn());
  }

  toast(text: string, kind: ToastMessage['kind'] = 'info'): void {
    this.toastListeners.forEach((fn) => fn({ text, kind }));
  }

  // ---------- 数据导入 ----------

  setImagery(r: RasterImage | null): void {
    this.state.imagery = r;
    this.state.hasData = !!(r || this.state.dem);
    this.setBurnIndex(null);
    this.emit('imagery-changed');
  }

  setPreImagery(r: RasterImage | null): void {
    this.state.preImagery = r;
    this.setBurnIndex(null);
    this.emit('pre-imagery-changed');
  }

  setDem(r: RasterImage | null): void {
    this.state.dem = r;
    this.state.hasData = !!(r || this.state.imagery);
    this.emit('dem-changed');
  }

  /** DEM 参数（如垂直倍率）就地修改后手动通知刷新 */
  emitDemChanged(): void {
    this.emit('dem-changed');
  }

  // ---------- 提取 / 显示 / 分级设置 ----------

  updateExtract(patch: Partial<ExtractSettings>): void {
    Object.assign(this.state.extract, patch);
    this.emit('extract-changed');
  }

  updateDisplay(patch: Partial<DisplaySettings>): void {
    Object.assign(this.state.display, patch);
    this.emit('display-changed');
  }

  updateSeverity(patch: Partial<SeveritySettings>): void {
    Object.assign(this.state.severity, patch);
    this.emit('severity-changed');
  }

  setStats(stats: Stats | null): void {
    this.state.stats = stats;
    this.emit('stats-changed');
  }

  setQuery(q: QueryInfo | null): void {
    this.state.query = q;
    this.emit('query-changed');
  }

  // ---------- 边界 ----------

  /** 提取/导入后直接设置已清理的边界，并重置编辑环与历史 */
  setBoundary(boundary: Boundary | null): void {
    this.state.boundary = boundary;
    this.rings = boundary ? { outer: boundary.outer.map((p) => ({ ...p })), holes: boundary.holes.map((h) => h.map((p) => ({ ...p }))) } : null;
    this.undoStack = [];
    this.redoStack = [];
    this.emit('boundary-changed');
    this.emit('edit-history-changed');
  }

  /** 场景完成重建后回写清理结果（不重置编辑环） */
  commitCleanedBoundary(boundary: Boundary): void {
    this.state.boundary = boundary;
    this.emit('boundary-changed');
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private pushHistory(): void {
    if (!this.rings) return;
    this.undoStack.push(cloneRings(this.rings));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.emit('edit-history-changed');
  }

  /**
   * 编辑环发生变化（拖动/增删顶点）：立即更新编辑态并防抖调度 manifold 重建。
   * 拖动过程中场景使用 earcut 即时三角化，重建完成后切换为 manifold 结果。
   */
  editRings(mutator: (rings: Rings) => void): void {
    if (!this.rings) return;
    this.pushHistory();
    mutator(this.rings);
    this.emit('boundary-changed');
    this.scheduleRebuild();
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.rings) return;
    this.redoStack.push(cloneRings(this.rings));
    this.rings = cloneRings(prev);
    this.emit('boundary-changed');
    this.emit('edit-history-changed');
    this.scheduleRebuild();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next || !this.rings) return;
    this.undoStack.push(cloneRings(this.rings));
    this.rings = cloneRings(next);
    this.emit('boundary-changed');
    this.emit('edit-history-changed');
    this.scheduleRebuild();
  }

  /** 立即执行一次 manifold 布尔清理（防抖 180ms，拖动结束后收敛） */
  scheduleRebuild(): void {
    if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      void this.rebuildNow();
    }, 180);
  }

  async rebuildNow(): Promise<void> {
    if (this.rebuilding || !this.rings || this.rings.outer.length < 3) return;
    this.rebuilding = true;
    try {
      const cleaned = await cleanBoundary(
        cloneRings(this.rings),
        {
          simplifyEpsilon: Math.max(0.5, this.state.extract.simplifyTolerance * 0.5),
          minFragmentArea: this.state.extract.minFragmentArea,
        },
      );
      if (cleaned.outer.length >= 3) {
        this.commitCleanedBoundary(cleaned);
        // 编辑环同步为清理后的环（保留用户后续编辑基准）
        this.rings = {
          outer: cleaned.outer.map((p) => ({ ...p })),
          holes: cleaned.holes.map((h) => h.map((p) => ({ ...p }))),
        };
      } else {
        this.toast('清理后边界为空，请调整修边', 'error');
      }
    } catch (err) {
      this.toast(`边界重建失败：${(err as Error).message}`, 'error');
    } finally {
      this.rebuilding = false;
    }
  }

  emptyStats(): Stats {
    return { ...EMPTY_STATS, levelAreas: [...EMPTY_STATS.levelAreas] };
  }
}

function cloneRings(rings: Rings): Rings {
  return {
    outer: rings.outer.map((p) => ({ ...p })),
    holes: rings.holes.map((h) => h.map((p: Pt) => ({ ...p }))),
  };
}

export const store = new Store();
