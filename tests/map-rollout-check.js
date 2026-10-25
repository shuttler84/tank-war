'use strict';
/* =========================================================
 * 地图推广验收运行器（阶段 2c-rollout）：逐图执行 A–F+G 断言 + 实跑截图
 * 用法: 先 python -m http.server 8080，再 node tests/map-rollout-check.js
 * 每张地图两次无头 Edge：
 *   ① --dump-dom   读取 #itest-report（A–F 玩法 + G 地图视觉断言）
 *   ② --screenshot 摆位画面 → screenshots/map-<id>.png
 * 可选: node tests/map-rollout-check.js open,city   （只跑指定地图）
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
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
];
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) { console.log('未找到 Edge / Chrome，跳过。'); process.exit(0); }

const BASE = process.env.PROTO_BASE || 'http://127.0.0.1:8080';
const ENTRY = (process.env.PROTO_ENTRY || '/index.html');
const tmp = path.join(root, 'node-tmp');
fs.mkdirSync(tmp, { recursive: true });

// 与 js/mapsize.js MAP_PRESETS 一致的完整清单（12 固定 + 1 随机）
const MAPS = process.argv[2]
  ? process.argv[2].split(',').map(s => s.trim()).filter(Boolean)
  : ['classic', 'open', 'corridor', 'crossfire', 'loop', 'twin',
     'city', 'fort', 'ring', 'hub', 'sectors', 'labyrinth', 'random'];

function edge(args, tag) {
  return execFileSync(browser, [
    '--headless', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(tmp, 'profile-map-' + tag),
    '--window-size=1440,900', '--virtual-time-budget=16000'
  ].concat(args), { timeout: 120000, encoding: 'utf8', maxBuffer: 32e6 });
}

let failedMaps = 0;
for (const mapId of MAPS) {
  const url = BASE + ENTRY + '?itest=1&map=' + mapId;
  let dom = '';
  try {
    dom = edge(['--dump-dom', url], 'dom-' + mapId);
  } catch (e) { dom = e.stdout || ''; }
  const m = dom.match(/<pre id="itest-report"[^>]*>([\s\S]*?)<\/pre>/);
  const report = m ? m[1] : null;
  let ok = !!report && /ITEST_OK/.test(report);
  const fails = report ? (report.match(/FAIL [^\n]*/g) || []) : ['未取到报告'];
  if (!ok) failedMaps++;

  // 截图（摆位=move：坦克行驶画面）
  const png = path.join(outDir, 'map-' + mapId + '.png');
  try {
    edge(['--screenshot=' + png, url + '&pose=move'], 'shot-' + mapId);
  } catch (e) { /* 截图失败在下方按文件存在性报 */ }
  const shotOk = fs.existsSync(png) && fs.statSync(png).size > 10000;

  const gLine = report ? (report.match(/G-碰撞[^\n]*/) || [''])[0] : '';
  const perfLine = report ? (report.match(/INFO \| perf[^\n]*/) || [''])[0] : '';
  console.log('[' + (ok && shotOk ? '通过' : '失败') + '] ' + mapId.padEnd(10)
    + ' 断言=' + (ok ? 'OK' : 'FAIL×' + fails.length)
    + ' 截图=' + (shotOk ? 'OK' : '缺失'));
  if (gLine) console.log('       ' + gLine.trim());
  if (perfLine) console.log('       ' + perfLine.trim());
  for (const f of fails.slice(0, 4)) console.log('       ' + f.trim());
}

console.log('================================');
if (failedMaps === 0) console.log('MAP_ROLLOUT_OK（' + MAPS.length + ' 张地图全部通过）');
else console.log('MAP_ROLLOUT_FAILED：' + failedMaps + ' 张地图未通过');
process.exit(failedMaps === 0 ? 0 : 1);
