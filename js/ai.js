'use strict';
/* =========================================================
 * 敌方 AI
 * 感知 -> 情报记忆 -> 威胁评估 -> 战术决策 -> 复用统一物理执行
 *
 * 状态一览：
 *   战斗：aim / advance / engage / flank / strafe / cover / pause / bounce
 *   追踪：pursue（依据"最后已知位置"追击）
 *   搜索：search / ambush（到达最后已知位置后搜查周边或守点伏击）
 *   生存：dodge / recover
 *   辅助：wander / patrol / collect / investigate
 *
 * 感知公平性（硬性约束）：
 * - think() 只在"视线检测"这一处查询玩家实时坐标，用于判断能否看见；
 * - 看不见玩家时，一切决策只能依据：
 *   1) 最后已知位置 lastKnown（亲眼确认，带时间戳与可信度衰减）；
 *   2) 队友共享情报 game.enemyIntel（带时间戳，按难度系数量化采信）；
 *   3) 枪声位置 game.lastPlayerShot（真实开火事件，带时间戳）。
 *   任何分支不得直接读取玩家实时坐标。
 * - AI 与玩家使用完全相同的坦克物理、子弹反弹和命中规则，
 *   不做穿墙观察、不做自动命中、不突破冷却、不瞬移。
 * ========================================================= */

const AI_DIFFICULTIES = {
  easy: {
    key: 'easy', name: '简单',
    thinkInterval: 0.34,
    reaction: 0.90,
    aimError: 0.34,          // 瞄准噪声（弧度）
    fireTolerance: 0.28,
    fireCooldown: 2.10,
    leadFactor: 0.00,        // 不预判
    missChance: 0.60,        // 明显错过机会
    dodgeDelay: 0.85,        // 反应迟缓
    dodgeThreshold: 0.70,
    dodgeDuration: 0.55,
    bounceSkill: 0.0,        // 不使用反弹
    bounceScanInterval: 3.5,
    idealRange: 240,
    speed: 138,
    turnSpeed: 6.4,
    /* ---- 情报与战术参数 ---- */
    memoryDecay: 4.0,        // 情报可信度从 1 衰减到 0 的秒数（越小忘得越快）
    pursueConf: 0.45,        // 高于该可信度才保持精确追击
    searchMaxPoints: 2,      // 一次搜索最多检查的候选点数
    searchDuration: 3.0,     // 单次搜索最长持续（秒）
    flankSkill: 0.15,        // 侧翼/机动战术的总体能力权重
    tacticInterval: 1.6,     // 战斗战术重新评估间隔（秒）
    intelShare: 0.35,        // 采信队友共享情报的可信度系数
    intelMaxAge: 3.5,        // 愿意采信队友情报的最长年龄（秒）
    coordination: 0.25,      // 队友路线避让 / 分工的权重
    ambushSkill: 0.10        // 失去视线后守点伏击的倾向
  },
  normal: {
    key: 'normal', name: '普通',
    thinkInterval: 0.18,
    reaction: 0.45,
    aimError: 0.17,
    fireTolerance: 0.18,
    fireCooldown: 1.35,
    leadFactor: 0.35,
    missChance: 0.30,
    dodgeDelay: 0.45,
    dodgeThreshold: 0.45,
    dodgeDuration: 0.45,
    bounceSkill: 0.40,
    bounceScanInterval: 2.2,
    idealRange: 250,
    speed: 158,
    turnSpeed: 7.8,
    memoryDecay: 6.5,
    pursueConf: 0.35,
    searchMaxPoints: 3,
    searchDuration: 4.5,
    flankSkill: 0.50,
    tacticInterval: 1.0,
    intelShare: 0.60,
    intelMaxAge: 5.0,
    coordination: 0.60,
    ambushSkill: 0.35
  },
  hard: {
    key: 'hard', name: '困难',
    thinkInterval: 0.10,
    reaction: 0.26,
    aimError: 0.085,
    fireTolerance: 0.11,
    fireCooldown: 1.00,
    leadFactor: 0.75,
    missChance: 0.08,
    dodgeDelay: 0.25,
    dodgeThreshold: 0.30,
    dodgeDuration: 0.38,
    bounceSkill: 0.80,
    bounceScanInterval: 1.2,
    idealRange: 260,
    speed: 176,
    turnSpeed: 9.2,
    memoryDecay: 10.0,
    pursueConf: 0.30,
    searchMaxPoints: 4,
    searchDuration: 6.5,
    flankSkill: 0.85,
    tacticInterval: 0.7,
    intelShare: 0.85,
    intelMaxAge: 7.0,
    coordination: 0.90,
    ambushSkill: 0.60
  },
  demon: {
    key: 'demon', name: '恶魔',
    // 复用 hard 的战术/机动量级（不改变敌人数量/速度/射速等既有数值语义）
    thinkInterval: 0.10,
    reaction: 0.22,
    aimError: 0.07,
    fireTolerance: 0.10,
    fireCooldown: 1.00,
    leadFactor: 0.80,
    missChance: 0.06,
    dodgeDelay: 0.22,
    dodgeThreshold: 0.28,
    dodgeDuration: 0.36,
    bounceSkill: 0.85,
    bounceScanInterval: 1.1,
    idealRange: 260,
    speed: 176,
    turnSpeed: 9.2,
    memoryDecay: 10.0,
    pursueConf: 0.30,
    searchMaxPoints: 4,
    searchDuration: 6.5,
    flankSkill: 0.85,
    tacticInterval: 0.7,
    intelShare: 0.85,
    intelMaxAge: 7.0,
    coordination: 0.0,       // 恶魔：不分工（全体锁定玩家）
    ambushSkill: 0.25,
    /* ---- 恶魔专属 ---- */
    demon: true              // 全员以玩家为唯一主动攻击目标 + 锁定范围约束
  }
};

/* 战斗风格：共用同一套物理，只改变行为偏好 */
const AI_PERSONALITIES = {
  aggressive: {
    key: 'aggressive', name: '进攻型',
    idealRange: 190, bounce: 0.8, dodge: 0.9, advance: 1.15, collectRange: 260,
    flank: 0.70, cover: 0.45, hold: 0.35, strafe: 0.90, ambush: 0.50
  },
  cautious: {
    key: 'cautious', name: '谨慎型',
    idealRange: 330, bounce: 0.6, dodge: 1.35, advance: 0.8, collectRange: 420,
    flank: 1.00, cover: 1.35, hold: 1.20, strafe: 0.70, ambush: 0.90
  },
  tactical: {
    key: 'tactical', name: '战术型',
    idealRange: 270, bounce: 1.5, dodge: 1.05, advance: 1.0, collectRange: 340,
    flank: 1.25, cover: 0.95, hold: 0.85, strafe: 1.10, ambush: 1.35
  }
};

/* 战术子系统的集中调参（避免散落的魔法数字） */
const AI_TACTICS = {
  /* 侧翼绕行 */
  flankMinOffset: 0.85,     // 侧翼点相对"自身→玩家"视线方向的最小偏角（弧度）
  flankMaxOffset: 2.30,     // 最大偏角
  flankRadiusPad: 90,       // 侧翼点距离在 idealRange 基础上的浮动范围
  flankCandidates: 4,       // 每次评估最多生成的侧翼候选数
  flankMinDist: 240,        // 与玩家距离小于该值时不考虑侧翼
  /* 横向机动 */
  strafeDistMin: 60,
  strafeDistMax: 130,
  strafeKeepOff: 70,        // 横移点必须与玩家保持的最小距离
  /* 掩体 */
  coverDistMin: 70,
  coverDistMax: 210,
  coverCandidates: 8,       // 掩体采样方向数
  /* 搜索 */
  searchRingMin: 70,        // 搜索候选点相对最后已知位置的环形范围
  searchRingMax: 300,
  searchSampleCap: 12,      // 候选采样上限（评分前）
  searchArriveDist: 80,     // 判定"已抵达最后已知位置"的距离
  /* 团队 */
  mateOverlapDist: 110,     // 队友目标重合判定距离
  mateOverlapPenalty: 0.55, // 重合惩罚（战术评分单位）
  /* 行为节奏 */
  goalArriveDist: 42,       // 到达战术/搜索目标的判定距离
  pauseTimeMin: 0.35,
  pauseTimeMax: 0.90,
  strafeTimeMin: 0.50,
  strafeTimeMax: 1.00,
  coverHoldMin: 0.50,
  coverHoldMax: 1.10,
  watchTimeMin: 0.35,       // 搜索点驻留观察时长
  watchTimeMax: 1.10,
  ambushWatchTime: 2.6,     // 伏击守点时长
  intelForgetConf: 0.08,    // 低于该可信度彻底遗忘目标
  soundIntelMaxAge: 2.5,    // 枪声情报的有效年龄（秒）
  soundIntelRange: 700      // 枪声情报的听取半径
};

/** 折线上 t 时刻的位置（t 为弹道的秒数） */
function pointOnPolyline(points, t) {
  if (!points.length) return null;
  if (t <= points[0].t) return { x: points[0].x, y: points[0].y };
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i].t) {
      const a = points[i - 1], b = points[i];
      const span = b.t - a.t;
      const k = span > 1e-9 ? (t - a.t) / span : 0;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  const last = points[points.length - 1];
  return { x: last.x, y: last.y };
}

class AIController {
  constructor(tank, game, difficultyKey, personalityKey) {
    this.tank = tank;
    this.game = game;
    this.diff = AI_DIFFICULTIES[difficultyKey] || AI_DIFFICULTIES.normal;
    this.personality = AI_PERSONALITIES[personalityKey] || AI_PERSONALITIES.tactical;

    tank.maxSpeed = this.diff.speed;
    tank.turnSpeed = this.diff.turnSpeed;
    tank.fireCooldown = this.diff.fireCooldown;

    this.aim = tank.angle;
    this.fireAngle = tank.angle;
    this.moveIntent = 0;
    this.wantFire = false;

    this.thinkTimer = Math.random() * this.diff.thinkInterval;
    this.hasLos = false;
    this.losAcquiredAt = -99;
    this.fireDelay = this.diff.reaction;
    this.targetDist = 9999;

    this.aimNoise = 0;
    this.aimNoiseTimer = 0;

    this.dodgeTimer = 0;
    this.dodgeAngle = tank.angle;
    this.lastDodge = -99;

    this.bounceSolution = null;
    this.bounceUntil = 0;
    this.lastBounceTry = -99;

    this.path = null;
    this.pathGoal = null;
    this.pathTime = -99;
    this.wanderGoal = null;

    this.stuckTime = 0;
    this.posCheckTimer = 0;
    this.lastPos = { x: tank.x, y: tank.y };
    this.recoverTimer = 0;

    this.idealRange = this.personality.idealRange;
    this.role = 'hunt';       // hunt = 主动追击，patrol = 巡逻/守卫
    this.state = 'idle';
    // 视线用与子弹一致的半径判断，否则会出现"看得见却打在墙角上"
    this.losRadius = CONFIG.BULLET.radius + 0.8;

    /* ---- 目标情报记忆（感知公平性核心） ---- */
    this.lastKnown = null;     // 最后亲眼确认的玩家位置 {x,y}
    this.lastSeenAt = -99;     // 最后亲眼确认的时刻（game.time）
    this.intelConf = 0;        // 当前情报可信度 0~1（缓存，think 时刷新）
    this.intelConf0 = 0;       // 采信时刻的初始可信度
    this.intelConfAt = -99;    // 情报的基准时刻（可信度从该时刻起衰减）
    this.intelSource = 'none'; // sight | share | sound | none

    /* ---- 战斗战术 ---- */
    this.tactic = null;        // {key, goal?, until, holdUntil?, routeKey?}
    this.tacticGoal = null;    // 当前战术移动目标（供队友避让参考）
    this.tacticUntil = 0;      // 战术有效期至（game.time）
    this.nextTacticReview = 0; // 下次战术评估时刻
    this.lastRouteKey = '';    // 最近一次选用的路线标识（多样性）
    this.lastThreat = null;    // 最近一次威胁评估 {level, at}

    /* ---- 搜索 ---- */
    this.searchQueue = [];     // 候选搜索点队列
    this.searchGoal = null;    // 当前搜索目标
    this.searchUntil = 0;      // 本轮搜索截止时间
    this.searchWatchUntil = 0; // 当前搜索点的观察截止时间
    this.searchWatchAim = tank.angle;
    this.searchAmbush = false; // 本轮搜索是否包含守点伏击

    /* ---- 导航 ---- */
    this.navTarget = null;     // 当前导航目标点（脱困偏向 / 队友避让依据）

    /* ---- 主动道具使用节流 ---- */
    this.lastEmpTry = -99;
    this.lastMineTry = -99;
  }

  /* ---------------- 主循环 ---------------- */

  update(dt) {
    const tank = this.tank;
    if (!tank.alive) return;

    // 被 EMP 干扰：短暂失去战斗能力（停止推进与开火），仍可被动挨打
    if (tank.empStun > 0) {
      this.moveIntent = 0;
      this.wantFire = false;
      tank.aimAngle = this.aim;
      tank.moveIntent = 0;
      return;
    }

    if (this.recoverTimer > 0) this.recoverTimer -= dt;
    if (this.dodgeTimer > 0) this.dodgeTimer -= dt;

    // 瞄准噪声定期变化（而不是每帧抖动）
    this.aimNoiseTimer -= dt;
    if (this.aimNoiseTimer <= 0) {
      this.aimNoiseTimer = 0.7 + Math.random() * 0.7;
      this.aimNoise = (Math.random() * 2 - 1) * this.diff.aimError;
    }

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.diff.thinkInterval * (0.85 + Math.random() * 0.35);
      this.think();
    }

    tank.aimAngle = this.aim;
    tank.moveIntent = this.moveIntent;

    this.updateStuck(dt);
    this.tryFire();
  }

  updateStuck(dt) {
    this.posCheckTimer += dt;
    if (this.posCheckTimer < 0.35) return;
    const moved = dist(this.tank.x, this.tank.y, this.lastPos.x, this.lastPos.y);
    if (this.moveIntent > 0.5 && moved < 10) this.stuckTime += this.posCheckTimer;
    else this.stuckTime = Math.max(0, this.stuckTime - this.posCheckTimer * 0.6);
    this.lastPos.x = this.tank.x;
    this.lastPos.y = this.tank.y;
    this.posCheckTimer = 0;
    if (this.stuckTime > 0.9) this.escape();
  }

  /* ---------------- 情报记忆 ---------------- */

  /**
   * 亲眼看见玩家：更新记忆。这是唯一把玩家实时坐标写进 AI 内部状态的入口，
   * 且仅在本帧视线检测成立时被调用。
   */
  observe(player, now) {
    this.lastKnown = { x: player.x, y: player.y };
    this.lastSeenAt = now;
    this.intelConf0 = 1;
    this.intelConfAt = now;
    this.intelConf = 1;
    this.intelSource = 'sight';
    // 主动清理过期的搜索计划（重新交战了）
    this.searchQueue.length = 0;
    this.searchGoal = null;
    this.searchUntil = 0;
    // 上报到共享情报黑板（带时间戳，队友只能按规则采信）
    if (this.game.reportEnemyIntel) {
      this.game.reportEnemyIntel(this.tank.id, player.x, player.y, now);
    }
  }

  /** 按时间衰减当前情报可信度 */
  computeIntelConf(now) {
    if (!this.lastKnown) return 0;
    const age = now - this.intelConfAt;
    if (age <= 0) return this.intelConf0;
    return Math.max(0, this.intelConf0 * (1 - age / this.diff.memoryDecay));
  }

  /**
   * 失去视线时的间接感知：采信队友共享情报与枪声。
   * 两条线索都带时间戳，采信后成为静态的"最后已知位置"，
   * 不会随玩家移动而更新。
   */
  absorbSharedIntel(now) {
    const game = this.game;
    // 先按当前时刻刷新手头情报的可信度（含采信后的持续衰减）
    this.intelConf = this.computeIntelConf(now);

    // 1) 队友共享情报（最近一次亲眼确认，带时间戳）
    const intel = game.enemyIntel;
    if (intel && intel.reporterId !== this.tank.id) {
      const age = now - intel.time;
      if (age >= 0 && age < this.diff.intelMaxAge) {
        const conf = (1 - age / this.diff.intelMaxAge) * this.diff.intelShare;
        // 只有比手头情报更新、且可信度更高时才采信
        if (conf > this.intelConf && (!this.lastKnown || intel.time > this.intelConfAt)) {
          this.lastKnown = { x: intel.x, y: intel.y };
          this.intelConf0 = conf;
          this.intelConfAt = now;
          this.intelConf = conf;
          this.intelSource = 'share';
          this.searchQueue.length = 0;
          this.searchGoal = null;
          this.searchUntil = 0;
        }
      }
    }

    // 2) 枪声（真实开火事件：位置与时间都是公开信息）
    const shot = game.lastPlayerShot;
    if (shot && now - shot.time < AI_TACTICS.soundIntelMaxAge) {
      const d = dist(this.tank.x, this.tank.y, shot.x, shot.y);
      if (d < AI_TACTICS.soundIntelRange && shot.time > this.intelConfAt) {
        const conf = 0.6 * (1 - (now - shot.time) / AI_TACTICS.soundIntelMaxAge);
        if (conf > this.intelConf) {
          this.lastKnown = { x: shot.x, y: shot.y };
          this.intelConf0 = conf;
          this.intelConfAt = shot.time;
          this.intelConf = conf;
          this.intelSource = 'sound';
          this.searchQueue.length = 0;
          this.searchGoal = null;
          this.searchUntil = 0;
        }
      }
    }
  }

  /** 彻底遗忘目标情报 */
  forgetIntel() {
    this.lastKnown = null;
    this.intelConf = 0;
    this.intelConf0 = 0;
    this.intelConfAt = -99;
    this.intelSource = 'none';
    this.searchQueue.length = 0;
    this.searchGoal = null;
    this.searchUntil = 0;
    this.bounceSolution = null;
  }

  /* ---------------- 主动道具 ---------------- */

  /**
   * AI 对主动道具的使用（与玩家使用同一套 Tank API 和规则）：
   * - 雷达：拾取后触发一次有限半径的"雷达探测"，得到一份带时间戳的目击情报；
   * - EMP：看得见玩家且距离在脉冲半径内时释放；
   * - 地雷：在追击/搜索途中、玩家不可见时于车后布设。
   */
  useActiveItems() {
    const tank = this.tank;
    const game = this.game;
    const cfg = CONFIG.PICKUPS;

    // 雷达探测（每次拾取只触发一次）
    if (tank.radarTime > 0 && !tank.radarPinged) {
      tank.radarPinged = true;
      const p = game.player;
      if (p && p.alive && dist(tank.x, tank.y, p.x, p.y) <= cfg.radarRadius) {
        this.lastKnown = { x: p.x, y: p.y };
        this.intelConf0 = 0.55;
        this.intelConfAt = game.time;
        this.intelConf = 0.55;
        this.intelSource = 'radar';
        this.searchQueue.length = 0;
        this.searchGoal = null;
        this.searchUntil = 0;
      }
    }

    // EMP：视线内且距离足够近时释放
    if (tank.empCharges > 0 && tank.empCooldown <= 0 && this.hasLos &&
        game.time - this.lastEmpTry > 3) {
      const p = game.player;
      if (p && p.alive && dist(tank.x, tank.y, p.x, p.y) < cfg.empRadius * 0.9 &&
          Math.random() < 0.6) {
        this.lastEmpTry = game.time;
        tank.useEmp(game);
      }
    }

    // 地雷：失去视线、在移动途中时布雷（限制频率）
    if (tank.mineCharges > 0 && tank.mineCooldown <= 0 &&
        game.time - this.lastMineTry > 4 && !this.hasLos) {
      if (this.state === 'pursue' || this.state === 'search' || this.state === 'wander') {
        this.lastMineTry = game.time;
        tank.deployMine(game);
      }
    }
  }

  /* ---------------- 决策 ---------------- */

  think() {
    const tank = this.tank;
    const game = this.game;
    const maze = game.maze;

    this.wantFire = false;

    if (this.recoverTimer > 0) {
      this.state = 'recover';
      this.moveIntent = 1;
      return;
    }
    if (this.dodgeTimer > 0) {
      this.state = 'dodge';
      this.moveIntent = 1;
      this.aim = this.dodgeAngle;
      return;
    }

    const player = game.player;
    if (!player || !player.alive) {
      this.forgetIntel();
      this.state = 'wander';
      this.wander();
      return;
    }

    /* 恶魔难度：锁定范围约束（CONFIG.AI.demonLockRadius）。
     * 范围外：清空情报并巡逻（复用现有 forgetIntel/wander 管线）——
     * 不查询玩家实时坐标、不开全图追踪；回到范围内恢复标准感知。
     * 目标选择与炮弹碰撞过滤彻底解耦：敌方间误伤不受此影响。 */
    if (this.diff.demon) {
      const lockR = CONFIG.AI.demonLockRadius;
      if (dist(tank.x, tank.y, player.x, player.y) > lockR && !this.hasLos) {
        if (this.lastKnown || this.intelConf > 0) this.forgetIntel();
        this.state = 'wander';
        this.wander();
        return;
      }
    }

    /* ---------- 感知段 ----------
     * 这里是唯一查询玩家实时坐标的位置：判断"能否看见"。
     * 看不见时，下方所有分支只使用 lastKnown / 共享情报 / 枪声。 */
    const los = maze.losClear(tank.x, tank.y, player.x, player.y, this.losRadius);
    if (los && !this.hasLos) {
      this.losAcquiredAt = game.time;
      this.fireDelay = this.diff.reaction +
        (Math.random() < this.diff.missChance ? 0.35 + Math.random() * 0.55 : 0);
    }
    this.hasLos = los;

    if (los) {
      this.observe(player, game.time);
    } else {
      this.intelConf = this.computeIntelConf(game.time);
      this.absorbSharedIntel(game.time);
      if (this.intelConf <= AI_TACTICS.intelForgetConf) this.forgetIntel();
    }

    // 距离认知：看得见用实时距离；看不见只能估计最后已知位置的距离
    const d = los
      ? dist(tank.x, tank.y, player.x, player.y)
      : (this.lastKnown ? dist(tank.x, tank.y, this.lastKnown.x, this.lastKnown.y) : 9999);
    this.targetDist = d;

    // 主动道具（雷达 / EMP / 地雷）的使用判定
    this.useActiveItems();

    // 0) 规避即将到来的子弹（生存优先，巡逻单位也需要）
    {
      const threat = this.assessThreat();
      if (threat) this.lastThreat = { level: threat.level, at: game.time };
      const threshold = this.diff.dodgeThreshold / this.personality.dodge;
      if (threat && threat.level >= threshold && game.time - this.lastDodge > 0.30) {
        this.startDodge(threat);
        this.lastDodge = game.time;
        return;
      }
    }

    // 1) 巡逻单位：不主动追击。看见玩家（且距离不太远）才交战，
    //    否则捡道具、查枪声或巡逻，避免所有敌人一拥而上。
    if (this.role === 'patrol' && (!los || d > 470)) {
      if (!tank.powerup && this.seekPickup()) {
        this.state = 'collect';
        return;
      }
      const shot = game.lastPlayerShot;
      if (shot && game.time - shot.time < 7 &&
          dist(tank.x, tank.y, shot.x, shot.y) < 560 && !tank.powerup) {
        const path = this.getPath(shot.x, shot.y);
        if (path && path.length) {
          this.navTarget = { x: shot.x, y: shot.y };
          this.followPath(path); this.state = 'investigate'; return;
        }
      }
      this.state = 'patrol';
      this.wander();
      return;
    }

    // 2) 有视线：进入战斗（战术选择 + 瞄准 + 开火）
    if (los) {
      this.combatVisible(player, d, game.time);
      return;
    }

    // 3) 无视线：先让位给仍在有效期内的机动战术（例如正在进掩体）
    if (this.runMobileTactic(game.time)) return;

    // 4) 无视线：反弹射击（只对最后已知位置解算，绝不使用玩家实时坐标）
    this.moveIntent = 0;
    const combatIntel = !!this.lastKnown && this.intelConf >= this.diff.pursueConf;
    const lostFor = game.time - this.lastSeenAt;
    if (this.diff.bounceSkill > 0 && combatIntel && lostFor > 0.7 &&
        d < 560 &&
        game.time - this.lastBounceTry > this.diff.bounceScanInterval &&
        tank.cooldown <= 0.12) {
      this.lastBounceTry = game.time;
      if (Math.random() < this.diff.bounceSkill * this.personality.bounce) {
        const sol = this.findBounceShot(this.lastKnown);
        if (sol) {
          this.bounceSolution = sol;
          this.bounceUntil = game.time + 0.7;
        }
      }
    }
    if (this.bounceSolution && game.time < this.bounceUntil) {
      this.state = 'bounce';
      this.aim = this.bounceSolution.angle;
      this.fireAngle = this.bounceSolution.angle;
      this.wantFire = true;
      this.moveIntent = 0;
      return;
    }
    this.bounceSolution = null;

    // 5) 无视线：依据情报决定追击 / 搜索 / 放弃
    if (this.lastKnown) {
      const canPursue = this.intelConf >= this.diff.pursueConf;
      const nearKnown = dist(tank.x, tank.y, this.lastKnown.x, this.lastKnown.y) < AI_TACTICS.searchArriveDist;
      if (!this.searchQueue.length && (!canPursue || nearKnown)) {
        // 精确追击结束（已抵达或情报老化）→ 转入搜索
        this.beginSearch(game.time);
      }
      if (this.searchQueue.length || game.time < this.searchUntil) {
        this.searchStep(game.time);
        return;
      }
      if (canPursue) {
        this.state = 'pursue';
        this.pursueKnown();
        return;
      }
    }

    // 6) 情报耗尽：恢复巡逻探索
    this.forgetIntel();
    this.state = 'wander';
    this.wander();
  }

  /* ---------------- 有视线的战斗 ---------------- */

  combatVisible(player, d, now) {
    const tank = this.tank;
    this.bounceSolution = null;

    // 玩家就在眼前躲进掩体？探头重新接战
    if (this.tactic && this.tactic.holdUntil) this.tactic = null;

    const target = this.predictTarget(player, d);
    const aimAngle = Math.atan2(target.y - tank.y, target.x - tank.x) + this.aimNoise;

    if (!this.tactic || now >= this.tacticUntil || now >= this.nextTacticReview) {
      this.pickCombatTactic(player, d, now);
    }

    // 机动类战术优先执行（炮口跟随移动方向，机动时不射击）
    if (this.runMobileTactic(now)) return;

    const t = this.tactic;
    if (t && t.key === 'pause' && now < this.tacticUntil) {
      // 短暂停顿观察：保持瞄准姿态但不推进
      this.aim = aimAngle;
      this.fireAngle = aimAngle;
      this.wantFire = true;
      this.moveIntent = 0;
      this.state = 'pause';
      this.tacticGoal = null;
      return;
    }

    // 站桩交战：advance（推进）/ engage（对射）
    this.tacticGoal = null;
    const off = Math.abs(angleDiff(tank.angle, aimAngle));
    this.aim = aimAngle;
    this.fireAngle = aimAngle;
    this.wantFire = true;
    if (off > 0.5) {
      this.state = 'aim';
      this.moveIntent = 0;          // 未对准时原地转向
    } else if (d > this.idealRange + 70) {
      this.state = 'advance';
      this.moveIntent = 1;          // 已经对准，边逼近边打
    } else {
      this.state = 'engage';
      this.moveIntent = 0;
    }
  }

  /**
   * 执行机动类战术（flank / strafe / cover）。
   * 返回 true 表示本拍由战术接管移动；返回 false 表示战术结束或不适用。
   */
  runMobileTactic(now) {
    const t = this.tactic;
    if (!t || !t.goal) return false;
    if (t.key !== 'flank' && t.key !== 'strafe' && t.key !== 'cover') return false;
    const tank = this.tank;

    // 掩体驻留：已经藏好，保持隐蔽
    if (t.key === 'cover' && t.holdUntil) {
      if (now < t.holdUntil) {
        this.state = 'cover';
        this.moveIntent = 0;
        this.wantFire = false;
        this.tacticGoal = t.goal;
        return true;
      }
      this.tactic = null;         // 藏够了：探头重新评估
      this.tacticGoal = null;
      return false;
    }

    if (now >= this.tacticUntil) {
      this.tactic = null;
      this.tacticGoal = null;
      return false;
    }

    const arrived = dist(tank.x, tank.y, t.goal.x, t.goal.y) < AI_TACTICS.goalArriveDist;
    if (arrived) {
      if (t.key === 'cover') {
        if (!t.holdUntil) {
          t.holdUntil = now + AI_TACTICS.coverHoldMin +
            Math.random() * (AI_TACTICS.coverHoldMax - AI_TACTICS.coverHoldMin);
        }
        this.state = 'cover';
        this.moveIntent = 0;
        this.wantFire = false;
        this.tacticGoal = t.goal;
        return true;
      }
      this.tactic = null;         // flank / strafe 到位 → 立即重新评估
      this.tacticGoal = null;
      return false;
    }

    // 朝战术目标机动（车体即炮管，机动中无法同时对准玩家）
    this.tacticGoal = t.goal;
    this.navTarget = t.goal;
    const path = this.getPath(t.goal.x, t.goal.y);
    if (path && path.length > 1) {
      this.followPath(path);
    } else {
      this.aim = Math.atan2(t.goal.y - tank.y, t.goal.x - tank.x);
      this.moveIntent = 1;
    }
    this.wantFire = false;
    this.state = t.key;
    return true;
  }

  /**
   * 有视线时的战斗战术选择：生成候选行动并评分，带约束地引入随机性。
   * 候选：正面推进 / 原地对射 / 横向机动 / 侧翼绕行 / 寻找掩护 / 短暂停顿。
   */
  pickCombatTactic(player, d, now) {
    const tank = this.tank;
    const pers = this.personality;
    const diff = this.diff;
    const closeRange = d < this.idealRange + 60;
    const cands = [];

    // —— 站桩类候选（无需选点） ——
    cands.push({
      key: 'advance',
      until: now + 1.2 + Math.random() * 1.6,
      score: (d > this.idealRange + 70 ? 1.0 : 0.30) * pers.advance
    });
    cands.push({
      key: 'engage',
      until: now + 1.0 + Math.random() * 1.4,
      score: 0.55 + 0.55 * (1 - Math.min(1, Math.abs(d - this.idealRange) / 300))
    });
    cands.push({
      key: 'pause',
      until: now + AI_TACTICS.pauseTimeMin +
        Math.random() * (AI_TACTICS.pauseTimeMax - AI_TACTICS.pauseTimeMin),
      score: (tank.cooldown > 1.0 ? 0.75 : 0.22) * pers.hold
    });

    // —— 机动类候选（需要生成目标点，生成失败则弃权） ——
    if (d >= AI_TACTICS.flankMinDist) {
      const flankGoal = this.pickFlankPoint(player);
      if (flankGoal) {
        cands.push({
          key: 'flank', goal: flankGoal,
          until: now + 2.2 + Math.random() * 2.0,
          score: (0.45 + 0.40 * Math.min(1, d / 420)) * diff.flankSkill * pers.flank
        });
      }
    }
    const strafeGoal = this.pickStrafePoint(player);
    if (strafeGoal) {
      cands.push({
        key: 'strafe', goal: strafeGoal,
        until: now + AI_TACTICS.strafeTimeMin +
          Math.random() * (AI_TACTICS.strafeTimeMax - AI_TACTICS.strafeTimeMin),
        score: (closeRange ? 1.0 : 0.50) * pers.strafe * (0.4 + 0.6 * diff.flankSkill)
      });
    }
    const threatFresh = this.lastThreat && now - this.lastThreat.at < 1.5;
    const coverGoal = this.pickCoverPoint(player);
    if (coverGoal) {
      cands.push({
        key: 'cover', goal: coverGoal,
        until: now + 2.5 + Math.random() * 1.5,
        score: (threatFresh ? 1.10 : 0.18) * pers.cover
      });
    }

    // —— 评分修正：队友避让 / 路线重复 / 随机扰动 ——
    for (const c of cands) {
      if (c.goal) {
        c.score -= this.mateCrowding(c.goal) * diff.coordination;
        c.routeKey = this.routeKeyOf(c.goal, player);
        if (c.routeKey && c.routeKey === this.lastRouteKey) c.score -= 0.35;
      }
      c.score *= 0.8 + Math.random() * 0.45;
    }

    cands.sort((a, b) => b.score - a.score);
    const best = cands[0] || { key: 'advance', until: now + 1.5 };
    this.tactic = best;
    this.tacticUntil = best.until;
    // 站桩战术按难度节奏重评；机动战术完成后才重评（避免半途反复改道）
    this.nextTacticReview = best.goal
      ? best.until
      : Math.min(best.until, now + diff.tacticInterval * (0.85 + Math.random() * 0.5));
    if (best.routeKey) this.lastRouteKey = best.routeKey;
  }

  /** 其他队友是否已经占用某个目标点附近（返回惩罚量） */
  mateCrowding(goal) {
    let pen = 0;
    const list = this.game.aiControllers;
    for (let i = 0; i < list.length; i++) {
      const other = list[i];
      if (other === this || !other.tank || !other.tank.alive) continue;
      const g = other.tacticGoal || other.navTarget || other.searchGoal ||
        (other.tactic && other.tactic.goal);
      if (g && dist(goal.x, goal.y, g.x, g.y) < AI_TACTICS.mateOverlapDist) {
        pen += AI_TACTICS.mateOverlapPenalty;
      }
    }
    return pen;
  }

  /** 路线标识：目标点相对玩家的方位角量化（用于避免重复同一条路线） */
  routeKeyOf(goal, player) {
    const a = Math.atan2(goal.y - player.y, goal.x - player.x);
    return 'r' + Math.round(a / (Math.PI / 6));
  }

  /** 把任意点吸附到可站立位置（世界内），失败返回 null */
  navSnap(x, y) {
    const maze = this.game.maze;
    const r = this.tank.radius;
    x = clamp(x, r + 4, maze.width - r - 4);
    y = clamp(y, r + 4, maze.height - r - 4);
    if (maze.isFree(x, y, r)) return { x, y };
    const idx = maze.nearestFree(maze.navIndexOf(x, y), 6);
    return idx >= 0 ? maze.navCenter(idx) : null;
  }

  /**
   * 侧翼点：以玩家为圆心、自身视线方向 ±0.85~2.3 弧度处采样。
   * 评分偏向"更偏侧"且"到位后有射击线"的点。
   * （仅在当前看得见玩家时调用，因此查询玩家实时坐标是合法的）
   */
  pickFlankPoint(player) {
    const tank = this.tank;
    const maze = this.game.maze;
    const base = Math.atan2(player.y - tank.y, player.x - tank.x);
    const r0 = this.idealRange + 30;
    const r1 = this.idealRange + AI_TACTICS.flankRadiusPad;
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < AI_TACTICS.flankCandidates; i++) {
      const side = (i % 2 === 0) ? 1 : -1;
      const off = side * (AI_TACTICS.flankMinOffset +
        Math.random() * (AI_TACTICS.flankMaxOffset - AI_TACTICS.flankMinOffset));
      const r = r0 + Math.random() * (r1 - r0);
      const p = this.navSnap(player.x + Math.cos(base + off) * r,
                             player.y + Math.sin(base + off) * r);
      if (!p) continue;
      let s = 0.5 * (Math.abs(off) / AI_TACTICS.flankMaxOffset);   // 越偏越是"侧翼"
      s -= dist(tank.x, tank.y, p.x, p.y) * 0.0018;                // 太远不划算
      if (maze.losClear(p.x, p.y, player.x, player.y, this.losRadius)) s += 0.45;
      if (s > bestScore) { bestScore = s; best = p; }
    }
    return best;
  }

  /** 横向机动点：垂直于视线方向的短距离移动，用于改变射击角度 */
  pickStrafePoint(player) {
    const tank = this.tank;
    const maze = this.game.maze;
    const losA = Math.atan2(player.y - tank.y, player.x - tank.x);
    for (let i = 0; i < 4; i++) {
      const side = (i % 2 === 0) ? 1 : -1;
      const a = losA + side * Math.PI / 2;
      const r = AI_TACTICS.strafeDistMin + Math.random() * (AI_TACTICS.strafeDistMax - AI_TACTICS.strafeDistMin);
      const p = this.navSnap(tank.x + Math.cos(a) * r, tank.y + Math.sin(a) * r);
      if (!p) continue;
      if (dist(tank.x, tank.y, p.x, p.y) < 45) continue;
      if (dist(p.x, p.y, player.x, player.y) < AI_TACTICS.strafeKeepOff) continue;
      if (!maze.walkableLine(tank.x, tank.y, p.x, p.y, tank.radius)) continue;
      return p;
    }
    return null;
  }

  /** 掩体点：附近一个能真正挡住"点→玩家"视线的位置 */
  pickCoverPoint(player) {
    const tank = this.tank;
    const maze = this.game.maze;
    let best = null, bestScore = Infinity;
    for (let i = 0; i < AI_TACTICS.coverCandidates; i++) {
      const a = (i / AI_TACTICS.coverCandidates) * TAU + Math.random() * 0.5;
      const r = AI_TACTICS.coverDistMin + Math.random() * (AI_TACTICS.coverDistMax - AI_TACTICS.coverDistMin);
      const p = this.navSnap(tank.x + Math.cos(a) * r, tank.y + Math.sin(a) * r);
      if (!p) continue;
      const dd = dist(tank.x, tank.y, p.x, p.y);
      if (dd < 40) continue;
      if (maze.losClear(p.x, p.y, player.x, player.y, this.losRadius)) continue; // 必须真的挡视线
      if (dd < bestScore) { bestScore = dd; best = p; }
    }
    return best;
  }

  /* ---------------- 射击 ---------------- */

  tryFire() {
    const tank = this.tank, game = this.game;
    // 连射门控（AI 的 wantFire 自然脉冲即"松开再按"，满足轮末释放要求）
    const gate = tank.updateFireGate(this.wantFire && tank.alive);
    if (!this.wantFire || !tank.alive) return;
    if (!gate) return;
    if (Math.abs(angleDiff(tank.angle, this.fireAngle)) > this.diff.fireTolerance) return;
    if (this.hasLos && game.time - this.losAcquiredAt < this.fireDelay) return;

    const shots = tank.fire(game);
    if (shots && shots.length) {
      for (let i = 0; i < shots.length; i++) game.bullets.push(shots[i]);
      this.wantFire = false;
    }
  }

  /* ---------------- 感知（威胁） ---------------- */

  assessThreat() {
    const tank = this.tank;
    const game = this.game;
    const horizon = 0.85;
    let best = null;

    for (let i = 0; i < game.bullets.length; i++) {
      const b = game.bullets[i];
      if (b.dead) continue;
      if (b.ownerId === tank.id) continue;          // 自己的子弹不会伤害自己
      if (b.age < this.diff.dodgeDelay) continue;   // 反应延迟

      const maxB = (b.maxBounces || CONFIG.BULLET.maxBounces) - b.bounces;
      const pts = Bullet.predictPath(
        game.maze, b.x, b.y, b.dx, b.dy, b.speed, maxB, horizon
      );
      const t = polylineApproachTime(pts, tank.x, tank.y, tank.radius + b.radius + 6);
      if (t === null || t > horizon) continue;

      const level = 1 - t / horizon;
      if (!best || level > best.level) best = { level, time: t, bullet: b, points: pts };
    }
    return best;
  }

  startDodge(threat) {
    const dir = this.chooseEscapeDir(threat);
    this.dodgeAngle = dir;
    this.aim = dir;
    this.moveIntent = 1;
    this.wantFire = false;
    this.dodgeTimer = this.diff.dodgeDuration;
    this.state = 'dodge';
  }

  chooseEscapeDir(threat) {
    const tank = this.tank;
    const maze = this.game.maze;
    let bestDir = tank.angle, bestScore = -Infinity;
    const speed = tank.maxSpeed;

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const dx = Math.cos(a), dy = Math.sin(a);
      const hit = maze.raycast(tank.x, tank.y, dx, dy, 140, tank.radius + 1);
      const free = hit ? hit.t : 140;
      if (free < 28) continue;

      let worst = 999;
      for (let k = 1; k <= 4; k++) {
        const t = k * 0.12;
        const travel = Math.min(free, speed * t);
        const px = tank.x + dx * travel;
        const py = tank.y + dy * travel;
        const bp = pointOnPolyline(threat.points, t);
        if (bp) worst = Math.min(worst, dist(px, py, bp.x, bp.y));
      }
      // 略微偏好可以跑得更远的方向
      const score = worst + Math.min(free, 140) * 0.06;
      if (score > bestScore) { bestScore = score; bestDir = a; }
    }
    return bestDir;
  }

  /* ---------------- 弹道 ---------------- */

  /**
   * 弹道飞行时间预判。仅在看得见玩家时调用（LOS 成立）。
   */
  predictTarget(player, d) {
    const lead = this.diff.leadFactor;
    if (lead <= 0) return { x: player.x, y: player.y };
    const travel = (d / CONFIG.BULLET.speed) * lead;
    return {
      x: player.x + Math.cos(player.angle) * player.speed * travel,
      y: player.y + Math.sin(player.angle) * player.speed * travel
    };
  }

  /**
   * 反弹射击搜索：从炮口按候选角度模拟真实弹道，
   * 找出能命中目标点的射线（至少经过一次反弹）。
   * @param {{x:number,y:number}} point 目标点。
   *   有视线时是玩家当前位置；无视线时必须是 lastKnown（最后已知位置）。
   */
  findBounceShot(point) {
    const tank = this.tank;
    const maze = this.game.maze;
    const m = tank.muzzlePoint();
    const hitR = CONFIG.TANK.radius + CONFIG.BULLET.radius + 4;
    let best = null;

    const SAMPLES = 56;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * TAU;
      // 只考虑当前朝向 100 度以内的射线，避免转身太久
      if (Math.abs(angleDiff(tank.angle, a)) > 1.75) continue;

      const dx = Math.cos(a), dy = Math.sin(a);
      const pts = Bullet.predictPath(maze, m.x, m.y, dx, dy, CONFIG.BULLET.speed, CONFIG.BULLET.maxBounces, 1.5);
      if (pts.length < 3) continue;     // 没有发生反弹

      const tHit = polylineApproachTime(pts, point.x, point.y, hitR);
      if (tHit === null) continue;

      // 自我危险：弹道（离开炮口圈之后）会回到自己身上则放弃。
      // 炮口本身距车体中心 muzzleOffset(24px) < 自检半径(25.6px)，
      // 因此必须从 0.05s（子弹已飞出 21.5px）起评估，否则所有解都会被误杀。
      const selfHit = polylineApproachTime(pts, tank.x, tank.y,
        tank.radius + CONFIG.BULLET.radius + 6, 0.05);
      if (selfHit !== null && selfHit < tHit + 0.12) continue;

      const score = tHit + (pts.length - 2) * 0.10;
      if (!best || score < best.score) best = { angle: a, score, time: tHit };
    }
    return best;
  }

  /* ---------------- 搜索（失去视线后） ---------------- */

  /** 开始一轮搜索：最后已知位置 → 周边候选点 */
  beginSearch(now) {
    this.searchQueue = this.buildSearchPoints(now);
    this.searchUntil = now + this.diff.searchDuration;
    this.searchWatchUntil = 0;
    this.searchAmbush = Math.random() < this.diff.ambushSkill * this.personality.ambush;
    // 立即登记首个目标，让同帧稍后决策的队友能够避让
    this.searchGoal = this.searchQueue.length ? this.searchQueue[0] : null;
  }

  /**
   * 生成搜索候选点：先回到最后已知位置，再检查周边环形区域。
   * 评分考虑距离、随机扰动与队友占用，避免所有敌人搜同一个点。
   */
  buildSearchPoints(now) {
    const tank = this.tank;
    const base = this.lastKnown;
    const pts = [];
    if (!base) return pts;
    pts.push({ x: base.x, y: base.y });   // 第一站：先回去看一眼

    const cand = [];
    for (let i = 0; i < AI_TACTICS.searchSampleCap * 2 && cand.length < AI_TACTICS.searchSampleCap; i++) {
      const a = Math.random() * TAU;
      const r = AI_TACTICS.searchRingMin + Math.random() * (AI_TACTICS.searchRingMax - AI_TACTICS.searchRingMin);
      const p = this.navSnap(base.x + Math.cos(a) * r, base.y + Math.sin(a) * r);
      if (!p) continue;
      cand.push(p);
    }

    const scored = [];
    for (let i = 0; i < cand.length; i++) {
      const p = cand[i];
      let s = -dist(tank.x, tank.y, p.x, p.y) * 0.004;   // 近者优先
      s += Math.random() * 0.45;                          // 搜索路线保持随机变化
      // 避免与队友的搜索目标/已排队点重复
      const list = this.game.aiControllers;
      for (let j = 0; j < list.length; j++) {
        const other = list[j];
        if (other === this || !other.tank || !other.tank.alive) continue;
        let crowded = false;
        const g = other.searchGoal || other.navTarget;
        if (g && dist(p.x, p.y, g.x, g.y) < AI_TACTICS.mateOverlapDist) crowded = true;
        if (!crowded && other.searchQueue) {
          for (let k = 0; k < other.searchQueue.length && k < 4; k++) {
            if (dist(p.x, p.y, other.searchQueue[k].x, other.searchQueue[k].y) < AI_TACTICS.mateOverlapDist) {
              crowded = true; break;
            }
          }
        }
        if (crowded) s -= AI_TACTICS.mateOverlapPenalty * this.diff.coordination;
        // 别扎堆检查同一个记忆点
        if (other.intelSource === 'share' && other.lastKnown &&
            dist(p.x, p.y, other.lastKnown.x, other.lastKnown.y) < 60) {
          s -= 0.30;
        }
      }
      scored.push({ p, s });
    }
    scored.sort((a, b) => b.s - a.s);

    for (let i = 0; i < scored.length && pts.length < Math.max(1, this.diff.searchMaxPoints); i++) {
      pts.push(scored[i].p);
    }
    return pts;
  }

  /** 搜索推进：逐个候选点前往 + 驻留观察 */
  searchStep(now) {
    const tank = this.tank;

    if (!this.searchQueue.length || now >= this.searchUntil) {
      // 搜索结束：放弃过时目标，恢复巡逻
      this.forgetIntel();
      this.state = 'wander';
      this.wander();
      return;
    }

    const goal = this.searchQueue[0];
    this.searchGoal = goal;
    this.navTarget = goal;
    const dd = dist(tank.x, tank.y, goal.x, goal.y);

    if (dd < AI_TACTICS.goalArriveDist) {
      // 抵达候选点：驻留观察（扫视四周），然后换下一个点
      if (now < this.searchWatchUntil) {
        this.state = this.searchAmbush ? 'ambush' : 'search';
        this.moveIntent = 0;
        this.aim = this.searchWatchAim;
        return;
      }
      this.searchQueue.shift();
      const first = this.searchAmbush && this.searchQueue.length === this.diff.searchMaxPoints - 1;
      const watch = first
        ? AI_TACTICS.ambushWatchTime
        : AI_TACTICS.watchTimeMin + Math.random() * (AI_TACTICS.watchTimeMax - AI_TACTICS.watchTimeMin);
      this.searchWatchUntil = now + watch;
      this.searchWatchAim = normalizeAngle(tank.angle + (Math.random() - 0.5) * 2.4);
      this.moveIntent = 0;
      return;
    }

    const path = this.getPath(goal.x, goal.y);
    if (path && path.length) {
      this.followPath(path);
      this.state = 'search';
      return;
    }
    // 走不通的候选点直接丢弃
    this.searchQueue.shift();
    this.searchWatchUntil = 0;
  }

  /* ---------------- 导航 ---------------- */

  getPath(tx, ty) {
    const now = this.game.time;
    const moved = !this.pathGoal || dist(tx, ty, this.pathGoal.x, this.pathGoal.y) > 40;
    if (this.path && !moved && now - this.pathTime < 0.9) return this.path;
    this.pathTime = now;
    this.pathGoal = { x: tx, y: ty };
    this.path = this.game.maze.findPath(this.tank.x, this.tank.y, tx, ty);
    return this.path;
  }

  /** 沿路径前进，自动拉直（取最远的可直达路点） */
  followPath(path) {
    const tank = this.tank;
    const maze = this.game.maze;
    if (!path || !path.length) { this.moveIntent = 0; return; }

    let target = null;
    for (let i = path.length - 1; i >= 0; i--) {
      const p = path[i];
      if (dist(tank.x, tank.y, p.x, p.y) < 12) continue;
      if (maze.walkableLine(tank.x, tank.y, p.x, p.y, tank.radius)) { target = p; break; }
    }
    if (!target) target = path[path.length - 1];
    if (dist(tank.x, tank.y, target.x, target.y) < 8) { this.moveIntent = 0; return; }

    this.aim = Math.atan2(target.y - tank.y, target.x - tank.x);
    this.moveIntent = 1;
  }

  /**
   * 精确追击：前往最后已知位置（绝不是玩家实时位置）。
   * 抵达后由 think() 转入搜索。
   */
  pursueKnown() {
    const goal = this.lastKnown;
    const path = this.getPath(goal.x, goal.y);
    this.navTarget = goal;
    if (path && path.length > 1) {
      this.followPath(path);
    } else {
      this.wander();
    }
  }

  wander() {
    const tank = this.tank;
    if (!this.wanderGoal || dist(tank.x, tank.y, this.wanderGoal.x, this.wanderGoal.y) < 70) {
      this.wanderGoal = this.pickExplorePoint();
      this.path = null;
    }
    if (!this.wanderGoal) { this.moveIntent = 0; return; }
    this.navTarget = this.wanderGoal;
    const path = this.getPath(this.wanderGoal.x, this.wanderGoal.y);
    if (path && path.length) {
      this.followPath(path);
    } else {
      this.moveIntent = 1;
      this.aim = normalizeAngle(tank.angle + (Math.random() - 0.5) * 0.8);
    }
  }

  pickExplorePoint() {
    const maze = this.game.maze;
    const tank = this.tank;
    for (let i = 0; i < 30; i++) {
      const idx = Math.floor(Math.random() * maze.navFree.length);
      if (!maze.navFree[idx]) continue;
      const p = maze.navCenter(idx);
      if (dist(tank.x, tank.y, p.x, p.y) < 220) continue;
      return p;
    }
    return null;
  }

  /** 前往附近的道具（没有道具且距离允许时） */
  seekPickup() {
    const pk = this.game.nearestPickup(this.tank.x, this.tank.y, this.personality.collectRange);
    if (!pk) return false;
    const path = this.getPath(pk.x, pk.y);
    if (path && path.length) {
      this.navTarget = { x: pk.x, y: pk.y };
      this.followPath(path);
      return true;
    }
    return false;
  }

  /** 脱困：评估 16 个方向的可用空间，选最大且较优的方向退出。
   *  偏向"当前行动目标"（navTarget），不再偏向玩家的实时坐标。 */
  escape() {
    const tank = this.tank;
    const maze = this.game.maze;
    let bestA = tank.angle, bestScore = -Infinity;

    const goal = this.navTarget || this.lastKnown || this.wanderGoal || this.tacticGoal;
    const goalAngle = goal ? Math.atan2(goal.y - tank.y, goal.x - tank.x) : null;

    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      const hit = maze.raycast(tank.x, tank.y, Math.cos(a), Math.sin(a), 160, tank.radius + 1);
      const free = hit ? hit.t : 160;
      let score = free;
      if (goalAngle !== null) {
        // 优先朝行动目标方向脱困
        const towards = Math.abs(angleDiff(a, goalAngle));
        score += (Math.PI - towards) * 12;
      }
      if (score > bestScore) { bestScore = score; bestA = a; }
    }

    this.aim = bestA;
    this.moveIntent = 1;
    this.wantFire = false;
    this.recoverTimer = 0.55;
    this.stuckTime = 0;
    this.path = null;
    this.wanderGoal = null;
    this.tactic = null;
    this.tacticGoal = null;
    this.state = 'recover';
  }
}
