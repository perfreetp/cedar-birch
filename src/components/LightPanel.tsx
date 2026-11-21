import { useStore } from '../state/store'

/** 单散射点光源 + 渲染参数 */
export function LightPanel() {
  const light = useStore((s) => s.light)
  const setLight = useStore((s) => s.setLight)
  const editTarget = useStore((s) => s.editTarget)
  const setEditTarget = useStore((s) => s.setEditTarget)
  const density = useStore((s) => s.density)
  const setDensity = useStore((s) => s.setDensity)
  const bloom = useStore((s) => s.bloom)
  const setBloom = useStore((s) => s.setBloom)

  return (
    <section className="panel">
      <h2>光照</h2>
      <div className="row">
        <button
          className={editTarget === 'light' ? 'mini active' : 'mini'}
          onClick={() => setEditTarget(editTarget === 'light' ? null : 'light')}
        >
          拖动光源
        </button>
        <span className="hint">
          位置 ({light.pos.map((v) => v.toFixed(1)).join(', ')})
        </span>
      </div>
      <div className="row">
        <span className="lbl">强度</span>
        <input
          type="range"
          min={0}
          max={5}
          step={0.05}
          value={light.intensity}
          onChange={(e) => setLight({ ...light, intensity: Number(e.target.value) })}
        />
        <span className="val">{light.intensity.toFixed(2)}</span>
      </div>
      <div className="row">
        <span className="lbl">环境光</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={light.ambient}
          onChange={(e) => setLight({ ...light, ambient: Number(e.target.value) })}
        />
        <span className="val">{light.ambient.toFixed(2)}</span>
      </div>
      <div className="row">
        <span className="lbl">消光系数</span>
        <input type="range" min={0.5} max={30} step={0.5} value={density} onChange={(e) => setDensity(Number(e.target.value))} />
        <span className="val">{density.toFixed(1)}</span>
      </div>
      <div className="row">
        <span className="lbl">辉光</span>
        <input type="range" min={0} max={2} step={0.05} value={bloom} onChange={(e) => setBloom(Number(e.target.value))} />
        <span className="val">{bloom.toFixed(2)}</span>
      </div>
    </section>
  )
}
