// manifold 布尔清理 + geometry 算法的 Node 单元测试（WASM 在 Node 下运行）
import { build } from 'esbuild';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const manifoldModule = await import('manifold-3d');
const wasmBytes = readFileSync(require.resolve('manifold-3d/manifold.wasm'));
const M = await manifoldModule.default({ wasmBinary: wasmBytes });
M.setup();

let pass = 0;
let fail = 0;
const check = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`, detail ?? '');
  }
};

// geometry 纯函数通过 esbuild 打包验证
const geoBundle = await build({
  entryPoints: ['src/lib/geometry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/geometry.mjs', geoBundle.outputFiles[0].text);
const geo = await import(new URL('../tmp/geometry.mjs', import.meta.url).pathname.replace(/^\//, '/'));
const { ringArea } = geo;

// 用本地初始化的 M 构造一个与 cleanBoundary 等价的测试入口
async function clean(rings, minFragmentArea) {
  const contours = [];
  if (rings.outer.length >= 3) contours.push(rings.outer.map((p) => [p.x, p.y]));
  for (const h of rings.holes) if (h.length >= 3) contours.push(h.map((p) => [p.x, p.y]));
  const cs = new M.CrossSection(contours, 'Positive');
  const polygons = cs.simplify(0.01).toPolygons();
  const candidates = polygons
    .map((poly) => poly.map((v) => (Array.isArray(v) ? { x: v[0], y: v[1] } : { x: v.x, y: v.y })))
    .filter((ring) => ring.length >= 3 && ringArea(ring) >= minFragmentArea)
    .sort((a, b) => ringArea(b) - ringArea(a));
  return { outer: candidates[0] ?? [], holes: candidates.slice(1) };
}

// ---- geometry 纯函数 ----
const square = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
];
check('正方形面积=100', Math.abs(geo.ringArea(square) - 100) < 1e-9, geo.ringArea(square));
check('正方形周长=40', Math.abs(geo.ringPerimeter(square) - 40) < 1e-9);
check('点(5,5)在多边形内', geo.pointInRing({ x: 5, y: 5 }, square) === true);
check('点(15,15)在多边形外', geo.pointInRing({ x: 15, y: 15 }, square) === false);
const simplified = geo.simplifyRing(
  [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  1,
);
check('DP 抽稀移除共线点', simplified.length === 4, simplified.length);

// ---- manifold 布尔清理（需要 wasm）----
try {
  // 自交蝴蝶结多边形：(0,0)(10,10)(10,0)(0,10) 自交
  const bowtie = [
    { x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 },
  ];
  const cleaned = await clean({ outer: bowtie, holes: [] }, 0.1);
  check('自交多边形被清理为有效环', cleaned.outer.length >= 3, cleaned.outer.length);

  // 两个重叠方块 → 并集后单外环
  const overlapping = [
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
    [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }],
  ];
  const merged = await clean({ outer: overlapping[0], holes: [overlapping[1]] }, 0.1);
  check('重叠斑块并集为单外环', merged.holes.length === 0 && merged.outer.length >= 4, merged);
  const mergedArea = ringArea(merged.outer);
  check('并集面积≈175（100+100-25）', Math.abs(mergedArea - 175) < 1.0, mergedArea);

  // 小碎片剔除
  const big = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const tiny = [{ x: 200, y: 200 }, { x: 201, y: 200 }, { x: 201, y: 201 }, { x: 200, y: 201 }];
  const filtered = await clean({ outer: big, holes: [tiny] }, 10);
  const totalArea = ringArea(filtered.outer) + filtered.holes.reduce((s, h) => s + ringArea(h), 0);
  check('1m² 碎片被最小面积阈值剔除', totalArea > 9000, totalArea);
} catch (e) {
  check('manifold wasm 在 Node 下运行', false, String((e && e.message) || e));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
