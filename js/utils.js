'use strict';
/* =========================================================
 * 通用数学工具
 * ========================================================= */

const TAU = Math.PI * 2;

function clamp(v, min, max) { return v < min ? min : (v > max ? max : v); }
function lerp(a, b, t) { return a + (b - a) * t; }

function dist(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  return Math.sqrt(dx * dx + dy * dy);
}

function dist2(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  return dx * dx + dy * dy;
}

/** 将角度归一化到 (-PI, PI] */
function normalizeAngle(a) {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a < -Math.PI) a += TAU;
  return a;
}

/** from -> to 的最短角度差，范围 (-PI, PI] */
function angleDiff(from, to) {
  return normalizeAngle(to - from);
}

/** 以最大角速度 maxStep 朝目标旋转，始终走最短路径 */
function rotateToward(current, target, maxStep) {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return normalizeAngle(target);
  return normalizeAngle(current + Math.sign(d) * maxStep);
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由字符串种子得到可复现的随机数生成器 */
function seededRandom(seed) {
  if (typeof seed === 'number') return mulberry32(seed | 0);
  return mulberry32(hashString(String(seed)));
}

function shuffle(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/** Canvas 圆角矩形（兼容不支持 roundRect 的浏览器） */
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 最小堆（A* 用）：双数组实现，push/pop 零对象分配，避免高频寻路触发 GC 尖刺 */
class MinHeap {
  constructor() { this.items = []; this.prios = []; }
  get size() { return this.items.length; }
  clear() { this.items.length = 0; this.prios.length = 0; }
  push(node, priority) {
    const items = this.items, prios = this.prios;
    let i = items.length;
    items.push(node);
    prios.push(priority);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (prios[p] <= prios[i]) break;
      const tn = items[p]; items[p] = items[i]; items[i] = tn;
      const tp = prios[p]; prios[p] = prios[i]; prios[i] = tp;
      i = p;
    }
  }
  pop() {
    const items = this.items, prios = this.prios;
    if (!items.length) return null;
    const top = items[0];
    const lastNode = items.pop(), lastPrio = prios.pop();
    const n = items.length;
    if (n) {
      items[0] = lastNode;
      prios[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let smallest = i;
        if (l < n && prios[l] < prios[smallest]) smallest = l;
        if (r < n && prios[r] < prios[smallest]) smallest = r;
        if (smallest === i) break;
        const tn = items[i]; items[i] = items[smallest]; items[smallest] = tn;
        const tp = prios[i]; prios[i] = prios[smallest]; prios[smallest] = tp;
        i = smallest;
      }
    }
    return top;
  }
}
