// 导出当前剖切位置与层道配置(含每道几何/面积/温度)为 JSON 文件
import { GrooveConfig, WeldConfig, ExportPayload, Bead } from '../types';

export function buildExportPayload(
  groove: GrooveConfig,
  weld: WeldConfig,
  beads: Bead[],
  sectionZ: number,
  peelVisibleLayers: number,
  thermalOverlay: boolean,
  thermalMap: Map<string, number>,
): ExportPayload {
  return {
    tool: 'weld-bead-section-viewer',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    sectionPosition: { z: Number(sectionZ.toFixed(3)), weldLength: groove.weldLength },
    groove: { ...groove },
    weld: { ...weld },
    peelVisibleLayers,
    thermalOverlay,
    beads: beads.map((b) => ({
      id: b.id,
      order: b.order,
      layer: b.layer,
      pass: b.pass,
      cx: Number(b.cx.toFixed(4)),
      cy: Number(b.cy.toFixed(4)),
      r: Number(b.r.toFixed(4)),
      nominalArea: Number(b.nominalArea.toFixed(3)),
      fusionArea: Number(b.fusionArea.toFixed(3)),
      penetrationDepth: Number(b.penetrationDepth.toFixed(3)),
      interpassTemp: thermalMap.has(b.id) ? Number(thermalMap.get(b.id)!.toFixed(1)) : null,
    })),
  };
}

export function downloadJson(payload: ExportPayload) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = payload.exportedAt.replace(/[:.]/g, '-').slice(0, 19);
  a.href = url;
  a.download = `weld-section_L${payload.weld.layerCount}_z${payload.sectionPosition.z}_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
