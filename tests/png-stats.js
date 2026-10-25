// PNG 像素统计（无依赖：Node 内置 zlib 解码非隔行 PNG）
// 用途：判定无头截图是否真的为空画面（区分“捕获问题”与“视觉误判”）
// 用法: node tests/png-stats.js a.png [b.png ...]
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png');
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8) throw new Error('bitDepth ' + bitDepth + ' unsupported');
  if (interlace !== 0) throw new Error('interlaced unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('colorType ' + colorType);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * channels);
  let prev = Buffer.alloc(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.slice(p, p + stride); p += stride;
    const cur = Buffer.from(line);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { width, height, channels, colorType, data: out, palette, trns };
}

function stats(file) {
  const png = decodePNG(fs.readFileSync(file));
  const { width, height, channels, data } = png;
  const px = (x, y) => {
    const i = (y * width + x) * channels;
    if (channels === 4) return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    return [data[i], data[i + 1], data[i + 2], 255];
  };
  const lum = ([r, g, b, a]) => (a < 16 ? -1 : 0.2126 * r + 0.7152 * g + 0.0722 * b);
  let n = 0, bright = 0, mid = 0, dark = 0, transparent = 0;
  const colorSet = new Set();
  let sumL = 0;
  for (let y = 0; y < height; y += 3) for (let x = 0; x < width; x += 3) {
    const c = px(x, y); n++;
    if (c[3] < 16) { transparent++; continue; }
    const L = lum(c); sumL += L;
    if (L > 200) bright++; else if (L > 60) mid++; else dark++;
    colorSet.add((c[0] >> 4) + ',' + (c[1] >> 4) + ',' + (c[2] >> 4));
  }
  // 采样几个关键区域（等距场景中央、HUD 右上角、左下角）
  const region = (cx, cy, r) => {
    let s = 0, k = 0, m = 0;
    for (let y = cy - r; y < cy + r; y += 2) for (let x = cx - r; x < cx + r; x += 2) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const L = lum(px(x, y)); if (L < 0) continue;
      s += L; k++; m = Math.max(m, L);
    }
    return k ? (s / k).toFixed(0) + '/max' + m.toFixed(0) : 'n/a';
  };
  console.log('=== ' + file);
  console.log(`  ${width}x${height} ch=${channels}`);
  console.log(`  采样 ${n}: 亮(>200)=${(bright / n * 100).toFixed(1)}% 中(60-200)=${(mid / n * 100).toFixed(1)}% 暗(<60)=${(dark / n * 100).toFixed(1)}% 透明=${(transparent / n * 100).toFixed(1)}%`);
  console.log(`  平均亮度=${(sumL / (n - transparent)).toFixed(1)} 颜色数(4bit量化)=${colorSet.size}`);
  console.log(`  区域亮度 中心=${region(width >> 1, height >> 1, 120)} 右上=${region(width - 130, 130, 100)} 左下=${region(130, height - 130, 100)}`);
}

for (const f of process.argv.slice(2)) { try { stats(f); } catch (e) { console.log('=== ' + f + '\n  ERR ' + e.message); } }
