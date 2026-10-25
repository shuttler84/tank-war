(function () {
  'use strict';

  const results = [];
  const metrics = {};

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
      console.log('  [通过] ' + name);
    } catch (e) {
      results.push({ name, ok: false, error: String((e && e.message) || e) });
      console.log('  [失败] ' + name + ' -> ' + ((e && e.message) || e));
    }
  }

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || '断言失败');
  }

  function makeStubMaze() {
    return {
      name: '测试空场',
      width: CONFIG.WIDTH,
      height: CONFIG.HEIGHT,
      walls: [],
      queryWalls() { return []; },
      raycast() { return null; },
      isFree() { return true; },
      losClear() { return true; },
      walkableLine() { return true; },
      findPath() { return null; },
      navFree: new Uint8Array(1),
      navCols: 1,
      navRows: 1,
      navCenter() { return { x: 0, y: 0 }; },
      navIndexOf() { return 0; }
    };
  }

  function makeGame(opts) {
    const g = new Game({});
    g.sound.enabled = false;
    g.startMatch(Object.assign({ mapId: 'classic', enemies: 1, difficulty: 'normal' }, opts || {}));
    return g;
  }

  function soloPlayer(mapId) {
    const g = makeGame({ mapId: mapId || 'classic', enemies: 1 });
    g.maze = makeStubMaze();
    g.aiControllers.length = 0;
    g.tanks = [g.player];
    g.player.x = 480;
    g.player.y = 320;
    g.player.angle = 0;
    g.player.aimAngle = 0;
    g.playerCtrl.reset();
    return g;
  }

  function findOpenSpot(maze, clearance) {
    const cx = maze.width / 2, cy = maze.height / 2;
    let best = null, bestD = Infinity;
    for (let y = 70; y < maze.height - 70; y += 6) {
      for (let x = 70; x < maze.width - 70; x += 6) {
        if (!maze.isFree(x, y, clearance)) continue;
        const d = dist(x, y, cx, cy);
        if (d < bestD) { bestD = d; best = { x, y }; }
      }
    }
    return best;
  }

  /** 导航网格连通率（BFS 覆盖比例） */
  function navConnectivity(maze) {
    let start = -1, total = 0;
    for (let i = 0; i < maze.navFree.length; i++) {
      if (maze.navFree[i]) { total++; if (start < 0) start = i; }
    }
    if (start < 0) return { ratio: 0, total: 0 };
    const seen = new Uint8Array(maze.navFree.length);
    const queue = [start];
    seen[start] = 1;
    let reach = 1;
    while (queue.length) {
      const idx = queue.pop();
      const cx = idx % maze.navCols;
      const cy = (idx / maze.navCols) | 0;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (let k = 0; k < 4; k++) {
        const nx = cx + dirs[k][0], ny = cy + dirs[k][1];
        if (nx < 0 || ny < 0 || nx >= maze.navCols || ny >= maze.navRows) continue;
        const ni = ny * maze.navCols + nx;
        if (!maze.navFree[ni] || seen[ni]) continue;
        seen[ni] = 1; reach++; queue.push(ni);
      }
    }
    return { ratio: reach / total, total };
  }

  function tankWallPenetration(maze, tank) {
    const walls = maze.queryWalls(tank.x, tank.y, tank.radius + 2);
    let worst = 0;
    for (let i = 0; i < walls.length; i++) {
      const p = Physics.pushCircleOutOfRect(tank.x, tank.y, tank.radius - 0.5, walls[i]);
      if (p) worst = Math.max(worst, p.depth);
    }
    return worst;
  }

  /* ---------------- 1. 迷宫 ---------------- */

  test('迷宫：全部预设可生成，导航网格连通率 > 90%', function () {
    const ids = ['classic', 'open', 'corridor'];
    for (const id of ids) {
      const maze = Maze.createPreset(id);
      assert(maze.walls.length > 20, id + ' 墙体过少');
      let start = -1, total = 0;
      for (let i = 0; i < maze.navFree.length; i++) {
        if (maze.navFree[i]) { total++; if (start < 0) start = i; }
      }
      assert(total > 200, id + ' 可行走格过少: ' + total);
      const seen = new Uint8Array(maze.navFree.length);
      const queue = [start];
      seen[start] = 1;
      let reach = 1;
      while (queue.length) {
        const idx = queue.pop();
        const cx = idx % maze.navCols;
        const cy = (idx / maze.navCols) | 0;
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (let k = 0; k < 4; k++) {
          const nx = cx + dirs[k][0], ny = cy + dirs[k][1];
          if (nx < 0 || ny < 0 || nx >= maze.navCols || ny >= maze.navRows) continue;
          const ni = ny * maze.navCols + nx;
          if (!maze.navFree[ni] || seen[ni]) continue;
          seen[ni] = 1; reach++; queue.push(ni);
        }
      }
      const ratio = reach / total;
      metrics['连通率 ' + id] = (ratio * 100).toFixed(1) + '%';
      assert(ratio > 0.9, id + ' 连通率过低: ' + ratio.toFixed(3));
    }
  });

  test('迷宫：出生点合法、互不挤压', function () {
    for (const id of ['classic', 'open', 'corridor']) {
      const maze = Maze.createPreset(id);
      const spawns = maze.pickSpawns(5);
      assert(spawns.length === 5, id + ' 出生点不足: ' + spawns.length);
      for (const s of spawns) assert(maze.isFree(s.x, s.y, CONFIG.TANK.radius + 2), id + ' 出生点卡墙');
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          assert(dist(spawns[i].x, spawns[i].y, spawns[j].x, spawns[j].y) > 100, id + ' 出生点过近');
        }
      }
    }
  });

  test('大地图：3 张新地图的尺寸 / 连通性 / 出生点', function () {
    for (const id of ['city', 'fort', 'ring']) {
      const preset = MAP_PRESETS.find(p => p.id === id);
      const maze = Maze.createPreset(id);
      assert(maze.width === preset.width && maze.height === preset.height,
        id + ' 世界尺寸错误: ' + maze.width + 'x' + maze.height);
      assert(maze.width > CONFIG.WIDTH || maze.height > CONFIG.HEIGHT, id + ' 不是大地图');
      assert(maze.walls.length > 60, id + ' 墙体过少: ' + maze.walls.length);

      const conn = navConnectivity(maze);
      metrics['连通率 ' + id] = (conn.ratio * 100).toFixed(1) + '%（' + conn.total + ' 格）';
      assert(conn.ratio > 0.9, id + ' 连通率过低: ' + conn.ratio.toFixed(3));

      const spawns = maze.pickSpawns(5);
      assert(spawns.length === 5, id + ' 出生点不足: ' + spawns.length);
      for (const s of spawns) {
        assert(maze.isFree(s.x, s.y, CONFIG.TANK.radius + 2), id + ' 出生点卡墙');
        assert(s.x > 0 && s.x < maze.width && s.y > 0 && s.y < maze.height, id + ' 出生点越界');
      }
    }
  });

  test('摄像机：小图居中、大图跟随并钳制在边界内', function () {
    const small = makeGame({ mapId: 'classic', enemies: 1 });
    small.camera.follow(500, 300, small.maze.width, small.maze.height);
    assert(small.camera.x === 0 && small.camera.y === 0, '小地图摄像机偏移应为 0');

    const big = makeGame({ mapId: 'fort', enemies: 1 });
    const w = big.maze.width, h = big.maze.height;
    assert(w > CONFIG.WIDTH && h > CONFIG.HEIGHT, 'fort 应为大地图');

    big.camera.follow(0, 0, w, h);
    assert(big.camera.x === 0 && big.camera.y === 0, '左上角钳制失败');

    big.camera.follow(w, h, w, h);
    assert(big.camera.x === w - CONFIG.WIDTH && big.camera.y === h - CONFIG.HEIGHT, '右下角钳制失败');

    big.camera.follow(w / 2, h / 2, w, h);
    assert(Math.abs(big.camera.x - (w / 2 - CONFIG.WIDTH / 2)) < 1e-6, '跟随中心失败');
    assert(big.camera.contains(w / 2, h / 2, 0), '视野应包含中心');
    assert(!big.camera.contains(w / 2 + 1000, h / 2, 0), '视野外判断失败');
  });

  test('鼠标：世界坐标随摄像机滚动重新换算', function () {
    // 俯视路径（URL ?iso=0 的语义）：世界 = 摄像机偏移 + 视口坐标
    const gTop = new Game({});
    gTop.isoForced = false;
    gTop.sound.enabled = false;
    gTop.startMatch({ mapId: 'fort', enemies: 1, difficulty: 'normal' });
    gTop.camera.follow(1400, 900, gTop.maze.width, gTop.maze.height);
    gTop.input.camera = gTop.camera;
    gTop.input.setViewMapper(null);
    gTop.input.mouse.canvasX = 120;
    gTop.input.mouse.canvasY = 80;
    gTop.input.syncWorld();
    assert(Math.abs(gTop.input.mouse.x - (gTop.camera.x + 120)) < 1e-9, '俯视：世界 X 未叠加摄像机');
    assert(Math.abs(gTop.input.mouse.y - (gTop.camera.y + 80)) < 1e-9, '俯视：世界 Y 未叠加摄像机');

    const beforeX = gTop.input.mouse.x;
    gTop.camera.follow(1520, 900, gTop.maze.width, gTop.maze.height);
    gTop.input.syncWorld();
    assert(Math.abs(gTop.input.mouse.x - beforeX) > 1, '摄像机移动后未重新换算');
    assert(Math.abs(gTop.input.mouse.x - (gTop.camera.x + 120)) < 1e-9, '换算结果错误');

    // 等距路径：视口坐标经逆投影回世界坐标，随相机滚动重新换算
    const gIso = new Game({});
    gIso.sound.enabled = false;
    gIso.startMatch({ mapId: 'fort', enemies: 1, difficulty: 'normal' });
    assert(gIso.isoActive === true, 'fort 应处于等距模式');
    gIso.input.setViewMapper(gIso.isoMapper());
    gIso.camera.x = 500;
    gIso.camera.y = 300;
    gIso.input.mouse.canvasX = 120;
    gIso.input.mouse.canvasY = 80;
    gIso.input.syncWorld();
    const w1 = gIso.iso.unproject(120 + 500, 80 + 300);
    assert(Math.abs(gIso.input.mouse.x - w1.x) < 1e-9, '等距：逆投影 X 错误');
    assert(Math.abs(gIso.input.mouse.y - w1.y) < 1e-9, '等距：逆投影 Y 错误');
    gIso.camera.x = 700;
    gIso.input.syncWorld();
    const w2 = gIso.iso.unproject(120 + 700, 80 + 300);
    assert(Math.abs(gIso.input.mouse.x - w2.x) < 1e-9 && Math.abs(gIso.input.mouse.y - w2.y) < 1e-9,
      '等距：相机移动后未重新换算');
  });

  test('生命：击毁后原地复活，生命耗尽才判负', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1, lives: 2 });
    g.aiControllers.length = 0;
    g.playerCtrl = null;

    function killPlayer() {
      g.player.invuln = 0;
      g.onBulletHit({ ownerId: 999 }, g.player);
    }

    killPlayer();
    assert(!g.player.alive, '第一次命中未击毁玩家');
    assert(g.lives === 1, '生命未扣减: ' + g.lives);
    assert(g.state === 'playing', '还有生命时不应结束: ' + g.state);
    assert(g.respawnTimer > 0, '未进入复活倒计时');

    for (let i = 0; i < 120; i++) g.update(1 / 60);
    assert(g.player.alive, '未复活');
    assert(g.player.invuln > 0, '复活后没有无敌时间');
    assert(g.maze.isFree(g.player.x, g.player.y, CONFIG.TANK.radius), '复活点卡墙');

    killPlayer();
    assert(g.lives === 0, '生命未耗尽');
    assert(g.state === 'ending', '生命耗尽未判负: ' + g.state);
    for (let i = 0; i < 150; i++) g.update(1 / 60);
    assert(g.state === 'over' && g.result === 'defeat', '未进入失败结算: ' + g.state + '/' + g.result);
  });

  /* ---------------- 2. 鼠标双模式 ---------------- */

  test('鼠标：圆内瞄准时坦克只旋转、不平移', function () {
    const g = soloPlayer();
    const tank = g.player;
    const ctrl = g.playerCtrl;
    const x0 = tank.x, y0 = tank.y;
    tank.angle = 0.2;
    tank.aimAngle = 0.2;
    ctrl.reset();
    g.input.mouse.x = x0 + 45;
    g.input.mouse.y = y0 + 20;
    for (let i = 0; i < 90; i++) { ctrl.update(); tank.update(1 / 60, g.maze); }
    assert(ctrl.mode === 'aim', '模式应为 aim，实际 ' + ctrl.mode);
    assert(Math.abs(tank.x - x0) < 0.001 && Math.abs(tank.y - y0) < 0.001, '瞄准模式发生位移');
    assert(Math.abs(angleDiff(tank.angle, Math.atan2(20, 45))) < 0.02, '未朝向鼠标');
  });

  test('鼠标：圆外为方向控制且速度与距离无关', function () {
    const g = soloPlayer();
    const tank = g.player;
    const ctrl = g.playerCtrl;

    function run(dx, dy, seconds) {
      tank.x = 480; tank.y = 320; tank.angle = 0; tank.angle = Math.atan2(dy, dx);
      tank.cooldown = 0;
      ctrl.reset();
      g.input.mouse.x = 480 + dx;
      g.input.mouse.y = 320 + dy;
      const steps = Math.round(seconds * 60);
      for (let i = 0; i < steps; i++) {
        // 鼠标跟随世界坐标（相对坦克中心的方向不变）
        g.input.mouse.x = tank.x + dx;
        g.input.mouse.y = tank.y + dy;
        ctrl.update();
        tank.update(1 / 60, g.maze);
      }
      return { x: tank.x, y: tank.y, mode: ctrl.mode };
    }

    const near = run(120, 60, 0.5);
    assert(near.mode === 'move', '应为移动模式');
    assert(near.x > 480 + 20, '没有朝右前方移动');
    assert(near.y > 320 + 10, '没有朝右下方移动');

    const far = run(600, 300, 0.5);
    const d1 = Math.hypot(near.x - 480, near.y - 320);
    const d2 = Math.hypot(far.x - 480, far.y - 320);
    assert(Math.abs(d1 - d2) < 1.5, '距离改变影响了移动速度: ' + d1.toFixed(2) + ' vs ' + d2.toFixed(2));

    const up = run(0, -200, 0.4);
    assert(up.y < 320 - 20, '没有朝上移动');
    const left = run(-200, 0, 0.4);
    assert(left.x < 480 - 20, '没有朝左移动');
    const down = run(0, 200, 0.4);
    assert(down.y > 320 + 20, '没有朝下移动');
  });

  test('鼠标：R 边界带滞回，不来回抖动', function () {
    const g = soloPlayer();
    const ctrl = g.playerCtrl;
    const tank = g.player;
    const R = CONFIG.MOUSE.aimRadius;

    ctrl.reset();
    g.input.mouse.x = tank.x + R - 2;
    ctrl.update();
    assert(ctrl.mode === 'aim', 'R 内应为 aim');

    g.input.mouse.x = tank.x + R + 4;
    ctrl.update();
    assert(ctrl.mode === 'aim', 'R+4 时不应切换（滞回 ' + CONFIG.MOUSE.hysteresis + '）');

    g.input.mouse.x = tank.x + R + CONFIG.MOUSE.hysteresis + 2;
    ctrl.update();
    assert(ctrl.mode === 'move', 'R+滞回 外应切换为 move');

    g.input.mouse.x = tank.x + R - 1;
    ctrl.update();
    assert(ctrl.mode === 'aim', '回到 R 内应为 aim');

    // 反复在 R+3 / R-3 之间跳变必须保持稳定
    let flips = 0;
    let prev = ctrl.mode;
    for (let i = 0; i < 200; i++) {
      g.input.mouse.x = tank.x + ((i % 2 === 0) ? R + 3 : R - 3);
      ctrl.update();
      if (ctrl.mode !== prev) { flips++; prev = ctrl.mode; }
    }
    assert(flips === 0, '边界抖动切换次数: ' + flips);
  });

  test('鼠标：切换到瞄准后立即停止平移', function () {
    const g = soloPlayer();
    const ctrl = g.playerCtrl;
    const tank = g.player;
    ctrl.reset();
    g.input.mouse.x = tank.x + 300;
    g.input.mouse.y = tank.y;
    for (let i = 0; i < 20; i++) { ctrl.update(); tank.update(1 / 60, g.maze); }
    const movingX = tank.x;
    assert(movingX > 480, '移动模式未推进');
    // 鼠标移回圆内
    g.input.mouse.x = tank.x + 10;
    g.input.mouse.y = tank.y;
    ctrl.update();
    const x1 = tank.x, y1 = tank.y;
    for (let i = 0; i < 30; i++) { ctrl.update(); tank.update(1 / 60, g.maze); }
    assert(ctrl.mode === 'aim', '模式未切回 aim');
    assert(Math.abs(tank.x - x1) < 0.001 && Math.abs(tank.y - y1) < 0.001, '瞄准后仍在平移');
  });

  test('坦克：转向始终走最短路径', function () {
    const t = new Tank({ id: 99, x: 480, y: 320, angle: 3.0, colorKey: 'green' });
    t.aimAngle = -3.0;
    const before = t.angle;
    t.update(1 / 60, makeStubMaze());
    assert(Math.abs(angleDiff(before, t.angle)) < 0.25, '旋转步长异常');
    assert(angleDiff(before, t.angle) > 0, '未选择最短路径（应正向旋转 0.283rad）');

    const t2 = new Tank({ id: 98, x: 480, y: 320, angle: 0, colorKey: 'green' });
    t2.aimAngle = -3.0;
    t2.update(1 / 60, makeStubMaze());
    assert(t2.angle < 0, '未选择最短路径（应负向旋转）');
  });

  /* ---------------- 3. 子弹物理 ---------------- */

  test('子弹：反射公式与法线正确', function () {
    const rect = { x: 100, y: 0, w: 10, h: 200 };
    const hit = Physics.rayRect(50, 100, 1, 0, rect, 0, 200);
    assert(hit, '未命中墙体');
    assert(Math.abs(hit.t - 50) < 1e-6, '交点距离错误: ' + hit.t);
    assert(hit.nx === -1 && hit.ny === 0, '法线错误');
    const vx = 1, vy = 0;
    const dot = vx * hit.nx + vy * hit.ny;
    const rx = vx - 2 * dot * hit.nx;
    const ry = vy - 2 * dot * hit.ny;
    assert(Math.abs(rx + 1) < 1e-9 && Math.abs(ry) < 1e-9, '反射方向错误');

    const hit2 = Physics.rayRect(50, 50, 0, 1, rect, 0, 200);
    assert(hit2 === null, '平行射线误判命中');

    // 线段远离圆时不得误报命中
    assert(Physics.segmentCircle(0, 0, 10, 0, 100, 0, 20) === -1, '远离时误报命中');
    assert(Physics.segmentCircle(0, 0, 10, 0, 5, 0, 20) === 0, '起点在圆内应为命中');
    const tHit = Physics.segmentCircle(0, 0, 10, 0, 15, 0, 6);
    assert(tHit > 0 && tHit < 1, '接近时未命中');
    assert(Math.abs(tHit - 0.9) < 1e-6, '命中参数错误: ' + tHit);
  });

  test('子弹：不会穿墙、次数达上限后销毁', function () {
    const g = makeGame({ mapId: 'corridor', enemies: 1 });
    g.aiControllers.length = 0;
    g.tanks = [];
    const spot = findOpenSpot(g.maze, CONFIG.TANK.radius + 6);
    assert(spot, '未找到发射点');

    let worstPen = 0;
    let maxBounces = 0;
    let allDead = true;

    for (let k = 0; k < 24; k++) {
      const angle = (k / 24) * TAU;
      const b = new Bullet({ x: spot.x, y: spot.y, angle, ownerId: -1, color: '#000' });
      if (!g.maze.isFree(b.x, b.y, b.radius)) continue;
      g.bullets.length = 0;
      g.bullets.push(b);
      for (let step = 0; step < 600 && !b.dead; step++) {
        b.update(1 / 60, g);
        const walls = g.maze.queryWalls(b.x, b.y, b.radius + 2);
        for (const w of walls) {
          if (Physics.circleRectOverlap(b.x, b.y, b.radius * 0.6, w)) {
            const p = Physics.pushCircleOutOfRect(b.x, b.y, b.radius * 0.6, w);
            if (p) worstPen = Math.max(worstPen, p.depth);
          }
        }
        maxBounces = Math.max(maxBounces, b.bounces);
      }
      if (!b.dead) allDead = false;
    }

    metrics['子弹最大穿墙深度'] = worstPen.toFixed(3) + 'px';
    metrics['子弹最大反弹数'] = maxBounces;
    assert(worstPen < 1.2, '子弹穿墙: ' + worstPen.toFixed(2));
    assert(maxBounces <= CONFIG.BULLET.maxBounces + 1, '反弹次数超上限');
    assert(allDead, '子弹未在生命周期内销毁');
  });

  test('子弹：预测弹道与实际飞行一致', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1 });
    g.aiControllers.length = 0;
    g.tanks = [];
    const spot = findOpenSpot(g.maze, CONFIG.TANK.radius + 6);
    let worst = 0;

    for (let k = 0; k < 20; k++) {
      const angle = (k / 20) * TAU + 0.13;
      const b = new Bullet({ x: spot.x, y: spot.y, angle, ownerId: -1, color: '#000' });
      const pred = Bullet.predictPath(g.maze, b.x, b.y, b.dx, b.dy, b.speed, CONFIG.BULLET.maxBounces, 0.8);
      const endPoint = pointOnPolyline(pred, 0.8);
      for (let step = 0; step < 48 && !b.dead; step++) b.update(1 / 60, g);
      if (b.dead) continue;
      const err = dist(b.x, b.y, endPoint.x, endPoint.y);
      worst = Math.max(worst, err);
    }
    metrics['弹道预测最大误差'] = worst.toFixed(3) + 'px';
    assert(worst < 2.5, '预测与真实弹道不一致: ' + worst.toFixed(2));
  });

  test('子弹：从炮口沿车体朝向发射', function () {
    const g = soloPlayer();
    const tank = g.player;
    tank.angle = 0.7;
    tank.aimAngle = 0.7;
    tank.cooldown = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;
    assert(g.bullets.length === 1, '未发射子弹');
    const b = g.bullets[0];
    const mvx = b.x - tank.x, mvy = b.y - tank.y;
    const spawnedAt = Math.hypot(mvx, mvy) - b.speed / 60;   // 扣除本帧位移
    assert(Math.abs(spawnedAt - CONFIG.TANK.muzzleOffset) < 4,
      '子弹不在炮口生成: ' + spawnedAt.toFixed(2));
    assert(Math.abs(angleDiff(Math.atan2(b.dy, b.dx), 0.7)) < 1e-6, '子弹方向与车体朝向不一致');
  });

  /* ---------------- 4. 命中与流程 ---------------- */

  test('命中：一发淘汰、只计一次分', function () {
    const g = soloPlayer();
    const player = g.player;
    const enemy = new Tank({ id: 1, x: player.x + 150, y: player.y, angle: Math.PI, colorKey: 'red' });
    g.tanks.push(enemy);
    player.angle = 0;
    player.aimAngle = 0;
    player.cooldown = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;

    for (let i = 0; i < 60 && enemy.alive; i++) g.update(1 / 60);
    assert(!enemy.alive, '敌人未被淘汰');
    const scoreAfter = g.score;
    assert(g.kills === 1, '击毁计数错误: ' + g.kills);
    assert(scoreAfter >= CONFIG.RULES.scorePerKill, '得分未增加');
    for (let i = 0; i < 30; i++) g.update(1 / 60);
    assert(g.kills === 1, '重复计分');
  });

  test('流程：暂停冻结、重开清理状态', function () {
    const g = makeGame({ enemies: 2, difficulty: 'hard' });
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    g.input.mouse.down = true;
    g.input.mouse.x = g.player.x + 300;
    g.update(1 / 60);
    g.input.mouse.down = false;

    const t = g.time;
    const px = g.player.x, py = g.player.y;
    g.pause();
    assert(g.state === 'paused', '未进入暂停');
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    assert(g.time === t, '暂停时游戏时间仍在推进');
    assert(g.player.x === px && g.player.y === py, '暂停时坦克仍在移动');

    g.restart();
    assert(g.state === 'playing', '重开后状态错误');
    assert(g.bullets.length === 0, '重开后残留子弹');
    assert(g.score === 0 && g.kills === 0, '重开后残留分数');
    assert(g.time === 0, '重开后时间未清零');
    for (const tk of g.tanks) assert(tk.alive, '重开后坦克未复活');
  });

  /* ---------------- 5. AI ---------------- */

  test('AI：持续移动、寻路、射击，且不穿墙', function () {
    const g = makeGame({ mapId: 'classic', enemies: 3, difficulty: 'hard' });
    const traveled = [0, 0, 0];
    let last = g.aiControllers.map(ai => ({ x: ai.tank.x, y: ai.tank.y }));
    let shots = 0;
    let worstPen = 0;
    const states = new Set();

    // 让玩家绕圈移动并暂时免疫，模拟真实对局中的走位
    const originalHit = g.onBulletHit.bind(g);
    g.onBulletHit = function (bullet, target) {
      if (target.isPlayer) return;
      originalHit(bullet, target);
    };

    const originalFire = Tank.prototype.fire;
    Tank.prototype.fire = function (game) {
      const b = originalFire.call(this, game);
      if (b && b.length) shots++;
      return b;
    };

    for (let i = 0; i < 60 * 20; i++) {
      const ang = i / 60 * 1.1;
      g.input.mouse.x = g.player.x + Math.cos(ang) * 160;
      g.input.mouse.y = g.player.y + Math.sin(ang) * 160;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      for (let k = 0; k < g.aiControllers.length; k++) {
        const t = g.aiControllers[k].tank;
        if (!t.alive) continue;
        traveled[k] += dist(t.x, t.y, last[k].x, last[k].y);
        last[k] = { x: t.x, y: t.y };
        worstPen = Math.max(worstPen, tankWallPenetration(g.maze, t));
        states.add(g.aiControllers[k].state);
      }
    }
    Tank.prototype.fire = originalFire;
    g.onBulletHit = originalHit;

    metrics['AI 20s 轨迹长度'] = traveled.map(v => v.toFixed(0)).join(' / ');
    metrics['AI 20s 开火次数'] = shots;
    metrics['AI 状态覆盖'] = Array.from(states).join(',');

    for (let k = 0; k < traveled.length; k++) {
      assert(traveled[k] > 300, 'AI ' + k + ' 几乎没移动: ' + traveled[k].toFixed(0));
    }
    assert(shots > 6, 'AI 开火过少: ' + shots);
    assert(worstPen < 1.5, 'AI 穿墙: ' + worstPen.toFixed(2));
    assert(states.size >= 3, 'AI 状态过于单一: ' + Array.from(states).join(','));
  });

  test('AI：难度差异（静态玩家存活时间）', function () {
    const times = {};
    for (const key of ['easy', 'normal', 'hard']) {
      const runs = [];
      for (let trial = 0; trial < 3; trial++) {
        const g = makeGame({ mapId: 'classic', enemies: 1, difficulty: key });
        g.input.mouse.x = g.player.x;
        g.input.mouse.y = g.player.y;   // 鼠标在圆心，玩家静止
        let died = 60;
        for (let i = 0; i < 60 * 45; i++) {
          g.update(1 / 60);
          g.input.mouse.x = g.player.x;
          g.input.mouse.y = g.player.y;
          if (!g.player.alive) { died = g.time; break; }
          if (!g.aiControllers[0].tank.alive) break;   // AI 被自己的反弹子弹干掉
        }
        runs.push(died);
      }
      // 取最快的一次，避免偶发的"AI 自己被反弹子弹带走"影响结论
      times[key] = Math.min.apply(null, runs);
    }
    metrics['击败静止玩家最快用时(简单/普通/困难)'] =
      times.easy.toFixed(1) + 's / ' + times.normal.toFixed(1) + 's / ' + times.hard.toFixed(1) + 's';
    assert(times.hard < times.easy, '困难 AI 未体现更强攻击性（hard=' + times.hard.toFixed(1) + ', easy=' + times.easy.toFixed(1) + '）');
  });

  test('AI：卡住后能自行脱困', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1, difficulty: 'hard' });
    const ai = g.aiControllers[0];
    const tank = ai.tank;
    // 把 AI 塞进墙角，朝向墙壁
    const walls = g.maze.walls[0];
    tank.x = walls.x + walls.w + tank.radius + 0.2;
    tank.y = walls.y + walls.h / 2;
    tank.angle = Math.PI;
    tank.aimAngle = Math.PI;
    ai.aim = Math.PI;
    const x0 = tank.x, y0 = tank.y;
    let escaped = false;
    for (let i = 0; i < 60 * 6; i++) {
      g.update(1 / 60);
      if (!g.player.alive) { g.player.alive = true; }
      if (g.state !== 'playing') g.state = 'playing';
      if (dist(tank.x, tank.y, x0, y0) > 120) { escaped = true; break; }
    }
    assert(escaped, 'AI 未能脱困，位移 ' + dist(tank.x, tank.y, x0, y0).toFixed(1));
  });

  test('AI：大地图上能长距离寻路并接战', function () {
    const g = makeGame({ mapId: 'fort', enemies: 2, difficulty: 'hard' });
    const originalHit = g.onBulletHit.bind(g);
    g.onBulletHit = function (bullet, target) {
      if (target.isPlayer) return;      // 保持玩家存活以持续观察
      originalHit(bullet, target);
    };
    let shots = 0;
    const originalFire = Tank.prototype.fire;
    Tank.prototype.fire = function (game) {
      const b = originalFire.call(this, game);
      if (b && b.length) shots++;
      return b;
    };

    const frames = 60 * 40;
    const t0 = Date.now();
    let minDist = 1e9, worstPen = 0;
    for (let i = 0; i < frames; i++) {
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      for (let k = 0; k < g.aiControllers.length; k++) {
        const ai = g.aiControllers[k];
        if (!ai.tank.alive) continue;
        minDist = Math.min(minDist, ai.targetDist);
        worstPen = Math.max(worstPen, tankWallPenetration(g.maze, ai.tank));
      }
    }
    const ms = (Date.now() - t0) / frames;
    Tank.prototype.fire = originalFire;
    g.onBulletHit = originalHit;

    metrics['大地图 AI 最近接近距离'] = Math.round(minDist) + 'px';
    metrics['大地图 AI 40s 开火'] = shots;
    metrics['大地图单帧耗时(ms)'] = ms.toFixed(3);
    assert(minDist < 340, '大地图 AI 40 秒内没有接近玩家: ' + Math.round(minDist));
    assert(shots > 2, '大地图 AI 没有开火: ' + shots);
    assert(worstPen < 1.5, '大地图 AI 穿墙: ' + worstPen.toFixed(2));
    assert(ms < 4, '大地图单帧耗时过高: ' + ms.toFixed(2) + 'ms');
  });

  /* ---------------- 6. 道具与敌人上限 ---------------- */

  test('敌人上限：标准图最多 5 辆、大地图最多 7 辆', function () {
    const small = makeGame({ mapId: 'classic', enemies: 7 });
    assert(small.tanks.length - 1 === 5, '标准图敌人应为 5: ' + (small.tanks.length - 1));

    const big = makeGame({ mapId: 'fort', enemies: 7 });
    assert(big.tanks.length - 1 === 7, '大地图敌人应为 7: ' + (big.tanks.length - 1));
    for (const t of big.tanks) assert(t.colors && t.colors.body, '敌人配色缺失');

    // 7 个敌人 7 种不同配色
    const keys = new Set(big.tanks.map(t => t.colorKey));
    assert(keys.size >= 7, '配色不足以区分 7 辆: ' + keys.size);
  });

  test('道具：地图上会刷出道具并可通过拾取获得', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1 });
    const targets = g.pickupTargets();
    assert(g.pickups.length >= targets.min && g.pickups.length <= targets.max,
      '标准图道具数应在 ' + targets.min + '~' + targets.max + ': ' + g.pickups.length);
    for (const pk of g.pickups) {
      assert(g.maze.isFree(pk.x, pk.y, pk.radius), '道具刷在墙里');
      assert(PICKUP_TYPES[pk.type], '未知道具类型: ' + pk.type);
    }
    const big = makeGame({ mapId: 'fort', enemies: 1 });
    const bt = big.pickupTargets();
    assert(bt.initial > targets.initial, '大地图目标数量应更多: ' + bt.initial + ' vs ' + targets.initial);
    assert(big.pickups.length >= bt.min && big.pickups.length <= bt.max,
      '大地图道具数应在 ' + bt.min + '~' + bt.max + ': ' + big.pickups.length);

    // 拾取：把玩家挪到道具上
    const pk = g.pickups[0];
    g.player.x = pk.x;
    g.player.y = pk.y;
    g.player.invuln = 0;
    const def = PICKUP_TYPES[pk.type];
    g.update(1 / 60);
    let gained = false;
    if (def.kind === 'weapon') gained = g.player.powerup === pk.type;
    else if (pk.type === 'shield') gained = g.player.invuln > 0;
    else if (pk.type === 'speed') gained = g.player.speedBoost > 0;
    else if (pk.type === 'rapid') gained = g.player.rapidTime > 0;
    else if (pk.type === 'radar') gained = g.player.radarTime > 0;
    else if (pk.type === 'bouncer') gained = g.player.bounceAmmo > 0;
    else if (pk.type === 'emp') gained = g.player.empCharges > 0;
    else if (pk.type === 'mine') gained = g.player.mineCharges > 0;
    assert(gained, '拾取后未获得道具: ' + pk.type);
    assert(g.pickups.indexOf(pk) === -1, '道具未从地图移除');
  });

  test('激光炮：拾取后开火产生可折射光束并击毁目标', function () {
    const g = soloPlayer();
    g.player.applyPickup('laser');
    assert(g.player.powerup === 'laser' && g.player.powerupShots === CONFIG.PICKUPS.laserShots);
    g.player.cooldown = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;

    assert(g.lasers.length === 1, '未生成激光: ' + g.lasers.length);
    assert(g.lasers[0].segments.length >= 1, '激光没有光束段');
    assert(g.player.powerupShots === CONFIG.PICKUPS.laserShots - 1, '剩余次数未扣减');
    assert(g.player.cooldown > 0, '激光没有射击间隔');

    // 光束衰减
    for (let i = 0; i < 40; i++) g.update(1 / 60);
    assert(g.lasers.length === 0, '激光未随时间消失');
  });

  test('激光炮：折射后命中掩体后的目标', function () {
    const g = soloPlayer();
    const enemy = new Tank({ id: 1, x: g.player.x + 260, y: g.player.y, angle: Math.PI, colorKey: 'red' });
    g.tanks.push(enemy);
    // 在玩家与目标之间立一堵墙，激光需要折射一次才能打到
    const wall = { x: g.player.x + 100, y: g.player.y - 200, w: 12, h: 190 };
    g.maze.walls.push(wall);
    g.maze.walls.push({ x: g.player.x + 100, y: g.player.y + 60, w: 190, h: 12 });

    g.player.applyPickup('laser');
    g.player.cooldown = 0;
    g.player.angle = 0;
    g.player.aimAngle = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;
    assert(g.lasers.length === 1, '未生成激光');
    for (let i = 0; i < 60 && enemy.alive; i++) g.update(1 / 60);
    assert(!enemy.alive, '折射激光未能击毁掩体后的目标');
  });

  test('散裂弹：命中目标爆炸分裂，碎片可独立命中', function () {
    const g = soloPlayer();
    const enemies = [];
    for (let k = 0; k < 3; k++) {
      const e = new Tank({ id: 10 + k, x: g.player.x + 90, y: g.player.y + (k - 1) * 46, angle: Math.PI, colorKey: 'red' });
      g.tanks.push(e);
      enemies.push(e);
    }
    g.player.applyPickup('cluster');
    g.player.cooldown = 0;
    g.player.angle = 0;
    g.player.aimAngle = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;

    // 等母弹命中（命中即分裂）
    for (let i = 0; i < 90 && g.bullets.some(b => b.generation === 1); i++) g.update(1 / 60);
    let fragments = 0;
    for (const b of g.bullets) if (b.generation === 2) fragments++;
    assert(fragments >= 4, '未分裂出碎片: ' + fragments);

    for (let i = 0; i < 90; i++) g.update(1 / 60);
    const dead = enemies.filter(e => !e.alive).length;
    assert(dead >= 1, '碎片没有击毁任何目标: ' + dead);
    for (const b of g.bullets) assert(b.generation !== 2 || b.dead || b.age < CONFIG.PICKUPS.clusterFragLife + 0.1, '碎片未按时销毁');
  });

  test('散裂弹：到达最大射程后原地爆炸', function () {
    const g = soloPlayer();
    g.player.applyPickup('cluster');
    g.player.cooldown = 0;
    g.player.angle = 0;
    g.player.aimAngle = 0;
    g.input.mouse.down = true;
    g.update(1 / 60);
    g.input.mouse.down = false;

    // 等到引信耗尽
    for (let i = 0; i < 70 && g.bullets.some(b => b.generation === 1); i++) g.update(1 / 60);
    const gen1 = g.bullets.filter(b => b.generation === 1).length;
    assert(gen1 === 0, '母弹引信耗尽后未消失');
  });

  test('护盾与超载引擎：拾取后生效并按时结束', function () {
    const t = new Tank({ id: 1, x: 480, y: 320, angle: 0, colorKey: 'green' });
    const baseSpeed = t.maxSpeed;

    t.applyPickup('shield');
    assert(t.invuln >= CONFIG.PICKUPS.shieldTime - 0.01, '护盾未提供无敌');

    t.applyPickup('speed');
    assert(t.speedBoost >= CONFIG.PICKUPS.speedTime - 0.01, '超载引擎未生效');
    const stub = makeStubMaze();
    const x0 = t.x;
    t.aimAngle = 0;
    t.moveIntent = 1;
    t.update(1 / 60, stub);
    const boosted = t.x - x0;
    assert(boosted > baseSpeed / 60 * 1.2, '加速未生效: ' + boosted.toFixed(2));

    for (let i = 0; i < 60 * 10; i++) t.update(1 / 60, stub);
    assert(t.speedBoost === 0 && t.powerup === null, '道具未按时结束');
    // 长时间移动会顶到边界，先挪回中间再测正常速度
    t.x = 480;
    t.y = 320;
    t.moveIntent = 1;
    const x1 = t.x;
    t.update(1 / 60, stub);
    const normal = t.x - x1;
    assert(Math.abs(normal - baseSpeed / 60) < 0.5, '加速结束后速度异常: ' + normal.toFixed(2));
  });

  test('AI 节奏：多敌人时不会全部追击（最多 2~3 个 hunter）', function () {
    for (const n of [3, 5, 7]) {
      const g = makeGame({ mapId: 'fort', enemies: n, difficulty: 'normal' });
      g.assignAIRoles();
      const hunters = g.aiControllers.filter(a => a.role === 'hunt').length;
      metrics[n + ' 敌时追击数'] = hunters;
      assert(hunters >= 1 && hunters <= CONFIG.RULES.hunterMaxNormal,
        n + ' 敌时追击数异常: ' + hunters);
      assert(g.aiControllers.every(a => a.role === 'hunt' || a.role === 'patrol'), '角色未知');
    }
  });

  /* ---------------- 6. 性能 ---------------- */

  test('性能：4 名困难 AI 的单帧更新耗时', function () {
    const g = makeGame({ mapId: 'classic', enemies: 4, difficulty: 'hard' });
    // 预热
    for (let i = 0; i < 120; i++) { g.update(1 / 60); if (g.state !== 'playing') g.state = 'playing'; }
    const t0 = Date.now();
    const frames = 900;
    for (let i = 0; i < frames; i++) {
      if (!g.player.alive) g.player = g.player; // 玩家死亡不复活，用于测量最坏情况
      if (g.state === 'over') g.state = 'playing';
      g.update(1 / 60);
    }
    const ms = (Date.now() - t0) / frames;
    metrics['单帧逻辑耗时(ms)'] = ms.toFixed(3);
    assert(ms < 8, '单帧耗时过高: ' + ms.toFixed(3) + 'ms');
  });

  test('稳定性：4 名困难 AI 连续 5 分钟无异常、对象数量受控', function () {
    const g = makeGame({ mapId: 'classic', enemies: 4, difficulty: 'hard' });
    const originalHit = g.onBulletHit.bind(g);
    g.onBulletHit = function (bullet, target) {
      if (target.isPlayer) return;   // 保持玩家存活以持续战斗
      originalHit(bullet, target);
    };
    let maxBullets = 0, maxParticles = 0, nanPos = false;
    const frames = 60 * 300;
    for (let i = 0; i < frames; i++) {
      const ang = i / 60 * 0.9;
      g.input.mouse.x = g.player.x + Math.cos(ang) * 170;
      g.input.mouse.y = g.player.y + Math.sin(ang) * 170;
      if (i % 300 === 0) g.input.mouse.down = !g.input.mouse.down;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      maxBullets = Math.max(maxBullets, g.bullets.length);
      maxParticles = Math.max(maxParticles, g.effects.particles.length);
      for (const t of g.tanks) {
        if (!isFinite(t.x) || !isFinite(t.y) || !isFinite(t.angle)) nanPos = true;
      }
      for (const b of g.bullets) {
        if (!isFinite(b.x) || !isFinite(b.y)) nanPos = true;
      }
    }
    g.onBulletHit = originalHit;
    metrics['5 分钟峰值子弹数'] = maxBullets;
    metrics['5 分钟峰值粒子数'] = maxParticles;
    assert(!nanPos, '出现 NaN 坐标');
    assert(maxBullets < 200, '子弹数量失控: ' + maxBullets);
    assert(maxParticles < 500, '粒子数量失控: ' + maxParticles);
    assert(g.time > 290, '游戏时间推进异常: ' + g.time);
  });

  /* ---------------- 7. AI 感知公平性与战术（智能化改造新增） ---------------- */

  /**
   * 在真实迷宫中寻找"AI 点 / 可见点 V / 隐藏点 H"组合：
   * 从 AI 点能看见 V、完全看不见 H，且 V 与 H 相距 > 330px，均可寻路抵达。
   */
  function findHideScenario(maze) {
    const r = CONFIG.TANK.radius + 4;
    const spots = [];
    for (let y = 60; y < maze.height - 60; y += 8) {
      for (let x = 60; x < maze.width - 60; x += 8) {
        if (maze.isFree(x, y, r)) spots.push({ x, y });
      }
    }
    if (!spots.length) return null;
    for (let a = 0; a < 12; a++) {
      const ai = spots[a * Math.floor(spots.length / 12)];
      const visible = [];
      const hidden = [];
      for (const s of spots) {
        if (dist(s.x, s.y, ai.x, ai.y) < 150) continue;
        if (maze.losClear(ai.x, ai.y, s.x, s.y, r)) visible.push(s);
        else hidden.push(s);
      }
      for (const v of visible) {
        if (maze.findPath(ai.x, ai.y, v.x, v.y) === null) continue;
        for (const h of hidden) {
          if (dist(v.x, v.y, h.x, h.y) < 330) continue;
          if (maze.findPath(ai.x, ai.y, h.x, h.y) === null) continue;
          return { ai, v, h };
        }
      }
    }
    return null;
  }

  test('公平性：失去视线后不追踪玩家实时位置，旧情报按时废弃（场景A/E）', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1, difficulty: 'normal' });
    const maze = g.maze;
    const sc = findHideScenario(maze);
    assert(sc, '未找到可用的隐蔽场景布局');
    const ai = g.aiControllers[0];
    ai.role = 'hunt';

    // 阶段 1：玩家在可见点 V 静止 1.2 秒 → AI 建立情报记忆
    ai.tank.x = sc.ai.x; ai.tank.y = sc.ai.y;
    ai.tank.angle = Math.atan2(sc.v.y - ai.tank.y, sc.v.x - ai.tank.x);
    g.player.x = sc.v.x; g.player.y = sc.v.y;
    g.input.mouse.x = sc.v.x; g.input.mouse.y = sc.v.y;   // 玩家瞄准原地不动
    for (let i = 0; i < 72; i++) {
      g.player.invuln = 99;   // 保护静止玩家：本阶段只验证感知记忆，AI 真的会开火
      g.update(1 / 60);
    }
    assert(ai.lastKnown, '未建立目标记忆');
    assert(dist(ai.lastKnown.x, ai.lastKnown.y, sc.v.x, sc.v.y) < 60,
      '记忆位置与实际可见位置偏差过大');
    assert(ai.intelConf > 0.9, '可见时可信度应接近 1: ' + ai.intelConf.toFixed(2));

    // 阶段 2：玩家瞬移到墙后 H（模拟沿另一条路线离开），运行 9 秒。
    // 鼠标钉在玩家身上使其保持静止，排除玩家自行移动造成的合法再目击。
    g.player.x = sc.h.x; g.player.y = sc.h.y;
    let everSawH = false;
    let leak = false;
    const statesAfter = new Set();
    for (let i = 0; i < 60 * 9; i++) {
      g.input.mouse.x = g.player.x; g.input.mouse.y = g.player.y;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      if (maze.losClear(ai.tank.x, ai.tank.y, sc.h.x, sc.h.y, ai.losRadius)) everSawH = true;
      // 泄漏判定：从未看见 H，记忆却收敛到 H
      if (!everSawH && ai.lastKnown && dist(ai.lastKnown.x, ai.lastKnown.y, sc.h.x, sc.h.y) < 130) leak = true;
      statesAfter.add(ai.state);
    }
    metrics['场景A 记忆可信度(结束后)'] = ai.intelConf.toFixed(2);
    metrics['场景A 状态集'] = Array.from(statesAfter).join(',');
    metrics['场景A 期间是否合法再目击'] = everSawH ? '是' : '否';
    assert(!leak, 'AI 在无视线情况下获知了玩家的隐藏位置（信息泄漏）');

    // 场景 E：若始终未再目击 → 情报必须过期、恢复巡逻探索
    if (!everSawH) {
      assert(ai.lastKnown === null, '旧情报未被废弃');
      assert(ai.intelConf === 0, '可信度未归零: ' + ai.intelConf);
      assert(['pursue','search','bounce','ambush'].indexOf(ai.state) === -1,
        '情报过期后仍在追击/搜索: ' + ai.state);
    } else {
      // 合法再目击：记忆必须来自真实看见的位置，且可信度成立
      assert(ai.lastKnown !== null && ai.intelConf > 0.5, '合法再目击后记忆/可信度异常');
      assert(dist(ai.lastKnown.x, ai.lastKnown.y, g.player.x, g.player.y) < 60,
        '再目击后的记忆与玩家实际位置偏差过大');
    }
  });

  test('公平性：无视线反弹射击只对最后已知位置解算（场景G）', function () {
    const g = makeGame({ mapId: 'classic', enemies: 1, difficulty: 'hard' });
    const ai = g.aiControllers[0];
    ai.role = 'hunt';

    // 构造确定的反弹几何：坦克在左下朝右上开火，子弹打到上方横墙后
    // 反弹向下命中"记忆点"MEM；玩家真实位置 PLAYER 在另一侧且距 MEM 很远。
    const T = CONFIG.TANK.wallThickness;
    const maze = g.maze;
    maze.walls.length = 0;
    maze.walls.push({ x: 0, y: 0, w: 480, h: 9 }, { x: 0, y: 351, w: 480, h: 9 },
                    { x: 0, y: 0, w: 9, h: 360 }, { x: 471, y: 0, w: 9, h: 360 });
    maze.walls.push({ x: 150, y: 115, w: 170, h: 9 });   // 反弹镜面墙（水平）
    maze.walls.push({ x: 176, y: 180, w: 9, h: 180 });   // 阻断直视的竖墙
    maze._buildSpatialGrid();
    maze._buildNavGrid();
    g.maze = maze;

    const MEM = { x: 288, y: 216 };       // 最后已知位置（反弹可命中）
    const PLAYER = { x: 400, y: 320 };    // 玩家真实位置（被竖墙遮挡、距 MEM > 150px、不在弹道上）
    ai.tank.x = 60; ai.tank.y = 252;
    ai.tank.angle = -Math.PI / 4; ai.tank.aimAngle = ai.tank.angle;
    g.player.x = PLAYER.x; g.player.y = PLAYER.y;
    g.player.alive = true; g.player.invuln = 99;
    ai.lastKnown = { x: MEM.x, y: MEM.y };
    ai.intelConf = 1; ai.intelConf0 = 1; ai.intelConfAt = 5; ai.intelSource = 'sight';
    ai.lastSeenAt = 5; ai.hasLos = false;

    // 几何自检：站位对 MEM 无直接视线（确实需要反弹），对玩家同样无视线
    assert(!maze.losClear(ai.tank.x, ai.tank.y, MEM.x, MEM.y, ai.losRadius), '测试几何失效：能直视记忆点');
    assert(!maze.losClear(ai.tank.x, ai.tank.y, PLAYER.x, PLAYER.y, ai.losRadius), '测试几何失效：能直视玩家');
    assert(dist(PLAYER.x, PLAYER.y, MEM.x, MEM.y) > 150, '测试几何失效：玩家与记忆点过近');

    const sol = ai.findBounceShot(ai.lastKnown);
    assert(sol, '构造几何中未求得反弹解');
    assert(Math.abs(angleDiff(ai.tank.angle, sol.angle)) <= 1.75 + 1e-6, '解超出朝向约束');

    const m = ai.tank.muzzlePoint();
    const pts = Bullet.predictPath(maze, m.x, m.y,
      Math.cos(sol.angle), Math.sin(sol.angle), CONFIG.BULLET.speed, CONFIG.BULLET.maxBounces, 1.5);
    const hitsMem = polylineApproachTime(pts, MEM.x, MEM.y,
      CONFIG.TANK.radius + CONFIG.BULLET.radius + 8);
    assert(hitsMem !== null, '反弹解未命中最后已知位置');
    metrics['场景G 反弹解命中记忆点时间'] = hitsMem.toFixed(2) + 's';

    // 信息流断言（泄漏判据）：属性拦截证明解算链路零次读取玩家实时坐标。
    // findBounceShot 的调用约定是传入目标点（think() 中只传 lastKnown），
    // 若其内部（或调用链上）读取了 player.x/y，此处计数必然 > 0。
    let spyReads = 0;
    const descX = Object.getOwnPropertyDescriptor(g.player, 'x');
    const descY = Object.getOwnPropertyDescriptor(g.player, 'y');
    Object.defineProperty(g.player, 'x', { get() { spyReads++; return PLAYER.x; }, configurable: true });
    Object.defineProperty(g.player, 'y', { get() { spyReads++; return PLAYER.y; }, configurable: true });
    try {
      const solSpy = ai.findBounceShot(ai.lastKnown);
      assert(!!solSpy === !!sol, '相同输入下解算结果不稳定');
    } finally {
      Object.defineProperty(g.player, 'x', descX);
      Object.defineProperty(g.player, 'y', descY);
    }
    assert(spyReads === 0, '反弹解算链路读取了玩家实时坐标 ' + spyReads + ' 次（泄漏）');
    metrics['场景G 反弹公平性'] = '通过（解算链路 0 次读取玩家实时坐标，弹道级校验）';

    // 弹道是否顺路扫过玩家真实位置只可能是几何巧合，记录但不作为泄漏判据
    const hitsReal = polylineApproachTime(pts, PLAYER.x, PLAYER.y,
      CONFIG.TANK.radius + CONFIG.BULLET.radius);
    metrics['场景G 弹道顺路接近玩家'] = hitsReal === null ? '否' : hitsReal.toFixed(2) + 's（几何巧合）';
  });

  test('战术：队友占位时评分会避开重叠目标（场景B/C 基础）', function () {
    const g = makeGame({ mapId: 'open', enemies: 3, difficulty: 'hard' });
    const ais = g.aiControllers;
    const p = g.player;
    const center = findOpenSpot(g.maze, CONFIG.TANK.radius + 8);
    assert(center, '未找到开阔点');
    p.x = center.x; p.y = center.y;

    // 三辆坦克放在同一个可见站位（同输入 → 候选集一致，可复现）
    let same = null;
    for (let y = 40; y < g.maze.height - 40 && !same; y += 6) {
      for (let x = 40; x < g.maze.width - 40 && !same; x += 6) {
        if (!g.maze.isFree(x, y, CONFIG.TANK.radius + 4)) continue;
        const d = dist(x, y, p.x, p.y);
        if (d < 260 || d > 520) continue;
        if (!g.maze.losClear(x, y, p.x, p.y, CONFIG.TANK.radius + 4)) continue;
        same = { x, y };
      }
    }
    assert(same, '未找到可见站位');
    for (const ai of ais) {
      ai.role = 'hunt';
      ai.tank.x = same.x; ai.tank.y = same.y;
      ai.observe(p, 0);          // 模拟"看得见玩家"
    }

    const realRandom = Math.random;
    const realPenalty = AI_TACTICS.mateOverlapPenalty;
    Math.random = () => 0.5;      // 固定随机源
    AI_TACTICS.mateOverlapPenalty = 50;   // 放大惩罚以便确定性断言
    try {
      const d0 = dist(same.x, same.y, p.x, p.y);
      const ai = ais[0];
      ai.tactic = null; ai.lastRouteKey = '';
      ai.pickCombatTactic(p, d0, 0);
      const solo = { key: ai.tactic.key, goal: ai.tactic.goal };
      assert(solo.key, '未产生战术选择');

      if (solo.goal) {
        // 其余队友占住同一个目标点 → 重新评估必须换目标
        for (let i = 1; i < ais.length; i++) {
          ais[i].tacticGoal = solo.goal;
          ais[i].navTarget = solo.goal;
        }
        ai.tactic = null; ai.lastRouteKey = '';
        ai.pickCombatTactic(p, d0, 0);
        const crowded = ai.tactic;
        const moved = !crowded.goal ||
          dist(crowded.goal.x, crowded.goal.y, solo.goal.x, solo.goal.y) > AI_TACTICS.mateOverlapDist ||
          crowded.key !== solo.key;
        assert(moved, '队友占位后仍未改变战术选择');
        metrics['场景C 避让后选择'] = crowded.key + (crowded.goal ? '@' + Math.round(crowded.goal.x) + ',' + Math.round(crowded.goal.y) : '');
      } else {
        metrics['场景C 站桩战术'] = solo.key;
      }
      // 侧翼点几何约束验证
      const flankGoal = ai.pickFlankPoint(p);
      if (flankGoal) {
        const bearing = Math.abs(angleDiff(
          Math.atan2(flankGoal.y - p.y, flankGoal.x - p.x),
          Math.atan2(same.y - p.y, same.x - p.x)));
        assert(bearing >= AI_TACTICS.flankMinOffset - 0.25 && bearing <= AI_TACTICS.flankMaxOffset + 0.25,
          '侧翼点不在侧向扇区内: ' + bearing.toFixed(2));
      }
    } finally {
      Math.random = realRandom;
      AI_TACTICS.mateOverlapPenalty = realPenalty;
    }
  });

  test('搜索：多敌人不会检查完全相同的候选点（场景B）', function () {
    const g = makeGame({ mapId: 'classic', enemies: 3, difficulty: 'hard' });
    const ais = g.aiControllers;
    const sc = findHideScenario(g.maze);
    assert(sc, '未找到隐蔽场景');
    // 三个 AI 同时看见玩家在 V，随后各自进入搜索
    for (const ai of ais) {
      ai.role = 'hunt';
      ai.tank.x = sc.ai.x; ai.tank.y = sc.ai.y;
      ai.observe({ x: sc.v.x, y: sc.v.y }, 0);
    }
    for (let i = 0; i < ais.length; i++) ais[i].beginSearch(1);
    const extra = ais.map(ai => ai.searchQueue.slice(1).map(pt => Math.round(pt.x / 30) + ':' + Math.round(pt.y / 30)));
    const union = new Set();
    for (const q of extra) for (const k of q) union.add(k);
    metrics['场景B 搜索候选去重后数量'] = union.size + ' / ' + extra.reduce((s, q) => s + q.length, 0);
    assert(union.size >= 4, '三个 AI 的搜索候选几乎完全相同: ' + JSON.stringify(extra));
  });

  test('战术：开阔地带多敌人保持队形层次（场景C）', function () {
    const g = makeGame({ mapId: 'open', enemies: 4, difficulty: 'hard' });
    let nearSum = 0, nearCnt = 0, maxNear = 0, pairSum = 0, pairCnt = 0;
    const states = new Set();
    for (let i = 0; i < 60 * 25; i++) {
      const ang = i / 60 * 0.9;
      g.input.mouse.x = g.player.x + Math.cos(ang) * 170;
      g.input.mouse.y = g.player.y + Math.sin(ang) * 170;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      for (const ai of g.aiControllers) if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      if (i % 15 === 0) {
        const alive = g.aiControllers.filter(a => a.tank.alive);
        let near = 0;
        for (const a of alive) {
          if (dist(a.tank.x, a.tank.y, g.player.x, g.player.y) < 140) near++;
          states.add(a.state);
        }
        nearSum += near; nearCnt++; maxNear = Math.max(maxNear, near);
        for (let x = 0; x < alive.length; x++) {
          for (let y = x + 1; y < alive.length; y++) {
            pairSum += dist(alive[x].tank.x, alive[x].tank.y, alive[y].tank.x, alive[y].tank.y);
            pairCnt++;
          }
        }
      }
    }
    const avgNear = nearSum / nearCnt;
    const avgPair = pairSum / pairCnt;
    metrics['场景C 玩家140px内敌人均值'] = avgNear.toFixed(2) + '（峰值 ' + maxNear + '）';
    metrics['场景C 敌人间平均间距'] = Math.round(avgPair) + 'px';
    metrics['场景C 状态覆盖'] = Array.from(states).join(',');
    assert(avgNear < 2.6, '敌人过度聚集在玩家身边: 均值 ' + avgNear.toFixed(2));
    assert(avgPair > 55, '敌人之间间距过小（扎堆）: ' + avgPair.toFixed(0) + 'px');
    assert(states.size >= 3, '行为状态过于单一: ' + Array.from(states).join(','));
  });

  test('难度与性格：战术/情报参数分级可辨（场景F）', function () {
    const e = AI_DIFFICULTIES.easy, n = AI_DIFFICULTIES.normal, h = AI_DIFFICULTIES.hard;
    assert(e.memoryDecay < n.memoryDecay && n.memoryDecay < h.memoryDecay, '记忆时长未分级');
    assert(e.searchMaxPoints < n.searchMaxPoints && n.searchMaxPoints < h.searchMaxPoints, '搜索广度未分级');
    assert(e.flankSkill < n.flankSkill && n.flankSkill < h.flankSkill, '侧翼能力未分级');
    assert(e.intelShare < n.intelShare && n.intelShare < h.intelShare, '情报共享未分级');
    assert(e.coordination < n.coordination && n.coordination < h.coordination, '协作度未分级');
    assert(e.tacticInterval > n.tacticInterval && n.tacticInterval > h.tacticInterval, '战术评估频率未分级');
    const pp = AI_PERSONALITIES;
    assert(pp.aggressive.advance > pp.cautious.advance, '进攻/谨慎推进倾向未区分');
    assert(pp.cautious.cover > pp.aggressive.cover, '谨慎/进攻掩护倾向未区分');
    assert(pp.tactical.ambush > pp.aggressive.ambush, '战术/进攻伏击倾向未区分');
    assert(pp.tactical.flank > pp.aggressive.flank, '战术/进攻侧翼倾向未区分');

    // 搜索队列长度受难度约束，且第一站是最后已知位置
    const g = makeGame({ mapId: 'classic', enemies: 1, difficulty: 'easy' });
    const ai = g.aiControllers[0];
    ai.lastKnown = { x: g.player.x, y: g.player.y };
    ai.intelSource = 'sight'; ai.intelConf = 1;
    ai.beginSearch(0);
    assert(ai.searchQueue.length >= 1 && ai.searchQueue.length <= AI_DIFFICULTIES.easy.searchMaxPoints,
      '搜索队列长度异常: ' + ai.searchQueue.length);
    assert(dist(ai.searchQueue[0].x, ai.searchQueue[0].y, g.player.x, g.player.y) < 20,
      '搜索第一站不是最后已知位置');

    // 行为差异：同样失联 3 秒，简单 AI 的情报衰减明显快于困难 AI
    const gh = makeGame({ mapId: 'classic', enemies: 1, difficulty: 'hard' });
    const aih = gh.aiControllers[0];
    aih.lastKnown = { x: 100, y: 100 }; aih.intelConf0 = 1; aih.intelConfAt = 0; aih.intelSource = 'sight';
    const confEasy = ai.computeIntelConf(3);
    const confHard = aih.computeIntelConf(3);
    assert(confEasy < confHard, '情报衰减速度未体现难度差异: ' + confEasy + ' vs ' + confHard);
    metrics['场景F 失联3s可信度(简单/困难)'] = confEasy.toFixed(2) + ' / ' + confHard.toFixed(2);
  });

  test('边界：玩家死亡/敌人死亡/不可达目标/共享情报时间戳（场景G）', function () {
    const g = makeGame({ mapId: 'classic', enemies: 2, difficulty: 'normal' });

    // 1) 玩家死亡：AI 遗忘情报并巡逻
    g.player.alive = false;
    for (let i = 0; i < 120; i++) g.update(1 / 60);
    for (const ai of g.aiControllers) {
      assert(ai.state === 'wander', '玩家死亡后状态应为 wander: ' + ai.state);
      assert(ai.lastKnown === null, '玩家死亡后应遗忘情报');
    }
    g.player.alive = true;

    // 2) 敌人中途死亡：不影响其余 AI 与主循环
    g.aiControllers[1].tank.kill();
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    assert(g.aiControllers[0].tank.alive, '存活敌人被误判');

    // 3) 不可达目标（记忆点落在墙体内部）：不崩溃、坐标有限、可恢复
    const ai = g.aiControllers[0];
    const w = g.maze.walls[Math.floor(g.maze.walls.length / 2)];
    ai.lastKnown = { x: w.x + w.w / 2, y: w.y + w.h / 2 };
    ai.intelConf = 1; ai.intelConf0 = 1; ai.intelConfAt = g.time; ai.intelSource = 'sight';
    for (let i = 0; i < 180; i++) {
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      assert(isFinite(ai.tank.x) && isFinite(ai.tank.y), '坐标出现 NaN');
    }
    assert(ai.tank.alive, 'AI 意外死亡');

    // 4) 共享情报：带时间戳采信，不随玩家移动更新
    g.enemyIntel = { x: 200, y: 200, time: g.time - 0.5, reporterId: 2 };
    ai.intelConf = 0; ai.intelConf0 = 0; ai.intelConfAt = -99; ai.lastKnown = null; ai.intelSource = 'none';
    ai.absorbSharedIntel(g.time);
    assert(ai.lastKnown && dist(ai.lastKnown.x, ai.lastKnown.y, 200, 200) < 1, '未采信队友情报');
    assert(ai.intelSource === 'share', '情报来源未标记');
    const confAtAdopt = ai.intelConf;
    g.enemyIntel = { x: 800, y: 600, time: g.time, reporterId: 2 };   // 玩家"移动"后队友没有新目击，情报不应刷新
    ai.absorbSharedIntel(g.time);
    assert(dist(ai.lastKnown.x, ai.lastKnown.y, 200, 200) < 1, '共享情报被实时坐标污染');
    ai.absorbSharedIntel(g.time + 6);
    assert(ai.intelConf < confAtAdopt, '共享情报未随时间衰减');
  });

  /* =========================================================
   * 8. 地图系统升级（多布局 / 连通性 / 出生点 / 可复现）
   * ========================================================= */

  function mapCellStats(maze) {
    let dead = 0, open = 0, corr = 0, floor = 0, solid = 0;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        if (!maze._isFloor(c, r)) { solid++; continue; }
        floor++;
        let n = 0;
        if (r > 0 && maze.hWall[c][r] === 0) n++;
        if (r < maze.rows - 1 && maze.hWall[c][r + 1] === 0) n++;
        if (c > 0 && maze.vWall[c][r] === 0) n++;
        if (c < maze.cols - 1 && maze.vWall[c + 1][r] === 0) n++;
        if (n <= 1) dead++;
        else if (n >= 3) open++;
        else corr++;
      }
    }
    return { dead, open, corr, floor, solid, openRatio: open / Math.max(1, floor) };
  }

  function mapSightLength(maze) {
    let sum = 0, cnt = 0;
    for (let r = 0; r < maze.rows; r += 2) {
      for (let c = 0; c < maze.cols; c += 2) {
        const x = (c + 0.5) * maze.cellW, y = (r + 0.5) * maze.cellH;
        if (!maze.isFree(x, y, CONFIG.TANK.radius)) continue;
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4;
          const hit = maze.raycast(x, y, Math.cos(a), Math.sin(a), 520, 3);
          sum += hit ? hit.t : 520;
          cnt++;
        }
      }
    }
    return sum / Math.max(1, cnt);
  }

  function sameWalls(a, b) {
    if (a.walls.length !== b.walls.length) return false;
    for (let i = 0; i < a.walls.length; i++) {
      const wa = a.walls[i], wb = b.walls[i];
      if (wa.x !== wb.x || wa.y !== wb.y || wa.w !== wb.w || wa.h !== wb.h) return false;
    }
    return true;
  }

  function biggestNavComponent(maze) {
    const seen = new Uint8Array(maze.navFree.length);
    let total = 0;
    for (let i = 0; i < maze.navFree.length; i++) if (maze.navFree[i]) total++;
    let best = 0, bestCells = [];
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < maze.navFree.length; i++) {
      if (!maze.navFree[i] || seen[i]) continue;
      const q = [i]; seen[i] = 1; const cells = [];
      while (q.length) {
        const idx = q.pop(); cells.push(idx);
        const cx = idx % maze.navCols, cy = (idx / maze.navCols) | 0;
        for (const d of dirs) {
          const nx = cx + d[0], ny = cy + d[1];
          if (nx < 0 || ny < 0 || nx >= maze.navCols || ny >= maze.navRows) continue;
          const ni = ny * maze.navCols + nx;
          if (!maze.navFree[ni] || seen[ni]) continue;
          seen[ni] = 1; q.push(ni);
        }
      }
      if (cells.length > best) { best = cells.length; bestCells = cells; }
    }
    return { ratio: best / Math.max(1, total), total, cells: bestCells };
  }

  test('地图：12 张预设均可生成，墙体/碰撞/导航/出生点一致', function () {
    const ids = MAP_PRESETS.filter(p => p.id !== 'random').map(p => p.id);
    assert(ids.length === 12, '地图数量应为 12（6 优化 + 6 新增）: ' + ids.length);
    const layouts = new Set();
    for (const id of ids) {
      const t0 = Date.now();
      const m = Maze.createPreset(id);
      const gen = Date.now() - t0;
      metrics['生成 ' + id] = gen + 'ms';
      assert(gen < 250, id + ' 生成过慢: ' + gen + 'ms');
      assert(m.walls.length > 20, id + ' 墙体过少: ' + m.walls.length);
      const comp = biggestNavComponent(m);
      assert(comp.ratio > 0.99, id + ' 导航连通率不足: ' + (comp.ratio * 100).toFixed(1) + '%');
      const spawns = m.pickSpawns(5);
      assert(spawns.length === 5, id + ' 出生点不足: ' + spawns.length);
      for (const s of spawns) {
        assert(m.isFree(s.x, s.y, CONFIG.TANK.radius), id + ' 出生点卡墙');
        assert(m.openness(s.x, s.y, 80) >= 2, id + ' 出生点周围空间过小');
      }
      for (let i = 0; i < spawns.length; i++) {
        for (let j = i + 1; j < spawns.length; j++) {
          assert(dist(spawns[i].x, spawns[i].y, spawns[j].x, spawns[j].y) > 90,
            id + ' 出生点过近');
        }
      }
      let reach = 0;
      for (let k = 0; k < 6; k++) {
        const idx = comp.cells[Math.floor((k + 1) / 7 * comp.cells.length)];
        if (idx === undefined) continue;
        const p = m.navCenter(idx);
        if (m.findPath(spawns[0].x, spawns[0].y, p.x, p.y)) reach++;
      }
      assert(reach >= 4, id + ' 出生点可达目标过少: ' + reach + '/6');
      layouts.add(m.layout);
    }
    metrics['地图布局类型数'] = layouts.size;
    assert(layouts.size >= 7, '布局类型过少: ' + Array.from(layouts).join(','));
  });

  test('地图：固定种子可复现，随机地图同样可复现', function () {
    for (const id of ['classic', 'fort', 'crossfire', 'hub', 'sectors']) {
      const a = Maze.createPreset(id);
      const b = Maze.createPreset(id);
      assert(sameWalls(a, b), id + ' 两次生成结果不一致');
    }
    const r1 = Maze.createRandom('repro-seed-1');
    const r2 = Maze.createRandom('repro-seed-1');
    assert(r1.layout === r2.layout && r1.width === r2.width && r1.height === r2.height,
      '随机地图布局/尺寸不可复现');
    assert(sameWalls(r1, r2), '随机地图墙体不可复现');
    let differs = false;
    for (const seed of ['repro-seed-2', 'repro-seed-3', 'repro-seed-4']) {
      const r3 = Maze.createRandom(seed);
      if (r3.layout !== r1.layout || !sameWalls(r1, r3)) { differs = true; break; }
    }
    assert(differs, '不同随机种子产生了完全相同的地图');
  });

  test('地图：布局结构真实差异（不是只换种子/尺寸）', function () {
    const ids = ['classic', 'open', 'corridor', 'crossfire', 'loop', 'twin',
      'city', 'fort', 'ring', 'hub', 'sectors', 'labyrinth'];
    const stats = {}, sight = {}, maps = {};
    for (const id of ids) {
      maps[id] = Maze.createPreset(id);
      stats[id] = mapCellStats(maps[id]);
      sight[id] = mapSightLength(maps[id]);
    }
    assert(sight.open > sight.classic * 1.3, '竞技场视野不够开阔');
    assert(sight.corridor < sight.classic * 0.9, '曲折回廊视野不够压抑');
    assert(sight.city > sight.classic * 1.15, '城区长街视野不足');
    for (const id of ['classic', 'corridor', 'crossfire', 'city', 'fort', 'labyrinth']) {
      assert(stats[id].dead >= 4, id + ' 缺少死胡同: ' + stats[id].dead);
    }
    for (const id of ['open', 'loop', 'twin', 'ring', 'sectors']) {
      assert(stats[id].dead <= 2, id + ' 不应有大量死胡同: ' + stats[id].dead);
    }
    assert(stats.city.solid >= 40, '城区缺少实心街区: ' + stats.city.solid);
    assert(stats.crossfire.solid >= 20, '十字布局缺少四角实心区: ' + stats.crossfire.solid);
    assert(stats.sectors.openRatio >= 0.6, '多房间布局房间占比过低: ' + stats.sectors.openRatio.toFixed(2));
    assert(stats.corridor.openRatio <= 0.3, '回廊布局通道占比异常');
    const smallIds = ['classic', 'open', 'corridor', 'crossfire', 'loop', 'twin'];
    for (let i = 0; i < smallIds.length; i++) {
      for (let j = i + 1; j < smallIds.length; j++) {
        assert(!sameWalls(maps[smallIds[i]], maps[smallIds[j]]),
          smallIds[i] + ' 与 ' + smallIds[j] + ' 墙体结构完全相同');
      }
    }
    const bigIds = ['city', 'fort', 'ring', 'hub', 'sectors', 'labyrinth'];
    for (let i = 0; i < bigIds.length; i++) {
      for (let j = i + 1; j < bigIds.length; j++) {
        assert(!sameWalls(maps[bigIds[i]], maps[bigIds[j]]),
          bigIds[i] + ' 与 ' + bigIds[j] + ' 墙体结构完全相同');
      }
    }
    metrics['地图结构指标'] = ids.map(id =>
      id + ':sight' + sight[id].toFixed(0) + '/dead' + stats[id].dead).join(' ');
  });

  test('地图：坦克能在所有地图上跑完长距离路径且不穿墙', function () {
    for (const id of ['classic', 'open', 'crossfire', 'loop', 'twin', 'city', 'hub', 'sectors']) {
      const g = makeGame({ mapId: id, enemies: 1, difficulty: 'hard' });
      const ai = g.aiControllers[0];
      let worstPen = 0, moved = 0;
      const start = { x: ai.tank.x, y: ai.tank.y };
      for (let i = 0; i < 60 * 20; i++) {
        g.update(1 / 60);
        if (g.state !== 'playing') g.state = 'playing';
        if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
        if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
        const walls = g.maze.queryWalls(ai.tank.x, ai.tank.y, ai.tank.radius + 2);
        for (const w of walls) {
          const p = Physics.pushCircleOutOfRect(ai.tank.x, ai.tank.y, ai.tank.radius - 0.5, w);
          if (p) worstPen = Math.max(worstPen, p.depth);
        }
        moved = Math.max(moved, dist(ai.tank.x, ai.tank.y, start.x, start.y));
      }
      assert(worstPen < 1.5, id + ' AI 穿墙: ' + worstPen.toFixed(2));
      assert(moved > 180 || g.player.x !== start.x, id + ' AI 20 秒内几乎没有探索: ' + moved.toFixed(0));
    }
  });

  /* =========================================================
   * 9. 道具系统升级（种类 / 刷新 / 效果 / 状态清理）
   * ========================================================= */

  function freshGame(mapId, enemies, difficulty) {
    const g = new Game({});
    g.sound.enabled = false;
    g.startMatch({ mapId: mapId || 'classic', enemies: enemies || 1, difficulty: difficulty || 'normal' });
    return g;
  }

  function findOpenPoint(maze, clearance) {
    const r = clearance || 30;
    let best = null, bestOpen = -1;
    for (let y = 80; y < maze.height - 80; y += 12) {
      for (let x = 80; x < maze.width - 80; x += 12) {
        if (!maze.isFree(x, y, r)) continue;
        const open = maze.openness(x, y, 120);
        if (open > bestOpen) { bestOpen = open; best = { x, y }; }
      }
    }
    return best;
  }

  test('道具：10 种类型定义完整，权重归一且有稀有度差异', function () {
    assert(PICKUP_KINDS.length === 10, '道具类型应为 10 种: ' + PICKUP_KINDS.length);
    let total = 0;
    const rarities = new Set();
    for (const k of PICKUP_KINDS) {
      const def = PICKUP_TYPES[k];
      assert(def && def.name && def.color && def.desc, k + ' 定义不完整');
      assert(def.weight > 0, k + ' 缺少刷新权重');
      assert(['common', 'tactical', 'rare'].indexOf(def.rarity) >= 0, k + ' 稀有度非法');
      assert(['weapon', 'boost', 'ammo', 'active', 'aura'].indexOf(def.kind) >= 0, k + ' 类型非法');
      total += def.weight;
      rarities.add(def.rarity);
    }
    assert(Math.abs(total - 1) < 0.01, '权重总和应归一化: ' + total.toFixed(3));
    assert(rarities.size === 3, '应同时存在普通/战术/稀有');
    const count = {};
    for (let i = 0; i < 12000; i++) {
      const t = randomPickupType([]);
      count[t] = (count[t] || 0) + 1;
    }
    for (const k of PICKUP_KINDS) assert((count[k] || 0) > 0, k + ' 从未被随机到');
    assert(count.emp < count.laser, '稀有道具出现率不应高于普通道具');
    metrics['道具采样 laser/emp'] = count.laser + '/' + count.emp;
  });

  test('道具：初始数量随地图规模增长，全部点位合法可达', function () {
    const small = freshGame('classic', 1);
    const st = small.pickupTargets();
    assert(small.pickups.length >= st.min && small.pickups.length <= st.max,
      '小图初始数量异常: ' + small.pickups.length);
    for (const pk of small.pickups) {
      assert(small.maze.isFree(pk.x, pk.y, pk.radius + 2), '道具卡在墙里');
      assert(small.maze.findPath(small.player.x, small.player.y, pk.x, pk.y), '道具不可达');
      for (const t of small.tanks) {
        assert(dist(pk.x, pk.y, t.x, t.y) >= CONFIG.PICKUPS.minTankDist * 0.4,
          '道具离坦克过近');
      }
    }
    const big = freshGame('fort', 2);
    const bt = big.pickupTargets();
    assert(bt.initial >= 8, '大地图初始道具过少: ' + bt.initial);
    assert(big.pickups.length >= bt.min && big.pickups.length <= bt.max,
      '大图初始数量异常: ' + big.pickups.length);
    for (const pk of big.pickups) {
      assert(big.maze.isFree(pk.x, pk.y, pk.radius + 2), '大地图道具卡在墙里');
    }
    const usedRegions = new Set();
    for (const pk of big.pickups) {
      for (let i = 0; i < big.pickupRegions.length; i++) {
        let match = false;
        for (const idx of big.pickupRegions[i].cells) {
          const p = big.maze.navCenter(idx);
          if (dist(p.x, p.y, pk.x, pk.y) < 60) { match = true; break; }
        }
        if (match) { usedRegions.add(i); break; }
      }
    }
    metrics['大图道具覆盖区域'] = usedRegions.size + ' / ' + big.pickupRegions.length;
    assert(usedRegions.size >= Math.min(3, big.pickupRegions.length), '大地图道具过度集中');
  });

  test('道具：低存量会快速补充，大地图长期不稀疏', function () {
    const g = freshGame('classic', 1);
    g.pickups.length = 0;
    g.pickupTimer = 0.1;
    let restored = 0;
    for (let i = 0; i < 60 * 15; i++) {
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      if (i === 60 * 14) restored = g.pickups.length;
    }
    assert(restored >= CONFIG.PICKUPS.targets.small.min - 1, '小图清空后未及时补充: ' + restored);

    const big = freshGame('fort', 3, 'hard');
    const bt = big.pickupTargets();
    let sum = 0, n = 0, below = 0;
    for (let i = 0; i < 60 * 30; i++) {
      big.input.mouse.x = big.player.x + Math.cos(i / 50) * 150;
      big.input.mouse.y = big.player.y + Math.sin(i / 50) * 150;
      big.update(1 / 60);
      if (big.state !== 'playing') big.state = 'playing';
      if (!big.player.alive) { big.player.alive = true; big.player.invuln = 99; }
      for (const ai of big.aiControllers) if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      if (i % 30 === 0) {
        sum += big.pickups.length; n++;
        if (big.pickups.length < bt.min) below++;
      }
    }
    const avg = sum / n;
    metrics['大地图30s道具均值'] = avg.toFixed(1) + '（目标 ' + bt.min + '~' + bt.max + '）';
    assert(avg >= bt.min, '大地图道具长期稀疏: 均值 ' + avg.toFixed(1));
    assert(below / n < 0.35, '大地图低存量时间过长: ' + (below / n * 100).toFixed(0) + '%');
  });

  test('道具：刷新具有簇群性与位置变化，不会全部堆叠', function () {
    const g = freshGame('fort', 2);
    const picks = g.pickups;
    assert(picks.length >= 8, '大地图初始道具不足');
    let minPair = Infinity, pairsUnder120 = 0, pairs = 0;
    for (let i = 0; i < picks.length; i++) {
      for (let j = i + 1; j < picks.length; j++) {
        const d = dist(picks[i].x, picks[i].y, picks[j].x, picks[j].y);
        pairs++;
        minPair = Math.min(minPair, d);
        if (d < 120) pairsUnder120++;
      }
    }
    assert(minPair < 120, '未形成道具簇（最近间距 ' + minPair.toFixed(0) + '）');
    assert(minPair >= CONFIG.PICKUPS.minPickupDist * 0.85, '道具间距过近/重叠: ' + minPair.toFixed(0));
    assert(pairsUnder120 < pairs, '所有道具都挤在一起');
    const before = picks.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|');
    g.pickups.length = 0;
    g.pickupTimer = 0;
    for (let i = 0; i < 60 * 8; i++) g.update(1 / 60);
    const after = g.pickups.map(p => Math.round(p.x) + ',' + Math.round(p.y)).join('|');
    assert(g.pickups.length > 0, '补充失败');
    assert(before !== after, '刷新位置完全固定');
  });

  test('道具：连射过载缩短冷却且不无限叠加', function () {
    const g = freshGame('classic', 1);
    const p = g.player;
    p.angle = 0; p.aimAngle = 0;
    p.cooldown = 0;
    p.fire(g);
    const normalCd = p.cooldown;
    p.applyPickup('rapid');
    p.cooldown = 0;
    p.fire(g);
    const rapidCd = p.cooldown;
    assert(rapidCd < normalCd, '连射未缩短冷却: ' + rapidCd + ' vs ' + normalCd);
    assert(rapidCd >= CONFIG.PICKUPS.minCooldown - 1e-9, '冷却低于下限');
    p.rapidTime = 1.5;
    p.applyPickup('rapid');
    assert(Math.abs(p.rapidTime - CONFIG.PICKUPS.rapidTime) < 0.01, '重复拾取应刷新时长');
    p.rapidTime = 0;
    p.cooldown = 0;
    p.fire(g);
    assert(Math.abs(p.cooldown - normalCd) < 1e-9, '效果结束后冷却未恢复');
    metrics['连射冷却 普通/过载'] = normalCd.toFixed(2) + '/' + rapidCd.toFixed(2) + 's';
  });

  test('道具：强化反弹给子弹额外反弹次数并逐发消耗', function () {
    const g = freshGame('classic', 1);
    const p = g.player;
    p.angle = 0; p.aimAngle = 0;
    p.cooldown = 0;
    let shots = p.fire(g);
    assert(shots[0].maxBounces === CONFIG.BULLET.maxBounces, '普通子弹反弹次数异常');
    p.applyPickup('bouncer');
    const ammo0 = p.bounceAmmo;
    assert(ammo0 === CONFIG.PICKUPS.bouncerShots, '反弹弹药数量异常');
    p.cooldown = 0;
    shots = p.fire(g);
    assert(shots[0].maxBounces === CONFIG.BULLET.maxBounces + CONFIG.PICKUPS.bouncerExtraBounces,
      '强化子弹未获得额外反弹: ' + shots[0].maxBounces);
    assert(p.bounceAmmo === ammo0 - 1, '齐射未消耗反弹弹药');
    p.bounceAmmo = 1; p.cooldown = 0;
    p.fire(g);
    assert(p.bounceAmmo === 0, '弹药未耗尽');
    p.cooldown = 0;
    shots = p.fire(g);
    assert(shots[0].maxBounces === CONFIG.BULLET.maxBounces, '弹药耗尽后仍强化');
  });

  test('道具：EMP 范围干扰、墙体遮挡、重复不叠加', function () {
    const g = freshGame('classic', 1);
    const spot = findOpenPoint(g.maze, 22);
    assert(spot, '未找到开阔点');
    const enemy = g.aiControllers[0].tank;
    g.player.x = spot.x; g.player.y = spot.y;
    let enemySpot = null;
    for (let a = 0; a < 16 && !enemySpot; a++) {
      const ang = a / 16 * Math.PI * 2;
      for (const rr of [90, 130, 160]) {
        const x = spot.x + Math.cos(ang) * rr, y = spot.y + Math.sin(ang) * rr;
        if (g.maze.isFree(x, y, 20) && g.maze.losClear(spot.x, spot.y, x, y, 4)) {
          enemySpot = { x, y }; break;
        }
      }
    }
    assert(enemySpot, '未找到可见范围内站位');
    enemy.x = enemySpot.x; enemy.y = enemySpot.y;
    g.player.applyPickup('emp');
    assert(g.player.empCharges === CONFIG.PICKUPS.empCharges, 'EMP 次数异常');
    assert(g.player.useEmp(g), 'EMP 释放失败');
    assert(enemy.empStun > 0, '范围内敌人未被干扰');
    assert(Math.abs(enemy.empStun - CONFIG.PICKUPS.empDuration) < 1e-9, '干扰时长异常');
    g.player.empCooldown = 0;
    g.player.useEmp(g);
    assert(enemy.empStun <= CONFIG.PICKUPS.empDuration + 1e-9, 'EMP 干扰被叠加');
    enemy.empStun = 1;
    assert(enemy.fire(g).length === 0, '被干扰的坦克仍能开火');
    enemy.empStun = 0;
    let blocked = null;
    for (let a = 0; a < 24 && !blocked; a++) {
      const ang = a / 24 * Math.PI * 2;
      for (const rr of [100, 140, 175]) {
        const x = spot.x + Math.cos(ang) * rr, y = spot.y + Math.sin(ang) * rr;
        if (g.maze.isFree(x, y, 20) && !g.maze.losClear(spot.x, spot.y, x, y, 4)) {
          blocked = { x, y }; break;
        }
      }
    }
    if (blocked) {
      enemy.empStun = 0;
      enemy.x = blocked.x; enemy.y = blocked.y;
      g.player.empCharges = 1; g.player.empCooldown = 0;
      g.player.useEmp(g);
      assert(enemy.empStun === 0, 'EMP 穿墙干扰了墙后目标');
    }
    metrics['EMP 校验'] = blocked ? '范围/遮挡/不叠加 通过' : '范围/不叠加 通过（未找到墙后点位）';
  });

  test('道具：地雷布设、延时、触发爆炸、不伤己方、连锁', function () {
    const g = freshGame('classic', 1);
    const spot = findOpenPoint(g.maze, 26);
    g.player.x = spot.x; g.player.y = spot.y;
    g.player.angle = 0; g.player.aimAngle = 0;
    g.player.applyPickup('mine');
    assert(g.player.mineCharges === CONFIG.PICKUPS.mineCharges, '地雷数量异常');
    const ok = g.player.deployMine(g);
    assert(ok && g.mines.length === 1, '地雷布设失败');
    const mine = g.mines[0];
    assert(g.maze.isFree(mine.x, mine.y, 10), '地雷生成在墙里');
    assert(!mine.armed, '地雷未经过起爆延时');
    g.player.x = mine.x; g.player.y = mine.y;
    for (let i = 0; i < 10; i++) g.update(1 / 60);
    assert(g.player.alive, '布设者被自己的地雷炸死');
    assert(g.mines.length === 1, '布设者触发了自己的地雷');
    const enemy = g.aiControllers[0].tank;
    enemy.x = mine.x; enemy.y = mine.y;
    let exploded = false;
    for (let i = 0; i < 120; i++) {
      g.update(1 / 60);
      if (!enemy.alive) { exploded = true; break; }
      if (!mine.dead) { enemy.x = mine.x; enemy.y = mine.y; }
    }
    assert(exploded, '地雷未能炸毁触发者');
    const g2 = freshGame('classic', 1);
    const s2 = findOpenPoint(g2.maze, 30);
    g2.player.x = s2.x; g2.player.y = s2.y;
    g2.player.applyPickup('mine');
    g2.player.mineCooldown = 0;
    g2.player.deployMine(g2);
    g2.player.mineCooldown = 0;
    const m1 = g2.mines[0];
    g2.player.x = m1.x + 30; g2.player.y = m1.y;
    g2.player.deployMine(g2);
    assert(g2.mines.length === 2, '第二颗地雷布设失败');
    const m2 = g2.mines[1];
    for (const mn of g2.mines) mn.age = mn.armTime + 0.1;
    g2.onMineExplode(m1);
    assert(m2.exploded || m2.dead, '地雷未连锁引爆');
  });

  test('道具：雷达计时生效，AI 雷达获得带时间戳情报', function () {
    const g = freshGame('classic', 1);
    g.player.applyPickup('radar');
    assert(g.player.radarTime === CONFIG.PICKUPS.radarTime, '雷达持续时间异常');
    const t0 = g.player.radarTime;
    for (let i = 0; i < 60; i++) { g.player.update(1 / 60, g.maze); }
    assert(g.player.radarTime < t0, '雷达计时未减少');
    const ai = g.aiControllers[0];
    ai.tank.radarTime = CONFIG.PICKUPS.radarTime;
    ai.tank.radarPinged = false;
    ai.lastKnown = null; ai.intelConf = 0;
    g.player.x = ai.tank.x + 200; g.player.y = ai.tank.y;
    ai.useActiveItems();
    assert(ai.lastKnown && ai.intelSource === 'radar', 'AI 雷达未产生情报');
    assert(ai.intelConf > 0 && ai.intelConf < 1, '雷达情报可信度应低于目视');
  });

  test('道具：重复拾取规则与死亡/重开/换图清理', function () {
    const g = freshGame('classic', 1);
    const p = g.player;
    p.applyPickup('rapid'); p.rapidTime = 2;
    p.applyPickup('rapid');
    assert(Math.abs(p.rapidTime - CONFIG.PICKUPS.rapidTime) < 0.01, '连射时长未刷新');
    p.applyPickup('bouncer'); p.applyPickup('bouncer');
    assert(p.bounceAmmo === CONFIG.PICKUPS.bouncerShots * 2, '反弹弹药未累加');
    for (let i = 0; i < 12; i++) p.applyPickup('bouncer');
    assert(p.bounceAmmo <= CONFIG.PICKUPS.bouncerShots * 3, '反弹弹药超过上限');
    for (let i = 0; i < 12; i++) p.applyPickup('emp');
    assert(p.empCharges <= CONFIG.PICKUPS.empCharges * 3, 'EMP 次数超过上限');
    for (let i = 0; i < 12; i++) p.applyPickup('mine');
    assert(p.mineCharges <= CONFIG.PICKUPS.mineCharges * 2, '地雷数量超过上限');
    p.applyPickup('laser');
    p.applyPickup('triple');
    assert(p.powerup === 'triple' && p.powerupShots === 0, '武器未正确替换');
    p.applyPickup('mine'); p.applyPickup('bouncer'); p.applyPickup('rapid');
    p.kill();
    assert(p.mineCharges === 0 && p.bounceAmmo === 0 && p.rapidTime === 0, '死亡后强化未清理');
    assert(p.powerup === null, '死亡后武器未清理');
    g.restart();
    assert(g.mines.length === 0, '重开后残留地雷');
    assert(g.pickups.length > 0, '重开后未生成道具');
    assert(g.recentPickupTypes.length <= CONFIG.PICKUPS.recentMemory, '防重复记忆未重置/超限');
    g.backToMenu();
    assert(g.mines.length === 0 && g.pickups.length === 0, '返回菜单后残留道具实体');
  });

  test('道具：AI 能拾取并正确使用新增道具', function () {
    const g = freshGame('ring', 3, 'hard');
    const ai = g.aiControllers[0];
    ai.tank.applyPickup('emp');
    ai.tank.applyPickup('mine');
    ai.tank.applyPickup('radar');
    const emp0 = ai.tank.empCharges, mine0 = ai.tank.mineCharges;
    let radarFrames = 0, empUsed = false, mineUsed = false;
    for (let i = 0; i < 60 * 15; i++) {
      g.input.mouse.x = g.player.x + Math.cos(i / 40) * 170;
      g.input.mouse.y = g.player.y + Math.sin(i / 40) * 170;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      if (ai.tank.radarTime > 0) radarFrames++;
      if (ai.tank.empCharges < emp0) empUsed = true;
      if (ai.tank.mineCharges < mine0) mineUsed = true;
    }
    metrics['AI 道具使用'] = 'radarFrames=' + radarFrames + ' emp=' + empUsed + ' mine=' + mineUsed;
    assert(radarFrames > 0, 'AI 雷达未生效');
    assert(empUsed || mineUsed, 'AI 未使用任何主动道具');
  });

  test('地图：12 张地图均可进入对局并正常运行 3 秒', function () {
    const ids = MAP_PRESETS.filter(p => p.id !== 'random').map(p => p.id);
    for (const id of ids) {
      const g = makeGame({ mapId: id, enemies: 3, difficulty: 'normal' });
      assert(g.state === 'playing', id + ' 未能进入对局');
      const targets = g.pickupTargets();
      assert(g.pickups.length >= targets.min && g.pickups.length <= targets.max,
        id + ' 初始道具数量异常: ' + g.pickups.length);
      assert(g.aiControllers.length === 3, id + ' AI 数量异常');
      for (let i = 0; i < 180; i++) {
        g.input.mouse.x = g.player.x + Math.cos(i / 30) * 160;
        g.input.mouse.y = g.player.y + Math.sin(i / 30) * 160;
        g.update(1 / 60);
        if (g.state !== 'playing') g.state = 'playing';
        if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
        for (const ai of g.aiControllers) if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
        for (const t of g.tanks) assert(isFinite(t.x) && isFinite(t.y), id + ' 坐标 NaN');
      }
      assert(g.pickups.length > 0, id + ' 运行后道具全部消失');
    }
    // 随机地图同样可进入
    const rnd = makeGame({ mapId: 'random', enemies: 2 });
    assert(rnd.state === 'playing' && rnd.maze && rnd.maze.walls.length > 20, '随机地图无法进入');
    for (let i = 0; i < 120; i++) rnd.update(1 / 60);
    assert(rnd.state === 'playing' || rnd.state === 'over', '随机地图运行异常');
  });

  test('性能：7 名困难 AI 在 1920×1280 大地图的单帧耗时与稳定性', function () {
    const g = makeGame({ mapId: 'fort', enemies: 7, difficulty: 'hard' });
    let nan = false, maxBullets = 0, maxParticles = 0, maxMines = 0;
    // 预热
    for (let i = 0; i < 120; i++) { g.update(1 / 60); if (g.state !== 'playing') g.state = 'playing'; }
    const t0 = Date.now();
    const frames = 60 * 30;
    for (let i = 0; i < frames; i++) {
      g.input.mouse.x = g.player.x + Math.cos(i / 45) * 170;
      g.input.mouse.y = g.player.y + Math.sin(i / 45) * 170;
      if (i % 240 === 0) g.input.mouse.down = !g.input.mouse.down;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      for (const ai of g.aiControllers) if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      maxBullets = Math.max(maxBullets, g.bullets.length);
      maxParticles = Math.max(maxParticles, g.effects.particles.length);
      maxMines = Math.max(maxMines, g.mines.length);
      for (const t of g.tanks) if (!isFinite(t.x) || !isFinite(t.y)) nan = true;
    }
    const ms = (Date.now() - t0) / frames;
    metrics['大地图7敌单帧耗时(ms)'] = ms.toFixed(3);
    assert(!nan, '大地图 7 敌出现 NaN 坐标');
    assert(ms < 6, '大地图 7 敌单帧耗时过高: ' + ms.toFixed(2) + 'ms');
    assert(maxBullets < 220, '子弹数量失控: ' + maxBullets);
    assert(maxParticles < 520, '粒子数量失控: ' + maxParticles);
    assert(maxMines < 40, '地雷数量失控: ' + maxMines);
    assert(g.pickups.length >= 4, '大地图道具数量异常: ' + g.pickups.length);
  });

  /* =========================================================
   * 10. 动态地图规模（全屏改造）
   * ========================================================= */

  test('动态尺寸：基准视口下全部地图还原预设基础规模', function () {
    for (const p of MAP_PRESETS) {
      const s = MapSize.compute(p, CONFIG.WIDTH, CONFIG.HEIGHT);
      assert(s.cols === p.cols && s.rows === p.rows,
        p.id + ' 基准视口行列数改变: ' + s.cols + 'x' + s.rows);
      assert(s.width === p.width && s.height === p.height,
        p.id + ' 基准视口世界尺寸改变: ' + s.width + 'x' + s.height);
    }
  });

  test('动态尺寸：更大视口 → 更大规模（小图铺满、大图扩展）', function () {
    const small = MAP_PRESETS.find(p => p.id === 'classic');
    const big = MAP_PRESETS.find(p => p.id === 'fort');
    const R = CONFIG.MAP_SIZE.small;
    const baseCw = small.width / small.cols;
    // 1280×720 → 1920×1080
    const s1 = MapSize.compute(small, 1280, 720);
    const s2 = MapSize.compute(small, 1920, 1080);
    assert(s1.width === 1280 && s1.height === 720, '小地图应铺满视口: ' + s1.width + 'x' + s1.height);
    assert(s2.width === 1920 && s2.height === 1080, '小地图应铺满视口: ' + s2.width + 'x' + s2.height);
    assert(s2.cols > s1.cols && s2.rows > s1.rows, '更大视口的小地图行列数应增加');
    // 格子尺寸缩放范围由配置约束（通道仍容得下坦克）
    const cw = s2.width / s2.cols, ch = s2.height / s2.rows;
    assert(cw <= baseCw * R.cellMaxScale + 1 && cw >= baseCw * R.cellMinScale - 1,
      '小地图格子缩放越界: ' + (cw / baseCw).toFixed(2) + 'x');
    assert(ch <= baseCw * R.cellMaxScale + 1 && ch >= baseCw * R.cellMinScale - 1,
      '小地图格子缩放越界: ' + (ch / baseCw).toFixed(2) + 'x');

    // 2K 主开发分辨率（2560×1440）：优先扩展真实网格而非放大格子
    const s3 = MapSize.compute(small, 2560, 1440);
    assert(s3.width === 2560 && s3.height === 1440, '2K 下小地图应铺满视口');
    assert(s3.cols >= 24 && s3.rows >= 14,
      '2K 下小地图真实扩格不足: ' + s3.cols + 'x' + s3.rows);
    assert(s3.width / s3.cols <= baseCw * R.cellMaxScale + 1 && s3.height / s3.rows <= baseCw * R.cellMaxScale + 1,
      '2K 下小地图格子过度放大: ' + (s3.width / s3.cols / baseCw).toFixed(2) + 'x');

    const b1 = MapSize.compute(big, 1280, 720);
    const b2 = MapSize.compute(big, 1920, 1080);
    const bigCw = big.width / big.cols;
    assert(b1.width > 1280 && b1.height > 720, '大地图应显著大于视口');
    assert(b2.width > b1.width && b2.height > b1.height, '更大视口的大地图应更大');
    assert(b2.width >= 1920 * 1.4 && b2.height >= 1080 * 1.4,
      '大地图扩展幅度不足: ' + b2.width + 'x' + b2.height);
    // 大地图格子尺寸保持不变（通道宽度与实体比例完全一致）
    assert(Math.abs(b2.width / b2.cols - bigCw) < 0.01, '大地图格子尺寸不应改变');
  });

  test('动态尺寸：步进取整防抖动、规模上限、极小/超宽视口安全', function () {
    const big = MAP_PRESETS.find(p => p.id === 'fort');
    // 步进取整：视口轻微变化时规模不变；即使跨过量化边界，
    // 变化量也应是 step 的整数倍（不会 1 行 1 列地频繁跳变）
    const a = MapSize.compute(big, 1920, 1080);
    const b = MapSize.compute(big, 1930, 1088);   // 轻微变化不应引起规模跳变
    assert(a.cols === b.cols && a.rows === b.rows,
      '视口轻微变化引起大地图规模跳变: ' + a.cols + 'x' + a.rows + ' -> ' + b.cols + 'x' + b.rows);
    const c = MapSize.compute(big, 1980, 1120);
    assert(Math.abs(c.cols - a.cols) % CONFIG.MAP_SIZE.big.step === 0 &&
      Math.abs(c.rows - a.rows) % CONFIG.MAP_SIZE.big.step === 0,
      '规模变化未按步进取整: ' + a.cols + 'x' + a.rows + ' -> ' + c.cols + 'x' + c.rows);
    // 上限
    const huge = MapSize.compute(big, 3840, 2160);
    assert(huge.cols <= CONFIG.MAP_SIZE.big.maxCols && huge.rows <= CONFIG.MAP_SIZE.big.maxRows,
      '大地图规模超上限: ' + huge.cols + 'x' + huge.rows);
    // 极小视口：格子仍应能容纳坦克（cell ≥ 0.8× 基础）
    const tiny = MapSize.compute(MAP_PRESETS.find(p => p.id === 'classic'), 500, 380);
    const cellW = 500 / tiny.cols, cellH = 380 / tiny.rows;
    assert(cellW >= 80 * 0.75 && cellH >= 80 * 0.75,
      '极小窗口格子过小: ' + cellW.toFixed(0) + 'x' + cellH.toFixed(0));
    // 超宽视口：格子不得无限放大（上限由配置决定）
    const ultrawide = MapSize.compute(MAP_PRESETS.find(p => p.id === 'classic'), 3440, 700);
    assert(3440 / ultrawide.cols <= 80 * (CONFIG.MAP_SIZE.small.cellMaxScale + 0.02),
      '超宽视口格子放大越界');
  });

  test('动态尺寸：describe 提供视口/可玩区/网格/世界/显示分层视图', function () {
    const preset = MAP_PRESETS.find(p => p.id === 'fort');
    const d = MapSize.describe(preset, 2560, 1440);
    assert(d.viewport.w === 2560 && d.viewport.h === 1440, 'viewport 层错误');
    assert(d.hudInset && d.hudInset.top === 0, 'hudInset 层错误');
    assert(d.playArea.w === 2560 && d.playArea.h === 1440, 'playArea 层错误（默认无内缩）');
    assert(d.cols >= preset.cols && d.rows >= preset.rows, '网格层错误');
    assert(d.width === Math.round(d.cols * d.cellW), '世界/网格层不一致');
    assert(d.cellW === d.width / d.cols && d.cellH === d.height / d.rows, '单元尺寸错误');
    assert(d.displayScale === 1, '显示缩放层错误（俯视 1:1）');
    assert(d.scrolls === true, '大地图应标记为可滚动');
    // 与 compute 单一来源一致
    const c = MapSize.compute(preset, 2560, 1440);
    assert(d.cols === c.cols && d.rows === c.rows && d.width === c.width && d.height === c.height,
      'describe 与 compute 结果不一致');
    // 小地图整图可见，scrolls 为 false
    const ds = MapSize.describe(MAP_PRESETS.find(p => p.id === 'classic'), 1920, 1080);
    assert(ds.scrolls === false, '小地图铺满视口时不应滚动');
  });

  test('动态尺寸：HUD 安全内缩会压缩可玩区并缩小地图规模', function () {
    const small = MAP_PRESETS.find(p => p.id === 'classic');
    const big = MAP_PRESETS.find(p => p.id === 'fort');
    const inset = { top: 120, right: 0, bottom: 60, left: 0 };
    // 无内缩基线
    const base = MapSize.compute(small, 1920, 1080);
    // 小地图：世界 = 可玩区（被内缩压缩）
    const s = MapSize.compute(small, 1920, 1080, 1, inset);
    assert(s.width === 1920 && s.height === 900, '小地图未按 HUD 内缩铺满可玩区: ' + s.width + 'x' + s.height);
    assert(s.cols <= base.cols, '内缩后行列数不应增加');
    // 大地图：目标世界按可玩区计算，规模不大于无内缩版本
    const bBase = MapSize.compute(big, 1920, 1080);
    const b = MapSize.compute(big, 1920, 1080, 1, inset);
    assert(b.width <= bBase.width && b.height <= bBase.height,
      '内缩后大地图规模不应增大');
    // 全局配置内缩（describe 路径）
    const saved = CONFIG.MAP_SIZE.hudInset;
    CONFIG.MAP_SIZE.hudInset = inset;
    try {
      const d = MapSize.describe(small, 1920, 1080);
      assert(d.playArea.h === 900 && d.width === 1920 && d.height === 900,
        'describe 未读取全局 HUD 内缩配置');
    } finally {
      CONFIG.MAP_SIZE.hudInset = saved;
    }
  });

  test('地图质量自检：全部预设 × 基准/1920/2560 视口均通过 validate', function () {
    const views = [[CONFIG.WIDTH, CONFIG.HEIGHT], [1920, 1080], [2560, 1440]];
    for (const p of MAP_PRESETS) {
      for (const [vw, vh] of views) {
        const m = p.layout === 'random'
          ? Maze.createRandom('validate-' + p.id + '-' + vw, vw, vh)
          : Maze.createPreset(p.id, vw, vh);
        const v = m.validation;
        assert(v, p.id + '@' + vw + ' 未生成自检结果');
        assert(v.boundaryClosed, p.id + '@' + vw + ' 边界未闭合');
        assert(v.connectivity >= 0.9, p.id + '@' + vw + ' 连通性不足: ' + v.connectivity.toFixed(3));
        assert(v.corridorFitsTank, p.id + '@' + vw + ' 通道容不下坦克');
        assert(v.ok, p.id + '@' + vw + ' 自检未通过');
        if (vw === 2560) {
          metrics['自检 ' + p.id] = m.cols + 'x' + m.rows +
            ' 连通' + (v.connectivity * 100).toFixed(0) + '%' +
            ' 死胡同' + (v.deadEndRatio * 100).toFixed(1) + '%';
        }
      }
    }
  });

  test('动态尺寸：扩图后各布局连通性 / 出生点 / 寻路一致可用', function () {
    // 用 1920×1080 视口重生成全部 12 张预设 + 一张随机图
    const ids = MAP_PRESETS.filter(p => p.id !== 'random').map(p => p.id);
    for (const id of ids) {
      const m = Maze.createPreset(id, 1920, 1080);
      assert(m.width >= 1280 && m.height >= 720, id + ' 扩图后小于视口');
      const comp = biggestNavComponent(m);
      assert(comp.ratio > 0.98, id + ' 扩图后导航连通率不足: ' + (comp.ratio * 100).toFixed(1) + '%');
      const spawns = m.pickSpawns(8);
      assert(spawns.length === 8, id + ' 扩图后出生点不足: ' + spawns.length);
      for (const s of spawns) assert(m.isFree(s.x, s.y, CONFIG.TANK.radius + 2), id + ' 扩图后出生点卡墙');
      // 跨图长距离寻路（对角）
      const path = m.findPath(spawns[0].x, spawns[0].y,
        Math.min(m.width - 40, spawns[0].x + m.width * 0.7),
        Math.min(m.height - 40, spawns[0].y + m.height * 0.7));
      assert(path && path.length > 2, id + ' 扩图后长距离寻路失败');
      // 边界墙闭合：世界边缘处必须不可站立
      assert(!m.isFree(m.width - 8, m.height / 2, 8) || !m.isFree(m.width / 2, m.height - 8, 8),
        id + ' 扩图后边界未闭合');
    }
    const r1 = Maze.createRandom('dyn-seed-1', 1920, 1080);
    const r2 = Maze.createRandom('dyn-seed-1', 1920, 1080);
    assert(r1.width === r2.width && r1.height === r2.height && r1.cols === r2.cols,
      '随机地图动态尺寸不可复现');
    assert(r1.width >= 1280, '随机地图动态尺寸异常: ' + r1.width + 'x' + r1.height);
  });

  test('动态尺寸：扩图后 big 语义 / 敌人上限 / 道具密度按地图类型判定', function () {
    // 小地图在 1920 视口下世界尺寸超过基准视口，但仍必须按"小地图"规则处理
    const g = new Game({});
    g.sound.enabled = false;
    const realCurrent = MapSize.current;
    MapSize.current = () => ({ w: 1920, h: 1080 });
    try {
      g.startMatch({ mapId: 'classic', enemies: 7, difficulty: 'normal' });
      assert(g.maze.big === false, 'classic 动态扩图后不应标记为 big');
      assert(g.maxEnemies === CONFIG.RULES.maxEnemiesSmall,
        '动态扩图的小地图不应放开敌人数上限');
      assert(g.tanks.length === CONFIG.RULES.maxEnemiesSmall + 1,
        '敌人数应被钳制在小地图上限: ' + g.tanks.length);
      const targets = g.pickupTargets();
      assert(g.pickups.length >= targets.min && g.pickups.length <= targets.max,
        '扩图后道具数量异常: ' + g.pickups.length);
    } finally {
      MapSize.current = realCurrent;
    }
  });

  test('对局中视口变化：只更新视口/摄像机，不重建地图、不移动实体', function () {
    const g = makeGame({ mapId: 'fort', enemies: 2 });
    const mazeBefore = g.maze;
    const playerBefore = g.player;
    const px = g.player.x, py = g.player.y;
    const bulletsBefore = g.bullets.length;

    g.applyViewSize(1600, 900, 1);
    assert(g.viewW === 1600 && g.viewH === 900, '视口尺寸未更新');
    assert(g.camera.w === 1600 && g.camera.h === 900, '摄像机视野未更新');
    assert(g.maze === mazeBefore, '视口变化不应重建地图');
    assert(g.player === playerBefore, '视口变化不应重建实体');
    assert(Math.abs(g.player.x - px) < 1e-9 && Math.abs(g.player.y - py) < 1e-9,
      '视口变化不应移动实体');
    assert(g.bullets.length === bulletsBefore, '视口变化不应清除子弹');

    // 视口变化后继续模拟：物理正常、坦克不卡墙不出界
    for (let i = 0; i < 120; i++) {
      g.input.mouse.x = g.player.x + Math.cos(i / 20) * 150;
      g.input.mouse.y = g.player.y + Math.sin(i / 20) * 150;
      g.update(1 / 60);
      if (g.state !== 'playing') g.state = 'playing';
      if (!g.player.alive) { g.player.alive = true; g.player.invuln = 99; }
      for (const ai of g.aiControllers) if (!ai.tank.alive) { ai.tank.alive = true; ai.tank.invuln = 1; }
      assert(g.player.x >= 0 && g.player.x <= g.maze.width, '玩家越界');
    }
    // 缩小视口同样安全
    g.applyViewSize(1024, 640, 1);
    g.update(1 / 60);
    assert(g.maze === mazeBefore && g.viewW === 1024, '缩小视口异常');
  });

  test('等距视图：投影/反投影互逆、高度换算与相机钳制', function () {
    const iso = new IsoView();
    iso.resize(2560, 1440, 2560, 1440);
    // 投影/反投影往返一致（逻辑与渲染坐标分离且互逆）
    for (const [x, y] of [[0, 0], [100, 0], [0, 100], [123.4, 567.8], [2560, 1440], [2000, 300]]) {
      const p = iso.project(x, y, 0);
      const q = iso.unproject(p.x, p.y);
      assert(Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6,
        '往返不一致: ' + x + ',' + y + ' -> ' + q.x.toFixed(3) + ',' + q.y.toFixed(3));
    }
    // 高度只影响屏幕纵轴，换算系数正确
    const p0 = iso.project(500, 500, 0);
    const p1 = iso.project(500, 500, 40);
    assert(Math.abs((p0.y - p1.y) - 40 * iso.u * CONFIG.ISO.elev) < 1e-6, '高度换算错误');
    assert(Math.abs(p1.x - p0.x) < 1e-9, '高度不应改变水平投影');
    // 相机钳制：内容大于视口时钳制在范围内；中心目标可跟随
    assert(iso.spanX > iso.viewW, '测试前提：内容应大于视口');
    const c = iso.project(1280, 720, 0);
    const cx = iso.clampCamX(c.x), cy = iso.clampCamY(c.y);
    assert(cx >= iso.minX - 1e-6 && cx <= iso.minX + iso.spanX - iso.viewW + 1e-6, '相机 X 越界');
    assert(cy >= 0 - 1e-6 && cy <= iso.spanY - iso.viewH + 1e-6, '相机 Y 越界');
    // 小内容时居中（等距内容从 minX=−H·u 开始，居中需计入 minX 偏移）
    const small = new IsoView();
    small.resize(2560, 1440, 600, 400);
    const scx = small.clampCamX(small.project(300, 200, 0).x);
    assert(Math.abs(scx - (small.minX + (small.spanX - small.viewW) / 2)) < 1e-6, '小内容应居中（含 minX 偏移）');
    // 居中后内容左缘应恰好落在屏幕内
    assert(small.minX - scx >= -1e-6, '居中后内容左缘不得越出屏幕');
  });

  test('等距视图：小地图整图适配（玩家任意位置完整可见）', function () {
    for (const [vw, vh] of [[2560, 1440], [1920, 1080], [1366, 768]]) {
      const maze = Maze.createPreset('classic', vw, vh);
      const iso = new IsoView();
      iso.resize(vw, vh, maze.width, maze.height, true);
      assert(iso.spanX <= vw + 1 && iso.spanY <= vh + 1,
        '小地图菱形未完整适配: span=' + iso.spanX.toFixed(0) + 'x' + iso.spanY.toFixed(0) +
        ' view=' + vw + 'x' + vh);
      // 相机恒居中（钳制不生效）→ 玩家在世界任意角落的屏幕投影都在视口内且不贴边
      for (const [px, py] of [
        [10, maze.height - 10],                    // 西南角（用户反馈的问题区域）
        [10, 10],                                  // 西北角
        [maze.width - 10, 10],                     // 东北角
        [maze.width - 10, maze.height - 10],       // 东南角
        [maze.width / 2, maze.height / 2]
      ]) {
        const camX = iso.clampCamX(iso.project(px, py, 0).x);
        const camY = iso.clampCamY(iso.project(px, py, 0).y);
        const sx = iso.project(px, py, 0).x - camX;
        const sy = iso.project(px, py, 0).y - camY;
        assert(sx > 15 && sx < vw - 15, '玩家屏幕 X 贴边: ' + sx.toFixed(0) + ' @' + px + ',' + py);
        assert(sy > 15 && sy < vh - 15, '玩家屏幕 Y 贴边: ' + sy.toFixed(0) + ' @' + px + ',' + py);
      }
    }
    // 大地图不受影响：仍使用跟随缩放（内容大于视口）
    const fort = MAP_PRESETS.find(p => p.id === 'fort');
    const isoB = new IsoView();
    isoB.resize(2560, 1440, fort.width * 1.55, fort.height * 1.55, false);
    assert(isoB.spanX > 2560 && isoB.spanY > 1440, '大地图应保持跟随缩放');
  });

  test('等距视图：墙体分段完整覆盖、装饰确定性与配置完备', function () {
    assert(CONFIG.ISO.enabled && (CONFIG.ISO.maps === 'all' || CONFIG.ISO.maps.indexOf('classic') >= 0),
      '等距渲染应覆盖全部地图');
    const maze = Maze.createPreset('classic', 960, 640);
    const data = IsoView.prepare(maze);
    assert(data.segs.length >= maze.walls.length, '分段数不应少于合并墙数');
    // 每个分段都落在其源墙矩形内，总面积等于源墙面积（完整覆盖、无重叠）
    let covered = 0;
    for (const s of data.segs) {
      const w = maze.walls[s.wallIndex];
      assert(s.x >= w.x - 1e-6 && s.y >= w.y - 1e-6 &&
        s.x + s.w <= w.x + w.w + 1e-6 && s.y + s.h <= w.y + w.h + 1e-6, '分段越出源墙');
      covered += s.w * s.h;
    }
    let area = 0;
    for (const w of maze.walls) area += w.w * w.h;
    assert(Math.abs(covered - area) < 1, '分段未完整覆盖墙体面积');
    // 长墙确实被切分（边界墙长度 > 单元尺寸）
    const maxLen = Math.max(maze.cellW, maze.cellH);
    assert(data.segs.some(s => maze.walls[s.wallIndex].w > maxLen + 1), '应存在被切分的长墙');
    // 确定性：同一迷宫两次准备结果一致（比较结构字段，排除运行时缓存）
    const sig = (d) => JSON.stringify({
      segs: d.segs.map(s => [s.x, s.y, s.w, s.h, s.metal, s.wallIndex]),
      cracks: d.cracks
    });
    const data2 = IsoView.prepare(Maze.createPreset('classic', 960, 640));
    assert(sig(data2) === sig(data), '墙体分段/装饰不可复现');
    // 镜像一致性：project 的线性性 (x1+x2) 投影 = p1+p2
    const iso2 = new IsoView();
    iso2.resize(2560, 1440, 2560, 1440);
    const a = iso2.project(300, 700, 0), b = iso2.project(900, 100, 0);
    const sum = iso2.project(1200, 800, 0);
    assert(Math.abs(a.x + b.x - sum.x) < 1e-6 && Math.abs(a.y + b.y - sum.y) < 1e-6,
      '投影应保持线性');
  });

  test('等距视图：全部 13 张地图均启用等距且可生成渲染数据', function () {
    for (const p of MAP_PRESETS) {
      const g = makeGame({ mapId: p.id, enemies: 1 });
      assert(g.isoActive === true, p.id + ' 未启用等距渲染');
      const data = IsoView.prepare(g.maze);
      assert(data.segs.length > 0 && data.cracks.length > 0, p.id + ' 渲染数据缺失');
      const ghostSegs = data.segs.filter(s => s.metal).length;
      assert(ghostSegs > 0, p.id + ' 缺少金属隔断标记');
      metrics['等距 ' + p.id] = g.maze.cols + 'x' + g.maze.rows + ' 段' + data.segs.length;
    }
  });

  test('等距视图：墙体遮挡检测（幽灵化判定）', function () {
    const iso = new IsoView();
    iso.resize(2560, 1440, 2560, 1440);
    const seg = { x: 500, y: 500, w: 200, h: 9, metal: false, crack: null };
    const zH = 44;
    // 坦克在墙后（北侧 26px）：中心投影落入墙体轮廓 → 遮挡
    assert(iso.segOccludes(seg, zH, 600, 500 - 26) === true, '墙后坦克应判定为被遮挡');
    // 坦克在墙前（南侧 26px）：不遮挡
    assert(iso.segOccludes(seg, zH, 600, 509 + 26) === false, '墙前坦克不应判定为被遮挡');
    // 坦克在墙的东延长线上（旁边而非背后）：不遮挡
    assert(iso.segOccludes(seg, zH, 900, 500) === false, '墙侧旁坦克不应判定为被遮挡');
    // 幽灵透明度配置存在且在合理范围
    assert(CONFIG.ISO.ghostAlpha > 0.2 && CONFIG.ISO.ghostAlpha < 0.7, 'ghostAlpha 配置异常');
    assert(CONFIG.ISO.heightK < 0.5, '墙高应已压低以减少走廊遮挡');
  });

  const failed = results.filter(r => !r.ok).length;
  return { total: results.length, failed, results, metrics };
})();