import { useStore } from '../state/store'

/** 三个正交切面 + 一个自由朝向切面 */
export function SlicePanel() {
  const slices = useStore((s) => s.slices)
  const setSlices = useStore((s) => s.setSlices)
  const editTarget = useStore((s) => s.editTarget)
  const setEditTarget = useStore((s) => s.setEditTarget)
  const tcMode = useStore((s) => s.tcMode)
  const setTcMode = useStore((s) => s.setTcMode)

  const axes = [
    { key: 'x' as const, label: 'X 切面' },
    { key: 'y' as const, label: 'Y 切面' },
    { key: 'z' as const, label: 'Z 切面' },
  ]

  return (
    <section className="panel">
      <h2>切面</h2>
      {axes.map((a) => (
        <div className="row" key={a.key}>
          <label>
            <input
              type="checkbox"
              checked={slices[a.key].enabled}
              onChange={(e) => setSlices({ ...slices, [a.key]: { ...slices[a.key], enabled: e.target.checked } })}
            />
            {a.label}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={slices[a.key].pos}
            disabled={!slices[a.key].enabled}
            onChange={(e) => setSlices({ ...slices, [a.key]: { ...slices[a.key], pos: Number(e.target.value) } })}
          />
        </div>
      ))}

      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={slices.free.enabled}
            onChange={(e) => setSlices({ ...slices, free: { ...slices.free, enabled: e.target.checked } })}
          />
          自由切面
        </label>
        <button
          className={editTarget === 'slice' ? 'mini active' : 'mini'}
          disabled={!slices.free.enabled}
          onClick={() => setEditTarget(editTarget === 'slice' ? null : 'slice')}
        >
          拖动
        </button>
        {editTarget === 'slice' && (
          <button className="mini" onClick={() => setTcMode(tcMode === 'translate' ? 'rotate' : 'translate')}>
            {tcMode === 'translate' ? '平移' : '旋转'}
          </button>
        )}
      </div>
      {(['theta', 'phi', 'offset'] as const).map((k) => (
        <div className="row" key={k}>
          <span className="lbl">{k === 'theta' ? '极角 θ' : k === 'phi' ? '方位角 φ' : '偏移'}</span>
          <input
            type="range"
            min={k === 'offset' ? -1 : 0}
            max={k === 'offset' ? 1 : k === 'theta' ? 180 : 360}
            step={k === 'offset' ? 0.01 : 1}
            value={slices.free[k]}
            disabled={!slices.free.enabled}
            onChange={(e) => setSlices({ ...slices, free: { ...slices.free, [k]: Number(e.target.value) } })}
          />
          <span className="val">{slices.free[k].toFixed(k === 'offset' ? 2 : 0)}</span>
        </div>
      ))}
    </section>
  )
}
