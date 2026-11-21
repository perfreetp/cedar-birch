// 渲染层单例:Stage 挂载时注册,导入流程等通过它访问
import type { VolumeManager } from '../volume/VolumeManager'

type ReadyCb = () => void

class Services {
  volume: VolumeManager | null = null
  private readyCbs: ReadyCb[] = []

  setVolume(v: VolumeManager): void {
    this.volume = v
    this.readyCbs.forEach((cb) => cb())
    this.readyCbs = []
  }

  whenVolume(): Promise<void> {
    if (this.volume) return Promise.resolve()
    return new Promise((resolve) => this.readyCbs.push(resolve))
  }
}

export const services = new Services()
