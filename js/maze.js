'use strict';
/* =========================================================
 * 迷宫：多布局生成、墙体、空间索引、射线检测、AI 导航网格
 *
 * 统一的数据组织（所有布局共用）：
 *   vWall[c][r] / hWall[c][r] —— 单元格边上的墙（1=有墙）
 *   walls[]                   —— 合并后的轴对齐墙体矩形（绘制/碰撞/射线同源）
 *   grid / navFree            —— 由 walls 派生的空间索引与导航网格
 * 因此无论采用哪种布局，绘制、碰撞、子弹射线、AI 寻路始终一致。
 *
 * 布局生成器（layout）：
 *   maze      递归回溯迷宫 + 编织环路 + 开放房间
 *   arena     中央开放竞技场 + 外围环形走廊 + 四向闸门
 *   ring      多层同心环廊 + 放射连接 + 中央广场
 *   twoZone   两个大房间 + 三条不同长度的连接通道
 *   cross     十字大道 + 四角迷宫区 + 门洞
 *   grid      城市街区（长直街道 + 街区庭院/巷道）
 *   hub       中央枢纽广场 + 四向辐条 + 外围环廊 + 角落房间
 *   rooms     BSP 多房间战区（门洞相连，可产生环路）
 *   labyrinth 迷宫骨架 + 环状回路 + 房间
 * ========================================================= */

class Maze {
  constructor(opts) {
    this.name = opts.name || '地图';
    this.seed = opts.seed || 'default';
    this.layout = opts.layout || 'maze';
    this.size = opts.size || ((opts.width || CONFIG.WIDTH) > CONFIG.WIDTH ||
      (opts.height || CONFIG.HEIGHT) > CONFIG.HEIGHT ? 'big' : 'small');
    this.cols = opts.cols;
    this.rows = opts.rows;
    // 世界尺寸（可能大于视口，此时由摄像机跟随）
    this.width = opts.width || CONFIG.WIDTH;
    this.height = opts.height || CONFIG.HEIGHT;
    this.cellW = this.width / this.cols;
    this.cellH = this.height / this.rows;
    this.thickness = CONFIG.MAZE.wallThickness;
    // big 按"预设地图类型"判定（小/大地图的敌人上限与道具密度规则），
    // 与视口无关：动态扩图后的小地图世界尺寸可能超过基准视口。
    this.big = this.size === 'big';

    this.walls = [];          // {x,y,w,h}
    this._stamp = null;
    this._stampId = 0;

    this._buildEdges(opts);
    this._buildWalls();
    this._buildSpatialGrid();
    this._buildNavGrid();
    this.validate();
  }

  /* ================= 生成后质量自检 ================= */

  /**
   * 每张地图生成后的统一质量检查：
   *   1) 外围边界闭合（生成器的硬性不变量）；
   *   2) 导航网格最大连通分量占比 ≥ 0.9（无大面积孤立区域）；
   *   3) 通道宽度能容纳坦克（格子 − 墙厚 ≥ 坦克直径）；
   *   4) 死胡同比例统计（供测试与调参参考，不作硬性失败）。
   * 结果缓存于 this.validation；关键项失败仅 console.warn ——
   * 生成器本身已具备连通性自修复与边界强制机制，这里做最终兜底告警。
   * @returns {{ok:boolean, boundaryClosed:boolean, connectivity:number,
   *            corridorFitsTank:boolean, deadEndRatio:number, floorCells:number, deadEnds:number}}
   */
  validate() {
    const cols = this.cols, rows = this.rows;

    // 1) 边界闭合
    let boundaryClosed = true;
    for (let r = 0; r < rows && boundaryClosed; r++) {
      if (!this.vWall[0][r] || !this.vWall[cols][r]) boundaryClosed = false;
    }
    for (let c = 0; c < cols && boundaryClosed; c++) {
      if (!this.hWall[c][0] || !this.hWall[c][rows]) boundaryClosed = false;
    }

    // 2) 导航网格连通性（最大分量 BFS）
    const n = this.navCols * this.navRows;
    let start = -1, total = 0;
    for (let i = 0; i < n; i++) {
      if (this.navFree[i]) { total++; if (start < 0) start = i; }
    }
    let biggest = 0;
    if (start >= 0) {
      const seen = new Uint8Array(n);
      const stack = [start];
      seen[start] = 1;
      biggest = 1;
      while (stack.length) {
        const idx = stack.pop();
        const cx = idx % this.navCols, cy = (idx / this.navCols) | 0;
        for (let k = 0; k < 4; k++) {
          const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx < 0 || ny < 0 || nx >= this.navCols || ny >= this.navRows) continue;
          const ni = ny * this.navCols + nx;
          if (!this.navFree[ni] || seen[ni]) continue;
          seen[ni] = 1;
          biggest++;
          stack.push(ni);
        }
      }
    }
    const connectivity = total ? biggest / total : 0;

    // 3) 通道宽度 ≥ 坦克直径（留 2px 制造余量）
    const corridorFitsTank =
      Math.min(this.cellW, this.cellH) - this.thickness >= CONFIG.TANK.radius * 2 - 2;

    // 4) 死胡同统计（地板格子上开放边数 = 1）
    let floorCells = 0, deadEnds = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!this._isFloor(c, r)) continue;
        floorCells++;
        let open = 0;
        if (c > 0 && this._edgeOpenBetween(c, r, c - 1, r)) open++;
        if (c < cols - 1 && this._edgeOpenBetween(c, r, c + 1, r)) open++;
        if (r > 0 && this._edgeOpenBetween(c, r, c, r - 1)) open++;
        if (r < rows - 1 && this._edgeOpenBetween(c, r, c, r + 1)) open++;
        if (open === 1) deadEnds++;
      }
    }

    const report = {
      boundaryClosed, connectivity, corridorFitsTank,
      deadEndRatio: floorCells ? deadEnds / floorCells : 0,
      floorCells, deadEnds,
      ok: boundaryClosed && connectivity >= 0.9 && corridorFitsTank
    };
    this.validation = report;
    if (!report.ok) {
      console.warn('[Maze] 地图质量自检未通过: ' + this.name +
        ' boundary=' + boundaryClosed +
        ' connectivity=' + connectivity.toFixed(3) +
        ' corridorFitsTank=' + corridorFitsTank);
    }
    return report;
  }

  /* ================= 生成入口 ================= */

  /**
   * 按预设生成地图。行列与世界尺寸由 MapSize 根据当前视口动态计算；
   * 不传视口时（测试环境）回退到基准视口，还原预设基础规模。
   */
  static createPreset(id, viewW, viewH) {
    const preset = MAP_PRESETS.find(p => p.id === id) || MAP_PRESETS[0];
    if (preset.layout === 'random') {
      return Maze.createRandom('random-' + Date.now() + '-' + Math.random(), viewW, viewH);
    }
    const size = MapSize.compute(preset, viewW, viewH);
    return new Maze({
      name: preset.name,
      seed: preset.seed || ('map-' + preset.id),
      layout: preset.layout,
      size: preset.size || (preset.big ? 'big' : 'small'),
      cols: size.cols,
      rows: size.rows,
      width: size.width,
      height: size.height,
      braid: preset.braid,
      rooms: preset.rooms,
      ringInsets: preset.ringInsets,
      centerInset: preset.centerInset,
      streetEvery: preset.streetEvery,
      corridorCells: preset.corridorCells
    });
  }

  /**
   * 随机地图：从全部预设布局中随机抽一种，按动态规模规则生成，
   * 并对目标尺寸做轻微扰动。全部随机数来自 seededRandom(seed)，固定种子可复现。
   */
  static createRandom(seed, viewW, viewH) {
    const s = String(seed);
    const rng = seededRandom(s);
    const pool = MAP_PRESETS.filter(p => p.layout !== 'random');
    const preset = pool[Math.floor(rng() * pool.length)];
    const jitter = 0.92 + rng() * 0.16;
    const size = MapSize.compute(preset, viewW, viewH, jitter);
    return new Maze({
      name: '随机地图 · ' + preset.name,
      seed: s,
      layout: preset.layout,
      size: preset.size,
      cols: size.cols,
      rows: size.rows,
      width: size.width,
      height: size.height,
      braid: preset.braid,
      rooms: preset.rooms,
      ringInsets: preset.ringInsets,
      centerInset: preset.centerInset,
      streetEvery: preset.streetEvery,
      corridorCells: preset.corridorCells
    });
  }

  _buildEdges(opts) {
    this._fillEdges();
    const rng = seededRandom(this.seed + '|' + this.layout);
    switch (this.layout) {
      case 'arena': this._genArena(opts); break;
      case 'ring': this._genRing(opts, rng); break;
      case 'twoZone': this._genTwoZone(opts, rng); break;
      case 'cross': this._genCross(opts, rng); break;
      case 'grid': this._genGrid(opts, rng); break;
      case 'hub': this._genHub(opts, rng); break;
      case 'rooms': this._genRooms(opts, rng); break;
      case 'labyrinth': this._genLabyrinth(opts, rng); break;
      case 'maze':
      default: this._genMaze(opts, rng); break;
    }
    this._finalizeFloor();
    this._enforceBoundary();
  }

  /**
   * 地板收尾：
   *   1. 计算地板连通分量，把所有孤立分量用"开门"方式接回主区域；
   *   2. 仅保留真正可达的地板，其余格子在 _buildWalls 中填成实心墙。
   * 这样无论哪种模板都不会出现"画面上是墙、导航里是房间"或不可达空腔。
   */
  _finalizeFloor() {
    const cols = this.cols, rows = this.rows, n = cols * rows;
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const self = this;

    const computeComps = () => {
      const comp = new Int32Array(n).fill(-1);
      const comps = [];
      for (let i = 0; i < n; i++) {
        if (!this._floor[i] || comp[i] >= 0) continue;
        const list = [];
        const stack = [i];
        comp[i] = comps.length;
        while (stack.length) {
          const cur = stack.pop();
          list.push(cur);
          const c = cur % cols, r = (cur / cols) | 0;
          for (const d of dirs) {
            const nc = c + d[0], nr = r + d[1];
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = nr * cols + nc;
            if (!this._floor[ni] || comp[ni] >= 0) continue;
            if (!this._edgeOpenBetween(c, r, nc, nr)) continue;
            comp[ni] = comps.length;
            stack.push(ni);
          }
        }
        comps.push(list);
      }
      return { comp, comps };
    };

    for (let guard = 0; guard < 24; guard++) {
      const { comp, comps } = computeComps();
      if (comps.length <= 1) return;
      let mainId = 0;
      for (let i = 1; i < comps.length; i++) {
        if (comps[i].length > comps[mainId].length) mainId = i;
      }

      // 0-1 BFS：从非主体分量出发，优先走已开的墙，必要时打穿 1 道墙
      let bestPath = null;
      let bestCost = Infinity;
      for (let ci = 0; ci < comps.length; ci++) {
        if (ci === mainId) continue;
        const dist = new Int32Array(n).fill(1e9);
        const prev = new Int32Array(n).fill(-1);
        const deque = [];
        for (const idx of comps[ci]) { dist[idx] = 0; deque.push(idx); }
        let target = -1;
        while (deque.length) {
          // 取当前距离最小的节点（n 很小，线性扫描足够）
          let bi = 0;
          for (let k = 1; k < deque.length; k++) if (dist[deque[k]] < dist[deque[bi]]) bi = k;
          const cur = deque.splice(bi, 1)[0];
          if (comp[cur] === mainId) { target = cur; break; }
          if (dist[cur] >= bestCost) continue;
          const c = cur % cols, r = (cur / cols) | 0;
          for (const d of dirs) {
            const nc = c + d[0], nr = r + d[1];
            if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
            const ni = nr * cols + nc;
            const w = this._edgeOpenBetween(c, r, nc, nr) ? 0 : 1;
            const nd = dist[cur] + w;
            if (nd < dist[ni]) {
              dist[ni] = nd;
              prev[ni] = cur;
              if (w === 0) deque.unshift(ni); else deque.push(ni);
            }
          }
        }
        if (target >= 0 && dist[target] < bestCost) {
          const path = [];
          let node = target;
          while (node !== -1) { path.push(node); node = prev[node]; }
          path.reverse();
          bestCost = dist[target];
          bestPath = path;
        }
      }
      if (!bestPath) return;
      // 沿路径开门并把经过的格子标记为地板
      for (let i = 1; i < bestPath.length; i++) {
        const a = bestPath[i - 1], b = bestPath[i];
        const c1 = a % cols, r1 = (a / cols) | 0;
        const c2 = b % cols, r2 = (b / cols) | 0;
        this._openBetween(c1, r1, c2, r2);
      }
      // 连接后重新计算（最多 24 次，防御性上限）
      if (guard === 23) return;
    }
  }

  /* ---------- 基础工具 ---------- */

  _fillEdges() {
    const cols = this.cols, rows = this.rows;
    const vWall = [];
    for (let c = 0; c <= cols; c++) vWall.push(new Uint8Array(rows).fill(1));
    const hWall = [];
    for (let c = 0; c < cols; c++) hWall.push(new Uint8Array(rows + 1).fill(1));
    this.vWall = vWall;
    this.hWall = hWall;
    // 地板标记：只有被显式挖开的格子才是可行走地面，其余格子在收尾时填成实心墙
    this._floor = new Uint8Array(cols * rows);
  }

  _markFloor(c, r) {
    if (c >= 0 && r >= 0 && c < this.cols && r < this.rows) {
      this._floor[r * this.cols + c] = 1;
    }
  }

  _isFloor(c, r) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this._floor[r * this.cols + c] === 1;
  }

  /** 两个相邻格之间的墙是否已打开 */
  _edgeOpenBetween(c1, r1, c2, r2) {
    if (c1 === c2) {
      const r = Math.max(r1, r2);
      return this.hWall[c1][r] === 0;
    }
    const c = Math.max(c1, c2);
    return this.vWall[c][r1] === 0;
  }

  /** 打开两个相邻格之间的墙（并标记为地板） */
  _openBetween(c1, r1, c2, r2) {
    if (c1 === c2) {
      const r = Math.max(r1, r2);
      if (r > 0 && r < this.rows) this.hWall[c1][r] = 0;
    } else {
      const c = Math.max(c1, c2);
      if (c > 0 && c < this.cols) this.vWall[c][r1] = 0;
    }
    this._markFloor(c1, r1);
    this._markFloor(c2, r2);
  }

  _enforceBoundary() {
    const cols = this.cols, rows = this.rows;
    for (let r = 0; r < rows; r++) { this.vWall[0][r] = 1; this.vWall[cols][r] = 1; }
    for (let c = 0; c < cols; c++) { this.hWall[c][0] = 1; this.hWall[c][rows] = 1; }
  }

  /** 打开某格某一侧的墙。dir: 0 北 / 1 东 / 2 南 / 3 西 */
  _open(c, r, dir) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    if (dir === 0 && r > 0) this.hWall[c][r] = 0;
    else if (dir === 1 && c < this.cols - 1) this.vWall[c + 1][r] = 0;
    else if (dir === 2 && r < this.rows - 1) this.hWall[c][r + 1] = 0;
    else if (dir === 3 && c > 0) this.vWall[c][r] = 0;
    this._markFloor(c, r);
    if (dir === 0) this._markFloor(c, r - 1);
    else if (dir === 1) this._markFloor(c + 1, r);
    else if (dir === 2) this._markFloor(c, r + 1);
    else this._markFloor(c - 1, r);
  }

  /** 打通矩形区域内部的所有格间墙（区域边界保持原状），并把区域标记为地板 */
  _carveRect(c0, r0, c1, r1) {
    c0 = clamp(c0, 0, this.cols - 1); c1 = clamp(c1, 0, this.cols - 1);
    r0 = clamp(r0, 0, this.rows - 1); r1 = clamp(r1, 0, this.rows - 1);
    if (c0 > c1 || r0 > r1) return;
    for (let c = c0 + 1; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) this.vWall[c][r] = 0;
    }
    for (let r = r0 + 1; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) this.hWall[c][r] = 0;
    }
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) this._markFloor(c, r);
    }
  }

  /** 把某格彻底封成实心块（四面墙），用于柱子/掩体 */
  _solidCell(c, r) {
    if (c < 1 || r < 1 || c >= this.cols - 1 || r >= this.rows - 1) return;
    this.vWall[c][r] = 1;
    this.vWall[c + 1][r] = 1;
    this.hWall[c][r] = 1;
    this.hWall[c][r + 1] = 1;
    this._floor[r * this.cols + c] = 0;
  }

  /** 同心环：在 inset 层挖一圈环形走廊 */
  _carveRing(d) {
    const c0 = d, c1 = this.cols - 1 - d, r0 = d, r1 = this.rows - 1 - d;
    if (c1 - c0 < 2 || r1 - r0 < 2) return;
    this._carveRect(c0, r0, c1, r0);
    this._carveRect(c0, r1, c1, r1);
    this._carveRect(c0, r0, c0, r1);
    this._carveRect(c1, r0, c1, r1);
  }

  /** 中央区域柱阵（掩体） */
  _pillarGrid(c0, r0, c1, r1, step) {
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    if (w < 5 || h < 4) return;
    const s = step || 3;
    for (let r = r0 + 2; r <= r1 - 2; r += s) {
      for (let c = c0 + 2; c <= c1 - 2; c += s) this._solidCell(c, r);
    }
  }

  /* ---------- 布局 1：传统迷宫 ---------- */

  _genMaze(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const vWall = this.vWall, hWall = this.hWall;
    // 迷宫布局覆盖全部格子
    for (let i = 0; i < cols * rows; i++) this._floor[i] = 1;

    const visited = new Uint8Array(cols * rows);
    const stack = [[0, 0]];
    visited[0] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const cx = cur[0], cy = cur[1];
      const options = [];
      if (cy > 0 && !visited[(cy - 1) * cols + cx]) options.push(0);
      if (cx < cols - 1 && !visited[cy * cols + cx + 1]) options.push(1);
      if (cy < rows - 1 && !visited[(cy + 1) * cols + cx]) options.push(2);
      if (cx > 0 && !visited[cy * cols + cx - 1]) options.push(3);
      if (!options.length) { stack.pop(); continue; }

      const dir = options[Math.floor(rng() * options.length)];
      let nx = cx, ny = cy;
      if (dir === 0) { ny = cy - 1; hWall[cx][cy] = 0; }
      else if (dir === 1) { nx = cx + 1; vWall[nx][cy] = 0; }
      else if (dir === 2) { ny = cy + 1; hWall[cx][ny] = 0; }
      else { nx = cx - 1; vWall[cx][cy] = 0; }

      visited[ny * cols + nx] = 1;
      stack.push([nx, ny]);
    }

    // 编织：删除部分内墙形成环路
    const braid = opts.braid === undefined ? 0.15 : opts.braid;
    for (let c = 1; c < cols; c++) {
      for (let r = 0; r < rows; r++) if (vWall[c][r] && rng() < braid) vWall[c][r] = 0;
    }
    for (let c = 0; c < cols; c++) {
      for (let r = 1; r < rows; r++) if (hWall[c][r] && rng() < braid) hWall[c][r] = 0;
    }

    // 开放房间（2x2 格）
    const rooms = opts.rooms || 0;
    for (let i = 0; i < rooms; i++) {
      const rc = 1 + Math.floor(rng() * (cols - 3));
      const rr = 1 + Math.floor(rng() * (rows - 3));
      this._carveRect(rc, rr, rc + 1, rr + 1);
    }
  }

  /** 在子矩形内跑一遍递归回溯（用于十字布局的四角） */
  _mazeRegion(rng, c0, r0, c1, r1) {
    if (c1 <= c0 || r1 <= r0) return;
    const w = c1 - c0 + 1, h = r1 - r0 + 1;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) this._markFloor(c, r);
    }
    const visited = new Uint8Array(w * h);
    const stack = [[0, 0]];
    visited[0] = 1;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const cx = cur[0], cy = cur[1];
      const opts = [];
      if (cy > 0 && !visited[(cy - 1) * w + cx]) opts.push(0);
      if (cx < w - 1 && !visited[cy * w + cx + 1]) opts.push(1);
      if (cy < h - 1 && !visited[(cy + 1) * w + cx]) opts.push(2);
      if (cx > 0 && !visited[cy * w + cx - 1]) opts.push(3);
      if (!opts.length) { stack.pop(); continue; }
      const dir = opts[Math.floor(rng() * opts.length)];
      const gc = c0 + cx, gr = r0 + cy;
      let nx = cx, ny = cy;
      if (dir === 0) { ny = cy - 1; this.hWall[gc][gr] = 0; }
      else if (dir === 1) { nx = cx + 1; this.vWall[gc + 1][gr] = 0; }
      else if (dir === 2) { ny = cy + 1; this.hWall[gc][gr + 1] = 0; }
      else { nx = cx - 1; this.vWall[gc][gr] = 0; }
      visited[ny * w + nx] = 1;
      stack.push([nx, ny]);
    }
  }

  /* ---------- 布局 2：中央竞技场 ---------- */

  _genArena(opts) {
    const cols = this.cols, rows = this.rows;
    this._carveRing(0);
    const c0 = 2, r0 = 2, c1 = cols - 3, r1 = rows - 3;
    if (c1 > c0 && r1 > r0) {
      this._carveRect(c0, r0, c1, r1);
      this._pillarGrid(c0, r0, c1, r1, 3);
    }
    const midC = Math.floor(cols / 2), midR = Math.floor(rows / 2);
    // 四向闸门：闸门格连接外环与竞技场
    const gate = (c, r, ns) => {
      if (ns) { this._open(c, r, 0); this._open(c, r, 2); }
      else { this._open(c, r, 1); this._open(c, r, 3); }
    };
    gate(midC, 1, true);
    gate(midC, rows - 2, true);
    gate(1, midR, false);
    gate(cols - 2, midR, false);
    // 侧向第二闸门（大地图时）
    if (cols >= 18) {
      gate(midC - 2, 1, true);
      gate(midC + 2, rows - 2, true);
    }
  }

  /* ---------- 布局 3：多层同心环 ---------- */

  _genRing(opts, rng) {
    const insets = (opts.ringInsets || [0, 2]).slice();
    const centerInset = opts.centerInset == null ? 4 : opts.centerInset;
    for (const d of insets) this._carveRing(d);

    const c0 = centerInset, r0 = centerInset;
    const c1 = this.cols - 1 - centerInset, r1 = this.rows - 1 - centerInset;
    if (c1 - c0 >= 1 && r1 - r0 >= 1) {
      this._carveRect(c0, r0, c1, r1);
      this._pillarGrid(c0, r0, c1, r1, 3);
    }

    const layers = insets.concat([centerInset]);
    for (let i = 0; i < layers.length - 1; i++) {
      this._connectRingLayers(layers[i], layers[i + 1]);
    }
  }

  /** 在 from 层与 to 层之间开 4 向（大地图双向）放射连接 */
  _connectRingLayers(from, to) {
    const cols = this.cols, rows = this.rows;
    const midC = Math.floor(cols / 2), midR = Math.floor(rows / 2);
    const gap = to - from - 1;
    const wide = cols >= 18 && rows >= 12;
    const colsPos = wide ? [midC - 1, midC + 1] : [midC];
    const rowsPos = wide ? [midR - 1, midR + 1] : [midR];

    const connectNS = (gx) => {
      if (gap <= 0) {
        // 相邻层：直接打通两层之间的那道墙
        this._open(gx, from, 2);
      } else {
        for (let r = from + 1; r <= to - 1; r++) {
          this._open(gx, r, 0);
          this._open(gx, r, 2);
        }
      }
    };
    const connectEW = (gy) => {
      if (gap <= 0) {
        this._open(from, gy, 1);
      } else {
        for (let c = from + 1; c <= to - 1; c++) {
          this._open(c, gy, 3);
          this._open(c, gy, 1);
        }
      }
    };

    for (const gx of colsPos) {
      connectNS(clamp(gx, from + 1, cols - 1 - to));
      // 南侧同样位置
      if (gap <= 0) this._open(gx, to, 2);
      else {
        for (let r = from + 1; r <= to - 1; r++) {
          this._open(gx, rows - 1 - r, 0);
          this._open(gx, rows - 1 - r, 2);
        }
      }
    }
    for (const gy of rowsPos) {
      connectEW(clamp(gy, from + 1, rows - 1 - to));
      if (gap <= 0) this._open(to, gy, 1);
      else {
        for (let c = from + 1; c <= to - 1; c++) {
          this._open(cols - 1 - c, gy, 3);
          this._open(cols - 1 - c, gy, 1);
        }
      }
    }
  }

  /* ---------- 布局 4：双区域攻防 ---------- */

  _genTwoZone(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const mid = Math.floor(cols / 2);
    const leftC1 = mid - 2, rightC0 = mid + 2;
    this._carveRect(1, 1, leftC1, rows - 2);
    this._carveRect(rightC0, 1, cols - 2, rows - 2);

    // 三条不同高度的连接通道（长度相同但位置不同，暴露度不同）
    const rTop = Math.max(2, Math.round(rows * 0.2));
    const rMid = Math.floor(rows / 2);
    const rBot = Math.min(rows - 3, Math.round(rows * 0.8));
    const rowsSel = [];
    for (const r of [rTop, rMid, rBot]) if (rowsSel.indexOf(r) < 0) rowsSel.push(r);
    for (const r of rowsSel) {
      for (let c = leftC1 + 1; c <= rightC0 - 1; c++) {
        this._open(c, r, 1);
        this._open(c, r, 3);
      }
    }

    // 房间内掩体（左右近似对称）
    const pillars = [
      [2, 2], [3, rows - 3], [leftC1 - 1, 2], [leftC1 - 2, rows - 3]
    ];
    for (const pc of pillars) {
      this._solidCell(pc[0], pc[1]);
      this._solidCell(cols - 1 - pc[0], pc[1]);
    }
  }

  /* ---------- 布局 5：十字交锋 ---------- */

  _genCross(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const corridor = opts.corridorCells || 1;
    const midC = Math.floor(cols / 2) - (corridor === 2 ? 1 : 0);
    const midR = Math.floor(rows / 2) - (corridor === 2 ? 1 : 0);

    // 十字大道
    this._carveRect(0, midR, cols - 1, midR + corridor - 1);
    this._carveRect(midC, 0, midC + corridor - 1, rows - 1);

    const quads = [
      { c0: 1, r0: 1, c1: midC - 2, r1: midR - 2, gateS: midR - 1, gateE: midC - 1 },
      { c0: midC + corridor, r0: 1, c1: cols - 2, r1: midR - 2, gateS: midR - 1, gateW: midC + corridor },
      { c0: 1, r0: midR + corridor, c1: midC - 2, r1: rows - 2, gateN: midR + corridor, gateE: midC - 1 },
      { c0: midC + corridor, r0: midR + corridor, c1: cols - 2, r1: rows - 2, gateN: midR + corridor, gateW: midC + corridor }
    ];

    for (const q of quads) {
      if (q.c1 - q.c0 < 1 || q.r1 - q.r0 < 1) continue;
      this._mazeRegion(rng, q.c0, q.r0, q.c1, q.r1);
      // 四角小广场，避免纯迷宫过密
      if (q.c1 - q.c0 >= 4 && q.r1 - q.r0 >= 3) {
        const pc = Math.floor((q.c0 + q.c1) / 2);
        const pr = Math.floor((q.r0 + q.r1) / 2);
        this._carveRect(pc - 1, pr, pc, pr + 1);
      }
      // 门洞：南北向与东西向各开一个，形成绕行环路
      if (q.gateS != null) {
        const gc = q.c0 + Math.floor((q.c1 - q.c0) / 2);
        this._open(gc, q.gateS, 0);      // 连到象限
        this._open(gc, q.gateS, 2);      // 连到十字大道
      }
      if (q.gateN != null) {
        const gc = q.c0 + Math.floor((q.c1 - q.c0) / 2);
        this._open(gc, q.gateN, 0);
        this._open(gc, q.gateN, 2);
      }
      if (q.gateE != null) {
        const gr = q.r0 + Math.floor((q.r1 - q.r0) / 2);
        this._open(q.gateE, gr, 3);
        this._open(q.gateE, gr, 1);
      }
      if (q.gateW != null) {
        const gr = q.r0 + Math.floor((q.r1 - q.r0) / 2);
        this._open(q.gateW, gr, 3);
        this._open(q.gateW, gr, 1);
      }
    }
  }

  /* ---------- 布局 6：城市街区 ---------- */

  _genGrid(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const every = Math.max(2, opts.streetEvery || 3);
    const streetRows = [], streetCols = [];
    for (let r = 1; r < rows - 1; r += every) streetRows.push(r);
    for (let c = 1; c < cols - 1; c += every) streetCols.push(c);
    if (!streetRows.length) streetRows.push(Math.floor(rows / 2));
    if (!streetCols.length) streetCols.push(Math.floor(cols / 2));

    for (const r of streetRows) this._carveRect(0, r, cols - 1, r);
    for (const c of streetCols) this._carveRect(c, 0, c, rows - 1);

    // 街区（两条街道之间的矩形）
    const rowBands = [];
    let prev = -1;
    for (const r of streetRows) {
      if (r - prev > 1) rowBands.push([prev + 1, r - 1]);
      prev = r;
    }
    if (rows - 2 - prev >= 1) rowBands.push([prev + 1, rows - 2]);
    const colBands = [];
    prev = -1;
    for (const c of streetCols) {
      if (c - prev > 1) colBands.push([prev + 1, c - 1]);
      prev = c;
    }
    if (cols - 2 - prev >= 1) colBands.push([prev + 1, cols - 2]);

    for (const [r0, r1] of rowBands) {
      for (const [c0, c1] of colBands) {
        if (r1 < r0 || c1 < c0) continue;
        const w = c1 - c0 + 1, h = r1 - r0 + 1;
        const roll = rng();
        if (roll < 0.42 && w >= 1 && h >= 1) {
          // 街区庭院：内部开阔，开 1~2 个门
          this._carveRect(c0, r0, c1, r1);
          const doors = 1 + Math.floor(rng() * 2);
          for (let d = 0; d < doors; d++) {
            const side = Math.floor(rng() * 4);
            if (side === 0) this._open(c0 + Math.floor(rng() * w), r0, 0);
            else if (side === 1) this._open(c1, r0 + Math.floor(rng() * h), 1);
            else if (side === 2) this._open(c0 + Math.floor(rng() * w), r1, 2);
            else this._open(c0, r0 + Math.floor(rng() * h), 3);
          }
        } else if (roll < 0.72 && w >= 2 && h >= 1) {
          // 穿街巷道：横向或纵向打通
          if (rng() < 0.5) {
            const rr = r0 + Math.floor(rng() * h);
            this._carveRect(c0, rr, c1, rr);
            this._open(c0, rr, 3);
            this._open(c1, rr, 1);
          } else {
            const cc = c0 + Math.floor(rng() * w);
            this._carveRect(cc, r0, cc, r1);
            this._open(cc, r0, 0);
            this._open(cc, r1, 2);
          }
        }
      }
    }

    // 中央广场：把靠近地图中心的一个街区完全打开并四面开门
    const ccx = cols / 2, ccy = rows / 2;
    let best = null, bestD = Infinity;
    for (const [r0, r1] of rowBands) {
      for (const [c0, c1] of colBands) {
        const d = Math.abs((c0 + c1) / 2 - ccx) + Math.abs((r0 + r1) / 2 - ccy);
        if (d < bestD) { bestD = d; best = { r0, r1, c0, c1 }; }
      }
    }
    if (best) {
      this._carveRect(best.c0, best.r0, best.c1, best.r1);
      for (let c = best.c0; c <= best.c1; c++) { this._open(c, best.r0, 0); this._open(c, best.r1, 2); }
      for (let r = best.r0; r <= best.r1; r++) { this._open(best.c0, r, 3); this._open(best.c1, r, 1); }
    }
  }

  /* ---------- 布局 7：中央枢纽 ---------- */

  _genHub(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const midC = Math.floor(cols / 2), midR = Math.floor(rows / 2);
    const pw = Math.max(3, Math.round(cols * 0.26));
    const ph = Math.max(3, Math.round(rows * 0.30));
    const px0 = clamp(midC - Math.floor(pw / 2), 2, cols - 3);
    const px1 = clamp(px0 + pw - 1, px0 + 1, cols - 2);
    const py0 = clamp(midR - Math.floor(ph / 2), 2, rows - 3);
    const py1 = clamp(py0 + ph - 1, py0 + 1, rows - 2);

    this._carveRect(px0, py0, px1, py1);          // 中央广场
    this._pillarGrid(px0, py0, px1, py1, 3);
    this._carveRing(0);                            // 外围环廊

    // 四向辐条
    for (let r = 1; r <= py0 - 1; r++) { this._open(midC, r, 0); this._open(midC, r, 2); }
    for (let r = py1 + 1; r <= rows - 2; r++) { this._open(midC, r, 0); this._open(midC, r, 2); }
    for (let c = 1; c <= px0 - 1; c++) { this._open(c, midR, 3); this._open(c, midR, 1); }
    for (let c = px1 + 1; c <= cols - 2; c++) { this._open(c, midR, 3); this._open(c, midR, 1); }

    // 四角房间 + 与外环的门 + 与广场的门（形成环路）
    const rooms = [
      { c0: 1, r0: 1, c1: px0 - 1, r1: py0 - 1, doorS: true, doorE: true },
      { c0: px1 + 1, r0: 1, c1: cols - 2, r1: py0 - 1, doorS: true, doorW: true },
      { c0: 1, r0: py1 + 1, c1: px0 - 1, r1: rows - 2, doorN: true, doorE: true },
      { c0: px1 + 1, r0: py1 + 1, c1: cols - 2, r1: rows - 2, doorN: true, doorW: true }
    ];
    for (const rm of rooms) {
      if (rm.c1 - rm.c0 < 1 || rm.r1 - rm.r0 < 1) continue;
      this._carveRect(rm.c0, rm.r0, rm.c1, rm.r1);
      // 与外环连通
      this._open(rm.c0 + Math.floor((rm.c1 - rm.c0) / 2), rm.r0, 0);
      // 与广场方向连通（通过辐条/广场边的门）
      if (rm.doorE) this._open(rm.c1, rm.r0 + Math.floor((rm.r1 - rm.r0) / 2), 1);
      if (rm.doorW) this._open(rm.c0, rm.r0 + Math.floor((rm.r1 - rm.r0) / 2), 3);
      if (rm.doorS) this._open(rm.c0 + Math.floor((rm.c1 - rm.c0) / 2), rm.r1, 2);
      if (rm.doorN) this._open(rm.c0 + Math.floor((rm.c1 - rm.c0) / 2), rm.r0, 0);
      // 房间内小掩体
      this._solidCell(rm.c0 + 1, rm.r0 + 1);
    }
  }

  /* ---------- 布局 8：BSP 多房间 ---------- */

  _genRooms(opts, rng) {
    const cols = this.cols, rows = this.rows;
    const minW = Math.max(3, Math.floor(cols / 8));
    const minH = Math.max(2, Math.floor(rows / 8));
    const leaves = [];
    const self = this;

    function split(c0, r0, c1, r1, depth) {
      const w = c1 - c0 + 1, h = r1 - r0 + 1;
      const canV = w >= minW * 2;
      const canH = h >= minH * 2;
      if (depth >= 7 || (!canV && !canH)) { leaves.push({ c0, r0, c1, r1 }); return; }
      let vertical;
      if (canV && canH) vertical = (w / minW >= h / minH) ? rng() < 0.72 : rng() < 0.28;
      else vertical = canV;
      if (vertical) {
        const cut = c0 + minW + Math.floor(rng() * (w - minW * 2 + 1));
        const dr = r0 + Math.floor(rng() * h);
        self.vWall[cut][dr] = 0;
        split(c0, r0, cut - 1, r1, depth + 1);
        split(cut, r0, c1, r1, depth + 1);
      } else {
        const cut = r0 + minH + Math.floor(rng() * (h - minH * 2 + 1));
        const dc = c0 + Math.floor(rng() * w);
        self.hWall[dc][cut] = 0;
        split(c0, r0, c1, cut - 1, depth + 1);
        split(c0, cut, c1, r1, depth + 1);
      }
    }
    split(1, 1, cols - 2, rows - 2, 0);
    for (const l of leaves) this._carveRect(l.c0, l.r0, l.c1, l.r1);

    // 额外环路：相邻房间之间再开门
    for (let i = 0; i < leaves.length; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        if (rng() > 0.28) continue;
        const a = leaves[i], b = leaves[j];
        if (a.c1 + 1 === b.c0) {
          const r0 = Math.max(a.r0, b.r0), r1 = Math.min(a.r1, b.r1);
          if (r1 >= r0) this.vWall[b.c0][r0 + Math.floor(rng() * (r1 - r0 + 1))] = 0;
        } else if (a.r1 + 1 === b.r0) {
          const c0 = Math.max(a.c0, b.c0), c1 = Math.min(a.c1, b.c1);
          if (c1 >= c0) this.hWall[c0 + Math.floor(rng() * (c1 - c0 + 1))][b.r0] = 0;
        }
      }
    }
    // 大房间加柱子，避免空旷
    for (const l of leaves) {
      if (l.c1 - l.c0 >= 4 && l.r1 - l.r0 >= 3) {
        this._solidCell(l.c0 + 2, l.r0 + 1);
        if (l.c1 - l.c0 >= 6) this._solidCell(l.c1 - 2, l.r1 - 1);
      }
    }
  }

  /* ---------- 布局 9：多环迷城 ---------- */

  _genLabyrinth(opts, rng) {
    this._genMaze(opts, rng);
    // 叠加环形回路：外环 + 内环
    this._carveRing(0);
    if (this.cols >= 16 && this.rows >= 10) this._carveRing(2);
    // 随机房间
    const rooms = 2;
    for (let i = 0; i < rooms; i++) {
      const rc = 2 + Math.floor(rng() * (this.cols - 5));
      const rr = 2 + Math.floor(rng() * (this.rows - 5));
      this._carveRect(rc, rr, rc + 1, rr + 1);
    }
  }

  /* ================= 墙体 / 索引 / 导航 ================= */

  _buildWalls() {
    const t = this.thickness;
    const cw = this.cellW, ch = this.cellH;

    // 合并同一直线上连续的墙段，减少碰撞体和绘制次数
    for (let c = 0; c <= this.cols; c++) {
      let run = -1;
      for (let r = 0; r <= this.rows; r++) {
        const has = r < this.rows && this.vWall[c][r];
        if (has) { if (run < 0) run = r; }
        else if (run >= 0) {
          const y0 = run * ch, y1 = r * ch;
          this.walls.push({ x: c * cw - t / 2, y: y0 - t / 2, w: t, h: y1 - y0 + t });
          run = -1;
        }
      }
    }
    for (let r = 0; r <= this.rows; r++) {
      let run = -1;
      for (let c = 0; c <= this.cols; c++) {
        const has = c < this.cols && this.hWall[c][r];
        if (has) { if (run < 0) run = c; }
        else if (run >= 0) {
          const x0 = run * cw, x1 = c * cw;
          this.walls.push({ x: x0 - t / 2, y: r * ch - t / 2, w: x1 - x0 + t, h: t });
          run = -1;
        }
      }
    }

    // 非地板格填成实心墙（按行合并成矩形，保持墙体数量受控）
    for (let r = 0; r < this.rows; r++) {
      let run = -1;
      for (let c = 0; c <= this.cols; c++) {
        const solid = c < this.cols && !this._isFloor(c, r);
        if (solid) { if (run < 0) run = c; }
        else if (run >= 0) {
          this.walls.push({
            x: run * cw, y: r * ch, w: (c - run) * cw, h: ch
          });
          run = -1;
        }
      }
    }
  }

  _buildSpatialGrid() {
    const gs = CONFIG.MAZE.gridSize;
    this.gridSize = gs;
    this.gridCols = Math.ceil(this.width / gs) + 2;
    this.gridRows = Math.ceil(this.height / gs) + 2;
    this.grid = [];
    const n = this.gridCols * this.gridRows;
    for (let i = 0; i < n; i++) this.grid.push([]);

    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      // +1 偏移，允许墙体略微超出画布（边界墙）
      const x0 = clamp(Math.floor((w.x) / gs) + 1, 0, this.gridCols - 1);
      const x1 = clamp(Math.floor((w.x + w.w) / gs) + 1, 0, this.gridCols - 1);
      const y0 = clamp(Math.floor((w.y) / gs) + 1, 0, this.gridRows - 1);
      const y1 = clamp(Math.floor((w.y + w.h) / gs) + 1, 0, this.gridRows - 1);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) this.grid[cy * this.gridCols + cx].push(i);
      }
    }
    this._stamp = new Int32Array(this.walls.length);
  }

  /** 取出圆形范围内的墙体（去重） */
  queryWalls(x, y, r) {
    const gs = this.gridSize;
    const x0 = clamp(Math.floor((x - r) / gs) + 1, 0, this.gridCols - 1);
    const x1 = clamp(Math.floor((x + r) / gs) + 1, 0, this.gridCols - 1);
    const y0 = clamp(Math.floor((y - r) / gs) + 1, 0, this.gridRows - 1);
    const y1 = clamp(Math.floor((y + r) / gs) + 1, 0, this.gridRows - 1);
    const out = [];
    const id = ++this._stampId;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.grid[cy * this.gridCols + cx];
        for (let k = 0; k < bucket.length; k++) {
          const idx = bucket[k];
          if (this._stamp[idx] !== id) {
            this._stamp[idx] = id;
            out.push(this.walls[idx]);
          }
        }
      }
    }
    return out;
  }

  /* ---------- 射线 / 可见性 ---------- */

  /**
   * 射线检测（沿网格 DDA 前进，遇到第一个墙体即返回）
   * @returns {{t:number,x:number,y:number,nx:number,ny:number}|null}
   */
  raycast(x0, y0, dx, dy, maxDist, radius) {
    radius = radius || 0;
    const gs = this.gridSize;
    let best = null;

    let cellX = clamp(Math.floor(x0 / gs) + 1, 0, this.gridCols - 1);
    let cellY = clamp(Math.floor(y0 / gs) + 1, 0, this.gridRows - 1);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;

    let tMaxX = dx !== 0 ? (((cellX - 1 + (dx > 0 ? 1 : 0)) * gs) - x0) / dx : Infinity;
    let tMaxY = dy !== 0 ? (((cellY - 1 + (dy > 0 ? 1 : 0)) * gs) - y0) / dy : Infinity;
    if (tMaxX < 0) tMaxX = 0;
    if (tMaxY < 0) tMaxY = 0;
    const tDeltaX = dx !== 0 ? Math.abs(gs / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(gs / dy) : Infinity;

    let tEnter = 0;
    for (let guard = 0; guard < 512; guard++) {
      // 细长墙体（如边界墙）会跨越很多格子，可能在本格内被"远处"命中，
      // 因此必须继续前进直到当前格子的入口距离超过已找到的最近命中距离。
      if (best && tEnter > best.t) break;

      const bucket = this.grid[cellY * this.gridCols + cellX];
      for (let i = 0; i < bucket.length; i++) {
        const w = this.walls[bucket[i]];
        const h = Physics.rayRect(x0, y0, dx, dy, w, radius, maxDist);
        if (h && (!best || h.t < best.t)) best = h;
      }

      let tNext;
      if (tMaxX < tMaxY) {
        tNext = tMaxX;
        cellX += stepX;
        tMaxX += tDeltaX;
      } else {
        tNext = tMaxY;
        cellY += stepY;
        tMaxY += tDeltaY;
      }
      if (tNext > maxDist) break;
      tEnter = tNext;
      if (cellX < 0 || cellY < 0 || cellX >= this.gridCols || cellY >= this.gridRows) break;
    }

    if (!best) return null;
    return {
      t: best.t,
      x: x0 + dx * best.t,
      y: y0 + dy * best.t,
      nx: best.nx,
      ny: best.ny
    };
  }

  /** 两点之间是否没有墙体遮挡 */
  losClear(x1, y1, x2, y2, radius) {
    const dx = x2 - x1, dy = y2 - y1;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return true;
    const hit = this.raycast(x1, y1, dx / d, dy / d, d, radius === undefined ? 2 : radius);
    return !hit || hit.t >= d - 0.01;
  }

  /** 半径为 r 的圆能否从 A 平滑移动到 B */
  walkableLine(x1, y1, x2, y2, r) {
    return this.losClear(x1, y1, x2, y2, r - 0.5);
  }

  /** 某个点是否能放下半径为 r 的圆 */
  isFree(x, y, r) {
    const walls = this.queryWalls(x, y, r + 2);
    for (let i = 0; i < walls.length; i++) {
      if (Physics.circleRectOverlap(x, y, r, walls[i])) return false;
    }
    return x > r && y > r && x < this.width - r && y < this.height - r;
  }

  /** 某个点周围的可行走空间（导航格计数），用于出生点/道具点评分 */
  openness(x, y, radius) {
    const gs = this.navSize;
    const cx0 = clamp(Math.floor((x - radius) / gs), 0, this.navCols - 1);
    const cx1 = clamp(Math.floor((x + radius) / gs), 0, this.navCols - 1);
    const cy0 = clamp(Math.floor((y - radius) / gs), 0, this.navRows - 1);
    const cy1 = clamp(Math.floor((y + radius) / gs), 0, this.navRows - 1);
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.navFree[cy * this.navCols + cx]) n++;
      }
    }
    return n;
  }

  /* ---------- AI 导航网格 ---------- */

  _buildNavGrid() {
    const gs = CONFIG.MAZE.navCell;
    this.navSize = gs;
    this.navCols = Math.ceil(this.width / gs);
    this.navRows = Math.ceil(this.height / gs);
    const total = this.navCols * this.navRows;
    this.navFree = new Uint8Array(total);
    const r = CONFIG.TANK.radius + 1.5;
    for (let cy = 0; cy < this.navRows; cy++) {
      for (let cx = 0; cx < this.navCols; cx++) {
        const x = (cx + 0.5) * gs, y = (cy + 0.5) * gs;
        this.navFree[cy * this.navCols + cx] = this.isFree(x, y, r) ? 1 : 0;
      }
    }
    this._gScore = new Float32Array(total);
    this._fScore = new Float32Array(total);
    this._cameFrom = new Int32Array(total);
    this._closed = new Uint8Array(total);
    this._visitMark = new Int32Array(total);
    this._visitId = 0;
    // A* 默认节点上限随导航网格规模自适应：
    // 扩图后长距离寻路可能需要展开大量格子，固定 4000 会在大地图上失联。
    this.pathNodeLimit = clamp(Math.round(total * 0.55), 4000, 60000);
  }

  navIndexOf(x, y) {
    const gs = this.navSize;
    const cx = clamp(Math.floor(x / gs), 0, this.navCols - 1);
    const cy = clamp(Math.floor(y / gs), 0, this.navRows - 1);
    return cy * this.navCols + cx;
  }

  navCenter(idx) {
    const cx = idx % this.navCols;
    const cy = (idx / this.navCols) | 0;
    return { x: (cx + 0.5) * this.navSize, y: (cy + 0.5) * this.navSize };
  }

  /** 找到最近的可行走格子 */
  nearestFree(idx, maxRing) {
    if (this.navFree[idx]) return idx;
    const cx = idx % this.navCols;
    const cy = (idx / this.navCols) | 0;
    const maxR = maxRing || 8;
    for (let ring = 1; ring <= maxR; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this.navCols || ny >= this.navRows) continue;
          const i = ny * this.navCols + nx;
          if (this.navFree[i]) return i;
        }
      }
    }
    return -1;
  }

  /**
   * A* 寻路（8 方向，禁止贴角穿越）
   * @returns {Array<{x:number,y:number}>|null}
   */
  findPath(sx, sy, tx, ty, maxNodes) {
    const cols = this.navCols, rows = this.navRows;
    const start = this.nearestFree(this.navIndexOf(sx, sy), 6);
    const goal = this.nearestFree(this.navIndexOf(tx, ty), 10);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, y: ty }];

    const gScore = this._gScore;
    const fScore = this._fScore;
    const cameFrom = this._cameFrom;
    const closed = this._closed;
    const visit = this._visitMark;
    const visitId = ++this._visitId;
    const limit = maxNodes || this.pathNodeLimit || 4000;

    const goalCx = goal % cols, goalCy = (goal / cols) | 0;
    const heuristic = (idx) => {
      const cx = idx % cols, cy = (idx / cols) | 0;
      const dx = Math.abs(cx - goalCx), dy = Math.abs(cy - goalCy);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const heap = Maze._sharedHeap || (Maze._sharedHeap = new MinHeap());
    heap.clear();   // 复用堆实例（寻路同步执行，无重入），消除每次寻路的对象分配
    gScore[start] = 0;
    fScore[start] = heuristic(start);
    cameFrom[start] = -1;
    visit[start] = visitId;
    closed[start] = 0;
    heap.push(start, fScore[start]);

    let expanded = 0;
    while (heap.size) {
      const current = heap.pop();
      if (current === goal) {
        // 回溯路径
        const path = [];
        let node = current;
        while (node !== -1) {
          path.push(this.navCenter(node));
          node = cameFrom[node];
        }
        path.reverse();
        return path;
      }
      if (closed[current] === 1 && visit[current] === visitId) continue;
      closed[current] = 1;
      if (++expanded > limit) break;

      const cx = current % cols, cy = (current / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (!this.navFree[ni]) continue;
          // 对角线不允许贴着墙角穿过
          if (dx !== 0 && dy !== 0) {
            if (!this.navFree[cy * cols + nx] || !this.navFree[ny * cols + cx]) continue;
          }
          const stepCost = (dx !== 0 && dy !== 0) ? Math.SQRT2 : 1;
          const tentative = gScore[current] + stepCost;
          if (visit[ni] !== visitId || tentative < gScore[ni]) {
            visit[ni] = visitId;
            closed[ni] = 0;
            gScore[ni] = tentative;
            cameFrom[ni] = current;
            fScore[ni] = tentative + heuristic(ni);
            heap.push(ni, fScore[ni]);
          }
        }
      }
    }
    return null;
  }

  /* ---------- 出生点 ---------- */

  /**
   * 挑选出生点：在几何距离之外，还考虑周边可行走空间与路线选择。
   * - 必须能放下坦克（isFree）
   * - 周边保留足够机动空间（openness），避免出生即死角
   * - 与其它出生点保持距离，且尽量分散在地图不同区域
   * @returns {Array<{x:number,y:number}>}
   */
  pickSpawns(count) {
    const rng = seededRandom(this.seed + '-spawns');
    const cells = [];
    const clearance = Math.min(this.cellW, this.cellH) * 1.35;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = (c + 0.5) * this.cellW, y = (r + 0.5) * this.cellH;
        if (!this.isFree(x, y, CONFIG.TANK.radius + 2)) continue;
        const open = this.openness(x, y, clearance);
        if (open < 2) continue;
        cells.push({ c, r, x, y, open });
      }
    }
    if (!cells.length) return this._fallbackSpawns(count);

    // 扩图后按地图面积适度放大出生点间距（仅对大地图生效，小地图保持原节奏）
    const areaK = Math.sqrt((this.width * this.height) / (CONFIG.WIDTH * CONFIG.HEIGHT));
    const spread = this.big ? clamp(areaK, 1, 1.6) : 1;
    const want = Math.min(320, 900 / Math.max(1, count)) * spread;
    const chosen = [];
    for (let attempt = 0; attempt < 400 && chosen.length < count; attempt++) {
      let best = null, bestScore = -Infinity;
      for (let i = 0; i < 28; i++) {
        const cell = cells[Math.floor(rng() * cells.length)];
        let minD = Infinity;
        for (const p of chosen) minD = Math.min(minD, dist(cell.x, cell.y, p.x, p.y));
        const spread = chosen.length ? Math.min(minD, want * 1.5) : 0;
        const score = spread + cell.open * 6 + rng() * 24;
        if (score > bestScore) { bestScore = score; best = cell; }
      }
      if (!best) break;
      let ok = true;
      for (const p of chosen) {
        if (dist(best.x, best.y, p.x, p.y) < want * 0.72) { ok = false; break; }
      }
      if (ok) chosen.push(best);
    }
    if (chosen.length < count) {
      for (const cell of shuffle(rng, cells.slice())) {
        if (chosen.length >= count) break;
        let ok = true;
        for (const p of chosen) {
          if (dist(cell.x, cell.y, p.x, p.y) < 90) { ok = false; break; }
        }
        if (ok) chosen.push(cell);
      }
    }
    if (chosen.length < count) return this._fallbackSpawns(count);
    return chosen.map(c => ({ x: c.x, y: c.y }));
  }

  _fallbackSpawns(count) {
    const rng = seededRandom(this.seed + '-fallback-spawns');
    // 与 pickSpawns 一致：兜底间距随地图面积放大（仅大地图生效）
    const areaK = Math.sqrt((this.width * this.height) / (CONFIG.WIDTH * CONFIG.HEIGHT));
    const spread = this.big ? clamp(areaK, 1, 1.6) : 1;
    const minDist = 100 * spread;
    const free = [];
    for (let i = 0; i < this.navFree.length; i++) {
      if (this.navFree[i]) free.push(this.navCenter(i));
    }
    shuffle(rng, free);
    const out = [];
    for (const p of free) {
      if (out.length >= count) break;
      let ok = true;
      for (const q of out) if (dist(p.x, p.y, q.x, q.y) < minDist) { ok = false; break; }
      if (ok) out.push(p);
    }
    return out;
  }

  /* ---------- 绘制 ---------- */

  /** @param {{x:number,y:number,w:number,h:number}} [camera] 视野裁剪 */
  render(ctx, camera) {
    const walls = this.walls;
    const visible = [];
    if (!camera) {
      for (let i = 0; i < walls.length; i++) visible.push(walls[i]);
    } else {
      const left = camera.x - 4, right = camera.x + camera.w + 4;
      const top = camera.y - 4, bottom = camera.y + camera.h + 4;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.x > right || w.x + w.w < left || w.y > bottom || w.y + w.h < top) continue;
        visible.push(w);
      }
    }
    // 冰墙主体
    ctx.fillStyle = CONFIG.COLORS.wall;
    for (let i = 0; i < visible.length; i++) {
      const w = visible[i];
      ctx.fillRect(w.x, w.y, w.w, w.h);
    }
    // 冰棱高光（顶部受光的细描边，纯装饰）
    ctx.strokeStyle = CONFIG.COLORS.wallEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < visible.length; i++) {
      const w = visible[i];
      ctx.rect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }
    ctx.stroke();
  }
}
