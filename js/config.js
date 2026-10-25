'use strict';
/* =========================================================
 * 坦克动荡：本地版 - 全局配置
 * 所有可调参数集中在此，避免散落在各个模块中。
 * ========================================================= */

const CONFIG = {
  /* 逻辑分辨率（游戏世界坐标） */
  WIDTH: 960,
  HEIGHT: 640,

  /* 固定步长物理，保证不同帧率下行为一致 */
  FIXED_DT: 1 / 60,
  MAX_FRAME_DT: 0.1,
  MAX_SUBSTEPS: 8,

  /* 迷宫相关 */
  MAZE: {
    cols: 12,
    rows: 8,
    wallThickness: 9,
    gridSize: 40,   // 墙体空间哈希单元
    navCell: 16     // AI 寻路网格单元
  },

  /* 动态地图规模（MapSize.compute 使用，见 js/mapsize.js）
   * WIDTH/HEIGHT 同时充当"基准视口"：无 window 的测试环境
   * 以此为视口，此时所有地图还原预设基础尺寸。 */
  MAP_SIZE: {
    small: {
      maxExtraCols: 12,    // 小地图列数最多在基础上增加 12 列
      maxExtraRows: 8,     // 行数最多增加 8 行
      shrinkCols: 3,       // 窄窗口下最多收缩 3 列
      shrinkRows: 2,
      cellMinScale: 0.82,  // 格子尺寸允许的缩放范围（×基础格子）
      cellMaxScale: 1.32,  // 上限收紧：大屏优先扩真实网格，而不是放大格子
      step: 2              // 行列数增长步进（防视口轻微变化引起跳变）
    },
    big: {
      expand: 1.55,        // 大地图目标世界 = 视口 × 1.55（保证摄像机可滚动）
      maxCols: 40,         // 网格规模上限（40×26×80px ≈ 3200×2080 世界）
      maxRows: 26,
      step: 2
    },
    /* HUD 安全内缩（等距阶段预留）：计算地图规模时从视口扣除的
     * 独占 UI 空间。当前 HUD 为半透明淡出覆盖层，不占用独占空间，
     * 故默认为 0；若未来 HUD 改为常驻实体面板，可在此设置。 */
    hudInset: { top: 0, right: 0, bottom: 0, left: 0 }
  },

  /* 坦克物理参数 */
  TANK: {
    radius: 16,             // 碰撞圆半径（与绘制尺寸一致）
    hullLength: 26,         // 车体前后长度
    hullWidth: 20,          // 车体宽度（不含履带）
    treadWidth: 7,          // 履带宽度
    treadOffset: 6.5,       // 履带内侧距中心线距离
    barrelLength: 15,       // 炮管长度
    barrelWidth: 6,         // 炮管宽度
    muzzleOffset: 24,       // 子弹生成点距坦克中心距离
    playerSpeed: 210,       // 玩家最大移动速度 (px/s)
    playerTurnSpeed: 11.0,  // 玩家转向角速度 (rad/s)
    enemySpeed: 170,
    enemyTurnSpeed: 8.2,
    turnSlowdown: 0.12,     // 转向过程中的速度衰减（越大转向越先停）
    collisionIterations: 2
  },

  /* 鼠标双模式控制 */
  MOUSE: {
    aimRadius: 80,      // 隐形判定圆半径 R
    hysteresis: 8,      // 模式切换滞回量（R+8 才切回移动）
    minAimDistance: 6   // 距离过近时保留原朝向
  },

  /* 子弹 */
  BULLET: {
    speed: 430,
    radius: 3.6,
    maxBounces: 3,        // 最大反弹次数
    maxAge: 6,            // 最长存活时间（秒）
    substep: 5,           // 单次碰撞检测最大位移，防止穿透薄墙
    playerCooldown: 0.26, // 玩家射击冷却（秒，普通炮弹的自身节奏下限）
    trailPoints: 16
  },

  /* 连射机制（普通炮弹；按实际时间计，单位秒）
   * 连射过载生效时优先适用其行；强化反弹只提升单轮上限（反弹强化照旧） */
  FIRE: {
    burst: 5,             // 普通状态单轮连射上限
    burstBouncer: 6,      // 强化反弹生效时单轮上限
    burstRapid: 10,       // 连射过载生效时单轮上限
    interval: 0.45,       // 相邻两发最小发射间隔（普通/强化反弹）
    intervalRapid: 0.15,  // 连射过载时间隔
    cooldownBurst: 1.2,   // 单轮结束后的冷却（普通/强化反弹）
    cooldownBurstRapid: 0.3 // 连射过载时轮末冷却
  },

  /* 比赛规则 */
  RULES: {
    scorePerKill: 100,
    victoryBonus: 300,
    maxEnemiesSmall: 5,   // 标准地图敌人上限
    maxEnemiesBig: 7,     // 大地图敌人上限
    endDelay: 1.5,        // 胜负判定后延迟展示结算
    playerLives: 3,       // 默认生命数（主菜单可调 1/3/5）
    respawnDelay: 1.4,    // 被击毁后复活等待（秒）
    respawnInvuln: 2.2,   // 复活后的无敌时间（秒）
    hunterMaxNormal: 2,   // 同时主动追击的 AI 上限（简单/普通）
    hunterMaxHard: 3,     // 困难难度同时追击上限
    spawnIntel: true      // 开局侦察：敌人获知玩家出生区域（静态情报，带时间戳并随难度衰减）
  },

  /* 道具 */
  PICKUPS: {
    radius: 13,           // 拾取判定半径
    respawnDelay: 15,     // 被拾取后多久刷新（秒）
    laserShots: 8,        // 激光炮可用次数
    laserCooldown: 0.55,  // 激光射击间隔
    laserMaxBounces: 3,   // 激光最大折射次数
    laserRange: 1150,     // 激光最长射程
    laserLife: 0.32,      // 激光光束残留时间
    clusterFuse: 0.85,    // 散裂弹引信（到达即爆炸分裂）
    clusterFragments: 6,  // 分裂出的碎片数
    clusterFragSpeed: 300,
    clusterFragLife: 0.9,
    tripleSpread: 0.20,   // 三连发扇形角（弧度）
    tripleCooldown: 0.34,
    shieldTime: 5,        // 护盾持续时间
    speedTime: 8,         // 超载引擎持续时间
    speedMult: 1.45,
    turnMult: 1.30,

    /* ---- 刷新系统：按地图规模与区域分布 ---- */
    targets: {
      small: { initial: 5, min: 4, max: 6, respawn: 5.5 },   // 标准图
      big:   { initial: 9, min: 7, max: 11, respawn: 5.0 }   // 大地图（按面积再放大）
    },
    areaScale: 0.55,        // 超出标准视口的面积每多 1 倍，目标数量额外 +55%
    clusterMin: 1,          // 簇内道具数下限
    clusterMax: 2,          // 簇内道具数上限（开局簇可到 3）
    clusterSpacingMin: 46,  // 簇内间距
    clusterSpacingMax: 78,
    regionSize: 460,        // 道具区域划分尺寸（世界像素）
    maxAge: 70,             // 道具最长存活时间（存量富余时转移位置）
    minTankDist: 110,       // 与坦克的最小生成距离
    minSpawnDist: 120,      // 与出生点的最小生成距离
    minPickupDist: 44,      // 道具之间的最小间距（簇内 46~78，仅防重叠）
    recentMemory: 4,        // 防重复记忆长度
    recentWeight: 0.35,     // 最近出现过的类型权重倍率

    /* ---- 新道具参数 ---- */
    rapidTime: 6,             // 连射过载持续时间
    rapidCooldownMult: 0.55,  // 开火冷却倍率
    minCooldown: 0.16,        // 冷却下限（防止无限射速）
    bouncerShots: 6,          // 强化反弹弹药发数
    bouncerExtraBounces: 2,   // 额外反弹次数
    empCharges: 2,            // EMP 使用次数
    empRadius: 190,           // EMP 作用半径
    empDuration: 0.9,         // 敌人受干扰时长
    empCooldown: 1.4,         // EMP 使用间隔
    mineCharges: 3,           // 地雷数量
    mineCooldown: 1.0,        // 布设间隔
    mineTriggerRadius: 24,    // 触发半径
    mineBlastRadius: 78,      // 爆炸半径
    mineArmTime: 0.7,         // 布设后的起爆延迟
    mineLife: 26,             // 地雷存活时间
    radarTime: 6,             // 雷达扫描持续时间
    radarRadius: 520          // 雷达探测半径
  },

  /* 等距伪 3D 渲染（原型阶段：仅对 ISO.maps 中的地图启用）
   * 世界坐标/碰撞/AI 完全不变；等距只是视图层：
   * - 地面与实体经仿射变换投影（圆→椭圆=地面透视，位置精确）；
   * - 墙体手工绘制 顶面+两个可见侧面 的盒体，按世界 x+y 深度排序；
   * - 投影参数集中在此，屏幕输入经逆投影回世界坐标。 */
  ISO: {
    enabled: true,
    maps: 'all',            // 全部地图启用等距渲染（'all' 或 id 数组）
    heightK: 0.38,          // 墙体高度 = min(cellW, cellH) × heightK（世界像素）
                            // 压低墙高以减少走廊遮挡（等效更俯视的观感）
    elev: 1.0,              // 高度到屏幕纵轴的换算系数
    zoomRefW: 1700,         // 缩放基准：u = clamp(min(vw/refW, vh/refH), min, max)
    zoomRefH: 1050,
    zoomMin: 0.62,
    zoomMax: 1.15,
    fitMin: 0.45,           // 小地图整图适配的缩放下限（极小窗口保底可读）
    shadowK: 0.45,          // 墙体阴影偏移 = 高度 × shadowK
    ghostAlpha: 0.42        // 遮挡坦克的墙体段透明度（遮挡感知半透明）
  },

  /* 配色：冰封峡谷战场 + 全息指挥终端
   * COLORS —— 战场世界内使用的颜色（地面/墙体/坦克队伍色）
   * THEME  —— 画布 HUD 与界面组件使用的语义化颜色 token（与 style.css
   *           的 CSS 变量保持同一套色板，新增界面颜色请两边同步） */
  COLORS: {
    bg: '#0A1A28',                       // 冰封峡谷：深蓝黑冰面
    wall: '#2E5A76',                     // 冷色冰墙主体
    wallEdge: 'rgba(158,216,240,0.30)',  // 冰棱顶部高光
    tanks: {
      green:  { body: '#43B02A', light: '#79D45E', dark: '#26671A', outline: '#143A0E', tread: '#1F5215', barrel: '#2C7A1B' },
      red:    { body: '#D0392F', light: '#F47067', dark: '#7C1A13', outline: '#450D09', tread: '#6A150F', barrel: '#A22A21' },
      blue:   { body: '#2F5FD0', light: '#6E9BF5', dark: '#17347C', outline: '#0A1A45', tread: '#142C6A', barrel: '#2449A2' },
      orange: { body: '#E08A20', light: '#FFC069', dark: '#8A4D08', outline: '#4A2703', tread: '#7A4408', barrel: '#B66C12' },
      purple: { body: '#A247C9', light: '#D08CEB', dark: '#5B1F79', outline: '#300F42', tread: '#4E1A67', barrel: '#7C2FA2' },
      teal:   { body: '#18A99B', light: '#6FD9CF', dark: '#0C5F58', outline: '#053331', tread: '#0B544E', barrel: '#128579' },
      pink:   { body: '#D4569B', light: '#F19CC6', dark: '#832B58', outline: '#4B1431', tread: '#742551', barrel: '#B0457F' },
      gold:   { body: '#C9A227', light: '#EDD365', dark: '#7A6110', outline: '#40330A', tread: '#6B560F', barrel: '#A5851D' }
    }
  },

  /* 全息指挥终端主题 token（与 style.css :root 变量同源） */
  THEME: {
    bgDeep: '#07111B',                    // 深蓝黑背景
    bgPanel: '#102638',                   // 面板底
    hudPanel: 'rgba(12, 27, 41, 0.86)',   // 画布 HUD 面板（半透明）
    hudBorder: 'rgba(29, 82, 106, 0.85)', // 面板边框
    accentLine: 'rgba(56, 216, 245, 0.55)',// 面板青色装饰线
    cyan: '#38D8F5',                      // 青蓝高亮
    text: '#E4F3FA',                      // 主文字
    textDim: '#91B2C3',                   // 次级文字
    textFaint: 'rgba(145, 178, 195, 0.55)',// 弱化文字
    orange: '#FF9D45',                    // 警示橙（重要操作/警告）
    lifeChip: '#58C93E',                  // 生命方块（玩家绿提亮）
    groundGrid: 'rgba(80, 170, 210, 0.06)',// 冰面网格线
    minimapWall: 'rgba(126, 180, 208, 0.60)',
    thumbBg: '#0C1B29',                   // 地图缩略图底
    thumbWall: '#7FC6E4',                 // 缩略图墙体
    thumbBorder: '#1D526A',
    /* 等距冰封峡谷材质（与 CSS 变量无对应，仅画布使用） */
    iso: {
      ground: '#0C2135',                  // 冰面基底
      groundAlt: 'rgba(127, 184, 216, 0.05)',  // 棋盘微差
      groundGrid: 'rgba(80, 170, 210, 0.10)',  // 冰面网格
      groundCrack: 'rgba(150, 200, 225, 0.12)',// 地面冰裂纹
      ambient: 'rgba(110, 200, 245, 0.10)',    // 蓝色环境光
      iceTop: '#7FB8D8',                  // 冰墙顶面
      iceSideR: '#2E5A76',                // 冰墙右侧面（背光）
      iceSideL: '#49799B',                // 冰墙左侧面（受光）
      iceEdge: 'rgba(205, 236, 250, 0.45)',    // 冰棱棱线
      iceCrack: 'rgba(225, 245, 255, 0.30)',   // 冰墙顶面裂纹
      metalTop: '#1C3648',                // 金属隔断顶面
      metalSideR: '#0B1922',
      metalSideL: '#122433',
      metalEdge: 'rgba(120, 160, 190, 0.35)',
      orange: '#FF9D45',                  // 隔断橙色警示标识
      orangeGlow: 'rgba(255, 157, 69, 0.28)',
      shadow: 'rgba(3, 10, 16, 0.35)',    // 墙体落影
      tankShadow: 'rgba(3, 10, 16, 0.30)' // 坦克落影
    }
  }
};

/* 预设地图定义（同一个 seed 总是生成同一张地图）
 *
 * layout 是真正决定拓扑结构的生成器：
 *   maze      递归回溯迷宫（纯走廊）
 *   arena     中央开放竞技场 + 外围环形走廊 + 四向闸门
 *   ring      多层同心环廊 + 放射连接
 *   twoZone   两个大房间 + 三条不同长度的连接通道
 *   cross     十字大道 + 四角迷宫区
 *   grid      城市街区（长直街道 + 街区庭院）
 *   hub       中央枢纽广场 + 四向辐条 + 外围环廊
 *   rooms     BSP 多房间战区（门洞相连）
 *   labyrinth 迷宫骨架 + 环形回路 + 多个房间
 *
 * cols/rows/width/height 是"基础规模"：实际对局由 MapSize.compute
 * 根据当前视口动态扩展（更大的屏幕 → 更大的战场），
 * 基础尺寸同时决定格子大小与布局比例，生成器按行列数自适应。 */
const MAP_PRESETS = [
  /* ---------- 小地图（快速遭遇 / 紧凑交战） ---------- */
  {
    id: 'classic', name: '经典迷宫', size: 'small', layout: 'maze',
    seed: 'tank-classic-01', cols: 12, rows: 8, width: 960, height: 640,
    braid: 0.16, rooms: 2,
    tagline: '均匀迷宫 · 转角遭遇',
    tactics: '短兵相接，利用拐角走位与反弹射击；房间是临时掩体。'
  },
  {
    id: 'open', name: '开阔战场', size: 'small', layout: 'arena',
    seed: 'tank-open-77', cols: 12, rows: 8, width: 960, height: 640,
    tagline: '中央竞技场 · 环形外廊',
    tactics: '中央开阔区适合对射与机动，外围环廊可以绕后；四向闸门是争夺焦点。'
  },
  {
    id: 'corridor', name: '曲折回廊', size: 'small', layout: 'maze',
    seed: 'tank-corridor-42', cols: 14, rows: 9, width: 960, height: 640,
    braid: 0.10, rooms: 1,
    tagline: '狭长走廊 · 谨慎推进',
    tactics: '通道较窄、视线短，主要靠卡角与反弹；少量环路避免完全单线。'
  },
  {
    id: 'crossfire', name: '十字交锋', size: 'small', layout: 'cross',
    seed: 'tank-crossfire-12', cols: 12, rows: 8, width: 960, height: 640,
    corridorCells: 1,
    tagline: '十字大道 · 四角迷宫',
    tactics: '中央十字是快速通道也是火力线，四角迷宫区适合伏击与绕行。'
  },
  {
    id: 'loop', name: '环形回廊', size: 'small', layout: 'ring',
    seed: 'tank-loop-31', cols: 12, rows: 8, width: 960, height: 640,
    ringInsets: [0], centerInset: 3,
    tagline: '外环 + 中央广场 · 绕后为王',
    tactics: '沿外环高速转移，穿过四向闸门抢占中央；绕后比正面硬冲更有效。'
  },
  {
    id: 'twin', name: '双区域攻防', size: 'small', layout: 'twoZone',
    seed: 'tank-twin-24', cols: 13, rows: 8, width: 960, height: 640,
    tagline: '双区对垒 · 三线连接',
    tactics: '两个大房间由三条长短不同的通道相连，选路决定交火距离与时机。'
  },

  /* ---------- 大地图（战区 / 绕行 / 争夺） ---------- */
  {
    id: 'city', name: '城区迷阵', size: 'big', layout: 'grid',
    seed: 'tank-city-5', cols: 20, rows: 13, width: 1600, height: 1040,
    streetEvery: 3,
    tagline: '城市街区 · 长街巷战',
    tactics: '沿街推进有长射界，街区庭院提供掩体与道具争夺点；避免在长街中央停留。'
  },
  {
    id: 'fort', name: '十字要塞', size: 'big', layout: 'cross',
    seed: 'tank-fort-9', cols: 24, rows: 16, width: 1920, height: 1280,
    corridorCells: 2,
    tagline: '要塞十字 · 四角堡垒',
    tactics: '宽阔十字大道连接四角迷宫堡垒；中央火力交汇，四角提供迂回与埋伏。'
  },
  {
    id: 'ring', name: '环形走廊', size: 'big', layout: 'ring',
    seed: 'tank-ring-3', cols: 22, rows: 14, width: 1760, height: 1120,
    ringInsets: [0, 2], centerInset: 4,
    tagline: '多环走廊 · 机动穿插',
    tactics: '内外双环 + 中央广场，放射闸门是咽喉；适合侧翼机动与守点。'
  },
  {
    id: 'hub', name: '中央枢纽', size: 'big', layout: 'hub',
    seed: 'tank-hub-18', cols: 20, rows: 13, width: 1600, height: 1040,
    tagline: '中央广场 · 放射通道',
    tactics: '四条辐条汇聚中央枢纽，控制枢纽就能控制视野；外环与侧室提供替代路线。'
  },
  {
    id: 'sectors', name: '分区战场', size: 'big', layout: 'rooms',
    seed: 'tank-sectors-8', cols: 24, rows: 16, width: 1920, height: 1280,
    tagline: '多房间战区 · 门洞争夺',
    tactics: '大小不一的房间由门洞相连，逐屋推进；门洞与房间角落是伏击点。'
  },
  {
    id: 'labyrinth', name: '多环迷城', size: 'big', layout: 'labyrinth',
    seed: 'tank-labyrinth-6', cols: 22, rows: 15, width: 1760, height: 1120,
    braid: 0.06, rooms: 0,
    tagline: '环路迷宫 · 多线穿插',
    tactics: '迷宫骨架叠加环状回路，既有藏身拐角也有长距离绕行；适合打游击。'
  },

  { id: 'random', name: '随机地图', size: 'small', layout: 'random',
    seed: null, cols: 12, rows: 8, width: 960, height: 640, braid: 0.20, rooms: 1 }
];

/* 大小分类（UI 与生成使用） */
const MAP_LAYOUT_NAMES = {
  maze: '传统迷宫', arena: '竞技场', ring: '环形回廊', twoZone: '双区域',
  cross: '十字布局', grid: '街区网格', hub: '中央枢纽', rooms: '多房间', labyrinth: '环路迷宫'
};
