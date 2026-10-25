'use strict';
/* =========================================================
 * 坦克：转向、移动、墙体碰撞、开火
 * 玩家与 AI 使用完全相同的物理实现。
 * ========================================================= */

class Tank {
  constructor(opts) {
    this.id = opts.id;
    this.x = opts.x;
    this.y = opts.y;
    this.angle = opts.angle || 0;      // 车体朝向 == 炮口朝向
    this.aimAngle = this.angle;        // 期望朝向（由控制器给出）
    this.isPlayer = !!opts.isPlayer;
    this.name = opts.name || '坦克';
    this.colorKey = opts.colorKey || 'green';
    this.colors = CONFIG.COLORS.tanks[this.colorKey];

    this.radius = CONFIG.TANK.radius;
    this.maxSpeed = opts.maxSpeed || CONFIG.TANK.playerSpeed;
    this.turnSpeed = opts.turnSpeed || CONFIG.TANK.playerTurnSpeed;
    this.fireCooldown = opts.fireCooldown || CONFIG.BULLET.playerCooldown;

    this.moveIntent = 0;   // 0~1，控制器给出的前进幅度
    this.speed = 0;        // 当前实际速度（用于视觉与 AI 判断）
    this.cooldown = 0;
    this.alive = true;
    this.kills = 0;
    this.spawnFlash = 0.6;
    this.trackPhase = 0;
    this.invuln = 0;          // 复活/护盾保护剩余时间（秒）
    this.powerup = null;      // 武器替换：laser | cluster | triple | null（互斥）
    this.powerupTime = 0;     // 武器剩余持续时间
    this.powerupShots = 0;    // 武器剩余可用次数（激光）
    this.speedBoost = 0;      // 超载引擎剩余时间
    /* ---- 可叠加的独立强化状态 ---- */
    this.rapidTime = 0;       // 连射过载剩余时间
    this.bounceAmmo = 0;      // 强化反弹剩余发数
    this.empCharges = 0;      // EMP 剩余使用次数
    this.empCooldown = 0;     // EMP 使用间隔
    this.mineCharges = 0;     // 地雷剩余数量
    this.mineCooldown = 0;    // 地雷布设间隔
    this.radarTime = 0;       // 雷达扫描剩余时间
    this.empStun = 0;         // 被 EMP 干扰的剩余时间
    this.radarPinged = false; // 雷达是否已触发过探测（AI 用）
    /* ---- 连射机制状态（普通炮弹；参数见 CONFIG.FIRE） ---- */
    this.burstShots = 0;      // 本轮已发射发数
    this.burstCooldown = false; // 当前 cooldown 是否为轮末冷却（到期即重置计数）
    this.needRelease = false; // 轮末后须松开扳机再按下才能开下一轮
  }

  /** 当前生效的连射参数（动态计算，不写入基础属性）：
   *  连射过载 > 强化反弹 > 普通；武器替换（powerup）不适用连射门控 */
  fireParams() {
    const F = CONFIG.FIRE;
    if (this.rapidTime > 0) return { limit: F.burstRapid, interval: F.intervalRapid, post: F.cooldownBurstRapid };
    if (this.bounceAmmo > 0) return { limit: F.burstBouncer, interval: F.interval, post: F.cooldownBurst };
    return { limit: F.burst, interval: F.interval, post: F.cooldownBurst };
  }

  /** 连射门控（玩家/AI 的开火扳机统一走这里）：
   *  - 武器替换期间维持原语义（仅冷却限制）；
   *  - 普通炮弹：间隔（cooldown）+ 单轮上限 + 轮末须松开再按 */
  updateFireGate(wantFire) {
    if (!wantFire) { this.needRelease = false; return false; }
    if (this.powerup) return this.cooldown <= 0;
    if (this.needRelease || this.cooldown > 0) return false;
    return this.burstShots < this.fireParams().limit;
  }

  /** 连射状态复位（重生/重开时调用） */
  resetBurst() {
    this.burstShots = 0;
    this.burstCooldown = false;
    this.needRelease = false;
  }

  /** 开火冷却：受连射过载影响，并设置下限防止无限射速 */
  effectiveCooldown(base) {
    const cfg = CONFIG.PICKUPS;
    const mult = this.rapidTime > 0 ? cfg.rapidCooldownMult : 1;
    return Math.max(cfg.minCooldown, base * mult);
  }

  /** 是否持有任何可用强化（用于 HUD/AI 判断） */
  hasEnhancement() {
    return !!this.powerup || this.rapidTime > 0 || this.bounceAmmo > 0 ||
      this.empCharges > 0 || this.mineCharges > 0 || this.radarTime > 0 ||
      this.speedBoost > 0;
  }

  update(dt, maze) {
    if (!this.alive) return;
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    // 连射：轮末冷却到期 → 重置本轮计数；道具中途失效使计数已达新上限 →
    // 同样按轮末处理（不重置计时、不追加发射额度）
    if (this.burstCooldown && this.cooldown <= 0) {
      this.burstShots = 0;
      this.burstCooldown = false;
    } else if (!this.burstCooldown && this.cooldown <= 0 && this.powerup === null
      && this.burstShots > 0 && this.burstShots >= this.fireParams().limit) {
      this.cooldown = Math.max(this.fireParams().post, this.effectiveCooldown(this.fireCooldown));
      this.burstCooldown = true;
      this.needRelease = true;
    }
    if (this.spawnFlash > 0) this.spawnFlash = Math.max(0, this.spawnFlash - dt);
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.powerupTime > 0) {
      this.powerupTime = Math.max(0, this.powerupTime - dt);
      if (this.powerupTime <= 0 && this.powerup !== 'laser') this.powerup = null;
    }
    if (this.speedBoost > 0) this.speedBoost = Math.max(0, this.speedBoost - dt);
    if (this.rapidTime > 0) this.rapidTime = Math.max(0, this.rapidTime - dt);
    if (this.radarTime > 0) this.radarTime = Math.max(0, this.radarTime - dt);
    if (this.radarTime <= 0 && this.radarPinged) this.radarPinged = false;
    if (this.empCooldown > 0) this.empCooldown = Math.max(0, this.empCooldown - dt);
    if (this.mineCooldown > 0) this.mineCooldown = Math.max(0, this.mineCooldown - dt);
    if (this.empStun > 0) this.empStun = Math.max(0, this.empStun - dt);

    // 1) 平滑转向：始终走最短路径（超载引擎时更快）
    const boost = this.speedBoost > 0;
    const turnSpd = this.turnSpeed * (boost ? CONFIG.PICKUPS.turnMult : 1);
    const maxSpd = this.maxSpeed * (boost ? CONFIG.PICKUPS.speedMult : 1);
    const diff = angleDiff(this.angle, this.aimAngle);
    const maxTurn = turnSpd * dt;
    if (Math.abs(diff) <= maxTurn) this.angle = this.aimAngle;
    else this.angle = normalizeAngle(this.angle + Math.sign(diff) * maxTurn);

    // 2) 依据转向完成度决定推进速度（未对准时减速，绝不侧滑）
    const remain = Math.abs(angleDiff(this.angle, this.aimAngle));
    let scale = (Math.cos(remain) - CONFIG.TANK.turnSlowdown) / (1 - CONFIG.TANK.turnSlowdown);
    scale = clamp(scale, 0, 1);

    // 被 EMP 干扰时机动能力下降（仍可通过转向调整炮口）
    const stunScale = this.empStun > 0 ? 0.35 : 1;
    const v = maxSpd * clamp(this.moveIntent, 0, 1) * scale * stunScale;
    this.speed = v;

    if (v > 0.01) {
      this.trackPhase += v * dt * 0.35;
      this.moveWithCollision(Math.cos(this.angle) * v * dt, Math.sin(this.angle) * v * dt, maze);
    }
  }

  /** 位移 + 分步碰撞，避免高速穿墙 */
  moveWithCollision(dx, dy, maze) {
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return;
    const steps = Math.max(1, Math.ceil(len / (this.radius * 0.45)));
    const sx = dx / steps, sy = dy / steps;
    for (let s = 0; s < steps; s++) {
      this.x += sx;
      this.y += sy;
      this.resolveWalls(maze);
    }
    this.x = clamp(this.x, this.radius, maze.width - this.radius);
    this.y = clamp(this.y, this.radius, maze.height - this.radius);
  }

  /** 与墙体分离（自然产生沿墙滑动） */
  resolveWalls(maze) {
    for (let iter = 0; iter < CONFIG.TANK.collisionIterations; iter++) {
      const walls = maze.queryWalls(this.x, this.y, this.radius + 2);
      let pushed = false;
      for (let i = 0; i < walls.length; i++) {
        const p = Physics.pushCircleOutOfRect(this.x, this.y, this.radius, walls[i]);
        if (p) {
          this.x += p.nx * (p.depth + 0.01);
          this.y += p.ny * (p.depth + 0.01);
          pushed = true;
        }
      }
      if (!pushed) break;
    }
  }

  muzzlePoint() {
    return {
      x: this.x + Math.cos(this.angle) * CONFIG.TANK.muzzleOffset,
      y: this.y + Math.sin(this.angle) * CONFIG.TANK.muzzleOffset
    };
  }

  /**
   * 开火：子弹从炮口沿车体当前朝向发射。
   * 依据当前道具切换武器形态，返回本社会发展出的所有子弹（激光等非子弹武器返回空数组）。
   */
  fire(game) {
    if (!this.alive || this.cooldown > 0) return [];
    if (this.empStun > 0) return [];   // 被 EMP 干扰期间无法开火

    const dx = Math.cos(this.angle);
    const dy = Math.sin(this.angle);
    let dist = CONFIG.TANK.muzzleOffset;

    // 炮口前方有墙时贴着墙面生成，保证子弹一定出现在墙体之外
    const wallHit = game.maze.raycast(
      this.x, this.y, dx, dy,
      CONFIG.TANK.muzzleOffset + CONFIG.BULLET.radius + 2,
      CONFIG.BULLET.radius
    );
    if (wallHit) dist = Math.max(6, wallHit.t - 1.2);

    const sx = this.x + dx * dist;
    const sy = this.y + dy * dist;
    const shots = [];

    // --- 激光炮：瞬时折射光束 ---
    if (this.powerup === 'laser') {
      this.cooldown = this.effectiveCooldown(CONFIG.PICKUPS.laserCooldown);
      game.spawnLaser(this);
      this.powerupShots--;
      if (this.powerupShots <= 0) this.powerup = null;
      game.effects.muzzle(sx, sy, this.angle, '#9FE8FF');
      game.addShake(2.6);
      if (game.sound) game.sound.play('laser');
      return [];
    }

    const extraBounces = this.bounceAmmo > 0 ? CONFIG.PICKUPS.bouncerExtraBounces : 0;
    this.cooldown = this.effectiveCooldown(this.fireCooldown);

    if (this.powerup === 'cluster') {
      // 散裂弹：碰敌人或到达最大射程后爆炸分裂
      shots.push(new Bullet({
        x: sx, y: sy, angle: this.angle,
        ownerId: this.id, color: '#FF8A3C',
        cluster: true, generation: 1,
        fuse: CONFIG.PICKUPS.clusterFuse,
        extraBounces
      }));
      this.cooldown = this.effectiveCooldown(Math.max(this.fireCooldown, 0.5));
    } else if (this.powerup === 'triple') {
      this.cooldown = this.effectiveCooldown(CONFIG.PICKUPS.tripleCooldown);
      for (let i = -1; i <= 1; i++) {
        shots.push(new Bullet({
          x: sx, y: sy, angle: this.angle + i * CONFIG.PICKUPS.tripleSpread,
          ownerId: this.id, color: '#C79BFF',
          extraBounces
        }));
      }
    } else {
      shots.push(new Bullet({
        x: sx, y: sy, angle: this.angle,
        ownerId: this.id,
        color: this.colors.body,
        extraBounces
      }));
      // 连射节奏（普通炮弹）：计数；间隔/轮末冷却取任务参数与坦克自身
      // 冷却的较大者（保持 AI 节奏与既有强化下限不被缩短绕过）
      const P = this.fireParams();
      this.burstShots++;
      if (this.burstShots >= P.limit) {
        this.cooldown = Math.max(P.post, this.cooldown);
        this.burstCooldown = true;
        this.needRelease = true;
      } else {
        this.cooldown = Math.max(P.interval, this.cooldown);
      }
    }

    // 一次齐射消耗 1 发强化反弹弹药
    if (extraBounces > 0) this.bounceAmmo = Math.max(0, this.bounceAmmo - 1);

    game.effects.muzzle(sx, sy, this.angle, this.colors.body);
    game.addShake(1.6);
    if (game.sound) game.sound.play('shoot');
    return shots;
  }

  /**
   * 拾取道具。规则：
   * - 武器替换（laser/cluster/triple）互斥，占用 powerup 槽；
   * - 临时强化（shield/speed/rapid/radar）刷新时长，不叠加倍率；
   * - 弹药类（bouncer）累加次数并设上限；
   * - 主动道具（emp/mine）累加次数并设上限。
   * 返回实际生效的道具类型（供 HUD 提示），无效时返回 null。
   */
  applyPickup(type) {
    const def = PICKUP_TYPES[type];
    if (!def) return null;
    const cfg = CONFIG.PICKUPS;

    if (def.kind === 'weapon') {
      this.powerup = type;
      if (def.shots) {
        this.powerupShots = def.shots();
        this.powerupTime = 0;
      } else {
        this.powerupTime = def.time;
        this.powerupShots = 0;
      }
    } else if (type === 'shield') {
      this.invuln = Math.max(this.invuln, def.time);
    } else if (type === 'speed') {
      this.speedBoost = Math.max(this.speedBoost, def.time);
    } else if (type === 'rapid') {
      this.rapidTime = Math.max(this.rapidTime, def.time);
    } else if (type === 'radar') {
      this.radarTime = Math.max(this.radarTime, def.time);
      this.radarPinged = false;
    } else if (type === 'bouncer') {
      this.bounceAmmo = Math.min(cfg.bouncerShots * 3, this.bounceAmmo + def.shots());
    } else if (type === 'emp') {
      this.empCharges = Math.min(cfg.empCharges * 3, this.empCharges + def.charges());
    } else if (type === 'mine') {
      this.mineCharges = Math.min(cfg.mineCharges * 2, this.mineCharges + def.charges());
    }
    return type;
  }

  /** 主动道具：EMP 脉冲（范围干扰，需要视线） */
  useEmp(game) {
    const cfg = CONFIG.PICKUPS;
    if (!this.alive || this.empCharges <= 0 || this.empCooldown > 0) return false;
    this.empCharges--;
    this.empCooldown = cfg.empCooldown;
    game.emitEmp(this);
    return true;
  }

  /** 主动道具：在车体后方布设地雷 */
  deployMine(game) {
    const cfg = CONFIG.PICKUPS;
    if (!this.alive || this.mineCharges <= 0 || this.mineCooldown > 0) return false;
    const back = 26;
    let x = this.x - Math.cos(this.angle) * back;
    let y = this.y - Math.sin(this.angle) * back;
    if (!game.maze.isFree(x, y, 10)) {
      x = this.x;
      y = this.y;
      if (!game.maze.isFree(x, y, 10)) return false;   // 卡在墙里时不消耗次数
    }
    this.mineCharges--;
    this.mineCooldown = cfg.mineCooldown;
    game.mines.push(new Mine({ x, y, ownerId: this.id }));
    if (game.effects) {
      game.effects.rings.push({
        x, y, r: 3, maxR: 18, life: 0.25, maxLife: 0.25,
        color: '#D9A066', width: 2
      });
    }
    if (game.sound) game.sound.play('mine');
    return true;
  }

  /** 清理所有强化状态（死亡/重开/换图） */
  clearPowerups() {
    this.powerup = null;
    this.powerupTime = 0;
    this.powerupShots = 0;
    this.speedBoost = 0;
    this.rapidTime = 0;
    this.bounceAmmo = 0;
    this.empCharges = 0;
    this.empCooldown = 0;
    this.mineCharges = 0;
    this.mineCooldown = 0;
    this.radarTime = 0;
    this.empStun = 0;
    this.radarPinged = false;
  }

  kill() {
    this.alive = false;
    this.speed = 0;
    this.clearPowerups();
  }

  render(ctx, time) {
    if (!this.alive) return;
    const c = this.colors;
    const T = CONFIG.TANK;
    const hl = T.hullLength, hw = T.hullWidth;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // 履带
    const tw = T.treadWidth, to = T.treadOffset;
    const tl = hl + 2;
    ctx.fillStyle = c.dark;
    ctx.fillRect(-tl / 2, -to - tw, tl, tw);
    ctx.fillRect(-tl / 2, to, tl, tw);
    // 履带纹路
    ctx.fillStyle = c.outline;
    for (let i = 0; i < 5; i++) {
      const px = -tl / 2 + 2 + i * ((tl - 4) / 4.4);
      ctx.fillRect(px, -to - tw + 1.2, 1.6, tw - 2.4);
      ctx.fillRect(px, to + 1.2, 1.6, tw - 2.4);
    }

    // 炮管（先画，被车体压住根部）
    const bl = T.barrelLength, bw = T.barrelWidth;
    const bx = hl / 2 - 4;
    ctx.fillStyle = c.barrel;
    ctx.fillRect(bx, -bw / 2, bl, bw);
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = c.outline;
    ctx.strokeRect(bx, -bw / 2, bl, bw);
    ctx.fillStyle = c.outline;
    ctx.fillRect(bx + bl - 2.6, -bw / 2 - 0.6, 2.6, bw + 1.2);

    // 车体
    ctx.fillStyle = c.body;
    roundRect(ctx, -hl / 2, -hw / 2, hl, hw, 4);
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = c.outline;
    ctx.stroke();

    // 车体高光
    ctx.fillStyle = c.light;
    roundRect(ctx, -hl / 2 + 2.6, -hw / 2 + 2.2, hl - 6.5, 3.8, 1.9);
    ctx.fill();

    // 炮塔
    ctx.beginPath();
    ctx.arc(0.5, 0, 6.4, 0, TAU);
    ctx.fillStyle = c.body;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = c.outline;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0.5, 0, 3.1, 0, TAU);
    ctx.fillStyle = c.light;
    ctx.fill();

    // 被 EMP 干扰：电弧闪烁
    if (this.empStun > 0) {
      const flick = 0.5 + 0.5 * Math.sin(time * 40);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 8, 0, TAU);
      ctx.strokeStyle = 'rgba(155,240,255,' + (0.35 + 0.45 * flick).toFixed(2) + ')';
      ctx.lineWidth = 1.6;
      ctx.stroke();
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(-10, -6); ctx.lineTo(-4, 2); ctx.lineTo(-7, 2); ctx.lineTo(-1, 8);
      ctx.strokeStyle = '#9BF0FF';
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 复活保护光环
    if (this.invuln > 0) {
      const pulse = 0.5 + 0.5 * Math.sin(this.invuln * 9);
      ctx.beginPath();
      ctx.arc(0, 0, this.radius + 5 + pulse * 2.5, 0, TAU);
      ctx.strokeStyle = 'rgba(120,214,255,' + (0.30 + 0.45 * pulse).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.restore();
  }
}
