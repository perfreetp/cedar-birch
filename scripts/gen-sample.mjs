// 生成示例层级数据文件: node scripts/gen-sample.mjs [输出路径]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSampleData } from '../src/core/sample-data.js';

const out = process.argv[2] || 'data/sample-typhoon.json';
mkdirSync(dirname(out), { recursive: true });
const data = generateSampleData();
writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
console.log(`已生成示例数据: ${out}`);
console.log(`  时刻数: ${data.steps.length}, 高度层: ${data.levels.length} 层`);
console.log(`  高度层(m): ${data.levels.join(', ')}`);
console.log(`  中心气压范围: ${Math.min(...data.steps.map((s) => s.centralPressure))} ~ ${Math.max(...data.steps.map((s) => s.centralPressure))} hPa`);
