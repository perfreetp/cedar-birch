import { useAppStore } from '../store/useAppStore'
import { useUiStore } from '../store/useUiStore'
import { returnVentWorldPos, wallLength } from '../lib/geometry'
import type { SpeedGear, WallName } from '../types'
import { SPEED_GEAR_TO_MS } from '../types'

const GEARS: SpeedGear[] = [1, 2, 3, 4, 5]
const WALL_LABEL: Record<WallName, string> = {
  west: '西墙',
  east: '东墙',
  north: '北墙',
  south: '南墙',
}

/** 第 2 页:送风口档位/方向 + 侧墙回风口自动对齐管理 */
export function VentConfig(): React.JSX.Element {
  const supplies = useAppStore((s) => s.supplies)
  const returns = useAppStore((s) => s.returns)
  const room = useAppStore((s) => s.room)
  const updateSupply = useAppStore((s) => s.updateSupply)
  const updateReturn = useAppStore((s) => s.updateReturn)
  const addReturn = useAppStore((s) => s.addReturn)
  const removeReturn = useAppStore((s) => s.removeReturn)
  const selectedId = useUiStore((s) => s.selectedSupplyId)
  const selectSupply = useUiStore((s) => s.selectSupply)

  const selected = supplies.find((v) => v.id === selectedId) ?? supplies[0] ?? null

  return (
    <div className="side-panel panel-scroll">
      <section className="card">
        <h3>顶棚送风口 ({supplies.length})</h3>
        <p className="hint">在三维视图中点击青色风口,或在下方列表选择</p>
        <div className="vent-list">
          {supplies.map((v, i) => (
            <div
              key={v.id}
              className={`vent-row ${selected?.id === v.id ? 'selected' : ''}`}
              onClick={() => selectSupply(v.id)}
            >
              <span>#{i + 1} · 档位 {v.gear}</span>
              <span className="muted">
                ({v.x.toFixed(1)}, {v.z.toFixed(1)})
              </span>
            </div>
          ))}
        </div>
      </section>

      {selected && (
        <section className="card">
          <h3>风口参数</h3>
          <label className="field">
            送风速度档位 → {SPEED_GEAR_TO_MS[selected.gear].toFixed(2)} m/s
            <div className="gear-row">
              {GEARS.map((g) => (
                <button
                  key={g}
                  className={`gear ${selected.gear === g ? 'active' : ''}`}
                  onClick={() => updateSupply(selected.id, { gear: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </label>
          <label className="field">
            方向方位角 {selected.azimuth}°(0=北,顺时针)
            <input
              type="range"
              min={-180}
              max={180}
              value={selected.azimuth}
              onChange={(e) => updateSupply(selected.id, { azimuth: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            倾角 {selected.tilt}°(0=垂直向下)
            <input
              type="range"
              min={0}
              max={60}
              value={selected.tilt}
              onChange={(e) => updateSupply(selected.id, { tilt: Number(e.target.value) })}
            />
          </label>
          <div className="grid-2">
            <label className="field">
              X(m)
              <input
                type="number"
                step={0.1}
                value={Number(selected.x.toFixed(2))}
                onChange={(e) => updateSupply(selected.id, { x: Number(e.target.value) })}
              />
            </label>
            <label className="field">
              Z(m)
              <input
                type="number"
                step={0.1}
                value={Number(selected.z.toFixed(2))}
                onChange={(e) => updateSupply(selected.id, { z: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>
      )}

      <section className="card">
        <h3>侧墙回风口 ({returns.length})</h3>
        <p className="hint">位置自动贴合墙面平面,仅需设置沿墙位置与高度</p>
        <div className="vent-list">
          {returns.map((r) => {
            const [wx, wy, wz] = returnVentWorldPos(r, room)
            return (
              <div key={r.id} className="return-block">
                <div className="return-head">
                  <strong>{WALL_LABEL[r.wall]}</strong>
                  <button className="btn-mini danger" onClick={() => removeReturn(r.id)}>删除</button>
                </div>
                <label className="field">
                  沿墙位置 {r.along.toFixed(2)} m / {wallLength(r.wall, room).toFixed(1)} m
                  <input
                    type="range"
                    min={0}
                    max={wallLength(r.wall, room)}
                    step={0.1}
                    value={r.along}
                    onChange={(e) => updateReturn(r.id, { along: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  中心高度 {r.y.toFixed(2)} m
                  <input
                    type="range"
                    min={0.2}
                    max={room.height - 0.2}
                    step={0.05}
                    value={r.y}
                    onChange={(e) => updateReturn(r.id, { y: Number(e.target.value) })}
                  />
                </label>
                <div className="grid-2">
                  <label className="field">
                    宽(m)
                    <input
                      type="number"
                      step={0.1}
                      min={0.3}
                      value={r.width}
                      onChange={(e) => updateReturn(r.id, { width: Number(e.target.value) })}
                    />
                  </label>
                  <label className="field">
                    高(m)
                    <input
                      type="number"
                      step={0.1}
                      min={0.2}
                      value={r.height}
                      onChange={(e) => updateReturn(r.id, { height: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <span className="muted">
                  世界坐标 ({wx.toFixed(2)}, {wy.toFixed(2)}, {wz.toFixed(2)})
                </span>
              </div>
            )
          })}
        </div>
        <div className="wall-add-row">
          {(['west', 'east', 'north', 'south'] as WallName[]).map((w) => (
            <button key={w} className="btn-mini" onClick={() => addReturn(w)}>
              + {WALL_LABEL[w]}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
