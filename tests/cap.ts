import { createDemoStation } from '../src/core/defaults.ts'
import { SimEngine } from '../src/sim/engine.ts'
const doc = createDemoStation()
const e = new SimEngine(doc, 1)
e.fillTo(20000)
console.log('filled', e.n)
const times:number[]=[]
for (let i=0;i<30;i++){ const t=performance.now(); e.step(0.1); times.push(performance.now()-t) }
times.sort((a,b)=>a-b)
console.log('20000 agents step ms: median', times[15].toFixed(1), 'p90', times[27].toFixed(1), 'max', times[29].toFixed(1))
const t0=performance.now(); const r=e.rasterize(); console.log('rasterize', (performance.now()-t0).toFixed(1),'ms maxD', r.maxDensity.toFixed(1))
