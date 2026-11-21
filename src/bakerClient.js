// 切片烘焙 worker 的 Promise 化客户端
import { buildDustLUT } from './colorLUT.js';

export class BakerClient {
  constructor() {
    this.worker = new Worker(new URL('./sliceBaker.worker.js', import.meta.url), { type: 'module' });
    this.jobs = new Map();
    this.jobSeq = 1;
    this.lut = buildDustLUT();
    this.maxTexSize = 4096;
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => {
      for (const { reject } of this.jobs.values()) reject(new Error(e.message));
      this.jobs.clear();
    };
  }

  _onMessage(msg) {
    if (msg.type === 'ready') {
      this.readyResolve?.(msg);
      return;
    }
    const job = this.jobs.get(msg.jobId);
    if (!job) return;
    this.jobs.delete(msg.jobId);
    if (msg.type === 'error') job.reject(new Error(msg.message));
    else job.resolve(msg);
  }

  nextJobId() { return this.jobSeq++; }

  // 转移整个 ArrayBuffer 给 worker（主线程不再保留副本）
  init(header, buffer) {
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.initReject = reject;
      this.worker.postMessage(
        { type: 'init', header, buffer },
        [buffer]
      );
    });
  }

  bake(params) {
    const jobId = this.nextJobId();
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve, reject });
      this.worker.postMessage({
        type: 'bake',
        jobId,
        lut: this.lut,
        maxTexSize: this.maxTexSize,
        ...params,
      });
    });
  }

  sample(frameA, frameB, interp, points) {
    const jobId = this.nextJobId();
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, {
        resolve: (msg) => resolve(new Float32Array(msg.values)),
        reject,
      });
      this.worker.postMessage({
        type: 'sample', jobId, frameA, frameB, interp,
        points: points.buffer ? points : new Float32Array(points),
      });
    });
  }

  stats(frameA, frameB, interp, thresholdNorm) {
    const jobId = this.nextJobId();
    return new Promise((resolve, reject) => {
      this.jobs.set(jobId, { resolve: (msg) => resolve(msg.stats), reject });
      this.worker.postMessage({ type: 'stats', jobId, frameA, frameB, interp, thresholdNorm });
    });
  }

  dispose() {
    this.worker.terminate();
    this.jobs.clear();
  }
}
