// 生成样例液冷机柜流场数据 sample-data/cabinet.lcf
// 场景:机柜内 4 组服务器机架,底部冷通道送风,热空气上升,机架为热源。
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const nx = 128
const ny = 96
const nz = 160
const nvox = nx * ny * nz

const u = new Float32Array(nvox)
const v = new Float32Array(nvox)
const w = new Float32Array(nvox)
const t = new Float32Array(nvox)

// 机架区域:x∈[0.2,0.8],4 段 y 区间,z∈[0.08,0.85]
const racks = [0.12, 0.34, 0.56, 0.78].map((y0) => ({ y0, y1: y0 + 0.14 }))

function inRack(fx, fy, fz) {
  if (fx < 0.2 || fx > 0.8 || fz < 0.08 || fz > 0.85) return false
  return racks.some((r) => fy >= r.y0 && fy <= r.y1)
}

// 机架后方(热通道)距离,用于热羽流
function rackHeat(fx, fy, fz) {
  let heat = 0
  for (const r of racks) {
    const cy = (r.y0 + r.y1) / 2
    const dy = Math.max(0, Math.abs(fy - cy) - (r.y1 - r.y0) / 2)
    const dx = Math.max(0, Math.abs(fx - 0.5) - 0.3)
    const dz = Math.max(0, Math.abs(fz - 0.45) - 0.38)
    const d2 = dx * dx * 4 + dy * dy * 30 + dz * dz * 3
    heat += Math.exp(-d2 * 18)
  }
  return heat
}

for (let z = 0; z < nz; z++) {
  const fz = z / (nz - 1)
  for (let y = 0; y < ny; y++) {
    const fy = y / (ny - 1)
    for (let x = 0; x < nx; x++) {
      const fx = x / (nx - 1)
      const i = z * ny * nx + y * nx + x

      const rack = inRack(fx, fy, fz)
      const heat = rackHeat(fx, fy, fz)

      // 温度:环境 18°C,机架内与热羽流升温
      let temp = 18 + 4 * fz // 底部冷、顶部略热
      temp += 30 * heat
      if (rack) temp += 14 + 6 * Math.sin(fx * 40) * Math.sin(fz * 55)
      temp += 1.5 * Math.sin(fx * 12 + fy * 9) * Math.cos(fz * 7)

      // 速度:底部送风向上,机架区域受阻,热羽流加速上升,带横向扰动
      let vu = 0.25 * Math.sin(fy * 20 + fz * 8) * Math.cos(fx * 14)
      let vv = 0.25 * Math.sin(fx * 16 - fz * 6)
      let vw = 0.6 + 1.6 * Math.exp(-Math.pow((fz - 0.05) * 6, 2)) // 底部送风
      vw += 2.2 * heat // 热羽流
      if (rack) {
        vu *= 0.15
        vv *= 0.15
        vw *= 0.25
      }
      // 机架间冷通道射流
      for (const r of racks) {
        const gy = r.y1 + 0.03
        vv += 0.9 * Math.exp(-Math.pow((fy - gy) * 25, 2)) * Math.exp(-Math.pow((fz - 0.3) * 2.5, 2))
      }

      u[i] = vu
      v[i] = vv
      w[i] = vw
      t[i] = temp
    }
  }
}

const header = {
  dims: [nx, ny, nz],
  spacing: [0.008, 0.008, 0.008],
  origin: [0, 0, 0],
  channels: ['u', 'v', 'w', 't'],
}

let headerJson = JSON.stringify(header)
// 填充空格使 payload 偏移 4 字节对齐(JSON 允许尾部空白)
const pad = (4 - ((8 + headerJson.length) % 4)) % 4
headerJson += ' '.repeat(pad)
const headerBuf = Buffer.from(headerJson, 'utf8')
const out = Buffer.alloc(8 + headerBuf.length + nvox * 4 * 4)
out.write('LCF1', 0, 'ascii')
out.writeUInt32LE(headerBuf.length, 4)
headerBuf.copy(out, 8)
let off = 8 + headerBuf.length
for (const ch of [u, v, w, t]) {
  Buffer.from(ch.buffer).copy(out, off)
  off += nvox * 4
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sample-data')
mkdirSync(dir, { recursive: true })
const file = join(dir, 'cabinet.lcf')
writeFileSync(file, out)
console.log(`已生成 ${file} (${(out.length / 1024 / 1024).toFixed(1)} MB, ${nx}×${ny}×${nz})`)
