import { Modal } from './controls.tsx'

const SHORTCUTS: [string, string][] = [
  ['空格', '播放 / 暂停'],
  ['R', '重置仿真'],
  ['Ctrl + Z', '撤销'],
  ['Ctrl + Shift + Z', '重做'],
  ['Ctrl + D', '复制选中物体'],
  ['Delete', '删除选中物体'],
  ['Enter', '闭合正在绘制的多边形'],
  ['Backspace', '撤回上一个绘制点'],
  ['Esc', '取消绘制 / 取消选中'],
]

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="使用说明" onClose={onClose} narrow footer={<button className="btn" onClick={onClose}>知道了</button>}>
      <div className="hint">
        站台客流热力仿真工具 · 数据全部保存在浏览器本地，可通过「导出」生成可分享的仿真包。
      </div>
      <div>
        <div className="section-head" style={{ padding: '0 0 6px', borderBottom: 'none', background: 'transparent', cursor: 'default' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>快捷键</span>
        </div>
        {SHORTCUTS.map(([k, v]) => (
          <div className="hud-kv" key={k}>
            <span className="k" style={{ fontFamily: 'var(--mono)', color: 'var(--text-2)' }}>{k}</span>
            <span className="v" style={{ fontFamily: 'var(--font)' }}>{v}</span>
          </div>
        ))}
      </div>
      <div className="divider" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div className="hud-kv"><span className="k">热力栅格</span><span className="v">512 × 512 · 200 ms/帧</span></div>
        <div className="hud-kv"><span className="k">色带分档</span><span className="v">0.5 / 1.5 / 2.6 / 3.8 / 4.9 / 6.0 人/m²</span></div>
        <div className="hud-kv"><span className="k">同时在场上限</span><span className="v">20,000 人</span></div>
        <div className="hud-kv"><span className="k">避让</span><span className="v">three-mesh-bvh 扇形射线</span></div>
      </div>
      <div className="hint">
        提示：在「回放」模式下调整闸机权重，会从当前帧向后联动重算；之前的帧保留，便于对比限流前后的差异。
      </div>
    </Modal>
  )
}
