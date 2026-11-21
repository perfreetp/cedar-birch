import { createApp } from 'vue'
import App from './App.vue'
import { store } from './state/store'
import './style.css'

// 自动化测试/调试入口
;(window as unknown as Record<string, unknown>).__dockStore = store

createApp(App).mount('#app')

// 场景实例在 App 挂载后回填，供自动化测试使用
export function registerDockScene(scene: unknown) {
  ;(window as unknown as Record<string, unknown>).__dockScene = scene
}
