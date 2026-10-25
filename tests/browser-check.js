'use strict';
/* =========================================================
 * 真实浏览器端到端检查（Edge / Chrome headless）
 *
 * 用途：验证"index.html + main.js"这层接线真的能跑通，
 *       尤其是鼠标事件是否挂载、坐标换算、键盘快捷键。
 * 用法：node tests/browser-check.js
 * ========================================================= */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
];
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) {
  console.log('未找到 Edge / Chrome，跳过浏览器检查。');
  process.exit(0);
}

const testScript = `
<script>
window.addEventListener('load', function () {
  setTimeout(function () {
    var out = [];
    var failed = 0;
    function check(name, cond, extra) {
      if (!cond) failed++;
      out.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
    }
    try {
      var g = window.__tankGame;
      var canvas = document.getElementById('game');
      var rect = canvas.getBoundingClientRect();

      // 1) 事件监听必须真正挂载（这是曾经的真实故障点）
      check('Canvas 上挂载了输入', !!g.input.canvas && g.input.canvas === canvas);
      check('画布存在真实尺寸', rect.width > 100 && rect.height > 100, rect.width + 'x' + rect.height);

      // 2) 开始一局
      document.getElementById('btn-start').click();
      check('点击开始进入对局', g.state === 'playing', 'state=' + g.state);
      // 开局瞬间的伪 blur（焦点抖动/页面内切换）不得触发自动暂停（用户实测反馈：
      // 未按暂停却弹出暂停框）。hasFocus()=true 的合成 blur + 开局宽限期双守卫
      window.dispatchEvent(new Event('blur'));
      check('开局伪 blur 不触发自动暂停', g.state === 'playing', 'state=' + g.state);
      // 检查过程中给玩家无敌保护，避免 AI 击毁玩家造成时序性误报
      g.player.invuln = 999;

      // 2b) 全屏视口：画布铺满窗口、绘图缓冲匹配 DPR、动态地图按视口定规模
      check('画布铺满浏览器窗口', rect.width === window.innerWidth && rect.height === window.innerHeight,
        rect.width + 'x' + rect.height + ' vs ' + window.innerWidth + 'x' + window.innerHeight);
      check('绘图缓冲匹配视口与DPR',
        Math.abs(canvas.width - rect.width * (window.devicePixelRatio || 1)) <= 1 &&
        Math.abs(canvas.height - rect.height * (window.devicePixelRatio || 1)) <= 1,
        canvas.width + 'x' + canvas.height + ' dpr=' + (window.devicePixelRatio || 1));
      check('小地图按视口铺满', g.maze.width === window.innerWidth && g.maze.height === window.innerHeight,
        g.maze.width + 'x' + g.maze.height);
      check('动态扩图行列数不少于基础规模', g.maze.cols >= 12 && g.maze.rows >= 8,
        g.maze.cols + 'x' + g.maze.rows);

      // 3) 真实 pointermove -> 世界坐标换算（俯视 1:1 + 相机偏移；等距走逆投影）
      var cx = rect.left + rect.width * 0.25;
      var cy = rect.top + rect.height * 0.75;
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: cx, clientY: cy, bubbles: true }));
      var rawX = rect.width * 0.25, rawY = rect.height * 0.75;
      var expX, expY;
      if (g.isoActive && g.iso) {
        var exp = g.iso.unproject(rawX + g.camera.x, rawY + g.camera.y);
        expX = exp.x; expY = exp.y;
      } else {
        expX = g.camera.x + rawX; expY = g.camera.y + rawY;
      }
      var ddx = Math.abs(g.input.mouse.x - expX), ddy = Math.abs(g.input.mouse.y - expY);
      check('鼠标坐标换算正确', ddx < 2 && ddy < 2,
        'got=' + g.input.mouse.x.toFixed(1) + ',' + g.input.mouse.y.toFixed(1) + ' exp=' + expX.toFixed(1) + ',' + expY.toFixed(1));

      // 4) 圆外 -> 移动模式，且坦克真的朝鼠标方向前进
      //    先找一条空间最充裕的方向，避免出生点贴着墙导致位移被挡住
      var p = g.player;
      p.cooldown = 0;
      var bestA = 0, bestD = -1;
      for (var k = 0; k < 24; k++) {
        var ang = k * Math.PI * 2 / 24;
        var hitW = g.maze.raycast(p.x, p.y, Math.cos(ang), Math.sin(ang), 400, p.radius + 2);
        var free = hitW ? hitW.t : 400;
        if (free > bestD) { bestD = free; bestA = ang; }
      }
      var sx = p.x, sy = p.y;
      // 目标世界点 = 坦克 + 最开阔方向 300px；屏幕位置按当前视图投影
      var wpX = p.x + Math.cos(bestA) * 300, wpY = p.y + Math.sin(bestA) * 300;
      var toClientX, toClientY;
      if (g.isoActive && g.iso) {
        var spT = g.iso.project(wpX, wpY, 0);
        toClientX = rect.left + spT.x - g.camera.x;
        toClientY = rect.top + spT.y - g.camera.y;
      } else {
        toClientX = rect.left + (wpX - g.camera.x);
        toClientY = rect.top + (wpY - g.camera.y);
      }
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: toClientX,
        clientY: toClientY,
        bubbles: true
      }));
      g.update(1 / 60);
      check('圆外进入移动模式', g.playerCtrl.mode === 'move', 'mode=' + g.playerCtrl.mode);
      for (var i = 0; i < 45; i++) g.update(1 / 60);
      var moved = Math.hypot(p.x - sx, p.y - sy);
      var moveAng = Math.atan2(p.y - sy, p.x - sx);
      var angErr = Math.abs(((moveAng - bestA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      check('坦克朝鼠标方向移动', moved > 40 && angErr < 0.5,
        'moved=' + moved.toFixed(1) + 'px 偏差=' + angErr.toFixed(2) + 'rad 自由距离=' + bestD.toFixed(0));

      // 5) 圆内 -> 瞄准模式且停止平移（屏幕位置按当前视图投影）
      var ix, iy;
      if (g.isoActive && g.iso) {
        var spP = g.iso.project(p.x, p.y, 0);
        ix = rect.left + spP.x - g.camera.x;
        iy = rect.top + spP.y - g.camera.y;
      } else {
        ix = rect.left + (p.x - g.camera.x);
        iy = rect.top + (p.y - g.camera.y);
      }
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: ix + 12, clientY: iy + 4, bubbles: true }));
      g.update(1 / 60);
      var ax = p.x, ay = p.y;
      for (var j = 0; j < 30; j++) g.update(1 / 60);
      check('圆内进入瞄准模式', g.playerCtrl.mode === 'aim', 'mode=' + g.playerCtrl.mode);
      check('瞄准时停止平移', Math.hypot(p.x - ax, p.y - ay) < 0.5,
        'drift=' + Math.hypot(p.x - ax, p.y - ay).toFixed(2));

      // 6) 左键开火
      p.cooldown = 0;
      var before = g.bullets.length;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
      check('左键按下被记录', g.input.mouse.down === true);
      for (var k = 0; k < 3; k++) g.update(1 / 60);
      check('开火产生子弹', g.bullets.length > before || p.cooldown > 0,
        'bullets=' + g.bullets.length + ' cd=' + p.cooldown.toFixed(2));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
      check('左键抬起被记录', g.input.mouse.down === false);

      // 7) 键盘：P 暂停、再按继续
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
      check('P 键暂停', g.state === 'paused', 'state=' + g.state);
      check('暂停界面出现', !document.getElementById('screen-pause').hasAttribute('hidden'));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
      check('再按 P 继续', g.state === 'playing', 'state=' + g.state);

      // 8) Esc 暂停
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check('Esc 暂停', g.state === 'paused');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));

      // 9) R 重开
      var oldScore = g.score;
      g.score = 999;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      check('R 键重开', g.state === 'playing' && g.time < 0.2 && g.score === 0 && g.bullets.length === 0,
        'state=' + g.state + ' time=' + g.time.toFixed(2) + ' score=' + g.score);

      // 10) F1 调试开关
      var dbg = g.debugShowAimCircle;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));
      check('F1 切换调试圆', g.debugShowAimCircle !== dbg);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }));

      // 11) 失焦清除按键
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0, bubbles: true }));
      window.dispatchEvent(new Event('blur'));
      check('失焦清除鼠标按下状态', g.input.mouse.down === false);

      // 12) 大地图 + 摄像机（1200x820 视口下 fort 动态规模 = 基础 1920x1280；等距视图）
      g.startMatch({ mapId: 'fort', enemies: 1, lives: 3 });
      g.player.invuln = 999;
      check('大地图加载', g.maze.width === 1920 && g.maze.height === 1280,
        g.maze.width + 'x' + g.maze.height);
      check('大地图启用等距渲染', g.isoActive === true, 'iso=' + g.isoActive);

      // 跟随：相机 = 玩家投影经 iso 钳制
      g.player.x = 1200;
      g.player.y = 900;
      g.update(1 / 60);
      var expC = (function () {
        var pp = g.iso.project(1200, 900, 0);
        return [g.iso.clampCamX(pp.x), g.iso.clampCamY(pp.y)];
      })();
      check('摄像机跟随玩家（iso 钳制）',
        Math.abs(g.camera.x - expC[0]) < 2 && Math.abs(g.camera.y - expC[1]) < 2,
        'cam=' + g.camera.x.toFixed(0) + ',' + g.camera.y.toFixed(0) +
        ' exp=' + expC[0].toFixed(0) + ',' + expC[1].toFixed(0));

      // 钳制验证：玩家移动到投影内容的四个极角（取角点附近可站立格，
      // 冻结玩家控制并让敌人失效，避免测试期间被物理/推移干扰）。
      // 等距内容的极点在菱形四角：每个世界角恰好饱和一个轴（西北饱和 Y、
      // 东北饱和 X、东南饱和 Y、西南饱和 X），另一轴为跟随值。
      var W = g.maze.width, H = g.maze.height;
      function nearWalkable(cx, cy) {
        var idx = g.maze.nearestFree(g.maze.navIndexOf(cx, cy), 14);
        return idx >= 0 ? g.maze.navCenter(idx) : { x: cx, y: cy };
      }
      var corners = [
        { x: 30, y: 30 },          // 西北 → Y 饱和最小
        { x: W - 30, y: 30 },      // 东北 → X 饱和最大
        { x: W - 30, y: H - 30 },  // 东南 → Y 饱和最大
        { x: 30, y: H - 30 }       // 西南 → X 饱和最小
      ];
      for (var ci0 = 0; ci0 < corners.length; ci0++) {
        var np = nearWalkable(corners[ci0].x, corners[ci0].y);
        corners[ci0].x = np.x;
        corners[ci0].y = np.y;
      }
      var savedCtrl = g.playerCtrl;
      g.playerCtrl = null;                       // 冻结玩家控制（updateWorld 置 moveIntent=0）
      for (var tk = 0; tk < g.tanks.length; tk++) if (!g.tanks[tk].isPlayer) g.tanks[tk].alive = false;
      var clampOk = true, clampInfo = '';
      for (var ci = 0; ci < corners.length; ci++) {
        g.player.x = corners[ci].x;
        g.player.y = corners[ci].y;
        g.update(1 / 60);
        var pp = g.iso.project(g.player.x, g.player.y, 0);
        var exX = g.iso.clampCamX(pp.x), exY = g.iso.clampCamY(pp.y);
        if (Math.abs(g.camera.x - exX) > 2 || Math.abs(g.camera.y - exY) > 2) {
          clampOk = false;
          clampInfo += ' @' + ci + '(' + g.camera.x.toFixed(0) + ',' + g.camera.y.toFixed(0) +
            ' exp=' + exX.toFixed(0) + ',' + exY.toFixed(0) + ')';
        }
      }
      g.playerCtrl = savedCtrl;                  // 恢复玩家控制
      // 极值抽查：西北角 Y 应饱和最小、东北角 X 应饱和最大
      var satOk = Math.abs(g.camera.x - g.iso.minX) < 2;   // 循环结束停在西南角 → X 最小
      check('摄像机四角跟随与饱和钳制', clampOk && satOk, clampInfo);

      // 鼠标世界坐标：等距逆投影含摄像机偏移
      g.player.x = 1200;
      g.player.y = 900;
      g.update(1 / 60);
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: rect.left + 200,
        clientY: rect.top + 150,
        bubbles: true
      }));
      g.update(1 / 60);
      var expM = g.iso.unproject(200 + g.camera.x, 150 + g.camera.y);
      check('大地图鼠标映射（iso 逆投影）',
        Math.abs(g.input.mouse.x - expM.x) < 2 && Math.abs(g.input.mouse.y - expM.y) < 2,
        'mouse=' + g.input.mouse.x.toFixed(0) + ',' + g.input.mouse.y.toFixed(0) +
        ' exp=' + expM.x.toFixed(0) + ',' + expM.y.toFixed(0) +
        ' cam=' + g.camera.x.toFixed(0) + ',' + g.camera.y.toFixed(0));

      // 在大地图上多跑几帧，确认渲染（含小地图）不抛异常
      for (var q2 = 0; q2 < 30; q2++) g.update(1 / 60);
      check('大地图连续运行正常', g.state === 'playing' && isFinite(g.camera.x) && isFinite(g.camera.y),
        'state=' + g.state);

      // 13) 地图选择：新增小图 / 大图按钮 + 信息面板 + 进入对局
      var btnSmall = document.querySelector('.choice[data-value="crossfire"]');
      var btnBig = document.querySelector('.choice[data-value="sectors"]');
      check('存在新增地图按钮', !!btnSmall && !!btnBig);
      if (btnSmall) {
        btnSmall.click();
        check('菜单预览切换到新布局', g.menuMaze.layout === 'cross', 'layout=' + g.menuMaze.layout);
        var infoEl = document.getElementById('map-info');
        check('地图信息面板显示战术说明',
          !!infoEl && infoEl.textContent.indexOf('十字') >= 0,
          infoEl ? infoEl.textContent.slice(0, 36) : 'missing');
      }
      if (btnBig) {
        btnBig.click();
        check('大图预览切换', g.menuMaze.layout === 'rooms', 'layout=' + g.menuMaze.layout);
      }
      document.getElementById('btn-start').click();
      g.player.invuln = 999;
      check('新地图可进入对局', g.state === 'playing' && g.maze.layout === 'rooms',
        'state=' + g.state + ' layout=' + (g.maze && g.maze.layout));
      var targets = g.pickupTargets();
      check('新地图生成足量道具',
        g.pickups.length >= targets.min && g.pickups.length <= targets.max,
        g.pickups.length + ' / ' + targets.min + '-' + targets.max);

      // 14) Q / E 主动道具
      g.player.applyPickup('mine');
      g.player.applyPickup('emp');
      var minesBefore = g.mines.length;
      var empBefore = g.player.empCharges;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
      g.update(1 / 60);
      check('Q 键布设地雷', g.mines.length === minesBefore + 1, 'mines=' + g.mines.length);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
      g.update(1 / 60);
      check('E 键释放 EMP', g.player.empCharges === empBefore - 1, 'emp=' + g.player.empCharges);
    } catch (err) {
      failed++;
      out.push('FAIL | 运行时异常 | ' + (err && err.message));
    }
    out.push('---- ' + (failed === 0 ? '全部通过' : failed + ' 项失败') + ' ----');
    var pre = document.createElement('pre');
    pre.id = 'browsercheck';
    pre.textContent = out.join('\\n');
    document.body.appendChild(pre);
  }, 200);
});
</script>
`;

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tmp = path.join(root, '_browsercheck.html');
fs.writeFileSync(tmp, html.replace('</body>', testScript + '</body>'), 'utf8');

let dom = '';
try {
  dom = execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-prefers-reduced-motion',
    '--force-device-scale-factor=1', '--window-size=1200,820',
    '--virtual-time-budget=6000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} finally {
  try { fs.unlinkSync(tmp); } catch (e) { /* ignore */ }
}

const m = dom.match(/<pre id="browsercheck">([\s\S]*?)<\/pre>/);
if (!m) {
  console.log('浏览器检查未产生结果（页面可能未正确加载）。');
  process.exit(1);
}

const lines = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').split('\n');
let failed = 0;
for (const line of lines) {
  console.log('  ' + line);
  if (line.startsWith('FAIL')) failed++;
}
console.log('');
console.log(failed === 0 ? '浏览器端到端检查：全部通过' : '浏览器端到端检查：' + failed + ' 项失败');
process.exit(failed === 0 ? 0 : 1);
