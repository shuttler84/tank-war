'use strict';
/* =========================================================
 * Node 无头测试运行器：把浏览器脚本载入 vm 上下文后执行测试套件
 * 用法： node tests/run-tests.js
 * ========================================================= */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, URLSearchParams };
const ctx = vm.createContext(sandbox);

const modules = [
  'config', 'mapsize', 'utils', 'isoview', 'physics', 'maze', 'bullet',
  'tank', 'effects', 'pickup', 'ai', 'control', 'game'
];

for (const name of modules) {
  const file = path.join(root, 'js', name + '.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: name + '.js' });
}

const suite = fs.readFileSync(path.join(__dirname, 'suite.js'), 'utf8');
const report = vm.runInContext(suite, ctx, { filename: 'suite.js' });

console.log('');
console.log('=========================================');
console.log('  通过 ' + (report.total - report.failed) + ' / ' + report.total + ' 项测试');
if (report.failed > 0) {
  console.log('  失败项：');
  for (const r of report.results) {
    if (!r.ok) console.log('   - ' + r.name + ': ' + r.error);
  }
}
if (report.metrics) {
  console.log('  指标：');
  for (const [k, v] of Object.entries(report.metrics)) console.log('   - ' + k + ': ' + v);
}
console.log('=========================================');
process.exit(report.failed > 0 ? 1 : 0);
