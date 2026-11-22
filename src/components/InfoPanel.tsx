import { SelectionInfo } from '../three/sceneManager';
import { thermalBinOf } from '../weld/thermal';
import { setSelectedBeadId } from '../state/store';

export default function InfoPanel(props: { info: SelectionInfo | null }) {
  const info = () => props.info;
  return (
    <div class="panel info-panel">
      <h2>焊道信息</h2>
      {info() === null ? (
        <p class="hint">在剖面上点击任意焊道截面,查看层号、道号与截面积。</p>
      ) : (
        <div class="info-grid">
          <div class="info-row">
            <span>焊道编号</span>
            <strong>{info()!.bead.id}</strong>
          </div>
          <div class="info-row">
            <span>层号(打底=1)</span>
            <strong>第 {info()!.bead.layer + 1} 层</strong>
          </div>
          <div class="info-row">
            <span>道号(层内)</span>
            <strong>第 {info()!.bead.pass + 1} 道</strong>
          </div>
          <div class="info-row">
            <span>施焊顺序</span>
            <strong>第 {info()!.bead.order + 1} 道</strong>
          </div>
          <div class="info-row">
            <span>焊道半径</span>
            <strong>{info()!.bead.r.toFixed(2)} mm</strong>
          </div>
          <div class="info-row">
            <span>熔深</span>
            <strong>{info()!.bead.penetrationDepth.toFixed(2)} mm</strong>
          </div>
          <div class="info-row">
            <span>标称截面积 πr²</span>
            <strong>{info()!.nominalArea.toFixed(2)} mm²</strong>
          </div>
          <div class="info-row highlight-row">
            <span>当前剖面截面积</span>
            <strong>{info()!.sectionArea.toFixed(2)} mm²</strong>
          </div>
          <div class="info-row">
            <span>熔合边界内面积</span>
            <strong>{info()!.bead.fusionArea.toFixed(2)} mm²</strong>
          </div>
          {info()!.interpassTemp !== null && (
            <div class="info-row">
              <span>道间温度</span>
              <strong>
                <span
                  class="temp-dot"
                  style={{ background: thermalBinOf(info()!.interpassTemp!).css }}
                />
                {info()!.interpassTemp!.toFixed(0)} °C
              </strong>
            </div>
          )}
          <button class="btn" onClick={() => setSelectedBeadId(null)}>
            取消选中
          </button>
        </div>
      )}
    </div>
  );
}
