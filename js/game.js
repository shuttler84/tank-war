'use strict';
/* =========================================================
 * 游戏主控：状态机、主循环、更新与渲染
 * ========================================================= */

/* =========================================================
 * 摄像机：大地图跟随玩家，并始终钳制在世界边界内
 * ========================================================= */
class Camera {
  constructor(viewW, viewH) {
    this.w = viewW;
    this.h = viewH;
    this.x = 0;
    this.y = 0;
  }

  /** 把摄像机对准世界中的某个点 */
  follow(tx, ty, worldW, worldH) {
    this.x = worldW <= this.w
      ? (worldW - this.w) / 2
      : clamp(tx - this.w / 2, 0, worldW - this.w);
    this.y = worldH <= this.h
      ? (worldH - this.h) / 2
      : clamp(ty - this.h / 2, 0, worldH - this.h);
  }

  /** 世界坐标是否在视野内（用于裁剪） */
  contains(x, y, margin) {
    const m = margin || 0;
    return x >= this.x - m && x <= this.x + this.w + m &&
           y >= this.y - m && y <= this.y + this.h + m;
  }
}

class Game {
  constructor(opts) {
    opts = opts || {};
    this.canvas = opts.canvas || null;
    this.stage = opts.stage || null;
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.headless = !this.ctx;

    this.input = opts.input || new Input(this.canvas);
    this.sound = opts.sound || new Sound(true);
    this.effects = new Effects();

    /* 视口尺寸：浏览器可供游戏使用的区域（全屏后即窗口大小）。
     * 战斗界面铺满视口；地图世界坐标独立于视口，由 MapSize 决定。 */
    const view = MapSize.current();
    this.viewW = view.w;
    this.viewH = view.h;
    this.hudScale = 1;
    this.camera = new Camera(this.viewW, this.viewH);
    if (this.input) this.input.camera = this.camera;

    /* 等距伪 3D 视图（原型）：仅对 CONFIG.ISO.maps 中的地图启用 */
    this.iso = new IsoView();
    this.isoActive = false;

    this.maze = null;
    this.menuMaze = null;
    this.menuMapId = 'classic';
    this.setMenuMap('classic');
    this.tanks = [];
    this.bullets = [];
    this.pickups = [];
    this.mines = [];
    this.lasers = [];
    this.pickupTimer = 0;
    this.pickupRegions = [];
    this.recentPickupTypes = [];
    this.spawnPoints = [];
    this.pickupToast = null;
    this.roleTimer = 0;
    this.lastPlayerShot = null;   // {x, y, time} 供巡逻 AI"听声辨位"
    this.enemyIntel = null;       // AI 共享情报黑板 {x, y, time, reporterId}（带时间戳）
    this.player = null;
    this.playerCtrl = null;
    this.aiControllers = [];

    this.time = 0;
    this.state = 'menu';            // menu | playing | paused | ending | over
    this.result = null;             // victory | defeat
    this.pendingResult = null;
    this.endTimer = 0;
    this.score = 0;
    this.kills = 0;
    this.shake = 0;
    this.hudFade = 1;
    this.minimapFade = 1;
    this.lives = CONFIG.RULES.playerLives;
    this.respawnTimer = 0;
    this.deaths = 0;
    this.dpr = 1;
    this.acc = 0;
    this.fixedDt = CONFIG.FIXED_DT;
    this.lastFrame = 0;
    this.raf = 0;
    this.debugShowAimCircle = false;

    this.settings = {
      mapId: 'classic',
      enemies: 2,
      difficulty: 'normal',
      lives: CONFIG.RULES.playerLives,
      sound: true
    };

    this.onStateChange = null;
    this.menuPreviewTimer = 0;

    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search || '');
      this.debugShowAimCircle = q.get('debug') === '1';
      // 等距视图强制开关（测试用）：?iso=1 / ?iso=0
      this.isoForced = q.get('iso') === '0' ? false : (q.get('iso') === '1' ? true : null);
    }
  }

  /* ---------------- 等距视图（原型） ---------------- */

  /** 指定地图是否使用等距渲染（CONFIG.ISO.maps = 'all' 或 id 数组；URL ?iso= 可强制关闭） */
  isoAllowed(mapId) {
    const list = CONFIG.ISO.maps;
    return list === 'all' || (Array.isArray(list) && list.indexOf(mapId) >= 0);
  }

  isIsoMap(mapId) {
    if (this.isoForced !== null && this.isoForced !== undefined) {
      return this.isoForced && this.isoAllowed(mapId);
    }
    return !!CONFIG.ISO.enabled && this.isoAllowed(mapId);
  }

  /** 等距参数随视口与当前阶段地图刷新（缩放、内容范围）。
   *  小地图（整图可见设计）传 fitWhole：等距菱形完整适配视口，
   *  相机恒居中，任何位置的玩家都完整可见；大地图保持跟随缩放。 */
  refreshIsoView() {
    if (!this.iso) return;
    const menuPhase = (this.state || 'menu') === 'menu';
    const maze = menuPhase ? this.menuMaze : this.maze;
    if (!maze) return;
    this.iso.resize(this.viewW, this.viewH, maze.width, maze.height, !maze.big);
  }

  /** 等距相机：以世界点为目标设置视口（钳制在投影内容范围内） */
  followIsoCamera() {
    if (!this.iso || !this.player) return;
    const p = this.iso.project(this.player.x, this.player.y, 0);
    this.camera.x = this.iso.clampCamX(p.x);
    this.camera.y = this.iso.clampCamY(p.y);
  }

  /** 等距相机居中（主菜单预览 / 复位） */
  centerIsoCamera() {
    if (!this.iso) return;
    const menuPhase = (this.state || 'menu') === 'menu';
    const maze = menuPhase ? this.menuMaze : this.maze;
    if (!maze) return;
    const p = this.iso.project(maze.width / 2, maze.height / 2, 0);
    this.camera.x = this.iso.clampCamX(p.x);
    this.camera.y = this.iso.clampCamY(p.y);
  }

  /** 等距输入映射：画布坐标 → 世界坐标（逆投影，含相机偏移） */
  isoMapper() {
    const iso = this.iso;
    const cam = this.camera;
    return (cx, cy) => iso.unprojectAt(cx, cy, cam);
  }

  /* ---------------- 视口与 DPR ---------------- */

  /**
   * 应用新的视口尺寸：更新 Canvas 分辨率、摄像机视野与 HUD 缩放。
   * 只调整显示层，绝不重建地图或移动实体（战斗中的窗口缩放安全）。
   * @param {number} vw 视口宽（CSS 像素）
   * @param {number} vh 视口高（CSS 像素）
   * @param {number} [dpr] 设备像素比（测试环境可显式传 1）
   */
  applyViewSize(vw, vh, dpr) {
    this.viewW = vw;
    this.viewH = vh;
    this.camera.w = vw;
    this.camera.h = vh;

    this.dpr = dpr !== undefined ? dpr
      : (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    if (this.canvas) {
      this.canvas.width = Math.round(vw * this.dpr);
      this.canvas.height = Math.round(vh * this.dpr);
    }

    /* HUD 缩放：以逻辑分辨率 (960×640) 为参照，窗口越大 HUD 越大，
     * 封顶 1.6 防止超大屏幕上 HUD 喧宾夺主；小窗口保持 1 保证可读。 */
    const ref = Math.min(vw / (CONFIG.WIDTH * 1.15), vh / (CONFIG.HEIGHT * 1.15));
    this.hudScale = clamp(ref, 1, 1.6);

    if (this.stage) {
      const overlay = this.stage.querySelector('.overlay');
      if (overlay) {
        const fs = clamp(Math.min(vw / 60, vh / 46), 11.5, 17.5);
        overlay.style.fontSize = fs + 'px';
      }
    }

    // 等距视图参数随视口刷新；主菜单重新居中，战斗中下一帧自动跟随
    this.refreshIsoView();
    if (this.isoActive) {
      if ((this.state || 'menu') === 'menu') this.centerIsoCamera();
      else this.followIsoCamera();
    }
  }

  /** 窗口尺寸变化：更新视口；主菜单下防抖重建预览地图（战斗中不动地图） */
  resize() {
    if (typeof window === 'undefined' || !this.canvas) return;
    this.applyViewSize(
      Math.max(320, window.innerWidth),
      Math.max(240, window.innerHeight)
    );
    if (this.state === 'menu') this.scheduleMenuPreviewRefresh();
  }

  /** 主菜单预览地图防抖重建：避免拖拽窗口时连续重建 */
  scheduleMenuPreviewRefresh() {
    if (typeof window === 'undefined') return;
    if (this.menuPreviewTimer) clearTimeout(this.menuPreviewTimer);
    this.menuPreviewTimer = setTimeout(() => {
      this.menuPreviewTimer = 0;
      if (this.state !== 'menu') return;
      this.setMenuMap(this.menuMapId || 'classic');
    }, 200);
  }

  /* ---------------- 流程 ---------------- */

  notify(state) {
    if (this.onStateChange) this.onStateChange(state, this);
  }

  setMenuMap(mapId, reroll) {
    const prevId = this.menuMapId;
    this.menuMapId = mapId;
    // 随机地图预览：显式选择（或再次点击）时换新种子，视口刷新时保持同一张
    if (mapId === 'random' && (reroll || mapId !== prevId || !this.menuPreviewSeed)) {
      this.menuPreviewSeed = 'menu-preview-' + Date.now();
    }
    // 菜单预览地图同样按当前视口动态定尺寸，铺满整个窗口作为背景
    const view = MapSize.current();
    this.menuMaze = mapId === 'random'
      ? Maze.createRandom(this.menuPreviewSeed || 'menu-preview', view.w, view.h)
      : Maze.createPreset(mapId, view.w, view.h);
    this.isoActive = this.isIsoMap(mapId);
    this.refreshIsoView();
    if (this.isoActive) this.centerIsoCamera();
    else {
      this.camera.follow(this.menuMaze.width / 2, this.menuMaze.height / 2,
        this.menuMaze.width, this.menuMaze.height);
    }
  }

  startMatch(settings) {
    if (settings) Object.assign(this.settings, settings);

    // 开战时刻根据当前视口确定本局地图规模，之后本局内保持稳定
    const mapId = this.settings.mapId;
    const view = MapSize.current();
    this.maze = mapId === 'random'
      ? Maze.createRandom('random-' + Date.now() + '-' + Math.random(), view.w, view.h)
      : Maze.createPreset(mapId, view.w, view.h);

    this.bullets.length = 0;
    this.tanks.length = 0;
    this.pickups.length = 0;
    this.mines.length = 0;
    this.lasers.length = 0;
    this.aiControllers.length = 0;
    this.effects.clear();
    this.time = 0;
    this.acc = 0;
    this.shake = 0;
    this.score = 0;
    this.kills = 0;
    this.result = null;
    this.pendingResult = null;
    this.endTimer = 0;
    this.lives = clamp(Math.floor(this.settings.lives) || CONFIG.RULES.playerLives, 1, 9);
    this.respawnTimer = 0;
    this.deaths = 0;
    this.roleTimer = 0;
    this.pickupTimer = 0;
    this.pickupRegions = [];
    this.recentPickupTypes = [];
    this.pickupToast = null;
    this.lastPlayerShot = null;
    this.enemyIntel = null;
    this.input.reset();

    // 敌人上限按地图类型（预设小/大图）判定，与当前视口无关
    const isBig = this.maze.big;
    const maxEnemies = isBig ? CONFIG.RULES.maxEnemiesBig : CONFIG.RULES.maxEnemiesSmall;
    const enemyCount = clamp(Math.floor(this.settings.enemies) || 1, 1, maxEnemies);
    this.maxEnemies = maxEnemies;
    const spawns = this.maze.pickSpawns(enemyCount + 1);
    // 极端情况兜底：从导航网格里找远离已有出生点的可行走格
    // （兜底间距与 pickSpawns 一致，随地图面积放大）
    const areaK = Math.sqrt((this.maze.width * this.maze.height) / (CONFIG.WIDTH * CONFIG.HEIGHT));
    const fallbackDist = 120 * (this.maze.big ? clamp(areaK, 1, 1.6) : 1);
    while (spawns.length < enemyCount + 1) {
      let picked = null;
      for (let i = 0; i < this.maze.navFree.length; i++) {
        if (!this.maze.navFree[i]) continue;
        const p = this.maze.navCenter(i);
        let ok = true;
        for (let j = 0; j < spawns.length; j++) {
          if (dist(p.x, p.y, spawns[j].x, spawns[j].y) < fallbackDist) { ok = false; break; }
        }
        if (ok) { picked = p; break; }
      }
      spawns.push(picked || { x: this.maze.width / 2, y: this.maze.height / 2 });
    }

    const cx = this.maze.width / 2, cy = this.maze.height / 2;
    const playerSpawn = spawns[0];
    this.player = new Tank({
      id: 0,
      x: playerSpawn.x,
      y: playerSpawn.y,
      angle: Math.atan2(cy - playerSpawn.y, cx - playerSpawn.x),
      isPlayer: true,
      colorKey: 'green',
      name: '玩家',
      maxSpeed: CONFIG.TANK.playerSpeed,
      turnSpeed: CONFIG.TANK.playerTurnSpeed,
      fireCooldown: CONFIG.BULLET.playerCooldown
    });
    this.tanks.push(this.player);

    const colors = ['red', 'blue', 'orange', 'purple', 'teal', 'pink', 'gold'];
    const personalities = ['aggressive', 'tactical', 'cautious', 'tactical'];
    const diffKey = AI_DIFFICULTIES[this.settings.difficulty] ? this.settings.difficulty : 'normal';

    for (let i = 0; i < enemyCount; i++) {
      const sp = spawns[i + 1];
      const tank = new Tank({
        id: i + 1,
        x: sp.x,
        y: sp.y,
        angle: Math.atan2(this.player.y - sp.y, this.player.x - sp.x),
        colorKey: colors[i % colors.length],
        name: '敌方 ' + (i + 1)
      });
      this.tanks.push(tank);
      this.aiControllers.push(new AIController(tank, this, diffKey, personalities[i % personalities.length]));
    }

    this.playerCtrl = new PlayerController(this.player, this.input);
    this.isoActive = this.isIsoMap(mapId);
    this.refreshIsoView();
    if (this.isoActive) {
      this.followIsoCamera();
      this.input.setViewMapper(this.isoMapper());
    } else {
      this.camera.follow(this.player.x, this.player.y, this.maze.width, this.maze.height);
      this.input.setViewMapper(null);
    }
    // 道具系统：记录出生点、划分区域后生成首批道具
    this.spawnPoints = spawns.map(s => ({ x: s.x, y: s.y }));
    this.buildPickupRegions();
    this.spawnPickups();
    this.assignAIRoles();
    // 开局侦察情报：敌人得知玩家的出生区域。
    // 这是一份静态情报（带时间戳、按各自难度衰减），玩家离开出生点后不会更新，
    // 取代旧版"从未看见也实时追踪玩家坐标"的不公平行为，同时保住开局节奏。
    if (CONFIG.RULES.spawnIntel) {
      this.enemyIntel = { x: playerSpawn.x, y: playerSpawn.y, time: 0, reporterId: -1 };
    }
    this.state = 'playing';
    this.input.enabled = true;
    this.notify('playing');
  }

  restart() {
    if (this.state === 'menu') { this.startMatch(); return; }
    this.startMatch();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.reset();
    this.notify('paused');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.acc = 0;
    this.input.reset();
    this.notify('playing');
  }

  togglePause() {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  backToMenu() {
    this.state = 'menu';
    this.playerCtrl = null;
    this.bullets.length = 0;
    this.pickups.length = 0;
    this.mines.length = 0;
    this.lasers.length = 0;
    this.tanks.length = 0;
    this.aiControllers.length = 0;
    this.enemyIntel = null;
    this.pickupRegions = [];
    this.recentPickupTypes = [];
    this.spawnPoints = [];
    this.pickupToast = null;
    this.effects.clear();
    this.input.reset();
    this.input.setViewMapper(null);
    this.isoActive = this.isIsoMap(this.menuMapId || 'classic');
    this.refreshIsoView();
    if (this.isoActive) this.centerIsoCamera();
    this.notify('menu');
  }

  /* ---------------- 更新 ---------------- */

  addShake(amount) {
    this.shake = Math.min(22, this.shake + amount);
  }

  update(dt) {
    if (this.state === 'playing' || this.state === 'ending') this.updateWorld(dt);
    this.effects.update(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 26);
  }

  updateWorld(dt) {
    this.time += dt;

    // 摄像机跟随玩家，鼠标世界坐标据此换算（大地图必需；等距视图走 iso 相机）
    if (this.player) {
      if (this.isoActive) this.followIsoCamera();
      else this.camera.follow(this.player.x, this.player.y, this.maze.width, this.maze.height);
    }
    if (this.input.attached) this.input.syncWorld();

    // 复活倒计时
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawnPlayer();
    }

    // 玩家控制（仅在正式对局中响应鼠标）
    if (this.state === 'playing' && this.playerCtrl && this.player.alive) {
      this.playerCtrl.update(dt);
    } else if (this.player) {
      this.player.moveIntent = 0;
    }

    // AI
    for (let i = 0; i < this.aiControllers.length; i++) this.aiControllers[i].update(dt);

    // 坦克物理
    for (let i = 0; i < this.tanks.length; i++) this.tanks[i].update(dt, this.maze);
    this.separateTanks();

    // 玩家射击（连射门控：按住不可绕过单轮上限/间隔/冷却，轮末须松开再按）
    {
      const hold = this.state === 'playing' && this.player.alive && this.input.mouse.down;
      if (this.player.updateFireGate(hold)) {
        const shots = this.player.fire(this);
        if (shots && shots.length) {
          for (let i = 0; i < shots.length; i++) this.bullets.push(shots[i]);
          this.lastPlayerShot = { x: this.player.x, y: this.player.y, time: this.time };
        }
      }
    }

    // 玩家主动道具（Q 布设地雷 / E 释放 EMP）
    if (this.state === 'playing' && this.player && this.player.alive && this.input.consume) {
      if (this.input.consume('emp')) this.player.useEmp(this);
      if (this.input.consume('mine')) this.player.deployMine(this);
    }

    // 道具：拾取判定 + 过期转移 + 自适应补充
    this.updatePickups(dt);

    // 地雷：延时起爆 / 触发检测
    for (let i = 0; i < this.mines.length; i++) {
      const mine = this.mines[i];
      if (!mine.dead) mine.update(dt, this);
    }
    let mw = 0;
    for (let i = 0; i < this.mines.length; i++) {
      if (!this.mines[i].dead) this.mines[mw++] = this.mines[i];
    }
    this.mines.length = mw;

    // 激光光束衰减
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      this.lasers[i].life -= dt;
      if (this.lasers[i].life <= 0) this.lasers.splice(i, 1);
    }

    // AI 角色轮换（追击 / 巡逻）
    this.roleTimer -= dt;
    if (this.roleTimer <= 0) {
      this.roleTimer = 2.5;
      this.assignAIRoles();
    }

    // 子弹
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.dead) b.update(dt, this);
    }
    let w = 0;
    for (let i = 0; i < this.bullets.length; i++) {
      if (!this.bullets[i].dead) this.bullets[w++] = this.bullets[i];
    }
    this.bullets.length = w;

    // 结算延迟
    if (this.state === 'ending') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) {
        this.state = 'over';
        this.result = this.pendingResult;
        this.notify('over');
      }
    }
  }

  /** 坦克之间互相推开，避免重叠 */
  separateTanks() {
    const list = this.tanks;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        const minD = a.radius + b.radius;
        if (d >= minD) continue;
        if (d < 1e-4) { dx = 1; dy = 0; d = 1e-4; }
        const nx = dx / d, ny = dy / d;
        const push = (minD - d) * 0.5 + 0.01;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
        a.resolveWalls(this.maze);
        b.resolveWalls(this.maze);
        a.x = clamp(a.x, a.radius, this.maze.width - a.radius);
        a.y = clamp(a.y, a.radius, this.maze.height - a.radius);
        b.x = clamp(b.x, b.radius, this.maze.width - b.radius);
        b.y = clamp(b.y, b.radius, this.maze.height - b.radius);
      }
    }
  }

  /** 沿子弹本帧位移查找最近的被撞击坦克 */
  findTankHit(bullet, x, y, mvx, mvy) {
    const x1 = x + mvx, y1 = y + mvy;
    let best = null;
    let bestT = 2;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive) continue;
      if (t.id === bullet.ownerId) continue;   // 统一规则：子弹不会伤害发射者
      if (t.invuln > 0) continue;              // 复活保护
      const tt = Physics.segmentCircle(x, y, x1, y1, t.x, t.y, t.radius + bullet.radius);
      if (tt >= 0 && tt < bestT) { bestT = tt; best = t; }
    }
    return best;
  }

  onBulletHit(bullet, target) {
    if (!target.alive || target.invuln > 0) return;
    // 散裂弹母弹命中目标：先炸出碎片再结算
    if (bullet.cluster && bullet.generation === 1) bullet.spawnFragments(this);
    target.kill();
    this.effects.explosion(target.x, target.y, target.colors.body);
    this.addShake(9);
    if (this.sound) this.sound.play('explosion');

    if (bullet.ownerId === this.player.id && !target.isPlayer) {
      this.score += CONFIG.RULES.scorePerKill;
      this.kills++;
    }

    if (target.isPlayer) this.onPlayerDown();
    else this.checkVictory();
  }

  /** 玩家被击毁：还有生命就等待复活，否则判负 */
  onPlayerDown() {
    this.deaths++;
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives > 0) {
      this.respawnTimer = CONFIG.RULES.respawnDelay;
      this.input.reset();
      return;
    }
    if (this.state === 'playing') {
      this.state = 'ending';
      this.pendingResult = 'defeat';
      this.endTimer = CONFIG.RULES.endDelay;
      this.notify('ending');
      if (this.sound) this.sound.play('lose');
    }
  }

  /** 复活点：在可行走格中挑离敌人最远的位置 */
  findRespawnPoint() {
    const maze = this.maze;
    const enemies = [];
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.isPlayer && t.alive) enemies.push(t);
    }
    let best = null, bestD = -Infinity;
    for (let i = 0; i < 90; i++) {
      const idx = Math.floor(Math.random() * maze.navFree.length);
      if (!maze.navFree[idx]) continue;
      const p = maze.navCenter(idx);
      let minD = 1e9;
      for (let j = 0; j < enemies.length; j++) {
        minD = Math.min(minD, dist(p.x, p.y, enemies[j].x, enemies[j].y));
      }
      if (minD > bestD) { bestD = minD; best = p; }
    }
    return best || { x: maze.width / 2, y: maze.height / 2 };
  }

  respawnPlayer() {
    const p = this.player;
    if (!p) return;
    const spot = this.findRespawnPoint();
    p.x = spot.x;
    p.y = spot.y;
    p.alive = true;
    p.cooldown = 0;
    p.resetBurst();          // 连射计数/轮末状态随重生复位
    p.moveIntent = 0;
    p.speed = 0;
    p.invuln = CONFIG.RULES.respawnInvuln;
    p.spawnFlash = 0.8;

    // 朝最近的敌人
    let nearest = null, nd = Infinity;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (t.isPlayer || !t.alive) continue;
      const d = dist(p.x, p.y, t.x, t.y);
      if (d < nd) { nd = d; nearest = t; }
    }
    p.angle = nearest ? Math.atan2(nearest.y - p.y, nearest.x - p.x) : 0;
    p.aimAngle = p.angle;

    if (this.playerCtrl) this.playerCtrl.reset();
    this.camera.follow(p.x, p.y, this.maze.width, this.maze.height);
    this.effects.rings.push({ x: p.x, y: p.y, r: 4, maxR: 42, life: 0.5, maxLife: 0.5, color: '#7FD9FF', width: 3 });
    this.respawnTimer = 0;
  }

  /* ---------------- 道具刷新系统 ---------------- */

  /** 当前地图的目标道具数量（随地图面积缩放，大地图不再稀疏） */
  pickupTargets() {
    const base = this.maze.big ? CONFIG.PICKUPS.targets.big : CONFIG.PICKUPS.targets.small;
    const area = (this.maze.width * this.maze.height) / (CONFIG.WIDTH * CONFIG.HEIGHT);
    const scale = 0.85 + 0.25 * Math.sqrt(Math.max(1, area));
    return {
      initial: Math.max(3, Math.round(base.initial * scale)),
      min: Math.max(2, Math.round(base.min * scale)),
      max: Math.max(4, Math.round(base.max * scale)),
      respawn: base.respawn
    };
  }

  /** 把导航网格划分为若干道具区域（记录每区的可用格） */
  buildPickupRegions() {
    const maze = this.maze;
    const rs = CONFIG.PICKUPS.regionSize;
    const cols = Math.max(1, Math.ceil(maze.width / rs));
    const rows = Math.max(1, Math.ceil(maze.height / rs));
    const regions = [];
    const total = cols * rows;
    for (let i = 0; i < total; i++) regions.push({ cells: [] });
    for (let cy = 0; cy < maze.navRows; cy++) {
      for (let cx = 0; cx < maze.navCols; cx++) {
        const idx = cy * maze.navCols + cx;
        if (!maze.navFree[idx]) continue;
        const rc = Math.min(cols - 1, Math.floor(cx * maze.navSize / rs));
        const rr = Math.min(rows - 1, Math.floor(cy * maze.navSize / rs));
        regions[rr * cols + rc].cells.push(idx);
      }
    }
    this.pickupRegions = regions.filter(rg => rg.cells.length >= 6);
  }

  /**
   * 校验道具候选点：可站立、与坦克/出生点/已有道具保持距离。
   * 返回吸附后的坐标或 null（失败应重新选点，绝不强行生成）。
   */
  findValidPickupSpot(x, y, relax) {
    const maze = this.maze, cfg = CONFIG.PICKUPS;
    const f = relax === undefined ? 1 : relax;
    const rr = cfg.radius + 4;
    x = clamp(x, rr + 4, maze.width - rr - 4);
    y = clamp(y, rr + 4, maze.height - rr - 4);
    const idx = maze.navIndexOf(x, y);
    const freeIdx = maze.navFree[idx] ? idx : maze.nearestFree(idx, 5);
    if (freeIdx < 0) return null;
    const p = maze.navCenter(freeIdx);
    if (!maze.isFree(p.x, p.y, rr)) return null;
    // 约束随重试逐步放宽，但永远不允许与坦克重叠
    const minTank = Math.max(CONFIG.TANK.radius + cfg.radius + 8, cfg.minTankDist * f);
    const minSpawn = Math.max(60, cfg.minSpawnDist * f);
    const minPickup = Math.max(cfg.radius * 2 + 18, cfg.minPickupDist * f);
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive) continue;
      if (dist(p.x, p.y, t.x, t.y) < minTank) return null;
    }
    for (let i = 0; i < this.spawnPoints.length; i++) {
      const s = this.spawnPoints[i];
      if (dist(p.x, p.y, s.x, s.y) < minSpawn) return null;
    }
    for (let i = 0; i < this.pickups.length; i++) {
      if (dist(p.x, p.y, this.pickups[i].x, this.pickups[i].y) < minPickup) return null;
    }
    return { x: p.x, y: p.y };
  }

  /**
   * 在一个区域内生成道具簇（1~3 个），簇内保持间距、簇间保持距离。
   * @returns {number} 实际生成数量
   */
  spawnPickupCluster(region, sizeHint) {
    if (!region || !region.cells.length) return 0;
    const cfg = CONFIG.PICKUPS;
    const maze = this.maze;
    const want = clamp(sizeHint || (cfg.clusterMin + Math.floor(Math.random() * (cfg.clusterMax - cfg.clusterMin + 1))),
      1, cfg.clusterMax + 1);

    // 簇中心候选：偏好开阔、易到达的格
    const centers = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const idx = region.cells[Math.floor(Math.random() * region.cells.length)];
      const p = maze.navCenter(idx);
      centers.push({ x: p.x, y: p.y, score: maze.openness(p.x, p.y, 90) + Math.random() * 6 });
    }
    centers.sort((a, b) => b.score - a.score);
    if (!centers.length) return 0;

    const relaxSteps = [1, 0.85, 0.7, 0.55, 0.45];
    let placed = 0;
    for (let ci = 0; ci < centers.length && placed < want; ci++) {
      const center = centers[ci];
      for (let k = placed; k < want; k++) {
        let pos = null;
        for (let attempt = 0; attempt < 18; attempt++) {
          const relax = relaxSteps[attempt % relaxSteps.length];
          let x = center.x, y = center.y;
          if (k > 0 || attempt > 0) {
            const a = Math.random() * TAU;
            const r = cfg.clusterSpacingMin + Math.random() * (cfg.clusterSpacingMax - cfg.clusterSpacingMin);
            x += Math.cos(a) * r;
            y += Math.sin(a) * r;
          }
          pos = this.findValidPickupSpot(x, y, relax);
          if (pos) break;
        }
        if (!pos) break;   // 该中心点放不下，换下一个中心
        const type = randomPickupType(this.recentPickupTypes);
        this.pickups.push(new Pickup(type, pos.x, pos.y));
        this.recentPickupTypes.push(type);
        while (this.recentPickupTypes.length > CONFIG.PICKUPS.recentMemory) this.recentPickupTypes.shift();
        placed++;
      }
    }
    return placed;
  }

  /** 开局首批道具：按区域轮转，保证各战区都有覆盖 */
  spawnPickups() {
    this.pickups.length = 0;
    if (!this.pickupRegions.length) this.buildPickupRegions();
    const targets = this.pickupTargets();
    const regions = shuffle(seededRandom(this.maze.seed + '-pickup-init'), this.pickupRegions.slice());
    let guard = 0;
    let round = 0;
    while (this.pickups.length < targets.initial && guard++ < 120 && regions.length) {
      const remain = targets.initial - this.pickups.length;
      if (remain <= 0) break;
      const region = regions[round % regions.length];
      // 前两簇稍大，制造"争夺热点"；大地图其余以散点覆盖更多战区，
      // 小地图继续以 2 个为一簇保持局部争夺密度。均不超过剩余缺口。
      const hint = Math.min(remain,
        round < 2 ? 3 : (this.maze.big ? 1 : 2));
      this.spawnPickupCluster(region, hint);
      round++;
      if (round > regions.length * 4 && this.pickups.length < targets.initial) {
        // 区域都试过仍不足：允许跨区域补充单个
        this.spawnPickupCluster(regions[Math.floor(Math.random() * regions.length)], 1);
      }
    }
    this.pickupTimer = targets.respawn;
  }

  /** 补充一个簇到道具最少的区域；达到上限则停止 */
  spawnOnePickup() {
    const targets = this.pickupTargets();
    if (this.pickups.length >= targets.max) return false;
    if (!this.pickupRegions.length) return false;
    const rs = CONFIG.PICKUPS.regionSize;
    const ranked = [];
    for (let i = 0; i < this.pickupRegions.length; i++) {
      const rg = this.pickupRegions[i];
      if (!rg.cells.length) continue;
      let cx = 0, cy = 0;
      for (let k = 0; k < rg.cells.length; k++) {
        const p = this.maze.navCenter(rg.cells[k]);
        cx += p.x; cy += p.y;
      }
      cx /= rg.cells.length; cy /= rg.cells.length;
      let count = 0;
      for (let k = 0; k < this.pickups.length; k++) {
        if (dist(this.pickups[k].x, this.pickups[k].y, cx, cy) < rs * 1.2) count++;
      }
      let nearestTank = 1e9;
      for (let k = 0; k < this.tanks.length; k++) {
        if (!this.tanks[k].alive) continue;
        nearestTank = Math.min(nearestTank, dist(cx, cy, this.tanks[k].x, this.tanks[k].y));
      }
      // 道具越少越优先；离坦克太近的区域略降权，避免"贴脸刷新"
      ranked.push({ rg, score: -count * 3 + Math.min(600, nearestTank) / 600 + Math.random() });
    }
    ranked.sort((a, b) => b.score - a.score);
    for (let i = 0; i < ranked.length; i++) {
      if (this.spawnPickupCluster(ranked[i].rg, 1) > 0) return true;
    }
    return false;
  }

  /** 每帧：拾取、过期转移、按存量自适应补充 */
  updatePickups(dt) {
    const cfg = CONFIG.PICKUPS;
    const targets = this.pickupTargets();

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.age += dt;
      let taken = false;
      for (let j = 0; j < this.tanks.length; j++) {
        const t = this.tanks[j];
        if (!t.alive) continue;
        if (dist(t.x, t.y, pk.x, pk.y) > t.radius + pk.radius) continue;
        t.applyPickup(pk.type);
        this.pickups.splice(i, 1);
        taken = true;
        this.effects.rings.push({
          x: pk.x, y: pk.y, r: 4, maxR: 34, life: 0.4, maxLife: 0.4,
          color: PICKUP_TYPES[pk.type].color, width: 3
        });
        if (t.isPlayer) {
          this.pickupToast = { type: pk.type, time: this.time };
          if (this.sound) this.sound.play('pickup');
        }
        break;
      }
      if (taken) continue;
      // 过期转移：存量富余时移除长期无人拾取的道具，让刷新点保持流动
      if (pk.age > cfg.maxAge && this.pickups.length > targets.min + 1) {
        this.pickups.splice(i, 1);
      }
    }

    const deficit = targets.max - this.pickups.length;
    if (deficit <= 0) {
      this.pickupTimer = Math.max(this.pickupTimer, targets.respawn * 0.5);
      return;
    }
    this.pickupTimer -= dt;
    if (this.pickupTimer > 0) return;
    const urgency = clamp((targets.initial - this.pickups.length) / Math.max(1, targets.initial - targets.min), 0, 1);
    let spawned = this.spawnOnePickup();
    // 低于最低存量时加快补给（一次尝试两个簇），避免长时间道具荒
    if (this.pickups.length < targets.min) {
      spawned = this.spawnOnePickup() || spawned;
    }
    // 存量越低补充间隔越短（基础间隔的 30%~55%）
    const interval = targets.respawn * (0.30 + 0.25 * (1 - urgency)) * (0.8 + Math.random() * 0.4);
    this.pickupTimer = spawned ? interval : Math.max(1.0, interval * 0.5);
  }

  nearestPickup(x, y, maxDist) {
    let best = null, bestD = maxDist;
    for (let i = 0; i < this.pickups.length; i++) {
      const d = dist(x, y, this.pickups[i].x, this.pickups[i].y);
      if (d <= bestD) { bestD = d; best = this.pickups[i]; }
    }
    return best;
  }

  /* ---------------- 范围效果：地雷 / EMP ---------------- */

  /** 地雷爆炸：墙体遮挡、无敌保护、不伤布设者，并支持连锁引爆 */
  onMineExplode(mine) {
    if (!mine || mine.exploded) return;
    mine.exploded = true;
    const cfg = CONFIG.PICKUPS;
    this.effects.explosion(mine.x, mine.y, '#D9A066');
    this.effects.rings.push({
      x: mine.x, y: mine.y, r: 6, maxR: cfg.mineBlastRadius,
      life: 0.35, maxLife: 0.35, color: '#FFB36B', width: 3
    });
    this.addShake(5);
    if (this.sound) this.sound.play('explosion');

    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive || t.invuln > 0) continue;
      if (t.id === mine.ownerId) continue;              // 与"子弹不伤发射者"一致
      if (dist(t.x, t.y, mine.x, mine.y) > cfg.mineBlastRadius + t.radius) continue;
      if (!this.maze.losClear(mine.x, mine.y, t.x, t.y, CONFIG.BULLET.radius)) continue;
      this.onBulletHit({ ownerId: mine.ownerId, cluster: false, generation: 2 }, t);
    }

    // 连锁引爆附近地雷
    for (let i = 0; i < this.mines.length; i++) {
      const other = this.mines[i];
      if (other === mine || other.dead || other.exploded) continue;
      if (dist(other.x, other.y, mine.x, mine.y) <= cfg.mineBlastRadius) {
        other.dead = true;
        this.onMineExplode(other);
      }
    }
  }

  /** EMP 脉冲：范围内且视线可达的敌方坦克被短暂干扰 */
  emitEmp(source) {
    const cfg = CONFIG.PICKUPS;
    this.effects.rings.push({
      x: source.x, y: source.y, r: 8, maxR: cfg.empRadius,
      life: 0.5, maxLife: 0.5, color: '#9BF0FF', width: 3
    });
    this.effects.rings.push({
      x: source.x, y: source.y, r: 4, maxR: cfg.empRadius * 0.6,
      life: 0.32, maxLife: 0.32, color: '#FFE9A8', width: 2
    });
    this.addShake(3);
    if (this.sound) this.sound.play('emp');
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive || t === source || t.invuln > 0) continue;
      if (dist(t.x, t.y, source.x, source.y) > cfg.empRadius) continue;
      // 墙体阻挡：隔墙不会被无条件控制
      if (!this.maze.losClear(source.x, source.y, t.x, t.y, CONFIG.BULLET.radius)) continue;
      t.empStun = Math.max(t.empStun, cfg.empDuration);   // 重复命中只刷新时长，不叠加
      t.cooldown = Math.max(t.cooldown, cfg.empDuration * 0.5);
      if (t.isPlayer) this.addShake(4);
    }
  }

  /** 激光：瞬时生成光束并结算命中 */
  spawnLaser(tank) {
    const laser = new Laser(this, tank);
    this.lasers.push(laser);
    if (laser.hitTank && laser.hitTank.alive) {
      this.onBulletHit({ ownerId: tank.id, cluster: false, generation: 2 }, laser.hitTank);
    }
  }

  /** 激光光束段上最近的可命中目标 */
  findLaserTarget(x0, y0, x1, y1, ownerId) {
    let best = null, bestT = 2;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive || t.invuln > 0 || t.id === ownerId) continue;
      const tt = Physics.segmentCircle(x0, y0, x1, y1, t.x, t.y, t.radius + 2);
      if (tt >= 0 && tt < bestT) { bestT = tt; best = t; }
    }
    return best;
  }

  /* ---------------- AI 进攻节奏 ---------------- */

  /**
   * AI 共享情报黑板：某 AI 亲眼确认玩家位置时上报。
   * 情报带时间戳与上报者，其他 AI 只能按各自难度的时间衰减规则采信，
   * 因此不会因为共享而获得玩家的实时坐标。
   */
  reportEnemyIntel(reporterId, x, y, time) {
    const cur = this.enemyIntel;
    if (!cur || time >= cur.time) {
      this.enemyIntel = { x, y, time, reporterId };
    }
  }

  /**
   * 把 AI 分成"追击"与"巡逻"两种角色，
   * 避免所有敌人一拥而上。巡逻单位只在看见玩家时交战。
   *
   * 排序依据是每个 AI"自身掌握的情报"：
   * 有视线时是实时距离；看不见时是基于最后已知位置的估计距离，
   * 且情报越旧越靠后（可信度惩罚）。角色分配因此不会向 AI 泄漏玩家实时位置。
   */
  assignAIRoles() {
    const alive = [];
    for (let i = 0; i < this.aiControllers.length; i++) {
      if (this.aiControllers[i].tank.alive) alive.push(this.aiControllers[i]);
    }
    const maxHunters = this.settings.difficulty === 'hard'
      ? CONFIG.RULES.hunterMaxHard
      : CONFIG.RULES.hunterMaxNormal;
    const hunters = Math.min(maxHunters, Math.max(1, Math.ceil(alive.length / 2)));
    const priority = (ai) => (ai.targetDist || 0) + (1 - (ai.intelConf || 0)) * 900;
    alive.sort((a, b) => priority(a) - priority(b));
    for (let i = 0; i < alive.length; i++) {
      alive[i].role = i < hunters ? 'hunt' : 'patrol';
    }
  }

  getAliveEnemies() {
    let n = 0;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.isPlayer && t.alive) n++;
    }
    return n;
  }

  checkVictory() {
    if (this.state !== 'playing') return;
    if (this.getAliveEnemies() === 0) {
      this.score += CONFIG.RULES.victoryBonus;
      this.state = 'ending';
      this.pendingResult = 'victory';
      this.endTimer = CONFIG.RULES.endDelay;
      this.notify('ending');
      if (this.sound) this.sound.play('win');
    }
  }

  /* ---------------- 渲染 ---------------- */

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.viewW, H = this.viewH;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 背景（等距模式下地图外的区域为终端深色）
    ctx.fillStyle = this.isoActive ? CONFIG.THEME.bgDeep : CONFIG.COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    let ox = 0, oy = 0;
    if (this.shake > 0.2) {
      ox = (Math.random() - 0.5) * this.shake;
      oy = (Math.random() - 0.5) * this.shake;
    }

    const cam = this.camera;
    const menu = this.state === 'menu';
    const maze = menu ? this.menuMaze : this.maze;

    if (maze && this.isoActive) {
      this.renderIsoWorld(ctx, maze, cam, ox, oy, menu);
    } else if (maze) {
      ctx.save();
      ctx.translate(-cam.x + ox, -cam.y + oy);

      // 冰面网格（纯装饰，只画世界范围内的可见部分，不参与碰撞）
      const step = CONFIG.MAZE.gridSize * 2;
      const T = CONFIG.THEME;
      const left = Math.max(0, cam.x), right = Math.min(maze.width, cam.x + cam.w);
      const top = Math.max(0, cam.y), bottom = Math.min(maze.height, cam.y + cam.h);
      if (right > left && bottom > top) {
        ctx.strokeStyle = T.groundGrid;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.floor(left / step) * step; x <= right; x += step) {
          ctx.moveTo(x, top); ctx.lineTo(x, bottom);
        }
        for (let y = Math.floor(top / step) * step; y <= bottom; y += step) {
          ctx.moveTo(left, y); ctx.lineTo(right, y);
        }
        ctx.stroke();
      }
      maze.render(ctx, cam);
      if (!menu) {
        for (let i = 0; i < this.pickups.length; i++) this.pickups[i].render(ctx, this.time, cam);
        for (let i = 0; i < this.bullets.length; i++) {
          const b = this.bullets[i];
          if (cam.contains(b.x, b.y, 40)) b.render(ctx);
        }
        for (let i = 0; i < this.lasers.length; i++) this.lasers[i].render(ctx, cam);
        for (let i = 0; i < this.mines.length; i++) this.mines[i].render(ctx, this.time, cam);
        for (let i = 0; i < this.tanks.length; i++) {
          const t = this.tanks[i];
          if (t.alive && cam.contains(t.x, t.y, 60)) t.render(ctx, this.time);
        }
        this.effects.render(ctx);
        if (this.debugShowAimCircle) this.renderDebugCircle(ctx);
      }
      ctx.restore();
    }

    if (menu) return;

    // HUD：绘制在缩放后的"逻辑 HUD 空间"中（随窗口增大而放大，封顶 1.6）
    const hs = this.hudScale;
    ctx.save();
    ctx.scale(hs, hs);
    const hw = W / hs, hh = H / hs;
    this.renderHUD(ctx, hw, hh);
    this.renderRadar(ctx, hw, hh);
    this.renderMinimap(ctx, hw, hh);
    this.renderCrosshair(ctx, hw, hh);
    ctx.restore();
  }

  /* ---------------- 等距渲染（原型：仅 ISO.maps 中的地图） ---------------- */

  /**
   * 等距世界渲染管线：
   *   冰面地面层（仿射变换） → 实体落影 → 深度排序绘制（墙体盒体与实体
   *   按"世界 x+y"画家算法统一排序） → 特效层。
   * 碰撞仍使用墙体足迹矩形；视觉侧面与落影不参与碰撞；
   * 世界坐标、输入逆投影与战斗逻辑完全不变。
   * 深度队列使用并行数组 + 复用索引排序，逐帧零对象分配（降低 GC 尖刺频率）。
   */
  renderIsoWorld(ctx, maze, cam, ox, oy, menu) {
    const iso = this.iso;
    const view = this._isoViewScratch || (this._isoViewScratch = { x: 0, y: 0 });
    view.x = cam.x - ox; view.y = cam.y - oy;   // 折叠屏幕震动
    const data = IsoView.prepare(maze);
    const zH = iso.heightZ(maze);

    iso.drawGround(ctx, maze, view, data, zH);

    // 实体落影（地面层，位于所有深度对象之下）
    if (!menu) {
      iso.beginGround(ctx, view);
      ctx.fillStyle = CONFIG.THEME.iso.tankShadow;
      for (let i = 0; i < this.tanks.length; i++) {
        const t = this.tanks[i];
        if (!t.alive || !iso.pointVisible(t.x, t.y, view, 100)) continue;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.radius * 1.12, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    // 深度排序队列（并行数组复用；kind: 0 墙段 1 坦克 2 道具 3 地雷 4 子弹 5 激光）
    const P = this._isoBuf || (this._isoBuf = { d: [], kind: [], ref: [], idx: [], tanksInView: [], segs: [] });
    const D = P.d, K = P.kind, R = P.ref;
    let n = 0;
    const add = (d, kind, ref) => { D[n] = d; K[n] = kind; R[n] = ref; n++; };

    const tanksInView = P.tanksInView;
    tanksInView.length = 0;
    if (!menu) {
      for (let i = 0; i < this.tanks.length; i++) {
        const t = this.tanks[i];
        if (!t.alive || !iso.pointVisible(t.x, t.y, view, 100)) continue;
        tanksInView.push(t);
        add(t.x + t.y + 0.1, 1, t);
      }
    }
    const visibleSegs = P.segs;
    visibleSegs.length = 0;
    for (let i = 0; i < data.segs.length; i++) {
      const seg = data.segs[i];
      if (!iso.segVisible(seg, zH, view)) continue;
      visibleSegs.push(seg);
      add((seg.x + seg.w) + (seg.y + seg.h), 0, seg);
    }
    // 遮挡感知半透明：墙体段遮住任一存活坦克（玩家或敌人）→ 该段半透明绘制，
    // 保证被遮挡的坦克信息始终可见（含敌我）。
    for (let i = 0; i < visibleSegs.length; i++) {
      const seg = visibleSegs[i];
      const segD = (seg.x + seg.w) + (seg.y + seg.h);
      let ghost = false;
      for (let k = 0; k < tanksInView.length; k++) {
        const t = tanksInView[k];
        if (t.x + t.y >= segD) continue;          // 坦克在段南角之前（墙前），不会被遮挡
        if (iso.segOccludes(seg, zH, t.x, t.y)) { ghost = true; break; }
      }
      seg._ghost = ghost;
    }
    if (!menu) {
      for (let i = 0; i < this.pickups.length; i++) {
        const pk = this.pickups[i];
        if (!iso.pointVisible(pk.x, pk.y, view, 60)) continue;
        add(pk.x + pk.y + 0.2, 2, pk);
      }
      for (let i = 0; i < this.mines.length; i++) {
        const mn = this.mines[i];
        if (mn.dead || !iso.pointVisible(mn.x, mn.y, view, 60)) continue;
        add(mn.x + mn.y + 0.25, 3, mn);
      }
      for (let i = 0; i < this.bullets.length; i++) {
        const b = this.bullets[i];
        if (b.dead || !iso.pointVisible(b.x, b.y, view, 60)) continue;
        add(b.x + b.y + 0.3, 4, b);
      }
      for (let i = 0; i < this.lasers.length; i++) add(1e9, 5, this.lasers[i]);
    }
    // 复用索引排序（越界索引视为 +∞ 沉底）
    const idx = P.idx;
    for (let i = 0; i < n; i++) idx[i] = i;
    idx.sort((a, b) => (a < n ? D[a] : Infinity) - (b < n ? D[b] : Infinity));

    for (let i = 0; i < n; i++) {
      const j = idx[i], kind = K[j], ref = R[j];
      if (kind === 0) {
        iso.drawWall(ctx, ref, zH, view, ref._ghost);
        continue;
      }
      // 实体在地面仿射层中绘制：位置精确、圆形自动呈贴地透视
      iso.beginGround(ctx, view);
      if (kind === 1) ref.render(ctx, this.time);
      else if (kind === 2) ref.render(ctx, this.time, null);
      else if (kind === 3) ref.render(ctx, this.time, null);
      else if (kind === 4) ref.render(ctx);
      else if (kind === 5) ref.render(ctx, null);
      ctx.restore();
    }

    if (menu) return;

    // 特效层（瞬时视觉，最上层）
    iso.beginGround(ctx, view);
    this.effects.render(ctx);
    if (this.debugShowAimCircle) this.renderDebugCircle(ctx);
    ctx.restore();
  }

  renderHUD(ctx, W, H) {
    if (!this.player) return;
    const T = CONFIG.THEME;
    const font = '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif';

    // HUD 在屏幕空间，坦克在世界空间：先把面板换算到世界坐标再判断遮挡
    const cam = this.camera;
    const hs = this.hudScale;
    let covered = false;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive) continue;
      if (t.x > cam.x - 24 && t.x < cam.x + 300 * hs && t.y > cam.y - 24 && t.y < cam.y + 110 * hs) { covered = true; break; }
    }
    this.hudFade += ((covered ? 0 : 1) - this.hudFade) * 0.16;
    const hudAlpha = 0.22 + 0.78 * this.hudFade;

    ctx.save();
    ctx.textBaseline = 'middle';

    /* ---- 左上：战术面板（得分 / 生命 / 武器），随遮挡淡出 ---- */
    ctx.globalAlpha = hudAlpha;
    ctx.fillStyle = T.hudPanel;
    roundRect(ctx, 16, 14, 276, 58, 10);
    ctx.fill();
    ctx.strokeStyle = T.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = T.accentLine;
    ctx.beginPath();
    ctx.moveTo(28, 14.5);
    ctx.lineTo(118, 14.5);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = T.textDim;
    ctx.font = '600 12px ' + font;
    ctx.fillText('得分', 32, 33);
    ctx.fillStyle = T.cyan;
    ctx.font = '800 21px ' + font;
    ctx.fillText(String(this.score), 72, 33);

    ctx.fillStyle = T.textDim;
    ctx.font = '600 12px ' + font;
    ctx.fillText('生命', 152, 33);
    const lifeAlpha = this.player.alive ? 1 : 0.35;
    for (let i = 0; i < Math.min(this.lives, 5); i++) {
      ctx.globalAlpha = hudAlpha * lifeAlpha;
      ctx.fillStyle = T.lifeChip;
      roundRect(ctx, 186 + i * 15, 27, 11, 11, 2.5);
      ctx.fill();
    }
    ctx.globalAlpha = hudAlpha;

    // 第二行：当前武器 / 道具状态
    if (this.player.powerup) {
      const def = PICKUP_TYPES[this.player.powerup];
      const remain = this.player.powerup === 'laser'
        ? '× ' + this.player.powerupShots
        : Math.ceil(this.player.powerupTime) + 's';
      ctx.textAlign = 'left';
      ctx.fillStyle = def.color;
      ctx.font = '700 12px ' + font;
      ctx.fillText('武器 · ' + def.name + ' ' + remain, 32, 53);
    } else {
      ctx.fillStyle = T.textFaint;
      ctx.font = '500 12px ' + font;
      ctx.fillText('武器系统就绪', 32, 53);
    }

    /* ---- 顶部中央：计时 + 剩余敌人（固定可见，不淡出） ---- */
    ctx.globalAlpha = 1;
    const totalSec = Math.floor(this.time);
    const timeText = String(Math.floor(totalSec / 60)).padStart(2, '0') + ':' + String(totalSec % 60).padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.fillStyle = T.cyan;
    ctx.font = '800 20px ' + font;
    ctx.fillText(timeText, W / 2, 26);

    const alive = this.getAliveEnemies();
    ctx.font = '600 11px ' + font;
    ctx.fillStyle = T.textDim;
    ctx.fillText('剩余敌人 ' + alive, W / 2, 46);
    if (alive > 0) {
      const sqW = alive * 16 - 3;
      for (let i = 0; i < Math.min(alive, 10); i++) {
        const colorKey = ['red', 'blue', 'orange', 'purple', 'teal', 'pink', 'gold'][i % 7];
        ctx.fillStyle = CONFIG.COLORS.tanks[colorKey].body;
        roundRect(ctx, W / 2 - sqW / 2 + i * 16, 55, 13, 8, 2);
        ctx.fill();
      }
    }

    /* ---- 右上：地图 + 难度（DOM 暂停按钮下方） ---- */
    ctx.textAlign = 'right';
    ctx.fillStyle = T.textFaint;
    ctx.font = '600 12px ' + font;
    const diff = AI_DIFFICULTIES[this.settings.difficulty] || AI_DIFFICULTIES.normal;
    const mazeName = this.maze ? this.maze.name : '';
    ctx.fillText(mazeName + '  ·  ' + diff.name, W - 24, 80);

    /* ---- 底部提示 ---- */
    ctx.fillStyle = T.textFaint;
    ctx.font = '500 12px ' + font;
    ctx.textAlign = 'left';
    ctx.fillText('左键 开火   ·   Q 地雷   ·   E EMP   ·   P / Esc 暂停   ·   R 重开', 24, H - 22);

    // 复活倒计时（警示橙）
    if (!this.player.alive && this.respawnTimer > 0) {
      ctx.textAlign = 'center';
      ctx.fillStyle = T.orange;
      ctx.font = '800 19px ' + font;
      ctx.fillText('已被击毁 · ' + Math.max(0, this.respawnTimer).toFixed(1) + ' 秒后复活', W / 2, H - 58);
      ctx.textAlign = 'left';
    }

    ctx.restore();

    // 道具状态条（不受左上 HUD 淡出影响，始终可读）
    this.renderEffectChips(ctx, font, W, H);

    // 拾取提示
    if (this.pickupToast && this.time - this.pickupToast.time < 1.4) {
      const k = clamp(1 - (this.time - this.pickupToast.time) / 1.4, 0, 1);
      const def = PICKUP_TYPES[this.pickupToast.type];
      if (def) {
        ctx.save();
        ctx.globalAlpha = k;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '800 19px ' + font;
        ctx.fillStyle = def.color;
        ctx.fillText('拾取 · ' + def.name, W / 2, 100 - (1 - k) * 10);
        ctx.restore();
      }
    }
  }

  /** 当前生效的道具/强化状态条 */
  renderEffectChips(ctx, font, W, H) {
    const p = this.player;
    if (!p) return;
    const chips = [];
    if (p.powerup) {
      const def = PICKUP_TYPES[p.powerup];
      const remain = p.powerup === 'laser' ? '×' + p.powerupShots : Math.ceil(p.powerupTime) + 's';
      chips.push({ color: def.color, text: def.name + ' ' + remain });
    }
    if (p.rapidTime > 0) chips.push({ color: PICKUP_TYPES.rapid.color, text: '连射 ' + Math.ceil(p.rapidTime) + 's' });
    if (p.bounceAmmo > 0) chips.push({ color: PICKUP_TYPES.bouncer.color, text: '反弹弹 ×' + p.bounceAmmo });
    if (p.empCharges > 0) chips.push({ color: PICKUP_TYPES.emp.color, text: 'EMP ×' + p.empCharges + ' [E]' });
    if (p.mineCharges > 0) chips.push({ color: PICKUP_TYPES.mine.color, text: '地雷 ×' + p.mineCharges + ' [Q]' });
    if (p.radarTime > 0) chips.push({ color: PICKUP_TYPES.radar.color, text: '雷达 ' + Math.ceil(p.radarTime) + 's' });
    if (p.speedBoost > 0) chips.push({ color: PICKUP_TYPES.speed.color, text: '加速 ' + Math.ceil(p.speedBoost) + 's' });
    if (p.invuln > 0) chips.push({ color: PICKUP_TYPES.shield.color, text: '护盾 ' + Math.ceil(p.invuln) + 's' });
    if (!chips.length) return;

    let x = 20;
    const y = H - 50;
    const T = CONFIG.THEME;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      ctx.font = '700 12px ' + font;
      const w = ctx.measureText(chip.text).width + 18;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = T.hudPanel;
      roundRect(ctx, x, y - 11, w, 22, 11);
      ctx.fill();
      ctx.strokeStyle = chip.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = T.text;
      ctx.fillText(chip.text, x + 9, y + 0.5);
      x += w + 8;
      if (x > W - 240) break;
    }
    ctx.restore();
  }

  /** 雷达扫描：视野内脉冲标记、视野外屏幕边缘方向箭头 */
  renderRadar(ctx, W, H) {
    const p = this.player;
    if (!p || p.radarTime <= 0) return;
    const cam = this.camera;
    ctx.save();
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive || t.isPlayer) continue;
      let sx, sy;
      if (this.isoActive && this.iso) {
        const p = this.iso.project(t.x, t.y, 0);
        sx = p.x - cam.x; sy = p.y - cam.y;
      } else {
        sx = t.x - cam.x; sy = t.y - cam.y;
      }
      const inside = sx > 14 && sx < W - 14 && sy > 14 && sy < H - 14;
      if (inside) {
        ctx.globalAlpha = 0.45 + 0.3 * Math.sin(this.time * 6 + t.id);
        ctx.strokeStyle = '#7CF0A0';
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.arc(sx, sy, t.radius + 9, 0, TAU);
        ctx.stroke();
      } else {
        const cx = W / 2, cy = H / 2;
        let dx = sx - cx, dy = sy - cy;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        dx /= len; dy /= len;
        const k = Math.min((cx - 46) / Math.max(1e-6, Math.abs(dx)), (cy - 46) / Math.max(1e-6, Math.abs(dy)));
        const ex = cx + dx * k, ey = cy + dy * k;
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = '#7CF0A0';
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(Math.atan2(dy, dx));
        ctx.beginPath();
        ctx.moveTo(10, 0); ctx.lineTo(-5, -7); ctx.lineTo(-2, 0); ctx.lineTo(-5, 7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.globalAlpha = 0.7;
        ctx.font = '700 11px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#2E6B3C';
        ctx.fillText(Math.round(len / 10) * 10 + 'px', ex - dx * 16, ey - dy * 16);
      }
    }
    ctx.restore();
  }

  /** 大地图专用小地图：墙体 + 视野框 + 坦克位置 */
  renderMinimap(ctx, W, H) {
    const maze = this.maze;
    if (!maze) return;
    // 世界没有超出视口（整图可见）时不显示小地图；
    // forceMinimap：3D 视图拉近后即使小图也非整图可见（由 3D 层置位，2D 原版不受影响）
    if (!this.forceMinimap && maze.width <= this.viewW && maze.height <= this.viewH) return;

    const pad = 18;
    const mw = Math.min(196, W * 0.22);
    const mh = Math.round(mw * maze.height / maze.width);
    const mx = W - mw - pad;
    const my = H - mh - pad;
    const sx = mw / maze.width;
    const sy = mh / maze.height;
    const cam = this.camera;

    // 有坦克跑进小地图区域时自动淡出
    let covered = false;
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive) continue;
      const scrX = t.x - cam.x, scrY = t.y - cam.y;
      if (scrX > mx - 16 && scrX < mx + mw + 16 && scrY > my - 16 && scrY < my + mh + 16) { covered = true; break; }
    }
    this.minimapFade += ((covered ? 0 : 1) - this.minimapFade) * 0.16;
    const alpha = 0.28 + 0.72 * this.minimapFade;

    ctx.save();
    ctx.globalAlpha = alpha;

    const T = CONFIG.THEME;
    ctx.fillStyle = T.hudPanel;
    roundRect(ctx, mx - 6, my - 6, mw + 12, mh + 12, 7);
    ctx.fill();
    ctx.strokeStyle = T.hudBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = T.minimapWall;
    for (let i = 0; i < maze.walls.length; i++) {
      const w = maze.walls[i];
      ctx.fillRect(mx + w.x * sx, my + w.y * sy, Math.max(0.9, w.w * sx), Math.max(0.9, w.h * sy));
    }

    // 当前视野（等距模式：可见 iso 窗口四角逆投影为世界菱形；
    // minimapHideViewRect：3D 视图按需隐藏该指示框）
    ctx.strokeStyle = T.accentLine;
    ctx.lineWidth = 1.4;
    if (this.isoActive && this.iso && !this.minimapHideViewRect) {
      // 视野四边形：3D 拉近时用 3D 层提供的真实可见区（viewWorldRect），
      // 缺省回退等距窗口四角逆投影
      const cs = (this.viewWorldRect && this.viewWorldRect.length === 4)
        ? this.viewWorldRect
        : [
          this.iso.unproject(cam.x, cam.y),
          this.iso.unproject(cam.x + this.viewW, cam.y),
          this.iso.unproject(cam.x + this.viewW, cam.y + this.viewH),
          this.iso.unproject(cam.x, cam.y + this.viewH)
        ];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const px = mx + cs[i].x * sx, py = my + cs[i].y * sy;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.strokeRect(mx + cam.x * sx, my + cam.y * sy, cam.w * sx, cam.h * sy);
    }

    // 道具
    for (let i = 0; i < this.pickups.length; i++) {
      const pk = this.pickups[i];
      ctx.fillStyle = PICKUP_TYPES[pk.type].color;
      ctx.beginPath();
      ctx.arc(mx + pk.x * sx, my + pk.y * sy, 2, 0, TAU);
      ctx.fill();
    }

    // 地雷
    for (let i = 0; i < this.mines.length; i++) {
      const mn = this.mines[i];
      if (mn.dead) continue;
      ctx.fillStyle = '#C98B4B';
      ctx.fillRect(mx + mn.x * sx - 1.5, my + mn.y * sy - 1.5, 3, 3);
    }

    // 坦克
    for (let i = 0; i < this.tanks.length; i++) {
      const t = this.tanks[i];
      if (!t.alive) continue;
      ctx.fillStyle = t.isPlayer ? '#1E7A1E' : t.colors.body;
      ctx.beginPath();
      ctx.arc(mx + t.x * sx, my + t.y * sy, t.isPlayer ? 3.6 : 2.8, 0, TAU);
      ctx.fill();
    }

    ctx.restore();
  }

  renderCrosshair(ctx, W, H) {
    const m = this.input.mouse;
    // 准星画在屏幕空间：鼠标画布坐标从视口空间换算到逻辑 HUD 空间
    const mxx = m.canvasX / this.hudScale, myy = m.canvasY / this.hudScale;
    if (mxx < -60 || myy < -60 || mxx > W + 60 || myy > H + 60) return;

    const T = CONFIG.THEME;
    const ready = this.player && this.player.alive && this.player.cooldown <= 0;
    const color = !this.player || !this.player.alive
      ? 'rgba(145,178,195,0.35)'
      : (ready ? 'rgba(56,216,245,0.95)' : 'rgba(145,178,195,0.65)');

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.7;
    ctx.beginPath();
    ctx.arc(mxx, myy, 9, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mxx - 15, myy); ctx.lineTo(mxx - 5, myy);
    ctx.moveTo(mxx + 5, myy); ctx.lineTo(mxx + 15, myy);
    ctx.moveTo(mxx, myy - 15); ctx.lineTo(mxx, myy - 5);
    ctx.moveTo(mxx, myy + 5); ctx.lineTo(mxx, myy + 15);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mxx, myy, 1.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** 仅调试模式可见：隐形判定圆、AI 状态 */
  renderDebugCircle(ctx) {
    const p = this.player;
    if (!p) return;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(220,60,60,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, CONFIG.MOUSE.aimRadius, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < this.aiControllers.length; i++) {
      const ai = this.aiControllers[i];
      const t = ai.tank;
      if (!t.alive) continue;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.font = '600 11px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ai.state, t.x, t.y - 26);
      // 目标情报记忆：最后已知位置（圆圈大小/虚实随可信度变化）
      if (ai.lastKnown && ai.intelConf > 0.05) {
        const conf = ai.intelConf;
        ctx.strokeStyle = 'rgba(204,102,0,' + (0.25 + 0.5 * conf).toFixed(2) + ')';
        ctx.lineWidth = 1.2;
        ctx.setLineDash(conf < 0.4 ? [3, 4] : []);
        ctx.beginPath();
        ctx.arc(ai.lastKnown.x, ai.lastKnown.y, 8 + 5 * conf, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(204,102,0,0.85)';
        ctx.fillText(Math.round(conf * 100) + '%', ai.lastKnown.x, ai.lastKnown.y - 18);
      }
      if (ai.path) {
        ctx.strokeStyle = 'rgba(0,0,160,0.35)';
        ctx.beginPath();
        ctx.moveTo(t.x, t.y);
        for (let k = 0; k < ai.path.length; k++) ctx.lineTo(ai.path[k].x, ai.path[k].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------------- 主循环 ---------------- */

  start() {
    if (this.headless || this.raf) return;
    this.lastFrame = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const step = (now) => {
      this.raf = requestAnimationFrame(step);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
  }

  tick(now) {
    let frameDt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    if (!isFinite(frameDt) || frameDt < 0) frameDt = 0;
    frameDt = Math.min(frameDt, CONFIG.MAX_FRAME_DT);

    this.acc += frameDt;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < CONFIG.MAX_SUBSTEPS) {
      this.update(this.fixedDt);
      this.acc -= this.fixedDt;
      steps++;
    }
    if (steps >= CONFIG.MAX_SUBSTEPS) this.acc = 0;

    this.render();
  }
}
