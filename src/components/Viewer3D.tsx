import { createEffect, onCleanup, onMount } from 'solid-js';
import {
  groove,
  weld,
  layout,
  thermalMap,
  sectionZ,
  setSectionZ,
  peelLayers,
  thermalOn,
  clippingOn,
  selectedBeadId,
} from '../state/store';
import { SceneManager, SelectionInfo } from '../three/sceneManager';

export default function Viewer3D(props: {
  onSelection: (info: SelectionInfo | null) => void;
}) {
  let mountRef: HTMLDivElement | undefined;
  let manager: SceneManager | undefined;

  onMount(() => {
    manager = new SceneManager(mountRef!, props.onSelection);
    manager.onSectionDragged = (z) => setSectionZ(z);
    manager.rebuildGroove(groove);
    manager.rebuildWeld(groove, layout(), weld.penetrationRatio);
    manager.setSectionZ(sectionZ());
    manager.setPeel(peelLayers());
  });

  // 坡口参数变化 -> 仅重建基板; 焊道与截面由下方工艺 effect 统一收口重建
  createEffect(() => {
    const g = groove;
    const sig = [
      g.thickness, g.topWidth, g.rootGap, g.rootLand, g.type, g.uRadius, g.weldLength, g.plateWidth,
    ].join('|');
    if (!manager) return;
    void sig;
    manager.rebuildGroove(g);
  });

  // 焊接工艺或排布结果变化 -> 焊道堆叠重新排布并重算截面
  createEffect(() => {
    // 完整读取依赖,保证层数/道数/坡口/熔深任一变化都能触发
    const result = layout();
    const sig = [
      result.beads.length,
      result.passesPerLayer.join(','),
      result.beadDiameter,
      weld.penetrationRatio,
      groove.type, groove.thickness, groove.topWidth, groove.rootGap,
      groove.rootLand, groove.uRadius, groove.weldLength,
    ].join('|');
    if (!manager) return;
    void sig;
    manager.rebuildWeld(groove, result, weld.penetrationRatio);
  });

  createEffect(() => manager?.setSectionZ(sectionZ()));
  createEffect(() => manager?.setPeel(peelLayers()));
  createEffect(() => manager?.setThermal(thermalOn(), thermalMap()));
  createEffect(() => manager?.setClipping(clippingOn()));
  createEffect(() => {
    manager?.setHighlight(selectedBeadId());
    if (selectedBeadId() === null) props.onSelection(null);
  });

  onCleanup(() => manager?.dispose());

  return <div class="viewer-canvas" ref={mountRef} />;
}
