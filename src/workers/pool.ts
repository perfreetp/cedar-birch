// 固定大小的 Worker 池,任务排队轮发
interface Job {
  msg: unknown
  transfer: Transferable[]
  resolve: (v: any) => void
  reject: (e: Error) => void
}

export class WorkerPool {
  private workers: Worker[] = []
  private idle: Worker[] = []
  private queue: Job[] = []
  private pending = new Map<Worker, Job>()

  constructor(size: number) {
    const n = Math.max(1, size)
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./chunkWorker.ts', import.meta.url), { type: 'module' })
      w.onmessage = (e) => {
        const job = this.pending.get(w)
        this.pending.delete(w)
        this.idle.push(w)
        if (job) {
          if (e.data?.type === 'error') job.reject(new Error(e.data.message))
          else job.resolve(e.data)
        }
        this.pump()
      }
      w.onerror = (e) => {
        const job = this.pending.get(w)
        this.pending.delete(w)
        this.idle.push(w)
        job?.reject(new Error(e.message || 'worker error'))
        this.pump()
      }
      this.workers.push(w)
      this.idle.push(w)
    }
  }

  exec(msg: unknown, transfer: Transferable[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({ msg, transfer, resolve, reject })
      this.pump()
    })
  }

  private pump() {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const w = this.idle.pop()!
      const job = this.queue.shift()!
      this.pending.set(w, job)
      w.postMessage(job.msg, job.transfer)
    }
  }
}

let pool: WorkerPool | null = null

export function getPool(): WorkerPool {
  if (!pool) {
    const n = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))
    pool = new WorkerPool(n)
  }
  return pool
}
