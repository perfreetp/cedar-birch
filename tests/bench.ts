import { createDemoStation } from '../src/core/defaults.ts'
import { SimEngine } from '../src/sim/engine.ts'
import { buildNav } from '../src/sim/nav.ts'

const doc = createDemoStation()
console.log('zones', doc.zones.length, 'obstacles', doc.obstacles.length)

let t0 = performance.now()
const nav = buildNav(doc)
console.log('nav build', (performance.now()-t0).toFixed(1),'ms', nav.cols, 'x', nav.rows, 'cell', nav.cell.toFixed(3),
  'sinks', nav.sinks.length, 'sources', nav.sources.length, 'lanes', nav.lanes.length)
let blocked=0; for(const b of nav.blocked) if(b) blocked++
console.log('blocked %', (blocked/nav.blocked.length*100).toFixed(1))

t0 = performance.now()
const eng = new SimEngine(doc, 777)
console.log('engine init', (performance.now()-t0).toFixed(1),'ms', 'bvh tris?', (eng.bvh as any).obstacleCount)

// warm up: 60 s at dt=0.1
const dt = 0.1
let frame=0
const times:number[]=[]
for (let step=0; step<600; step++) {
  const ts = performance.now()
  eng.step(dt)
  if (step%50===0) { const rs=eng.rasterize(); times.push(performance.now()-ts) }
  frame++
  if (step%100===0) console.log(`t=${eng.time.toFixed(0)}s agents=${eng.n} served=${eng.served} spill=${eng.spill}`)
}
console.log('mean step ms', (times.reduce((a,b)=>a+b,0)/times.length).toFixed(2))

t0 = performance.now()
const snap = eng.makeSnapshot(frame)
console.log('snapshot', (performance.now()-t0).toFixed(1),'ms', 'maxD', snap.stats.maxDensity.toFixed(2), 'bands', snap.stats.bandCounts)
