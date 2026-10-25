'use strict';
/* =========================================================
 * 道具与可部署物
 *
 * Pickup：地图上可拾取的强化道具（玩家与 AI 都能捡）
 * Mine  ：地雷套件部署的可触发爆炸物
 * Laser ：激光炮的瞬时弹道（可沿墙面折射，命中即淘汰）
 *
 * 道具统一用 PICKUP_TYPES 描述：名称/颜色/稀有度/权重/类型/
 * 持续时间或次数/图标。新增道具只需在这里补定义 + 在
 * tank.applyPickup() 与 render 图标中处理对应分支。
 * ========================================================= */

/* 道具类型定义
 * kind: weapon 武器替换（互斥，占用 tank.powerup）
 *       boost  临时强化（可与武器共存，按时长刷新不叠加）
 *       ammo   弹药强化（按次数消耗）
 *       active 主动道具（按键释放，按次数消耗）
 *       aura   自动生效的感知类道具
 * rarity: common / tactical / rare
 */
const PICKUP_TYPES = {
  laser: {
    name: '激光炮', color: '#37B6FF', rarity: 'common', weight: 0.16, kind: 'weapon',
    shots: function () { return CONFIG.PICKUPS.laserShots; },
    desc: '8 发折射激光'
  },
  cluster: {
    name: '散裂弹', color: '#FF8A3C', rarity: 'common', weight: 0.16, kind: 'weapon', time: 10,
    desc: '命中后炸出碎片'
  },
  triple: {
    name: '三连发', color: '#C79BFF', rarity: 'common', weight: 0.13, kind: 'weapon', time: 10,
    desc: '扇形三连射'
  },
  shield: {
    name: '能量护盾', color: '#7FD9FF', rarity: 'tactical', weight: 0.10, kind: 'boost',
    time: CONFIG.PICKUPS.shieldTime,
    desc: '短暂无敌'
  },
  speed: {
    name: '超载引擎', color: '#FFD24A', rarity: 'tactical', weight: 0.10, kind: 'boost',
    time: CONFIG.PICKUPS.speedTime,
    desc: '加速与转向提升'
  },
  rapid: {
    name: '连射过载', color: '#FF6B6B', rarity: 'common', weight: 0.12, kind: 'boost',
    time: CONFIG.PICKUPS.rapidTime,
    desc: '开火冷却缩短'
  },
  bouncer: {
    name: '强化反弹', color: '#B8E986', rarity: 'tactical', weight: 0.10, kind: 'ammo',
    shots: function () { return CONFIG.PICKUPS.bouncerShots; },
    desc: '子弹额外反弹'
  },
  emp: {
    name: 'EMP 脉冲', color: '#9BF0FF', rarity: 'rare', weight: 0.03, kind: 'active',
    charges: function () { return CONFIG.PICKUPS.empCharges; }, key: 'E',
    desc: '范围干扰敌人'
  },
  mine: {
    name: '地雷套件', color: '#D9A066', rarity: 'rare', weight: 0.03, kind: 'active',
    charges: function () { return CONFIG.PICKUPS.mineCharges; }, key: 'Q',
    desc: '布设触发地雷'
  },
  radar: {
    name: '雷达扫描', color: '#7CF0A0', rarity: 'tactical', weight: 0.07, kind: 'aura',
    time: CONFIG.PICKUPS.radarTime,
    desc: '显示敌人方位'
  }
};

const PICKUP_KINDS = ['laser', 'cluster', 'triple', 'shield', 'speed', 'rapid', 'bouncer', 'emp', 'mine', 'radar'];

/* 兼容旧代码/测试的权重表 */
const PICKUP_WEIGHTS = {};
for (const k of PICKUP_KINDS) PICKUP_WEIGHTS[k] = PICKUP_TYPES[k].weight;

/**
 * 按权重随机道具类型；recent 中最近出现过的类型权重降低，避免连续重复。
 * 权重会自动归一化，新增类型后无需手工调整总和。
 */
function randomPickupType(recent) {
  const cfg = CONFIG.PICKUPS;
  const recentList = recent || [];
  let total = 0;
  const weights = {};
  for (const k of PICKUP_KINDS) {
    const def = PICKUP_TYPES[k];
    let w = def.weight || 0;
    if (recentList.indexOf(k) >= 0) w *= cfg.recentWeight;
    weights[k] = w;
    total += w;
  }
  if (total <= 0) return 'cluster';
  let r = Math.random() * total;
  for (const k of PICKUP_KINDS) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return PICKUP_KINDS[PICKUP_KINDS.length - 1];
}

class Pickup {
  constructor(type, x, y) {
    this.type = type;
    this.x = x;
    this.y = y;
    this.radius = CONFIG.PICKUPS.radius;
    this.bob = Math.random() * TAU;
    this.age = 0;
    this.dead = false;
  }

  /** @param {{x:number,y:number,w:number,h:number}} [camera] */
  render(ctx, time, camera) {
    if (camera && !camera.contains(this.x, this.y, 40)) return;
    const def = PICKUP_TYPES[this.type];
    if (!def) return;
    const bobY = Math.sin(time * 2.4 + this.bob) * 2.6;
    const x = this.x, y = this.y + bobY;
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2 + this.bob);

    ctx.save();
    // 底部光晕
    ctx.globalAlpha = 0.22 + 0.16 * pulse;
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(x, y, this.radius + 5 + pulse * 2, 0, TAU);
    ctx.fill();

    // 外圈（稀有道具加一圈细环）
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.arc(x, y, this.radius, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = def.color;
    ctx.stroke();
    if (def.rarity === 'rare') {
      ctx.globalAlpha = 0.55 + 0.35 * pulse;
      ctx.beginPath();
      ctx.arc(x, y, this.radius + 3.5, 0, TAU);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 0.95;
    }

    // 图标
    ctx.strokeStyle = def.color;
    ctx.fillStyle = def.color;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    switch (this.type) {
      case 'laser': {
        // 折射光束：三段折线
        ctx.beginPath();
        ctx.moveTo(x - 5, y + 5);
        ctx.lineTo(x - 1, y - 1);
        ctx.lineTo(x + 1, y + 1);
        ctx.lineTo(x + 5, y - 5);
        ctx.stroke();
        break;
      }
      case 'cluster': {
        // 中心圆 + 四散小点
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4 + Math.PI / 4;
          ctx.beginPath();
          ctx.arc(x + Math.cos(a) * 5.5, y + Math.sin(a) * 5.5, 1.5, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'triple': {
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.arc(x + i * 4.5, y + Math.abs(i) * 2, 1.7, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'shield': {
        // 盾形
        ctx.beginPath();
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x + 5, y - 3);
        ctx.lineTo(x + 4, y + 3);
        ctx.lineTo(x, y + 6);
        ctx.lineTo(x - 4, y + 3);
        ctx.lineTo(x - 5, y - 3);
        ctx.closePath();
        ctx.stroke();
        break;
      }
      case 'speed': {
        // 双箭头
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 5);
        ctx.lineTo(x - 1, y);
        ctx.lineTo(x - 5, y + 5);
        ctx.moveTo(x + 1, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x + 1, y + 5);
        ctx.stroke();
        break;
      }
      case 'rapid': {
        // 三连闪电
        ctx.beginPath();
        ctx.moveTo(x - 5, y - 6);
        ctx.lineTo(x - 2, y - 1);
        ctx.lineTo(x - 4, y - 1);
        ctx.lineTo(x - 1, y + 6);
        ctx.moveTo(x + 1, y - 6);
        ctx.lineTo(x + 4, y - 1);
        ctx.lineTo(x + 2, y - 1);
        ctx.lineTo(x + 5, y + 6);
        ctx.stroke();
        break;
      }
      case 'bouncer': {
        // 弹跳箭头：折线 + 箭头
        ctx.beginPath();
        ctx.moveTo(x - 6, y + 5);
        ctx.lineTo(x - 1, y - 2);
        ctx.lineTo(x + 2, y + 2);
        ctx.lineTo(x + 6, y - 6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 6, y - 6);
        ctx.lineTo(x + 2.2, y - 5.2);
        ctx.moveTo(x + 6, y - 6);
        ctx.lineTo(x + 5.2, y - 2.2);
        ctx.stroke();
        break;
      }
      case 'emp': {
        // 同心弧
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.arc(x, y, i * 2.4, -0.9, 0.9);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, i * 2.4, Math.PI - 0.9, Math.PI + 0.9);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, 1.4, 0, TAU);
        ctx.fill();
        break;
      }
      case 'mine': {
        // 圆盘 + 尖刺
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + Math.PI / 4;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4);
          ctx.lineTo(x + Math.cos(a) * 7, y + Math.sin(a) * 7);
          ctx.stroke();
        }
        break;
      }
      case 'radar': {
        // 雷达扇形 + 光点
        ctx.beginPath();
        ctx.arc(x - 1, y + 1, 6, -0.5, 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x - 1, y + 1, 3.4, -0.5, 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + 3, y - 3.5, 1.5, 0, TAU);
        ctx.fill();
        break;
      }
      default: break;
    }
    ctx.restore();
  }
}

/* =========================================================
 * 地雷：布设后短暂延时起爆，触发即爆炸
 * ========================================================= */
class Mine {
  constructor(opts) {
    const cfg = CONFIG.PICKUPS;
    this.x = opts.x;
    this.y = opts.y;
    this.ownerId = opts.ownerId;
    this.radius = 12;
    this.triggerRadius = cfg.mineTriggerRadius;
    this.blastRadius = cfg.mineBlastRadius;
    this.armTime = cfg.mineArmTime;
    this.life = cfg.mineLife;
    this.age = 0;
    this.armed = false;
    this.dead = false;
    this.blink = Math.random() * TAU;
  }

  update(dt, game) {
    if (this.dead) return;
    this.age += dt;
    if (this.age >= this.life) { this.dead = true; return; }
    if (!this.armed) {
      if (this.age >= this.armTime) this.armed = true;
      return;
    }
    // 触发：任意非布设者坦克进入范围
    for (let i = 0; i < game.tanks.length; i++) {
      const t = game.tanks[i];
      if (!t.alive || t.invuln > 0) continue;
      if (t.id === this.ownerId) continue;
      if (dist(t.x, t.y, this.x, this.y) <= this.triggerRadius + t.radius) {
        this.dead = true;
        game.onMineExplode(this);
        return;
      }
    }
  }

  /** @param {{x:number,y:number,w:number,h:number}} [camera] */
  render(ctx, time, camera) {
    if (camera && !camera.contains(this.x, this.y, 30)) return;
    const cfg = CONFIG.PICKUPS;
    const pulse = 0.5 + 0.5 * Math.sin(time * 6 + this.blink);
    const lifeLeft = 1 - this.age / this.life;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.55 + lifeLeft * 0.45);
    // 外圈提示
    ctx.strokeStyle = this.armed ? 'rgba(217,160,102,' + (0.35 + 0.4 * pulse).toFixed(2) + ')' : 'rgba(120,120,120,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.armTime > 0 && this.armed ? 9 : 7, 0, TAU);
    ctx.stroke();
    // 雷体
    ctx.fillStyle = this.armed ? '#C98B4B' : '#8F8F8F';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#4A2F12';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 起爆指示灯
    ctx.fillStyle = this.armed ? 'rgba(255,70,60,' + (0.35 + 0.65 * pulse).toFixed(2) + ')' : 'rgba(160,160,160,0.8)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, 1.8, 0, TAU);
    ctx.fill();
    // 触发范围（半透明）
    if (this.armed) {
      ctx.globalAlpha = 0.08 + 0.05 * pulse;
      ctx.fillStyle = '#FFB36B';
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.triggerRadius + 6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

/* =========================================================
 * 激光：瞬时射线，可沿墙面折射
 * ========================================================= */
class Laser {
  /**
   * @param {Game} game
   * @param {Tank} tank 发射者
   */
  constructor(game, tank) {
    const cfg = CONFIG.PICKUPS;
    this.ownerId = tank.id;
    this.color = '#5FD0FF';
    this.life = cfg.laserLife;
    this.maxLife = cfg.laserLife;
    this.segments = [];
    this.hitTank = null;

    const maze = game.maze;
    let cx = tank.x + Math.cos(tank.angle) * CONFIG.TANK.muzzleOffset;
    let cy = tank.y + Math.sin(tank.angle) * CONFIG.TANK.muzzleOffset;
    let dx = Math.cos(tank.angle);
    let dy = Math.sin(tank.angle);
    let remaining = cfg.laserRange;
    let bounces = 0;

    // 起点若被墙挡住，贴回墙前
    const startFix = maze.raycast(tank.x, tank.y, dx, dy, CONFIG.TANK.muzzleOffset + cfg.laserRange, 2);
    if (startFix && startFix.t < CONFIG.TANK.muzzleOffset - 2) {
      cx = tank.x + dx * Math.max(6, startFix.t - 1.5);
      cy = tank.y + dy * Math.max(6, startFix.t - 1.5);
    }

    while (remaining > 1 && bounces <= cfg.laserMaxBounces) {
      const wallHit = maze.raycast(cx, cy, dx, dy, remaining, 2);
      const dist = wallHit ? wallHit.t : remaining;
      const ex = cx + dx * dist;
      const ey = cy + dy * dist;

      // 沿这一段找最近的目标
      const target = game.findLaserTarget(cx, cy, ex, ey, this.ownerId);
      if (target) {
        const t = Physics.segmentCircle(cx, cy, ex, ey, target.x, target.y, target.radius + 2);
        this.segments.push({ x1: cx, y1: cy, x2: cx + dx * dist * t, y2: cy + dy * dist * t });
        this.hitTank = target;
        return;
      }

      this.segments.push({ x1: cx, y1: cy, x2: ex, y2: ey });
      if (!wallHit) return;

      cx = wallHit.x + wallHit.nx * 0.6;
      cy = wallHit.y + wallHit.ny * 0.6;
      const dot = dx * wallHit.nx + dy * wallHit.ny;
      dx -= 2 * dot * wallHit.nx;
      dy -= 2 * dot * wallHit.ny;
      remaining -= dist;
      bounces++;
    }
  }

  /** @param {{x:number,y:number,w:number,h:number}} [camera] */
  render(ctx, camera) {
    const k = this.life / this.maxLife;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      // 外发光
      ctx.globalAlpha = 0.22 * k;
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
      // 内芯
      ctx.globalAlpha = 0.95 * k;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
