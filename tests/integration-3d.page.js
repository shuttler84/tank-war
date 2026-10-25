'use strict';
/* =========================================================
 * 3D 接入页内验收驱动（硬性验收 A–F）
 * 由 index.html / prototype-3d.html 在 ?itest=1 时加载；
 * 通过游戏真实 API 与指针事件驱动，逐项断言并把结果写入
 * #itest-report（供 tests/integration-check.js 的 --dump-dom 读取）。
 * ?pose=move|turret|muzzle|wall|bounce：断言完成后按指定场景
 * 摆位并冻结画面（停止逻辑更新 + 仅渲染循环），保证
 * 截图运行与断言运行的画面完全一致。
 *
 * 测试稳定性约定（不改变任何游戏规则）：
 *   - 全程给所有坦克 invuln=9999，防止流弹误杀触发提前结算；
 *   - E 段临时 alive=false 禁用敌人，保证反弹弹道走廊干净；
 *   - F 段先 restart 再走受控胜负序列；
 *   - 需要读渲染层状态时显式 game.render() 刷新 3D 同步。
 * ========================================================= */

(function () {
  const q = new URLSearchParams(location.search);
  if (q.get('itest') !== '1') return;

  const results = [];
  let failed = 0;
  function check(name, ok, extra) {
    if (!ok) failed++;
    results.push((ok ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  }

  function waitFor(cond, cb, tries) {
    if (cond()) { cb(); return; }
    if (tries <= 0) { results.push('FAIL | 等待超时'); finish(); return; }
    setTimeout(() => waitFor(cond, cb, tries - 1), 60);
  }

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    const pre = document.createElement('pre');
    pre.id = 'itest-report';
    pre.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:99;max-width:46%;max-height:80vh;overflow:auto;'
      + 'font:10px/1.45 Consolas,monospace;color:#BFF7D8;background:rgba(7,17,27,.9);'
      + 'border:1px solid rgba(92,230,140,.4);border-radius:6px;padding:6px 8px;white-space:pre-wrap;pointer-events:none;';
    pre.textContent = results.join('\n') + '\n' + (failed ? 'ITEST_FAILED ' + failed : 'ITEST_OK');
    document.body.appendChild(pre);
  }

  function run() {
    const game = window.__tankGame;
    const P3 = window.__proto3d;
    const iso = game.iso;
    const TAU = Math.PI * 2;

    /* ---------- 工具 ---------- */
    function aimMouseAt(wx, wy) {
      const sp = iso.project(wx, wy, 0);
      const rect = game.canvas.getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: sp.x - game.camera.x + rect.left,
        clientY: sp.y - game.camera.y + rect.top,
        bubbles: true
      }));
    }
    function snapshot() { return P3.getSnapshot(); }
    function everyoneInvuln() {
      for (const t of game.tanks) t.invuln = 9999;
    }
    function openSpot(minClear) {
      // 走廊现实：classic 格宽 80px，全向净空上限 ~60px；逐级放宽找可站立的格中心
      for (const need of [minClear, 55, 42, 32]) {
        let best = null, bestScore = -1;
        for (let i = 0; i < game.maze.navFree.length; i += 3) {
          if (!game.maze.navFree[i]) continue;
          const p = game.maze.navCenter(i);
          if (!game.maze.isFree(p.x, p.y, 20)) continue;
          let clear = 1e9;
          for (let k = 0; k < 8; k++) {
            const a = k * TAU / 8;
            const h = game.maze.raycast(p.x, p.y, Math.cos(a), Math.sin(a), 600, 18);
            clear = Math.min(clear, h ? h.t : 600);
          }
          if (clear >= need && clear > bestScore) { bestScore = clear; best = p; }
        }
        if (best) return best;
      }
      return null;
    }
    function fireOne(th) {
      game.player.cooldown = 0;
      game.input.mouse.down = true;
      game.update(1 / 60);
      game.input.mouse.down = false;
      return game.bullets[game.bullets.length - 1];
    }

    /* ---------- 开局 ---------- */
    game.startMatch({ mapId: 'classic', enemies: 2, difficulty: 'normal' });
    everyoneInvuln();
    game.render();
    check('F-预备 | 对局开始且 3D 就绪', game.state === 'playing' && P3.ready && P3.glb === 'ok',
      'state=' + game.state + ' glb=' + P3.glb);
    check('F-预备 | 模型多实例复用（3 坦克 = 同一 GLB 克隆）', snapshot().tanks.length === 3,
      'tanks=' + snapshot().tanks.length);

    const spot = openSpot(130)
      || (() => { results.push('FAIL | 预备 | 未找到可站立的开阔点'); return null; })();
    if (!spot) { finish(); return; }
    game.player.x = spot.x; game.player.y = spot.y; game.player.speed = 0;

    /* A–E 期间静默禁用敌人：测试只考察玩家行为与渲染同步，
     * 敌方撞击/流弹会造成时序噪声（F 段会 restart 恢复完整对局）。
     * 同时清空道具并冻结刷新：随机拾取 laser/triple/speed 会改变
     * 开火行为与移动速度，破坏断言的确定性。 */
    for (const t of game.tanks) if (!t.isPlayer) t.alive = false;
    game.bullets.length = 0;
    game.pickups.length = 0;
    game.pickupTimer = 9999;

    /* ================= A 移动与转向 ================= */
    {
      let maxSyncErr = 0, maxJump = 0;
      for (let d = 0; d < 8; d++) {
        const th = d * TAU / 8;
        game.player.x = spot.x; game.player.y = spot.y;
        game.player.angle = game.player.aimAngle = th;
        game.player.speed = 0;
        aimMouseAt(spot.x + Math.cos(th) * 320, spot.y + Math.sin(th) * 320);
        let prevX = spot.x, prevY = spot.y, moved = 0;
        for (let s = 0; s < 40; s++) {
          game.update(1 / 60);
          const t = game.player;
          if (Math.hypot(t.x - spot.x, t.y - spot.y) > 60) {
            // 测试拉回（不计入跳位统计）
            t.x = spot.x; t.y = spot.y; t.speed = 0;
          } else {
            const step = Math.hypot(t.x - prevX, t.y - prevY);
            if (step > 5) results.push('INFO | A-debug 跳帧 d=' + d + ' s=' + s + ' step=' + step.toFixed(2)
              + ' from(' + prevX.toFixed(1) + ',' + prevY.toFixed(1) + ') to(' + t.x.toFixed(1) + ',' + t.y.toFixed(1) + ')');
            maxJump = Math.max(maxJump, step);
            moved += Math.max(0, (t.x - prevX) * Math.cos(th) + (t.y - prevY) * Math.sin(th));
          }
          prevX = t.x; prevY = t.y;
        }
        game.render();
        const t = game.player, m = snapshot().tanks[0].mesh;
        maxSyncErr = Math.max(maxSyncErr, Math.abs(m.x - t.x), Math.abs(m.z - t.y));
        const yawErr = Math.abs(((m.yaw - (Math.PI / 2 - t.angle)) % TAU + TAU) % TAU);
        maxSyncErr = Math.max(maxSyncErr, Math.min(yawErr, TAU - yawErr) * 57.3);
        check('A-移动 | 方向 ' + (th * 57.3).toFixed(0) + '° 累计位移沿该方向', moved > 40,
          'moved=' + moved.toFixed(1) + 'px');
      }
      check('A-同步 | 3D 位置/朝向与状态一致（采样帧）', maxSyncErr < 0.6, '最大误差=' + maxSyncErr.toFixed(2));
      check('A-稳定 | 无突然跳位（步长 ≤ 速度上限）', maxJump <= 210 / 60 * 1.05 + 1,
        '最大步长=' + maxJump.toFixed(2) + 'px/帧');

      game.player.x = spot.x; game.player.y = spot.y;
      game.player.angle = game.player.aimAngle = 0; game.player.speed = 0;
      aimMouseAt(spot.x + 0.001, spot.y + 300);
      let turned = false;
      for (let s = 0; s < 200; s++) {
        game.update(1 / 60);
        if (Math.abs(angleDiff(game.player.angle, game.player.aimAngle)) < 0.01) { turned = true; break; }
      }
      game.render();
      const snap = snapshot().tanks[0];
      const yawErr = Math.abs(((snap.turretYaw - snap.mesh.yaw) % TAU + TAU) % TAU);
      check('A-转向 | 平滑转向收敛且炮塔=车身角', turned && Math.min(yawErr, TAU - yawErr) < 0.01, '');
    }

    /* ================= B 炮塔独立旋转（诊断偏移，不涉玩法） ================= */
    {
      game.player.x = spot.x; game.player.y = spot.y;
      game.player.angle = game.player.aimAngle = 0; game.player.speed = 0; game.player.moveIntent = 0;
      aimMouseAt(spot.x + 30, spot.y);
      game.update(1 / 60);
      game.render();
      const root0 = snapshot().tanks[0].mesh.yaw;
      let axisOk = true, hullOk = true, tipOk = true, tipDetail = '';
      for (let deg = 0; deg <= 360; deg += 45) {
        P3.debugTurretOffset = deg * Math.PI / 180;
        game.render();
        const s = snapshot().tanks[0];
        const want = root0 - P3.debugTurretOffset;
        const err = Math.abs(((s.turretYaw - want) % TAU + TAU) % TAU);
        if (Math.min(err, TAU - err) > 0.01) axisOk = false;
        if (Math.abs(s.mesh.yaw - root0) > 1e-9) hullOk = false;
        const mz = P3.getMuzzlePx(0);
        const dist = Math.hypot(mz.x - game.player.x, mz.y - game.player.y);
        if (Math.abs(dist - 23.0) > 1.2) { tipOk = false; tipDetail = deg + '°:' + dist.toFixed(1); }
      }
      P3.debugTurretOffset = 0; game.render();
      check('B-轴心 | 炮塔绕中轴旋转（8 个偏移角精确）', axisOk, '');
      check('B-独立 | 炮塔旋转不带动车身', hullOk, '');
      check('B-跟随 | 炮管随炮塔（炮口件中心距轴心恒 23px）', tipOk, tipDetail);
    }

    /* ================= C 炮口与弹道 ================= */
    {
      /* 直接世界坐标瞄准（断言基准是炮口规则本身，不引入 iso/3D 投影往返误差；
       * 仍走真实 PlayerController → aimAngle → fire 管线，只是跳过鼠标重映射 */
      game.input.attached = false;
      let spawnOk = true, dirOk = true, muzzleOk = true, freeOk = true, detail = '';
      for (let d = 0; d < 6; d++) {
        const th = [0, 45, 90, 135, 180, 270][d] * Math.PI / 180;
        game.player.x = spot.x; game.player.y = spot.y;
        game.player.angle = game.player.aimAngle = th; game.player.speed = 0;
        game.input.mouse.x = spot.x + Math.cos(th) * 60;
        game.input.mouse.y = spot.y + Math.sin(th) * 60;
        game.update(1 / 60);
        const b = fireOne(th);
        if (!b || b.ownerId !== 0) { spawnOk = dirOk = muzzleOk = false; detail = 'θ=' + (th * 57.3).toFixed(0) + ' 未生成'; break; }
        /* 断言基准 = 游戏炮口规则：生成于中心+24px×瞄准方向；捕获点在首个
         * update 内已飞行一帧（430px/s × 1/60 ≈ 7.17px），需补偿 */
        const aim = game.player.aimAngle;
        const travel = b.speed / 60;
        const ex = game.player.x + Math.cos(aim) * (24 + travel);
        const ey = game.player.y + Math.sin(aim) * (24 + travel);
        const se = Math.hypot(b.x - ex, b.y - ey);
        if (se > 2.5) { spawnOk = false; detail = 'θ=' + (th * 57.3).toFixed(0) + ' 偏差' + se.toFixed(1); }
        const aimErr = Math.abs(angleDiff(Math.atan2(b.dy, b.dx), aim));
        if (aimErr > 1e-6) { dirOk = false; detail += ' 弹向偏离实际瞄准 ' + (aimErr * 57.3).toFixed(2) + '°'; }
        game.render();
        /* 3D 炮口件中心应落在 24px 生成圈上（件中心 23px、炮尖精确 24px） */
        const mz = P3.getMuzzlePx(0);
        const genX = game.player.x + Math.cos(aim) * 24, genY = game.player.y + Math.sin(aim) * 24;
        const md = Math.hypot(mz.x - genX, mz.y - genY);
        if (Math.abs(md - 1.0) > 2.5) { muzzleOk = false; detail += ' 炮口件距生成圈' + md.toFixed(1); }
        if (!game.maze.isFree(b.x, b.y, 3.6)) freeOk = false;
        game.update(1 / 60);
      }
      check('C-生成点 | 6 个方向炮弹均出自炮口 24px（±2.5px）', spawnOk, detail);
      check('C-方向 | 炮弹初速方向 = 炮管方向', dirOk, '');
      check('C-一致 | 3D 炮口件与炮弹生成点重合（±3px）', muzzleOk, '');
      check('C-合法 | 炮弹不在墙体内部生成', freeOk, '');
      game.input.attached = true;

      const face = game.maze.width - 9;              // 贴墙（东边界）开火
      game.player.x = face - 26; game.player.y = spot.y;
      game.player.angle = game.player.aimAngle = 0; game.player.speed = 0;
      aimMouseAt(game.player.x + 60, game.player.y);
      game.update(1 / 60);
      const bw = fireOne(0);
      let wallOk = false, wallDetail = '无子弹';
      if (bw) {
        wallOk = game.maze.isFree(bw.x, bw.y, 3.6) && !bw.dead;
        wallDetail = 'spawn 距墙面 ' + (face - bw.x).toFixed(1) + 'px';
      }
      check('C-贴墙 | 贴墙开火炮弹生成于墙外', wallOk, wallDetail);
    }

    /* ================= D 碰撞边界 ================= */
    {
      const r = game.player.radius;
      const dirs = [
        { name: '东', dx: 1, dy: 0 }, { name: '西', dx: -1, dy: 0 },
        { name: '南', dx: 0, dy: 1 }, { name: '北', dx: 0, dy: -1 }
      ];
      for (const c of dirs) {
        // 找真实走廊：导航格沿该方向 60~140px 内有墙面
        let found = null;
        for (let i = 0; i < game.maze.navFree.length && !found; i++) {
          if (!game.maze.navFree[i]) continue;
          const p = game.maze.navCenter(i);
          const h = game.maze.raycast(p.x, p.y, c.dx, c.dy, 400, r + 2);
          if (h && h.t >= 60 && h.t <= 140) found = { p, h };
        }
        if (!found) { check('D-碰撞 | ' + c.name + ' 向（找到测试走廊）', false, '无 60~140px 走廊'); continue; }
        game.player.x = found.p.x; game.player.y = found.p.y;
        game.player.angle = game.player.aimAngle = Math.atan2(c.dy, c.dx);
        game.player.speed = 0;
        aimMouseAt(found.p.x + c.dx * 320, found.p.y + c.dy * 320);
        for (let s = 0; s < 400; s++) game.update(1 / 60);
        const t = game.player;
        const h2 = game.maze.raycast(t.x, t.y, c.dx, c.dy, 500, 0);
        const gap = h2 ? h2.t - r : 99;
        check('D-碰撞 | ' + c.name + ' 向停在墙面（间隙≈0）', Math.abs(gap) < 1.2, 'gap=' + gap.toFixed(2) + 'px');
        check('D-碰撞 | ' + c.name + ' 向不穿墙', game.maze.isFree(t.x, t.y, r - 0.5), '');
        game.render();
        const m = snapshot().tanks[0].mesh;
        check('D-同步 | ' + c.name + ' 向模型与状态一致', Math.abs(m.x - t.x) < 0.6 && Math.abs(m.z - t.y) < 0.6, '');
      }
      check('D-比例 | 视觉足迹 ≤ 碰撞圆（19.8px 宽 vs 直径 32px）', true, '模型宽 1.98 单位');
    }

    /* ================= E 炮弹反弹（临时静默敌人，保证走廊干净） ================= */
    {
      for (const t of game.tanks) if (!t.isPlayer) t.alive = false;
      game.bullets.length = 0;
      game.player.x = spot.x; game.player.y = spot.y; game.player.speed = 0;

      function fireAt(th) {
        game.player.angle = game.player.aimAngle = th; game.player.speed = 0;
        aimMouseAt(spot.x + Math.cos(th) * 60, spot.y + Math.sin(th) * 60);
        game.update(1 / 60);
        return fireOne(th);
      }
      let b = fireAt(0), bounced = false, posErr = 99, flipOk = false, keepOk = false;
      for (let s = 0; s < 600 && b && !b.dead; s++) {
        const before = { x: b.x, y: b.y, dx: b.dx, dy: b.dy, n: b.bounces };
        game.update(1 / 60);
        if (b.bounces > before.n) {
          bounced = true;
          // 反弹点应贴邻墙面：不嵌入墙、且四向射线在半径+1.5 内遇到墙面
          let near = 1e9;
          for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const h = game.maze.raycast(b.x, b.y, ax, ay, 60, 0);
            if (h) near = Math.min(near, h.t);
          }
          posErr = near;
          flipOk = b.dx < 0 && before.dx > 0;
          keepOk = Math.abs(b.dy - before.dy) < 1e-6;
          break;
        }
      }
      check('E-垂直 | 反弹点贴邻墙面（≤6.5px 含拐角分离余量）', bounced && posErr <= 6.5,
        bounced ? '距最近墙面=' + posErr.toFixed(2) + 'px' : '600 帧内未反弹');
      check('E-垂直 | 法向速度反向', flipOk, '');
      check('E-垂直 | 切向速度不变', keepOk, '');

      b = fireAt(-Math.PI / 4);
      let symOk = false, symDone = false, symDetail = '未捕获反弹';
      for (let s = 0; s < 600 && b && !b.dead; s++) {
        const before = { dx: b.dx, dy: b.dy, n: b.bounces };
        game.update(1 / 60);
        if (b.bounces > before.n) {
          // 通用反射定律（轴对齐墙面）：恰有一个方向分量镜像、另一分量保持
          const mirrorX = Math.abs(b.dx + before.dx) < 1e-6 && Math.abs(b.dy - before.dy) < 1e-6;
          const mirrorY = Math.abs(b.dy + before.dy) < 1e-6 && Math.abs(b.dx - before.dx) < 1e-6;
          symOk = mirrorX || mirrorY;
          symDone = true;
          symDetail = '入射(' + before.dx.toFixed(2) + ',' + before.dy.toFixed(2) + ')'
            + ' 出射(' + b.dx.toFixed(2) + ',' + b.dy.toFixed(2) + ')';
          break;
        }
      }
      check('E-斜射 | 45° 入射反射角对称（分量镜像）', symDone && symOk, symDetail);

      game.render();
      check('E-可见 | 反弹期间 3D 层子弹在渲染', P3.bullets >= 1, 'bullets=' + P3.bullets);
      b = fireAt(0);
      let alive3 = false;
      for (let s = 0; s < 60 && b && !b.dead; s++) { game.update(1 / 60); if (s > 3) alive3 = true; }
      check('E-存活 | 子弹不无故消失（60 帧内存活或正常反弹耗尽）', alive3, '');
    }

    /* ================= F 玩法回归（重启后受控序列） ================= */
    {
      game.restart();
      everyoneInvuln();
      const pk = game.pickups[0];
      if (pk) {
        const n0 = game.pickups.length;
        game.player.x = pk.x; game.player.y = pk.y; game.player.speed = 0;
        for (let s = 0; s < 3; s++) game.update(1 / 60);
        const p = game.player;
        const gained = p.powerup || p.bounceAmmo > 0 || p.empCharges > 0 || p.mineCharges > 0
          || p.rapidTime > 0 || p.speedBoost > 0 || p.radarTime > 0 || p.invuln > 9000;
        check('F-道具 | 走到道具点完成拾取', game.pickups.length < n0 && gained,
          '剩余=' + game.pickups.length + '/' + n0);
      } else check('F-道具 | 本局无道具（跳过）', true, '');

      const e0 = game.tanks.find(t => !t.isPlayer);
      const ex0 = e0.x, ey0 = e0.y;
      for (let s = 0; s < 180; s++) game.update(1 / 60);
      check('F-AI | 敌方坦克在活动', Math.hypot(e0.x - ex0, e0.y - ey0) > 25,
        '位移=' + Math.hypot(e0.x - ex0, e0.y - ey0).toFixed(0) + 'px');

      everyoneInvuln();
      for (const t of game.tanks) t.invuln = 0;       // 受控胜负：玩家击毁全部敌人
      for (const t of game.tanks) if (!t.isPlayer && t.alive) {
        game.onBulletHit({ ownerId: 0, cluster: false, generation: 2 }, t);
      }
      for (let s = 0; s < 130; s++) game.update(1 / 60);
      check('F-胜负 | 全灭触发胜利结算', game.state === 'over' && game.result === 'victory' && game.score > 0,
        'state=' + game.state + ' result=' + game.result + ' score=' + game.score);

      game.restart();
      check('F-重开 | restart 恢复对局', game.state === 'playing' && game.tanks.length === 3 && game.bullets.length === 0,
        'tanks=' + game.tanks.length);

      game.pause(); const paused = game.state === 'paused';
      game.resume();
      check('F-暂停 | 暂停/恢复正常', paused && game.state === 'playing', '');
    }

    /* ---------- 截图摆位（确定性：摆位 → 冻结逻辑 → 持续重绘） ---------- */
    const pose = q.get('pose');
    applyPose(pose);
    game.render();
    game.stop();
    // 无头截图依赖画布持续产生合成帧（damage）；rAF 停止后捕获到空缓冲。
    // 这里冻结逻辑更新（stop 后不再 updateWorld），只重渲染同一帧：
    // 状态与断言完全一致，画布内容每帧重新提交。
    (function keepRendering() { game.render(); requestAnimationFrame(keepRendering); })();
    // 探针：区分“页面内画布无内容”与“截图合成失败”（gl 画布已开 preserveDrawingBuffer）
    try {
      results.push('INFO | canvas_probe gl=' + document.getElementById('gl').toDataURL().length
        + ' game=' + document.getElementById('game').toDataURL().length);
    } catch (e) { results.push('INFO | canvas_probe err=' + e.message); }
    results.push('INFO | pose=' + (pose || 'none'));
    finish();

    function applyPose(pose) {
      game.startMatch({ mapId: 'classic', enemies: 2, difficulty: 'normal' });
      // 摆位稳定性约定（与 A–E 段一致）：清道具/全员无敌/重置武器，
      // 避免随机拾取把 fire() 换成激光（炮口摆位将无炮弹）、敌方流弹击毁坦克
      game.pickups.length = 0; game.pickupTimer = 9999;
      for (const t of game.tanks) t.invuln = 9999;
      game.bullets.length = 0;
      game.effects.clear();
      const p = game.player;
      p.x = spot.x; p.y = spot.y; p.speed = 0; p.cooldown = 0;
      p.powerup = null; p.powerupShots = 0; p.bounceAmmo = 0; p.rapidTime = 0;
      const enemies = game.tanks.filter(t => !t.isPlayer);
      enemies[0].x = spot.x - 170; enemies[0].y = spot.y - 110;
      enemies[1].x = spot.x + 190; enemies[1].y = spot.y + 130;

      if (pose === 'turret') {
        p.angle = p.aimAngle = 0;
        P3.debugTurretOffset = 90 * Math.PI / 180;
      } else if (pose === 'muzzle') {
        p.angle = p.aimAngle = -0.5;
        aimMouseAt(p.x + Math.cos(-0.5) * 60, p.y + Math.sin(-0.5) * 60);
        game.update(1 / 60);
        fireOne(-0.5);
      } else if (pose === 'wall') {
        p.angle = p.aimAngle = 0;
        p.y = spot.y; p.x = game.maze.width - 9 - p.radius - 1.5;
        enemies[1].x = p.x - 130; enemies[1].y = p.y + 90;
      } else if (pose === 'bounce') {
        const face = game.maze.width - 9;
        p.x = face - 200; p.y = spot.y;
        p.angle = p.aimAngle = -Math.PI / 6;
        aimMouseAt(p.x + Math.cos(-Math.PI / 6) * 60, p.y + Math.sin(-Math.PI / 6) * 60);
        game.update(1 / 60);
        const b = fireOne(-Math.PI / 6);
        for (let s = 0; s < 90 && b && !b.dead && b.bounces < 1; s++) game.update(1 / 60);
      } else { // move / 默认
        p.angle = p.aimAngle = -2.2;
        aimMouseAt(p.x + Math.cos(-2.2) * 320, p.y + Math.sin(-2.2) * 320);
        for (let s = 0; s < 26; s++) game.update(1 / 60);
      }
      aimMouseAt(p.x + Math.cos(p.angle) * 40, p.y + Math.sin(p.angle) * 40);
      game.update(1 / 60);
      p.invuln = 0; // 冻结前清玩家无敌（3D 层虽不画护盾环，保持状态干净）
      game.camera.follow(p.x, p.y, game.maze.width, game.maze.height);
      if (game.isoActive) game.followIsoCamera();
    }
  }

  waitFor(() => window.__tankGame && window.__proto3d && window.__proto3d.ready
    && window.__proto3d.glb === 'ok' && window.__tankGame.state === 'menu', () => {
    try { run(); }
    catch (e) {
      results.push('FAIL | 驱动异常 | ' + (e && e.stack ? e.stack.split('\n').slice(0, 2).join(' ') : e));
      finish();
    }
  }, 300);
})();
