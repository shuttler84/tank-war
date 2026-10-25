// classic 示范地图基线记录：布局/墙体/碰撞/出生点/道具（改造前快照）
// 用法: node tests/map-baseline.js
'use strict';
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const sandbox = { console, setTimeout, clearTimeout, Date, Math, JSON, URLSearchParams };
const ctx = vm.createContext(sandbox);
for (const name of ['config', 'mapsize', 'utils', 'isoview', 'physics', 'maze', 'bullet', 'tank', 'effects', 'pickup', 'ai', 'control', 'game']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), ctx, { filename: name + '.js' });
}

const out = vm.runInContext(`(function () {
  const game = new Game();
  game.startMatch({ mapId: 'classic', enemies: 2, difficulty: 'normal' });
  const m = game.maze;
  const iso = game.iso;
  const walls = m.walls.map(w => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  // 墙体分类：水平长墙(h=厚度) / 垂直长墙(w=厚度) / 近正方块
  const T = m.thickness;
  let hN = 0, vN = 0, other = 0, maxLen = 0, minLen = 1e9;
  for (const w of walls) {
    if (Math.abs(w.h - T) < 0.01 && w.w > T) hN++;
    else if (Math.abs(w.w - T) < 0.01 && w.h > T) vN++;
    else other++;
    maxLen = Math.max(maxLen, w.w, w.h);
    minLen = Math.min(minLen, w.w, w.h);
  }
  // 出生点（坦克初始位）
  const spawns = game.tanks.map(t => ({ x: +t.x.toFixed(1), y: +t.y.toFixed(1), player: !!t.isPlayer }));
  // 道具：刷新逻辑参数 + 本局实际点位
  const pickups = game.pickups.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), type: p.type }));
  // 可通行性采样：网格步进统计自由比例
  let free = 0, tot = 0;
  for (let y = T; y < m.height; y += 10) for (let x = T; x < m.width; x += 10) {
    tot++; if (m.isFree(x, y, 16)) free++;
  }
  return {
    map: { id: 'classic', name: m.name, width: m.width, height: m.height, cols: m.cols, rows: m.rows,
      cellW: m.cellW, cellH: m.cellH, thickness: m.thickness, wallHeightPx: iso.heightZ(m), seed: m.seed },
    walls: { count: walls.length, horizontal: hN, vertical: vN, other, maxLenPx: +maxLen.toFixed(1), minPx: +minLen.toFixed(1), list: walls },
    spawns, pickups, pickupConfig: { max: CONFIG.PICKUPS.max, spawnInterval: CONFIG.PICKUPS.interval },
    navFree: { sampled: tot, freeRatio: +(free / tot).toFixed(3) },
    tank: { radius: CONFIG.TANK.radius, speed: CONFIG.TANK.speed },
    bullet: { speed: CONFIG.BULLET.speed, radius: CONFIG.BULLET.radius, maxBounces: CONFIG.BULLET.maxBounces },
  };
})()`, ctx, { filename: 'baseline.js' });

fs.writeFileSync(path.join(root, 'tests', 'map-baseline-classic.json'), JSON.stringify(out, null, 2));
console.log('地图:', out.map.name, out.map.width + 'x' + out.map.height, '网格', out.map.cols + 'x' + out.map.rows,
  '格宽', out.map.cellW.toFixed(1), '墙厚', out.map.thickness, '墙高(px)', out.map.wallHeightPx.toFixed(1));
console.log('墙体:', out.walls.count, '段（水平', out.walls.horizontal, '/ 垂直', out.walls.vertical, '/ 其他', out.walls.other,
  '）最长', out.walls.maxLenPx, 'px 最短', out.walls.minPx, 'px');
console.log('出生点:', JSON.stringify(out.spawns));
console.log('道具:', out.pickups.length, '个', JSON.stringify(out.pickups));
console.log('可通行比例(半径16采样):', out.navFree.freeRatio);
console.log('已写入 tests/map-baseline-classic.json');
