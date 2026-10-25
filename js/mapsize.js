'use strict';
/* =========================================================
 * 统一尺寸管理：视口 / 地图动态规模
 *
 * 三层尺寸概念（全项目共用，避免各地图自行适配）：
 *   视口尺寸   —— 浏览器当前可供游戏使用的区域（CSS 像素，全屏后即窗口大小）
 *   地图尺寸   —— 游戏世界的实际宽高与网格行列数（本模块计算）
 *   网格/实体  —— 每格世界尺寸与坦克等实体尺寸（保持不变，保证手感）
 *   显示参数   —— 世界到屏幕的映射（当前俯视 1:1；等距阶段在此接入投影）
 *
 * 计算规则（CONFIG.MAP_SIZE）：
 *   小地图：优先保持紧凑 —— 行列数在基础规模上有限扩展（+12 列 / +8 行），
 *           世界尺寸恰好铺满可玩区（保留"整图可见"的原有设计），
 *           由格子尺寸在 [0.82, 1.32] 倍间微调吸收视口差异；
 *           格子放大到达上限时自动追加列/行（宁可多扩真实网格，不放大格子）。
 *   大地图：保持格子尺寸不变（通道宽度、实体比例完全不变），
 *           按视口面积等比放大网格行列数（目标 = 可玩区 × expand），
 *           行列数按步进取整避免窗口轻微变化引起规模跳变，并设上限。
 *
 * HUD 空间：CONFIG.MAP_SIZE.hudInset 从视口扣除的独占 UI 空间（当前为 0，
 * HUD 是半透明淡出覆盖层；等距阶段若 HUD 常驻可设置）。
 *
 * 各布局的扩图表现（生成器均按行列数参数化，天然随规模扩展）：
 *   maze/曲折回廊   迷宫分支与环路数量随行列数增长
 *   arena/开阔战场  中央竞技场与外围环廊扩大，柱阵掩体按间距密度自动增加
 *   ring/环形回廊   环层数量与放射连接随规模增长
 *   cross/十字      中央十字大道贯通全图，四角迷宫区向外围扩展
 *   hub/中央枢纽    中央广场按比例扩大，辐条与外围环廊同步延长
 *   grid/街区       街区数量按街道间距自动增加
 *   rooms/分区      BSP 递归按可用行列分裂出更多战区
 *   twoZone/双区域  两侧房间扩大，三条连接通道位置按比例分布
 *   labyrinth       迷宫骨架 + 双环 + 房间随规模叠加
 *   random          按上述规则以目标尺寸重新生成（种子可复现）
 *
 * 无 window 的测试环境回退到逻辑分辨率 (960×640)，
 * 此时所有地图精确还原预设基础尺寸，便于回归测试。
 * ========================================================= */

const MapSize = {
  /** 当前视口：优先真实窗口，测试环境回退到逻辑分辨率 */
  current() {
    if (typeof window !== 'undefined' && window.innerWidth > 0) {
      return {
        w: Math.max(320, window.innerWidth),
        h: Math.max(240, window.innerHeight)
      };
    }
    return { w: CONFIG.WIDTH, h: CONFIG.HEIGHT };
  },

  /**
   * 单轴行列数拟合：
   * - 未超过基础规模时直接取整（允许小窗口适度收缩）；
   * - 超过基础规模时按 step 步进增长，避免视口轻微变化引起跳变；
   * - 最后钳制在 [min, max]。
   */
  fitCount(targetPx, cellPx, baseCount, minCount, maxCount, step) {
    const raw = targetPx / cellPx;
    let count;
    if (raw <= baseCount) count = Math.round(raw);
    else count = baseCount + Math.round((raw - baseCount) / step) * step;
    return clamp(count, Math.min(minCount, maxCount), maxCount);
  },

  /** HUD 内缩参数（显式传入优先，其次配置，最后全 0） */
  insetsOf(hudInset) {
    const inset = hudInset || CONFIG.MAP_SIZE.hudInset || {};
    return {
      top: inset.top || 0, right: inset.right || 0,
      bottom: inset.bottom || 0, left: inset.left || 0
    };
  },

  /**
   * 根据视口与预设计算本局地图规模。
   * @param {{size:string,cols:number,rows:number,width:number,height:number}} preset
   * @param {number} [viewW] 视口宽（缺省用 MapSize.current()）
   * @param {number} [viewH] 视口高
   * @param {number} [jitter] 随机地图的目标尺寸扰动系数（~1）
   * @param {object} [hudInset] 本局 HUD 独占空间 {top,right,bottom,left}
   * @returns {{cols:number, rows:number, width:number, height:number}}
   */
  compute(preset, viewW, viewH, jitter, hudInset) {
    const rule = CONFIG.MAP_SIZE;
    const raw = (viewW && viewH) ? { w: viewW, h: viewH } : this.current();
    const inset = this.insetsOf(hudInset);
    /* 扣除 HUD 独占空间后的可玩区（不小于最小可玩视口） */
    const view = {
      w: Math.max(320, raw.w - inset.left - inset.right),
      h: Math.max(240, raw.h - inset.top - inset.bottom)
    };
    jitter = jitter || 1;
    const cw = preset.width / preset.cols;    // 预设基础格子尺寸
    const ch = preset.height / preset.rows;

    if (preset.size === 'big') {
      /* 大地图：格子尺寸不动，按两轴中更大的扩展需求等比放大网格。
       * 取 max 保证世界在两个方向上都至少覆盖 可玩区 × expand。 */
      const scale = Math.max(
        view.w * rule.big.expand / preset.width,
        view.h * rule.big.expand / preset.height,
        1
      ) * jitter;
      const cols = this.fitCount(preset.width * scale, cw,
        preset.cols, preset.cols, rule.big.maxCols, rule.big.step);
      const rows = this.fitCount(preset.height * scale, ch,
        preset.rows, preset.rows, rule.big.maxRows, rule.big.step);
      return {
        cols, rows,
        width: Math.round(cols * cw),
        height: Math.round(rows * ch)
      };
    }

    /* 小地图：有限扩格，世界恰好铺满可玩区 */
    let cols = this.fitCount(view.w * jitter, cw,
      preset.cols, preset.cols - rule.small.shrinkCols,
      preset.cols + rule.small.maxExtraCols, rule.small.step);
    let rows = this.fitCount(view.h * jitter, ch,
      preset.rows, preset.rows - rule.small.shrinkRows,
      preset.rows + rule.small.maxExtraRows, rule.small.step);
    /* 格子尺寸缩放限制在 [cellMinScale, cellMaxScale] 倍内：
     * - 超过放大上限 → 追加列/行（多扩真实网格）；
     * - 低于收缩下限 → 减少列/行（保证通道仍容得下坦克）。 */
    cols = clamp(cols,
      Math.ceil(view.w / (cw * rule.small.cellMaxScale)),
      Math.max(8, Math.floor(view.w / (cw * rule.small.cellMinScale))));
    rows = clamp(rows,
      Math.ceil(view.h / (ch * rule.small.cellMaxScale)),
      Math.max(6, Math.floor(view.h / (ch * rule.small.cellMinScale))));
    return {
      cols, rows,
      width: Math.round(view.w),
      height: Math.round(view.h)
    };
  },

  /**
   * 分层尺寸视图：一次给出视口 / HUD 预留 / 可玩区 / 网格 / 世界 / 显示参数，
   * 供调试面板与未来等距投影统一取用，避免各模块重复拼装。
   */
  describe(preset, viewW, viewH, jitter) {
    const raw = (viewW && viewH) ? { w: viewW, h: viewH } : this.current();
    const inset = this.insetsOf();
    const size = this.compute(preset, raw.w, raw.h, jitter);
    return {
      viewport: { w: raw.w, h: raw.h },                       // 浏览器可视区域
      hudInset: inset,                                        // HUD 独占空间
      playArea: {                                             // 扣除 HUD 后的可玩区
        w: Math.max(320, raw.w - inset.left - inset.right),
        h: Math.max(240, raw.h - inset.top - inset.bottom)
      },
      cols: size.cols,                                        // 网格行列数
      rows: size.rows,
      cellW: size.width / size.cols,                          // 网格单元世界尺寸
      cellH: size.height / size.rows,
      width: size.width,                                      // 世界尺寸（=可行驶区域）
      height: size.height,
      displayScale: 1,                                        // 显示缩放：俯视 1:1（等距阶段接入投影）
      scrolls: size.width > raw.w || size.height > raw.h      // 世界超出视口 → 摄像机跟随
    };
  }
};
