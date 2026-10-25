'use strict';
/* =========================================================
 * 子弹：运动、连续碰撞、墙壁反弹、命中判定
 * 反弹使用真实反射公式 v' = v - 2 * dot(v, n) * n
 * ========================================================= */

class Bullet {
  constructor(opts) {
    this.x = opts.x;
    this.y = opts.y;
    this.angle = opts.angle;
    this.dx = Math.cos(opts.angle);
    this.dy = Math.sin(opts.angle);
    this.speed = opts.speed || CONFIG.BULLET.speed;
    this.maxAge = opts.maxAge || 0;
    this.radius = CONFIG.BULLET.radius;
    this.ownerId = opts.ownerId;
    this.ownerColor = opts.color || '#333';
    // 散裂弹：generation 1 是母弹（会分裂），2 是碎片
    this.cluster = !!opts.cluster;
    this.generation = opts.generation || 1;
    this.fuse = opts.fuse || 0;
    // 强化反弹弹药：每颗子弹单独记录最大反弹次数（普通子弹 = CONFIG.BULLET.maxBounces）
    this.maxBounces = CONFIG.BULLET.maxBounces + (opts.extraBounces || 0);
    this.enhanced = (opts.extraBounces || 0) > 0;
    this.bounces = 0;
    this.age = 0;
    this.dead = false;
    this.trail = [{ x: this.x, y: this.y }];
    this.trailTimer = 0;
  }

  /**
   * 把子弹从墙体中挤出（墙体在拐角/T 型接口处会相互重叠）。
   * 预测与真实飞行共用，保证 AI 弹道模拟一致。
   */
  static separate(maze, x, y) {
    const r = CONFIG.BULLET.radius;
    for (let iter = 0; iter < 3; iter++) {
      const walls = maze.queryWalls(x, y, r + 2);
      let moved = false;
      for (let i = 0; i < walls.length; i++) {
        const p = Physics.pushCircleOutOfRect(x, y, r, walls[i]);
        if (p) {
          x += p.nx * (p.depth + 0.02);
          y += p.ny * (p.depth + 0.02);
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, y };
  }

  /** 在当前位置炸出一圈碎片（散裂弹） */
  spawnFragments(game) {
    const n = CONFIG.PICKUPS.clusterFragments;
    game.effects.sparkBurst(this.x, this.y, '#FF8A3C', 10);
    game.effects.rings.push({
      x: this.x, y: this.y, r: 3, maxR: 30,
      life: 0.3, maxLife: 0.3, color: '#FF8A3C', width: 2.5
    });
    game.addShake(3);
    if (game.sound) game.sound.play('split');
    for (let i = 0; i < n; i++) {
      const a = this.angle + i * TAU / n + 0.25;
      game.bullets.push(new Bullet({
        x: this.x, y: this.y, angle: a,
        ownerId: this.ownerId, color: '#FF8A3C',
        speed: CONFIG.PICKUPS.clusterFragSpeed,
        generation: 2,
        maxAge: CONFIG.PICKUPS.clusterFragLife
      }));
    }
  }

  update(dt, game) {
    this.age += dt;
    if (this.age > (this.maxAge || CONFIG.BULLET.maxAge)) { this.dead = true; return; }
    // 散裂弹母弹：引信耗尽原地爆炸
    if (this.cluster && this.generation === 1) {
      this.fuse -= dt;
      if (this.fuse <= 0) {
        this.spawnFragments(game);
        this.dead = true;
        return;
      }
    }

    // 记录轨迹点（用于视觉拖尾）
    this.trailTimer += dt;
    if (this.trailTimer > 0.012) {
      this.trailTimer = 0;
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > CONFIG.BULLET.trailPoints) this.trail.shift();
    }

    let remaining = this.speed * dt;
    let guard = 0;

    while (remaining > 1e-6 && !this.dead && guard++ < 500) {
      const step = Math.min(remaining, CONFIG.BULLET.substep);
      remaining -= step;

      // 角部墙体互相重叠时先把弹体挤出，避免起点落在墙内而漏检
      const fixed = Bullet.separate(game.maze, this.x, this.y);
      this.x = fixed.x;
      this.y = fixed.y;

      // 连续碰撞：整段射线上最近的一面墙
      const hit = game.maze.raycast(this.x, this.y, this.dx, this.dy, step, this.radius);
      const travel = hit ? hit.t : step;

      if (travel > 0) {
        const tank = game.findTankHit(this, this.x, this.y, this.dx * travel, this.dy * travel);
        if (tank) {
          this.dead = true;
          game.onBulletHit(this, tank);
          return;
        }
      }

      if (hit) {
        // 未走完的位移要还给剩余距离，否则每反弹一次都会变慢，
        // 与 AI 使用的弹道预测产生偏差
        remaining += (step - hit.t);
        // 反射
        this.x = hit.x + hit.nx * 0.15;
        this.y = hit.y + hit.ny * 0.15;
        const dot = this.dx * hit.nx + this.dy * hit.ny;
        this.dx -= 2 * dot * hit.nx;
        this.dy -= 2 * dot * hit.ny;
        const len = Math.sqrt(this.dx * this.dx + this.dy * this.dy) || 1;
        this.dx /= len;
        this.dy /= len;
        this.angle = Math.atan2(this.dy, this.dx);
        this.bounces++;
        this.trail.push({ x: this.x, y: this.y });
        game.effects.wallHit(hit.x, hit.y, hit.nx, hit.ny, this.ownerColor);
        if (game.sound) game.sound.play('bounce');

        if (this.bounces > this.maxBounces) {
          this.dead = true;
          game.effects.sparkBurst(hit.x, hit.y, this.ownerColor, 6);
          return;
        }
      } else {
        this.x += this.dx * step;
        this.y += this.dy * step;
      }
    }
  }

  /**
   * 预演子弹飞行轨迹（与 Bullet.update 使用完全相同的射线与反射规则）。
   * 供 AI 的威胁评估与反弹射击复用。
   * @returns {Array<{x:number,y:number,t:number}>}
   */
  static predictPath(maze, x, y, dx, dy, speed, maxBounces, maxTime) {
    const points = [{ x, y, t: 0 }];
    let bounces = 0;
    let remaining = speed * maxTime;
    let t = 0;
    let cx = x, cy = y;

    while (remaining > 0.5 && bounces <= maxBounces) {
      const fixed = Bullet.separate(maze, cx, cy);
      cx = fixed.x;
      cy = fixed.y;
      const hit = maze.raycast(cx, cy, dx, dy, remaining, CONFIG.BULLET.radius);
      if (!hit) {
        cx += dx * remaining;
        cy += dy * remaining;
        t += remaining / speed;
        points.push({ x: cx, y: cy, t });
        break;
      }
      cx = hit.x + hit.nx * 0.15;
      cy = hit.y + hit.ny * 0.15;
      t += hit.t / speed;
      remaining -= hit.t;
      points.push({ x: cx, y: cy, t });

      const dot = dx * hit.nx + dy * hit.ny;
      dx -= 2 * dot * hit.nx;
      dy -= 2 * dot * hit.ny;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      dx /= len; dy /= len;
      bounces++;
    }
    return points;
  }

  render(ctx) {
    const color = this.ownerColor;
    // 拖尾
    for (let i = 0; i < this.trail.length; i++) {
      const p = this.trail[i];
      const k = (i + 1) / this.trail.length;
      ctx.globalAlpha = 0.42 * k;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, this.radius * (0.5 + 0.62 * k), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 弹体
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, TAU);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = color;
    ctx.stroke();

    // 强化反弹弹药：额外描一圈亮色，便于识别
    if (this.enhanced) {
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius + 2.4, 0, TAU);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#B8E986';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
}

/**
 * 轨迹折线与圆的首次接近时间
 * @param {number} [tMin] 忽略该时刻之前的弹道段（用于跳过"子弹尚在炮口圈内"的起始段）
 * @returns {number|null} 秒
 */
function polylineApproachTime(points, cx, cy, r, tMin) {
  tMin = tMin || 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (b.t <= tMin) continue;              // 整段都在 tMin 之前：跳过
    // 跨 tMin 的段：从 tMin 对应的位置开始检查（而不是从段起点）
    let ax = a.x, ay = a.y, at = a.t;
    if (a.t < tMin) {
      const k = (b.t - a.t) > 1e-9 ? (tMin - a.t) / (b.t - a.t) : 0;
      ax = a.x + (b.x - a.x) * k;
      ay = a.y + (b.y - a.y) * k;
      at = tMin;
    }
    const dx = b.x - ax, dy = b.y - ay;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-9) {
      t = clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1);
    }
    const px = ax + dx * t, py = ay + dy * t;
    if (dist(px, py, cx, cy) <= r) {
      return at + (b.t - at) * t;
    }
  }
  return null;
}
