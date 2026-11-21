import { useAppStore } from '../store/useAppStore'
import { MAX_PARTICLES } from '../types'

/** 第 3 页:仿真运行控制 + 高度切片密度 */
export function SimPanel(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const room = useAppStore((s) => s.room)
  const setSettings = useAppStore((s) => s.setSettings)

  return (
    <div className="side-panel panel-scroll">
      <section className="card">
        <h3>流场仿真</h3>
        <div className="btn-row">
          <button
            className={`btn ${settings.running ? 'primary' : ''}`}
            onClick={() => setSettings({ running: !settings.running })}
          >
            {settings.running ? '暂停' : '运行'}
          </button>
        </div>
        <label className="field">
          同屏粒子上限 {settings.targetCount}
          <input
            type="range"
            min={1000}
            max={MAX_PARTICLES}
            step={500}
            value={settings.targetCount}
            onChange={(e) => setSettings({ targetCount: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          流速倍率 {settings.speedMul.toFixed(2)}×
          <input
            type="range"
            min={0.3}
            max={2}
            step={0.05}
            value={settings.speedMul}
            onChange={(e) => setSettings({ speedMul: Number(e.target.value) })}
          />
        </label>
        <p className="hint">粒子从顶棚送风口发射,遇设备绕行,被回风口气动吸收;达到寿命上限后回收重采样。</p>
      </section>

      <section className="card">
        <h3>高度切片</h3>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.sliceEnabled}
            onChange={(e) => setSettings({ sliceEnabled: e.target.checked })}
          />
          启用高度切片查看截面密度
        </label>
        <label className="field">
          切片高度 {settings.sliceHeight.toFixed(2)} m(也可直接拖动视图中的青色球柄)
          <input
            type="range"
            min={0.1}
            max={room.height - 0.1}
            step={0.05}
            value={settings.sliceHeight}
            disabled={!settings.sliceEnabled}
            onChange={(e) => setSettings({ sliceHeight: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          切片带宽 ±{(settings.sliceBand / 2).toFixed(2)} m
          <input
            type="range"
            min={0.1}
            max={1.5}
            step={0.05}
            value={settings.sliceBand}
            disabled={!settings.sliceEnabled}
            onChange={(e) => setSettings({ sliceBand: Number(e.target.value) })}
          />
        </label>
        <div className="legend">
          <span>低</span>
          <div className="legend-bar" />
          <span>高</span>
        </div>
        <p className="hint">热力图按切片带内粒子数对数映射;颜色同时表达粒子停留时间(蓝=新,红=久)。</p>
      </section>

      <section className="card">
        <h3>性能策略</h3>
        <ul className="note-list">
          <li>定长 20000 粒子池 + swap-remove 复用,无逐帧内存分配</li>
          <li>0.8 m 均匀网格空间哈希,碰撞只查邻近 3×3×3 格</li>
          <li>每帧 2 子步积分,单步位移受限,几何上无法穿透设备</li>
          <li>设备拖动经 store 推送 → 空间分块与 OBB 即时重建</li>
        </ul>
      </section>
    </div>
  )
}
