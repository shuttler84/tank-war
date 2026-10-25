'use strict';
/* =========================================================
 * 3D 接入硬性验收运行器（阶段 2c-0，测试 A–F）
 * 用法: 项目根目录先 python -m http.server 8080，再
 *       node tests/integration-check.js
 * 每个场景执行两次同 URL 的无头 Edge：
 *   ① --screenshot 截取摆位画面（与断言运行完全一致）
 *   ② --dump-dom   读取 #itest-report 断言结果
 * 产出 screenshots/integration-*.png 与逐项 PASS/FAIL 清单。
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

const SCENARIOS = [
  { pose: 'overview' }, { pose: 'menu' }, { pose: 'move' }, { pose: 'turret' }, { pose: 'muzzle' }, { pose: 'laser' }, { pose: 'wall' }, { pose: 'bounce' }
];

function edge(args, tag) {
  // 清理上次运行的浏览器配置（含磁盘缓存）：页面/脚本变更后避免陈旧缓存
  for (const d of fs.readdirSync(tmp)) {
    if (d.startsWith('profile-') && (tag ? d.endsWith('-' + tag) : true)) {
      try { fs.rmSync(path.join(tmp, d), { recursive: true, force: true }); } catch (e) {}
    }
  }
  return execFileSync(browser, [
    '--headless', '--enable-unsafe-swiftshader', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(tmp, 'profile-' + tag),
    '--window-size=1440,900', '--virtual-time-budget=14000'
  ].concat(args), { timeout: 90000, encoding: 'utf8', maxBuffer: 32e6 });
}

let allResults = [];
let failedTotal = 0;

for (const sc of SCENARIOS) {
  const url = BASE + ENTRY + '?itest=1&pose=' + sc.pose;
  const png = path.join(outDir, 'integration-' + sc.pose + '.png');
  try {
    edge(['--screenshot=' + png, url], 'shot-' + sc.pose);
  } catch (e) {
    console.log('[失败] ' + sc.pose + ' 截图执行异常: ' + String(e.message).split('\n')[0]);
    failedTotal++;
  }
  let dom = '';
  try {
    dom = edge(['--dump-dom', url], 'dom-' + sc.pose);
  } catch (e) {
    console.log('[失败] ' + sc.pose + ' DOM 执行异常: ' + String(e.message).split('\n')[0]);
    failedTotal++;
    continue;
  }
  const m = dom.match(/<pre id="itest-report"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('[失败] ' + sc.pose + ' 未找到验收报告（驱动未完成）');
    failedTotal++;
    continue;
  }
  const text = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const lines = text.split('\n').filter(Boolean);
  const verdict = lines[lines.length - 1];
  if (sc.pose === 'move') allResults = lines.slice(0, -1);   // 断言集每场景相同，取一份
  const shotOk = fs.existsSync(png) && fs.statSync(png).size > 10000;
  const ok = verdict === 'ITEST_OK' && shotOk;
  if (!ok) failedTotal++;
  console.log((ok ? '[通过] ' : '[失败] ') + 'pose=' + sc.pose +
    '  截图=' + (shotOk ? 'OK' : '无') + '  ' + verdict);
}

console.log('\n===== 断言明细（场景 move）=====');
for (const l of allResults) console.log('  ' + l);

const fails = allResults.filter(l => l.startsWith('FAIL'));
console.log('================================');
console.log(failedTotal === 0 && fails.length === 0
  ? 'INTEGRATION_CHECK_OK（A–F 全部通过）'
  : 'INTEGRATION_CHECK_FAILED：场景失败 ' + failedTotal + '，断言失败 ' + fails.length);
if (fails.length) fails.forEach(l => console.log('  ' + l));
process.exit(failedTotal === 0 && fails.length === 0 ? 0 : 1);
