// Node 端单元测试：用 esbuild 即时转译 TS，验证 marching squares / manifold / geometry
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';

const bundle = await build({
  entryPoints: ['src/lib/extraction.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: [],
});
const code = bundle.outputFiles[0].text;
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/extraction.mjs', code);

const ex = await import(new URL('../tmp/extraction.mjs', import.meta.url).pathname.replace(/^\//, '/'));

const mk = (grid, cols, rows) => ({
  grid: Float32Array.from(grid),
  cols,
  rows,
  cellSize: 1,
  origin: { x: 0, y: 0 },
  otsu: 0.5,
  mean: 0.5,
});

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`, detail ?? '');
  }
}

// 1. 3x3 中心四格高值
const g1 = [0, 0, 0, 0, 1, 1, 0, 1, 1];
const r1 = ex.marchingSquares(mk(g1, 3, 3), 0.5);
check('3x3 中心块产生 1 个环', r1.length === 1, JSON.stringify(r1));
check('3x3 环至少 3 顶点', r1[0] && r1[0].length >= 3, r1[0]?.length);

// 2. 5x5 中心 3x3 块
const g2 = [];
for (let y = 0; y < 5; y++)
  for (let x = 0; x < 5; x++) g2.push(x >= 1 && x <= 3 && y >= 1 && y <= 3 ? 1 : 0);
const r2 = ex.marchingSquares(mk(g2, 5, 5), 0.5);
check('5x5 中心块产生 1 个环', r2.length === 1, JSON.stringify(r2));
check('5x5 环顶点数 >= 4', r2[0]?.length >= 4, r2[0]?.length);

// 3. 全高/全低无等值线
check('全高无环', ex.marchingSquares(mk([1, 1, 1, 1], 2, 2), 0.5).length === 0);
check('全低无环', ex.marchingSquares(mk([0, 0, 0, 0], 2, 2), 0.5).length === 0);

// 4. 两个分离斑块 → 2 个环
const g4 = [];
for (let y = 0; y < 9; y++)
  for (let x = 0; x < 9; x++) {
    const inA = x >= 1 && x <= 2 && y >= 1 && y <= 2;
    const inB = x >= 6 && x <= 7 && y >= 6 && y <= 7;
    g4.push(inA || inB ? 1 : 0);
  }
const r4 = ex.marchingSquares(mk(g4, 9, 9), 0.5);
check('两分离斑块产生 2 个环', r4.length === 2, r4.map((r) => r.length));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
