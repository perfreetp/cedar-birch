/// <reference lib="webworker" />
// 体数据块处理 Worker:解析提取 / 归一化 / 按传输函数烘焙
// 所有消息携带 jobId,结果原样带回。

interface ExtractMsg {
  type: 'extract'
  jobId: number
  chunkId: number
  payload: ArrayBuffer // Float32Array,4*n,通道主序 u|v|w|t
}

interface NormalizeMsg {
  type: 'normalize'
  jobId: number
  chunkId: number
  rg: ArrayBuffer // Float32Array,2*n (temp, speed)
  ranges: [number, number, number, number] // tMin,tMax,sMin,sMax
}

interface BakeMsg {
  type: 'bake'
  jobId: number
  chunkId: number
  raw: ArrayBuffer // Uint8Array,2*n 归一化 (temp, speed)
  lut: ArrayBuffer // Uint8Array,256*4,当前体渲染通道的 LUT
  channel: 0 | 1
}

type InMsg = ExtractMsg | NormalizeMsg | BakeMsg

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const m = e.data
  try {
    if (m.type === 'extract') handleExtract(m)
    else if (m.type === 'normalize') handleNormalize(m)
    else handleBake(m)
  } catch (err) {
    ctx.postMessage({ type: 'error', jobId: m.jobId, message: String(err) })
  }
}

function handleExtract(m: ExtractMsg) {
  const payload = new Float32Array(m.payload)
  const n = payload.length / 4
  const rg = new Float32Array(2 * n)
  let tMin = Infinity,
    tMax = -Infinity,
    sMin = Infinity,
    sMax = -Infinity
  for (let i = 0; i < n; i++) {
    const u = payload[i]
    const v = payload[n + i]
    const w = payload[2 * n + i]
    const t = payload[3 * n + i]
    const s = Math.sqrt(u * u + v * v + w * w)
    rg[2 * i] = t
    rg[2 * i + 1] = s
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
    if (s < sMin) sMin = s
    if (s > sMax) sMax = s
  }
  ctx.postMessage(
    { type: 'extract-result', jobId: m.jobId, chunkId: m.chunkId, rg: rg.buffer, stats: [tMin, tMax, sMin, sMax] },
    [rg.buffer],
  )
}

function handleNormalize(m: NormalizeMsg) {
  const rg = new Float32Array(m.rg)
  const n = rg.length / 2
  const out = new Uint8Array(2 * n)
  const [tMin, tMax, sMin, sMax] = m.ranges
  const ts = tMax > tMin ? 255 / (tMax - tMin) : 0
  const ss = sMax > sMin ? 255 / (sMax - sMin) : 0
  for (let i = 0; i < n; i++) {
    out[2 * i] = (rg[2 * i] - tMin) * ts
    out[2 * i + 1] = (rg[2 * i + 1] - sMin) * ss
  }
  ctx.postMessage({ type: 'normalize-result', jobId: m.jobId, chunkId: m.chunkId, raw: out.buffer }, [out.buffer])
}

function handleBake(m: BakeMsg) {
  const raw = new Uint8Array(m.raw)
  const lut = new Uint8Array(m.lut)
  const n = raw.length / 2
  const out = new Uint8Array(4 * n)
  const histT = new Uint32Array(256)
  const histS = new Uint32Array(256)
  const off = m.channel
  for (let i = 0; i < n; i++) {
    const tv = raw[2 * i]
    const sv = raw[2 * i + 1]
    histT[tv]++
    histS[sv]++
    const l = raw[2 * i + off] * 4
    out[4 * i] = lut[l]
    out[4 * i + 1] = lut[l + 1]
    out[4 * i + 2] = lut[l + 2]
    out[4 * i + 3] = lut[l + 3]
  }
  ctx.postMessage(
    {
      type: 'bake-result',
      jobId: m.jobId,
      chunkId: m.chunkId,
      baked: out.buffer,
      histT: histT.buffer,
      histS: histS.buffer,
    },
    [out.buffer, histT.buffer, histS.buffer],
  )
}

export {}
