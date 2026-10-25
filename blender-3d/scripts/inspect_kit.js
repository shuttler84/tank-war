// GLB 部件盘点：解析 JSON 块，输出层级 + 世界包围盒 + 材质/贴图引用
// 用法: node blender-3d/scripts/inspect_kit.js [kitDir] [过滤词]
'use strict';
const fs = require('fs');
const path = require('path');

const kitDir = process.argv[2] || path.join(__dirname, '..', '..', 'kenney_modular-space-kit_1.0', 'Models', 'GLB format');
const filter = process.argv[3] || '';

function parseGLB(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x676c5446) throw new Error('not glb'); // 'glTF'
  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('first chunk not JSON');
  return JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
}

function mulMat(a, b) { // 4x4 列主序
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
const IDENT = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function nodeMat(n) {
  if (n.matrix) return n.matrix;
  let m = IDENT.slice();
  if (n.scale) m = mulMat(m, [n.scale[0],0,0,0, 0,n.scale[1],0,0, 0,0,n.scale[2],0, 0,0,0,1]);
  if (n.rotation) { const q = n.rotation; /* 罕见：Kenney 通常无旋转节点 */ }
  if (n.translation) m = mulMat(m, [1,0,0,0, 0,1,0,0, 0,0,1,0, n.translation[0],n.translation[1],n.translation[2],1]);
  return m;
}
function xform(m, v) {
  return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]];
}

const files = fs.readdirSync(kitDir).filter(f => f.endsWith('.glb') && f.includes(filter)).sort();
for (const f of files) {
  let g;
  try { g = parseGLB(path.join(kitDir, f)); }
  catch (e) { console.log(f + ': ERR ' + e.message); continue; }
  const accs = g.accessors || [];
  const meshName = i => (g.meshes && g.meshes[i] && g.meshes[i].name) || ('mesh' + i);
  const matOf = p => {
    if (p.material === undefined) return '-';
    const m = (g.materials || [])[p.material] || {};
    const tex = m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture
      ? 'tex' + m.pbrMetallicRoughness.baseColorTexture.index : (m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor
        ? 'rgb(' + m.pbrMetallicRoughness.baseColorFactor.slice(0, 3).map(v => (v * 255) | 0).join(',') + ')' : '-');
    return (m.name || '?') + '/' + tex + '/' + (m.alphaMode || 'OP');
  };
  // 遍历场景树，累计各 mesh 世界包围盒
  const bounds = {};
  let triTotal = 0;
  const walk = (ni, m) => {
    const n = (g.nodes || [])[ni];
    if (!n) return;
    const nm = mulMat(m, nodeMat(n));
    if (n.mesh !== undefined) {
      const mesh = (g.meshes || [])[n.mesh];
      let bb = null, mats = new Set();
      for (const p of mesh.primitives) {
        const a = accs[p.attributes.POSITION];
        if (!a || !a.min) continue;
        const corners = [];
        for (let i = 0; i < 8; i++) {
          const c = xform(nm, [ (i&1)?a.max[0]:a.min[0], (i&2)?a.max[1]:a.min[1], (i&4)?a.max[2]:a.min[2] ]);
          corners.push(c);
        }
        bb = bb ? bb : { min: corners[0].slice(), max: corners[0].slice() };
        for (const c of corners) for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], c[k]); bb.max[k] = Math.max(bb.max[k], c[k]); }
        mats.add(matOf(p));
        if (p.indices !== undefined) triTotal += (accs[p.indices].count || 0) / 3;
        else triTotal += (a.count || 0) / 3;
      }
      if (bb) {
        const key = n.name || meshName(n.mesh);
        bounds[key] = { min: bb.min.map(v => +v.toFixed(3)), max: bb.max.map(v => +v.toFixed(3)), mats: [...mats] };
      }
    }
    for (const c of (n.children || [])) walk(c, nm);
  };
  for (const r of ((g.scenes || [])[0] || { nodes: [] }).nodes) walk(r, IDENT);
  const imgs = (g.images || []).map(i => i.uri || '<embedded>').join(',');
  console.log('== ' + f + '  tris=' + (triTotal | 0) + (imgs ? '  images=' + imgs : ''));
  for (const [k, b] of Object.entries(bounds)) {
    const size = [0, 1, 2].map(i => +(b.max[i] - b.min[i]).toFixed(3));
    console.log(`   ${k}: 尺寸 ${size.join('x')}  y[${b.min[1]}..${b.max[1]}]  材质 ${b.mats.join(' | ')}`);
  }
}
