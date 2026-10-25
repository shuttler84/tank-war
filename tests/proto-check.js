'use strict';
/* =========================================================
 * 3D 原型无头浏览器检查（阶段2a）
 * 用法: 先在项目根目录启动本地服务 python -m http.server 8080
 *       然后 node tests/proto-check.js
 * 每个用例：无头 Edge 打开 prototype-3d.html → 截图 PNG →
 * dump-dom 检查 #proto-status（GLB ok / 无错误 / WebGL 可用）。
 * 产出: screenshots/proto-*.png
 * ========================================================= */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) {
  console.log('未找到 Edge / Chrome，跳过 3D 原型检查。');
  process.exit(0);
}

const BASE = process.env.PROTO_BASE || 'http://127.0.0.1:8080';
const USER_DIR = path.join(root, 'node-tmp', 'edge-proto-profile');
fs.mkdirSync(USER_DIR, { recursive: true });

const CASES = [
  { name: 'classic', query: '?autostart=1&map=classic&enemies=2&sim=5&fire=1' },
  { name: 'hub', query: '?autostart=1&map=hub&enemies=3&sim=5' },
  { name: 'menu', query: '' }
];

function run(name, url, pngPath) {
  const shotArgs = [
    '--headless', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + USER_DIR + '-' + name,
    '--window-size=1440,900', '--virtual-time-budget=9000',
    '--screenshot=' + pngPath, url
  ];
  execFileSync(browser, shotArgs, { timeout: 60000, stdio: 'ignore' });

  const domArgs = [
    '--headless', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + USER_DIR + '-' + name + '-dom',
    '--window-size=1440,900', '--virtual-time-budget=9000',
    '--dump-dom', url
  ];
  return execFileSync(browser, domArgs, { timeout: 60000, encoding: 'utf8', maxBuffer: 32e6 });
}

let failed = 0;
for (const c of CASES) {
  const url = BASE + '/prototype-3d.html' + c.query;
  const png = path.join(outDir, 'proto-' + c.name + '.png');
  let dom = '';
  try {
    dom = run(c.name, url, png);
  } catch (e) {
    console.log('[FAIL] ' + c.name + ' 浏览器执行失败: ' + e.message.split('\n')[0]);
    failed++;
    continue;
  }
  const m = dom.match(/<div id="proto-status"[^>]*>([\s\S]*?)<\/div>/);
  const status = m ? m[1].replace(/<[^>]+>/g, '').trim() : '(未找到状态面板)';
  const shotOk = fs.existsSync(png) && fs.statSync(png).size > 10000;
  const glbOk = status.includes('GLB ok');
  const noErr = !status.includes('错误');
  const webglOk = status.includes('WebGL ✓');
  const ok = shotOk && glbOk && noErr && webglOk;
  if (!ok) failed++;
  console.log((ok ? '[通过] ' : '[失败] ') + c.name +
    '  截图=' + (shotOk ? 'OK' : '无') +
    ' WebGL=' + (webglOk ? 'OK' : 'FAIL') +
    ' GLB=' + (glbOk ? 'OK' : 'FAIL') +
    ' 错误=' + (noErr ? '无' : '有'));
  console.log('       状态面板: ' + status.replace(/\n/g, ' | '));
}

console.log(failed === 0 ? 'PROTO_CHECK_OK' : 'PROTO_CHECK_FAILED: ' + failed + ' 例');
process.exit(failed === 0 ? 0 : 1);
