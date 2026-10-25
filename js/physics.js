'use strict';
/* =========================================================
 * 通用碰撞与几何计算
 * 玩家和 AI 共用同一套实现，保证物理规则完全一致。
 * ========================================================= */

const Physics = {
  /** 圆与矩形是否重叠 */
  circleRectOverlap(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  },

  /**
   * 计算把圆推出矩形所需的位移
   * @returns {{nx:number, ny:number, depth:number}|null}
   */
  pushCircleOutOfRect(cx, cy, r, rect) {
    const nx = clamp(cx, rect.x, rect.x + rect.w);
    const ny = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - nx, dy = cy - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 > r * r) return null;

    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      return { nx: dx / d, ny: dy / d, depth: r - d };
    }
    // 圆心落在矩形内部：沿最浅的一条边推出
    const left = cx - rect.x;
    const right = rect.x + rect.w - cx;
    const top = cy - rect.y;
    const bottom = rect.y + rect.h - cy;
    const m = Math.min(left, right, top, bottom);
    if (m === left) return { nx: -1, ny: 0, depth: left + r };
    if (m === right) return { nx: 1, ny: 0, depth: right + r };
    if (m === top) return { nx: 0, ny: -1, depth: top + r };
    return { nx: 0, ny: 1, depth: bottom + r };
  },

  /**
   * 射线与矩形（按 radius 向外扩张）求交，slab 算法
   * (dx,dy) 必须是单位向量
   * @returns {{t:number, axis:number, nx:number, ny:number}|null}
   */
  rayRect(px, py, dx, dy, rect, radius, maxT) {
    const minx = rect.x - radius;
    const maxx = rect.x + rect.w + radius;
    const miny = rect.y - radius;
    const maxy = rect.y + rect.h + radius;

    let tmin = 0, tmax = maxT, axis = -1;

    if (Math.abs(dx) < 1e-9) {
      if (px < minx || px > maxx) return null;
    } else {
      const inv = 1 / dx;
      let t1 = (minx - px) * inv;
      let t2 = (maxx - px) * inv;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; axis = 0; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }

    if (Math.abs(dy) < 1e-9) {
      if (py < miny || py > maxy) return null;
    } else {
      const inv = 1 / dy;
      let t1 = (miny - py) * inv;
      let t2 = (maxy - py) * inv;
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) { tmin = t1; axis = 1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }

    if (axis < 0) return null;          // 起点位于扩张后的矩形内部
    if (tmin < 0 || tmin > maxT) return null;

    return {
      t: tmin,
      axis,
      nx: axis === 0 ? (dx > 0 ? -1 : 1) : 0,
      ny: axis === 1 ? (dy > 0 ? -1 : 1) : 0
    };
  },

  /**
   * 线段与圆求交
   * @returns {number} 命中处参数 t（0~1），未命中返回 -1
   */
  segmentCircle(x0, y0, x1, y1, cx, cy, r) {
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;                 // 起点已在圆内
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return -1;
    const b = 2 * (fx * dx + fy * dy);
    if (b >= 0) return -1;                // 正在远离该圆，不可能相交
    const disc = b * b - 4 * a * c;
    if (disc < 0) return -1;
    const sq = Math.sqrt(disc);
    const t = (-b - sq) / (2 * a);
    if (t < 0 || t > 1) return -1;
    return t;
  },

  /** 点到线段的距离 */
  pointSegmentDist(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return dist(px, py, x0, y0);
    let t = ((px - x0) * dx + (py - y0) * dy) / len2;
    t = clamp(t, 0, 1);
    return dist(px, py, x0 + dx * t, y0 + dy * t);
  }
};
