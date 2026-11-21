import { useAppStore, type PageId } from './store/useAppStore'
import { Viewport3D } from './components/Viewport3D'
import { PlanEditor } from './components/PlanEditor'
import { VentConfig } from './components/VentConfig'
import { SimPanel } from './components/SimPanel'
import { ExportPanel } from './components/ExportPanel'

const STEPS: Array<{ title: string; desc: string }> = [
  { title: '平面布局', desc: '绘制墙体与设备,拖拽位姿' },
  { title: '风口配置', desc: '三维房间内布置送/回风口' },
  { title: '流场评估', desc: '粒子仿真与高度切片' },
  { title: '快照导入导出', desc: '保存与还原工程' },
]

export function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">≋</span>
          洁净车间气流粒子可视化
        </div>
        <nav className="stepper">
          {STEPS.map((step, i) => {
            const id = i as PageId
            const active = page === id
            return (
              <button
                key={step.title}
                className={`step ${active ? 'active' : ''} ${page > id ? 'done' : ''}`}
                onClick={() => setPage(id)}
              >
                <span className="step-no">{i + 1}</span>
                <span className="step-text">
                  <strong>{step.title}</strong>
                  <small>{step.desc}</small>
                </span>
              </button>
            )
          })}
        </nav>
      </header>

      <main className={`main page-${page}`}>
        {page === 0 ? (
          <PlanEditor />
        ) : (
          <div className="three-layout">
            <Viewport3D />
            <div className="side-host">
              {page === 1 && <VentConfig />}
              {page === 2 && <SimPanel />}
              {page === 3 && <ExportPanel />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
