import type { PlateRecord, WeldDataFile, WeldRecord } from '../types';

/** 确定性 PRNG（mulberry32），保证每次加载示例数据完全一致 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 高斯-ish 随机（三次平均近似） */
function gaussian(rand: () => number, mean: number, spread: number): number {
  const v = (rand() + rand() + rand()) / 3 - 0.5; // -0.5..0.5
  return mean + v * 2 * spread;
}

const REGIONS = [
  '双层底 102 分段',
  '舷侧外板 102 分段',
  '纵舱壁 102 分段',
  '甲板 102 分段',
  '横舱壁 102 分段',
  '肋板框架 102 分段',
  '首柱区域 102 分段',
  '机舱围壁 102 分段',
];

/**
 * 生成一个船体分段示例：纵向（船长 X）32m、宽 16m、高 12m，
 * 板材由外板/甲板/舱壁/肋板组成，焊缝沿板边与肋位分布，共约 3 万条。
 */
export function generateSampleDataset(targetWelds = 30000): WeldDataFile {
  const rand = mulberry32(20261122);
  const L = 32; // 船长 m
  const W = 16;
  const H = 12;

  const plates: PlateRecord[] = [];
  const addPlate = (
    id: string,
    thickness: number,
    px: number, py: number, pz: number,
    sx: number, sy: number, sz: number,
  ) => {
    plates.push({ id, thickness, position: [px, py, pz], size: [sx, sy, sz] });
  };

  // —— 外板：左右舷、底板、甲板 ——
  addPlate('PL-SHELL-P', 18, 0, 0, W / 2, L / 2, H / 2, 0.08);
  addPlate('PL-SHELL-S', 18, 0, 0, -W / 2, L / 2, H / 2, 0.08);
  addPlate('PL-BOTTOM', 20, 0, -H / 2, 0, L / 2, 0.1, W / 2);
  addPlate('PL-DECK-UP', 14, 0, H / 2, 0, L / 2, 0.08, W / 2);
  addPlate('PL-DECK-MID', 12, 0, 0, 0, L / 2, 0.08, W / 2);

  // —— 横舱壁 / 肋板：每 4m 一道 ——
  const frameXs: number[] = [];
  for (let x = -L / 2 + 4; x < L / 2; x += 4) {
    frameXs.push(x);
    addPlate(`PL-BHD-${x.toFixed(0)}`, 12, x, 0, 0, 0.08, H / 2, W / 2);
  }

  // —— 纵舱壁 2 道、纵桁 2 道 ——
  for (const z of [-W / 4, W / 4]) {
    addPlate(`PL-LBHD-${z > 0 ? 'P' : 'S'}`, 11, 0, 0, z, L / 2, H / 2, 0.07);
  }
  for (const y of [-H / 4, H / 4]) {
    addPlate(`PL-GIRDER-${y > 0 ? 'U' : 'L'}`, 13, 0, y, 0, L / 2, 0.09, W / 2);
  }

  // —— 焊缝 ——
  const welds: WeldRecord[] = [];
  let seq = 0;
  const pushWeld = (
    region: string,
    thickness: number,
    p: [number, number, number],
    d: [number, number, number],
    len: number,
  ) => {
    // 间隙分布：多数在 1-5mm，少量超差，尾部少量 8mm 以上
    let gap: number;
    const r = rand();
    if (r < 0.08) gap = gaussian(rand, 9.2, 1.6);          // 超差簇
    else if (r < 0.2) gap = gaussian(rand, 6.4, 1.0);      // 大间隙
    else gap = gaussian(rand, 2.6, 1.5);                   // 常规
    gap = Math.max(0, Math.round(gap * 10) / 10);
    seq += 1;
    const regionNo = String(REGIONS.indexOf(region) + 101);
    welds.push({
      id: `W-${regionNo}-${String(seq).padStart(5, '0')}`,
      region,
      thickness,
      gap,
      position: p,
      direction: d,
      length: Math.round(len * 100) / 100,
    });
  };

  // 每道肋位处：沿外板/甲板/纵舱壁的板边，每 ~0.55m 一条短焊缝
  const spacing = 0.55;
  // 沿船长把各肋位轮换分配给不同装配区域，保证 8 个区域都有焊缝
  const frameRegions = [
    REGIONS[0], REGIONS[5], REGIONS[4], REGIONS[3],
    REGIONS[0], REGIONS[7], REGIONS[2], REGIONS[6],
  ];
  frameXs.forEach((x, fi) => {
    const frameRegion = frameRegions[fi % frameRegions.length];
    for (let z = -W / 2 + 0.4; z <= W / 2 - 0.4; z += spacing) {
      pushWeld(frameRegion, 12, [x, H / 2 - 0.1, z], [0, 0, 1], spacing * 0.8);
      pushWeld(REGIONS[0], 20, [x, -H / 2 + 0.15, z], [0, 0, 1], spacing * 0.8);
      if (welds.length >= targetWelds) break;
    }
    for (let y = -H / 2 + 0.4; y <= H / 2 - 0.4; y += spacing) {
      pushWeld(REGIONS[1], 18, [x, y, W / 2 - 0.12], [0, 1, 0], spacing * 0.8);
      pushWeld(REGIONS[1], 18, [x, y, -W / 2 + 0.12], [0, 1, 0], spacing * 0.8);
      if (welds.length >= targetWelds) break;
    }
  });

  // 纵缝：沿船长方向，外板/纵桁/纵舱壁上按肋距分段，8 个区域均有足量焊缝
  let guard = 0;
  while (welds.length < targetWelds && guard++ < 50000) {
    const x = -L / 2 + rand() * L;
    const kind = rand();
    if (kind < 0.24) {
      const side = rand() < 0.5 ? 1 : -1;
      const y = -H / 2 + rand() * H;
      pushWeld(REGIONS[1], 18, [x, y, side * (W / 2 - 0.12)], [1, 0, 0], 0.9 + rand() * 0.6);
    } else if (kind < 0.44) {
      const z = (rand() < 0.5 ? -1 : 1) * W / 4;
      const y = -H / 2 + rand() * H;
      pushWeld(REGIONS[2], 11, [x, y, z], [1, 0, 0], 0.9 + rand() * 0.6);
    } else if (kind < 0.62) {
      const z = -W / 2 + rand() * W;
      pushWeld(REGIONS[3], 14, [x, H / 2 - 0.12, z], [1, 0, 0], 0.9 + rand() * 0.6);
    } else if (kind < 0.76) {
      const z = -W / 2 + rand() * W;
      const y = (rand() < 0.5 ? -1 : 1) * H / 4;
      pushWeld(REGIONS[5], 13, [x, y, z], [1, 0, 0], 0.8 + rand() * 0.5);
    } else if (kind < 0.86) {
      // 首柱区域：艏部 1/4 船长内的外板纵缝
      const side = rand() < 0.5 ? 1 : -1;
      const xf = L / 4 + rand() * (L / 4);
      const y = -H / 2 + rand() * H;
      pushWeld(REGIONS[6], 18, [xf, y, side * (W / 2 - 0.12)], [1, 0, 0], 0.9 + rand() * 0.6);
    } else if (kind < 0.95) {
      // 机舱围壁：艉部 1/4 船长内的纵桁缝
      const xa = -L / 2 + rand() * (L / 4);
      const z = -W / 2 + rand() * W;
      pushWeld(REGIONS[7], 13, [xa, -H / 4, z], [1, 0, 0], 0.8 + rand() * 0.5);
    } else {
      // 横舱壁板边纵缝，补足该区域
      const fx = frameXs[Math.floor(rand() * frameXs.length)];
      const y = -H / 2 + rand() * H;
      pushWeld(REGIONS[4], 12, [fx, y, (rand() < 0.5 ? -1 : 1) * (W / 2 - 0.2)], [0, 1, 0], 0.7 + rand() * 0.5);
    }
  }

  return {
    name: '示例分段 BLK-102（3 万条焊缝）',
    version: 1,
    welds: welds.slice(0, targetWelds),
    plates,
  };
}
