'use strict';
/* =========================================================
 * 等距伪 3D 视图层（原型）
 *
 * 原则：世界坐标、碰撞、AI 完全不变；本模块只做"世界 → 屏幕"的
 * 等距投影与绘制。投影为线性仿射（2:1 游戏（dimetric）等距）：
 *   isoX = (x − y) · u
 *   isoY = (x + y) · u / 2 − z · u · elev
 * 因此：
 *   - 地面内容（坦克/子弹/道具/特效/阴影）在仿射变换下绘制，
 *     位置精确、圆形自动变为贴地椭圆；
 *   - 墙体为有高度的盒体：手工投影 顶面 + 两个可见侧面（东南/西南），
 *     按世界 (x + y) 深度用画家算法与实体统一排序；
 *   - 屏幕输入经逆投影回到世界坐标（Input.viewMapper）。
 * 分段：合并长墙按 ≤ max(cellW, cellH) 切分为渲染段，
 *       保证长墙不会因整体深度键错误遮挡旁边的实体。
 *
 * 数据分层（结构 / 主题分离）：
 *   拓扑结构   —— maze.walls（生成器产出，兼作碰撞数据，本模块不修改）
 *   地图尺寸   —— MapSize.compute（行列数 / 世界宽高）
 *   墙体类型   —— seg.metal（'普通冰墙' | '金属隔断'，由种子确定性派生）
 *   材质与配色 —— CONFIG.THEME.iso（冰墙三面 / 金属三面 / 橙色警示 / 落影）
 *   装饰元素   —— seg.crack 与地面 cracks（种子确定性派生，纯视觉不参与碰撞）
 *   环境光     —— drawGround 的径向环境光（THEME.iso.ambient）
 *   投影参数   —— CONFIG.ISO（高度 / 缩放 / 阴影系数）
 * 更换主题只需替换 THEME.iso 色板；新增墙体类型在 prepare 中扩展材质标记。
 * ========================================================= */

class IsoView {
  constructor() {
    this.u = 1;
    this.viewW = 0;
    this.viewH = 0;
    this.worldW = 0;
    this.worldH = 0;
    this.minX = 0;      // 投影内容范围（iso 空间，未含相机偏移）
    this.spanX = 0;
    this.spanY = 0;
  }

  /**
   * 视口/世界尺寸变化时重算缩放与内容范围。
   * @param {boolean} [fitWhole] 小地图（整图可见设计）：缩放取"恰好放下整个
   *   等距菱形"的适配值——相机永远居中，任意位置的玩家都完整可见，
   *   不会出现地图边缘玩家被屏幕裁切的情况。大地图保持跟随缩放。
   */
  resize(viewW, viewH, worldW, worldH, fitWhole) {
    const R = CONFIG.ISO;
    this.viewW = viewW;
    this.viewH = viewH;
    this.worldW = worldW;
    this.worldH = worldH;
    const span = worldW + worldH;
    if (fitWhole) {
      // 菱形宽 = span·u、高 = span·u/2：取两轴都能容纳（留 3%~5% 边距）的缩放
      this.u = clamp(Math.min(viewW * 0.97 / span, viewH * 1.9 / span),
        R.fitMin || 0.45, R.zoomMax);
    } else {
      this.u = clamp(Math.min(viewW / R.zoomRefW, viewH / R.zoomRefH), R.zoomMin, R.zoomMax);
    }
    this.minX = -worldH * this.u;
    this.spanX = span * this.u;
    this.spanY = span * this.u * 0.5;
  }

  /** 世界 → iso 屏幕（z 为世界像素高度） */
  project(x, y, z) {
    const u = this.u;
    return {
      x: (x - y) * u,
      y: (x + y) * u * 0.5 - (z || 0) * u * (CONFIG.ISO.elev || 1)
    };
  }

  /** iso 屏幕 → 世界（不含相机偏移） */
  unproject(sx, sy) {
    const a = sx / this.u, b = 2 * sy / this.u;
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** 画布坐标（含相机偏移）→ 世界坐标，供输入层使用 */
  unprojectAt(canvasX, canvasY, cam) {
    return this.unproject(canvasX + cam.x, canvasY + cam.y);
  }

  /** 相机 X 钳制：内容不足一屏时居中（等距内容从 minX=−H·u 开始，居中需计入），
   *  否则跟随并钳制在内容范围内 */
  clampCamX(ix) {
    if (this.spanX <= this.viewW) return this.minX + (this.spanX - this.viewW) / 2;
    return clamp(ix - this.viewW / 2, this.minX, this.minX + this.spanX - this.viewW);
  }

  clampCamY(iy) {
    if (this.spanY <= this.viewH) return (this.spanY - this.viewH) / 2;
    return clamp(iy - this.viewH / 2, 0, this.spanY - this.viewH);
  }

  /** 墙体世界高度 */
  heightZ(maze) {
    return Math.min(maze.cellW, maze.cellH) * (CONFIG.ISO.heightK || 0.55);
  }

  /* ---------------- 内容准备（确定性，按迷宫缓存） ---------------- */

  /**
   * 把合并长墙切分为渲染段并标记金属隔断，生成地面冰裂纹。
   * 结果缓存在 maze._isoData，同一迷宫只计算一次（确定性可复现）。
   */
  static prepare(maze) {
    if (maze._isoData) return maze._isoData;
    const maxLen = Math.max(maze.cellW, maze.cellH);
    const segs = [];
    for (let i = 0; i < maze.walls.length; i++) {
      const w = maze.walls[i];
      const metal = ((Math.imul(i + 1, 0x9E3779B1) >>> 0) % 6) === 0;
      if (w.w >= w.h) {
        for (let x = w.x; x < w.x + w.w - 0.5; x += maxLen) {
          const ww = Math.min(maxLen, w.x + w.w - x);
          segs.push({ x, y: w.y, w: ww, h: w.h, metal, wallIndex: i, crack: null });
        }
      } else {
        for (let y = w.y; y < w.y + w.h - 0.5; y += maxLen) {
          const hh = Math.min(maxLen, w.y + w.h - y);
          segs.push({ x: w.x, y, w: w.w, h: hh, metal, wallIndex: i, crack: null });
        }
      }
    }
    // 冰墙顶面裂纹（世界坐标折线，投影后自然贴合顶面）
    const rng = seededRandom(maze.seed + '|iso-wall-cracks');
    for (const s of segs) {
      if (s.metal || ((Math.imul(segs.length + s.x | 0, 0x85EBCA6B) >>> 0) % 3) !== 0) continue;
      const p1 = { x: s.x + s.w * (0.15 + rng() * 0.2), y: s.y + s.h * (0.2 + rng() * 0.6) };
      const p2 = { x: s.x + s.w * (0.5 + rng() * 0.35), y: s.y + s.h * (0.2 + rng() * 0.6) };
      const mid = { x: (p1.x + p2.x) / 2 + (rng() - 0.5) * s.w * 0.2, y: (p1.y + p2.y) / 2 + (rng() - 0.5) * s.h * 0.2 };
      s.crack = [p1, mid, p2];
    }
    // 地面冰裂纹
    const grng = seededRandom(maze.seed + '|iso-decor');
    const cracks = [];
    const n = clamp(Math.round(maze.cols * maze.rows / 14), 6, 40);
    for (let k = 0; k < n; k++) {
      const pts = [];
      let cx = grng() * maze.width, cy = grng() * maze.height;
      let a = grng() * TAU;
      const count = 3 + Math.floor(grng() * 3);
      for (let s = 0; s < count; s++) {
        pts.push({ x: clamp(cx, 0, maze.width), y: clamp(cy, 0, maze.height) });
        a += (grng() - 0.5) * 1.6;
        cx += Math.cos(a) * (40 + grng() * 90);
        cy += Math.sin(a) * (40 + grng() * 90);
      }
      cracks.push(pts);
    }
    maze._isoData = { segs, cracks };
    return maze._isoData;
  }

  /* ---------------- 可见性 ---------------- */

  pointVisible(x, y, view, margin) {
    const p = this.project(x, y, 0);
    const sx = p.x - view.x, sy = p.y - view.y;
    return sx > -margin && sx < this.viewW + margin && sy > -margin && sy < this.viewH + margin;
  }

  segVisible(seg, zH, view) {
    // 包围盒缓存：大地图分段上千，缩放参数不变时直接复用
    if (seg._bu !== this.u || seg._bz !== zH) {
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      const cs = [[seg.x, seg.y], [seg.x + seg.w, seg.y], [seg.x, seg.y + seg.h], [seg.x + seg.w, seg.y + seg.h]];
      for (const [x, y] of cs) {
        const p0 = this.project(x, y, 0);
        const p1 = this.project(x, y, zH);
        if (p0.x < minX) minX = p0.x; if (p0.x > maxX) maxX = p0.x;
        if (p1.x < minX) minX = p1.x; if (p1.x > maxX) maxX = p1.x;
        if (p1.y < minY) minY = p1.y;
        if (p0.y > maxY) maxY = p0.y;
      }
      seg._b = [minX, maxX, minY, maxY];
      seg._bu = this.u;
      seg._bz = zH;
    }
    const b = seg._b;
    const l = b[0] - view.x, r = b[1] - view.x, t = b[2] - view.y, bt = b[3] - view.y;
    return r > -60 && l < this.viewW + 60 && bt > -60 && t < this.viewH + 60;
  }

  /* ---------------- 绘制 ---------------- */

  /** 地面层仿射变换（实体/阴影/地面装饰共用） */
  beginGround(ctx, view) {
    ctx.save();
    ctx.transform(this.u, this.u * 0.5, -this.u, this.u * 0.5, -view.x, -view.y);
  }

  /**
   * 冰封峡谷地面：基底 + 环境光 + 棋盘微差 + 网格 + 冰裂纹 + 墙体落影。
   * 全部在世界坐标的仿射变换下绘制。
   */
  drawGround(ctx, maze, view, data, zH) {
    const C = CONFIG.THEME.iso;
    this.beginGround(ctx, view);
    // 基底冰面（世界矩形经变换即等距菱形地面）
    ctx.fillStyle = C.ground;
    ctx.fillRect(0, 0, maze.width, maze.height);
    // 蓝色环境光（中心微亮；渐变对象按迷宫+尺寸缓存，避免逐帧分配）
    const akey = maze.seed + '|' + (maze.width | 0) + 'x' + (maze.height | 0);
    if (this._ambientKey !== akey) {
      const g = ctx.createRadialGradient(
        maze.width / 2, maze.height / 2, 0,
        maze.width / 2, maze.height / 2, Math.max(maze.width, maze.height) * 0.65);
      g.addColorStop(0, C.ambient);
      g.addColorStop(1, 'rgba(110, 200, 245, 0)');
      this._ambient = g;
      this._ambientKey = akey;
    }
    ctx.fillStyle = this._ambient;
    ctx.fillRect(0, 0, maze.width, maze.height);
    // 低干扰棋盘微差
    ctx.fillStyle = C.groundAlt;
    const cw = maze.cellW, ch = maze.cellH;
    for (let r = 0; r < maze.rows; r++) {
      for (let c = r % 2; c < maze.cols; c += 2) {
        ctx.fillRect(c * cw, r * ch, cw, ch);
      }
    }
    // 网格线（线宽按缩放补偿）
    ctx.strokeStyle = C.groundGrid;
    ctx.lineWidth = 1 / this.u;
    ctx.beginPath();
    for (let c = 0; c <= maze.cols; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, maze.height); }
    for (let r = 0; r <= maze.rows; r++) { ctx.moveTo(0, r * ch); ctx.lineTo(maze.width, r * ch); }
    ctx.stroke();
    // 冰裂纹
    ctx.strokeStyle = C.groundCrack;
    ctx.lineWidth = 1.5 / this.u;
    for (const pts of data.cracks) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    // 墙体落影（向东南偏移的地面矩形，视觉提示不参与碰撞）
    const S = zH * (CONFIG.ISO.shadowK || 0.45);
    ctx.fillStyle = C.shadow;
    for (const seg of data.segs) {
      if (!this.segVisible(seg, zH, view)) continue;
      ctx.fillRect(seg.x + S, seg.y + S, seg.w, seg.h);
    }
    ctx.restore();
  }

  /**
   * 坦克（世界点 wx,wy，z=0）是否被该墙体段的投影遮挡。
   * 在 iso 空间做"盒体轮廓六边形"的点包含测试（与相机无关，可每帧廉价调用）：
   * 轮廓 = 顶面四角 + 东南/西南两侧面底脚（B0, C0, D0）。
   */
  segOccludes(seg, zH, wx, wy) {
    const A = this.project(seg.x, seg.y, zH);
    const B = this.project(seg.x + seg.w, seg.y, zH);
    const Cc = this.project(seg.x + seg.w, seg.y + seg.h, zH);
    const D = this.project(seg.x, seg.y + seg.h, zH);
    const B0 = this.project(seg.x + seg.w, seg.y, 0);
    const C0 = this.project(seg.x + seg.w, seg.y + seg.h, 0);
    const D0 = this.project(seg.x, seg.y + seg.h, 0);
    const p = this.project(wx, wy, 0);
    const poly = [A, B, B0, C0, D0, D];
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (((yi > p.y) !== (yj > p.y)) &&
        (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  /**
   * 单个墙体盒体：顶面 + 东南/西南两个可见侧面 + 棱线 + 顶面裂纹 +
   * 金属隔断的橙色警示标识。视觉侧面/阴影不参与碰撞（碰撞仍是足迹矩形）。
   * @param {boolean} [ghost] 遮挡了存活坦克 → 整段半透明，保持战场信息可见
   */
  drawWall(ctx, seg, zH, view, ghost) {
    const C = CONFIG.THEME.iso;
    const cols = seg.metal
      ? { top: C.metalTop, r: C.metalSideR, l: C.metalSideL, edge: C.metalEdge }
      : { top: C.iceTop, r: C.iceSideR, l: C.iceSideL, edge: C.iceEdge };
    const ox = -view.x, oy = -view.y;
    if (ghost) ctx.globalAlpha = CONFIG.ISO.ghostAlpha || 0.42;
    const A = this.project(seg.x, seg.y, zH);
    const B = this.project(seg.x + seg.w, seg.y, zH);
    const Cc = this.project(seg.x + seg.w, seg.y + seg.h, zH);
    const D = this.project(seg.x, seg.y + seg.h, zH);
    const B0 = this.project(seg.x + seg.w, seg.y, 0);
    const C0 = this.project(seg.x + seg.w, seg.y + seg.h, 0);
    const D0 = this.project(seg.x, seg.y + seg.h, 0);
    const quad = (p1, p2, p3, p4, fill) => {
      ctx.beginPath();
      ctx.moveTo(p1.x + ox, p1.y + oy);
      ctx.lineTo(p2.x + ox, p2.y + oy);
      ctx.lineTo(p3.x + ox, p3.y + oy);
      ctx.lineTo(p4.x + ox, p4.y + oy);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };

    quad(B, Cc, C0, B0, cols.r);   // 东南侧面（背光，右）
    quad(D, Cc, C0, D0, cols.l);   // 西南侧面（受光，左）
    quad(A, B, Cc, D, cols.top);   // 顶面
    // 棱线
    ctx.strokeStyle = cols.edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(A.x + ox, A.y + oy);
    ctx.lineTo(B.x + ox, B.y + oy);
    ctx.lineTo(Cc.x + ox, Cc.y + oy);
    ctx.lineTo(D.x + ox, D.y + oy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(B.x + ox, B.y + oy); ctx.lineTo(B0.x + ox, B0.y + oy);
    ctx.moveTo(Cc.x + ox, Cc.y + oy); ctx.lineTo(C0.x + ox, C0.y + oy);
    ctx.moveTo(D.x + ox, D.y + oy); ctx.lineTo(D0.x + ox, D0.y + oy);
    ctx.stroke();
    // 冰墙顶面裂纹
    if (seg.crack) {
      ctx.strokeStyle = C.iceCrack;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < seg.crack.length; i++) {
        const q = this.project(seg.crack[i].x, seg.crack[i].y, zH);
        if (i === 0) ctx.moveTo(q.x + ox, q.y + oy);
        else ctx.lineTo(q.x + ox, q.y + oy);
      }
      ctx.stroke();
    }
    // 金属隔断：橙色警示标识（顶面中心菱形 + 外圈微光）
    if (seg.metal) {
      const cx = seg.x + seg.w / 2, cy = seg.y + seg.h / 2;
      const d = Math.min(seg.w, seg.h) * 0.13;
      const dia = (k, fill) => {
        const m0 = this.project(cx - k * d, cy, zH);
        const m1 = this.project(cx, cy - k * d, zH);
        const m2 = this.project(cx + k * d, cy, zH);
        const m3 = this.project(cx, cy + k * d, zH);
        quad(m0, m1, m2, m3, fill);
      };
      dia(1.7, C.orangeGlow);
      dia(1, C.orange);
    }
    if (ghost) ctx.globalAlpha = 1;
  }
}
