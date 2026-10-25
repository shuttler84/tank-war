// PNG 左右拼图（对照图用）：node tests/png-join.js a.png b.png out.png [标签]
'use strict';
const fs = require('fs');
const zlib = require('zlib');

function decodePNG(buf) {
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0) throw new Error('unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const cur = Buffer.from(raw.slice(p, p + stride)); p += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x], c = x >= channels ? prev[x - channels] : 0;
      let v = cur[x];
      if (filter === 1) v += a; else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const i = x * channels, o = (y * width + x) * 3;
      if (channels === 1) { out[o] = out[o + 1] = out[o + 2] = cur[i]; }
      else if (channels === 4) { const al = cur[i + 3]; out[o] = cur[i] * al / 255; out[o + 1] = cur[i + 1] * al / 255; out[o + 2] = cur[i + 2] * al / 255; }
      else { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

const CRC_T = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_T[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const b = Buffer.alloc(8 + data.length + 4);
  b.writeUInt32BE(data.length, 0); b.write(type, 4, 'ascii'); data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
  return b;
}
function encodePNG(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const [fa, fb, fo] = process.argv.slice(2, 5);
const A = decodePNG(fs.readFileSync(fa)), B = decodePNG(fs.readFileSync(fb));
if (A.height !== B.height) throw new Error('高度不一致');
const GAP = 12;
const W = A.width + GAP + B.width, H = A.height;
const out = Buffer.alloc(W * H * 3, 24);   // 深灰分隔底色
for (let y = 0; y < H; y++) {
  A.data.copy(out, (y * W) * 3, y * A.width * 3, (y + 1) * A.width * 3);
  B.data.copy(out, (y * W + A.width + GAP) * 3, y * B.width * 3, (y + 1) * B.width * 3);
}
fs.writeFileSync(fo, encodePNG(W, H, out));
console.log('OK ' + fo + ' ' + W + 'x' + H);
