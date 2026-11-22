import './styles.css';
import { BsrApp } from './components/bsr-app';
import { BsrView3d } from './components/view-3d';
import { PanelImport } from './components/panel-import';
import { PanelExtract } from './components/panel-extract';
import { PanelEdit } from './components/panel-edit';
import { PanelStats } from './components/panel-stats';
import { getManifold } from './lib/manifold';
import { unionContours, cleanBoundary } from './lib/manifold';
import { store } from './store';
import { exportBoundaryGeoJSON } from './lib/geojson';
import { saveProject } from './lib/storage';
import { computeBurnIndex, extractContours } from './lib/extraction';

customElements.define('bsr-app', BsrApp);
customElements.define('bsr-view3d', BsrView3d);
customElements.define('bsr-panel-import', PanelImport);
customElements.define('bsr-panel-extract', PanelExtract);
customElements.define('bsr-panel-edit', PanelEdit);
customElements.define('bsr-panel-stats', PanelStats);

// 自动化测试/外部集成的调试句柄
(window as unknown as {
  __BSR_STORE__?: unknown;
  __BSR_DEBUG__?: unknown;
}).__BSR_STORE__ = store;
(window as unknown as { __BSR_DEBUG__?: unknown }).__BSR_DEBUG__ = {
  exportGeoJSON: () =>
    exportBoundaryGeoJSON(store.state.boundary!, store.state.stats, undefined),
  save: () => saveProject(store.state),
  async runExtract() {
    const imagery = store.state.imagery!;
    const burn = computeBurnIndex(imagery, store.state.extract.referenceColor, store.state.preImagery);
    const contours = extractContours(burn, {
      threshold: burn.otsu,
      minFragmentArea: store.state.extract.minFragmentArea,
      simplifyTolerance: store.state.extract.simplifyTolerance,
    });
    const cleaned = await unionContours(contours, {
      simplifyEpsilon: Math.max(0.5, store.state.extract.simplifyTolerance * 0.5),
      minFragmentArea: store.state.extract.minFragmentArea,
    });
    return { contourCount: contours.length, outer: cleaned.outer.length, holes: cleaned.holes.length };
  },
  async testCrossSection() {
    const M = await getManifold();
    const cs = new M.CrossSection([[[0, 0], [10, 0], [10, 10], [0, 10]]], 'Positive');
    const polys = cs.toPolygons();
    return { polyCount: polys.length, firstVerts: polys[0]?.length };
  },
  cleanBoundary,
};

// 预热 manifold wasm，首次提取/修边时无等待
getManifold().catch((err) => console.error('manifold 初始化失败', err));
