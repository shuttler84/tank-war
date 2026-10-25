'use strict';
/* =========================================================
 * 道具功能演示动画（主菜单图鉴用，每道具一个循环 canvas 动画）
 * 全部程序绘制（无外部素材），与游戏配色一致；
 * 由 pickup-legend.js 在图鉴展开时驱动单个 rAF 循环。
 * ========================================================= */

const PickupDemos = (function () {
  const TAU = Math.PI * 2;

  /* 通用小件：坦克（朝 angle 的三角车体+炮管）、墙、弹 */
  function tank(ctx, x, y, a, color) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = color || '#7fd97f';
    ctx.fillRect(-7, -5, 14, 10);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, 3.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = color || '#7fd97f'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(11, 0); ctx.stroke();
    ctx.restore();
  }
  function box(ctx, x, y, w, h) {
    ctx.fillStyle = 'rgba(150,170,190,0.5)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(180,210,235,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  function bullet(ctx, x, y, r, color) {
    ctx.fillStyle = color || '#ffe9a8';
    ctx.beginPath(); ctx.arc(x, y, r || 2.2, 0, TAU); ctx.fill();
  }
  const frac = t => t - Math.floor(t);

  const DEMOS = {
    laser(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        tank(ctx, 18, h / 2, 0);
        const k = frac(t / 1.6);
        // 三段折射光束扫过
        const x0 = 30 + k * 0, sweep = Math.sin(t * 2.2) * 10;
        const pts = [[x0, h / 2 + sweep], [w * 0.45, h * 0.24], [w * 0.7, h * 0.72], [w - 12, h * 0.3]];
        ctx.strokeStyle = '#37B6FF'; ctx.lineWidth = 2.6;
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(t * 9);
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
        bullet(ctx, pts[3][0], pts[3][1], 3, '#9FE8FF');
      };
    },
    cluster(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        tank(ctx, 16, h / 2, 0);
        const k = frac(t / 1.5);
        const bx = 26 + k * (w * 0.55), by = h / 2;
        if (k < 0.62) bullet(ctx, bx, by, 2.6, '#FF8A3C');
        else {
          const e = (k - 0.62) / 0.38;
          const cx = 26 + 0.62 * (w * 0.55);
          for (let i = 0; i < 7; i++) {
            const a = i * TAU / 7 + 0.4;
            const d = e * 26;
            ctx.globalAlpha = 1 - e;
            bullet(ctx, cx + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2, '#FF8A3C');
          }
          ctx.globalAlpha = 0.7 * (1 - e);
          ctx.strokeStyle = '#FF8A3C'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx, h / 2, 6 + e * 22, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      };
    },
    triple(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        tank(ctx, 16, h / 2, 0);
        const k = frac(t / 1.3);
        for (let i = -1; i <= 1; i++) {
          const a = i * 0.3;
          const d = k * (w - 40);
          bullet(ctx, 28 + Math.cos(a) * d, h / 2 + Math.sin(a) * d, 2.4, '#C79BFF');
        }
      };
    },
    shield(w, h, t) {
      return (ctx) => {
        tank(ctx, w / 2, h / 2, Math.sin(t) * 0.9);
        const pulse = 0.6 + 0.4 * Math.sin(t * 5);
        ctx.strokeStyle = '#7FD9FF'; ctx.globalAlpha = pulse; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(w / 2, h / 2, 17 + Math.sin(t * 5) * 2, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        // 来弹被弹开
        const k = frac(t / 1.1);
        const bx = w - 14 - k * (w / 2 - 22);
        if (k < 0.72) bullet(ctx, bx, h / 2 - 8, 2.2, '#ff9a9a');
      };
    },
    speed(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        const k = frac(t / 1.2);
        const x = 20 + (k < 0.5 ? k * 2 : 2 - k * 2) * (w - 40);
        const dir = k < 0.5 ? 0 : Math.PI;
        tank(ctx, x, h / 2, k < 0.5 ? 0 : Math.PI, '#FFD24A');
        ctx.strokeStyle = 'rgba(255,210,74,0.55)'; ctx.lineWidth = 1.6;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(dir) * (14 + i * 7), h / 2 - 6 + i);
          ctx.lineTo(x - Math.cos(dir) * (20 + i * 7), h / 2 - 6 + i);
          ctx.stroke();
        }
      };
    },
    rapid(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        tank(ctx, 16, h / 2, 0);
        for (let i = 0; i < 4; i++) {
          const k = frac(t * 1.4 + i * 0.25);
          bullet(ctx, 28 + k * (w - 44), h / 2 + (i % 2 ? 3 : -3), 2, '#FF6B6B');
        }
      };
    },
    bouncer(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        tank(ctx, 16, h / 2, 0);
        const k = frac(t / 2.2);
        const pts = [[30, h / 2], [w * 0.6, 16], [w - 16, h - 18], [w * 0.5, h / 2], [w - 14, 14]];
        let seg = Math.min(3, Math.floor(k * 4)), lk = frac(k * 4);
        const x = pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * lk;
        const y = pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * lk;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= 4; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke(); ctx.setLineDash([]);
        bullet(ctx, x, y, 2.6, '#9fe8ff');
      };
    },
    emp(w, h, t) {
      return (ctx) => {
        tank(ctx, 20, h / 2, 0);
        const k = frac(t / 1.8);
        ctx.strokeStyle = '#B6FF6E'; ctx.lineWidth = 2; ctx.globalAlpha = 1 - k;
        ctx.beginPath(); ctx.arc(20, h / 2, 8 + k * 34, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
        // 被脉冲瘫痪的敌人闪烁
        const hit = k > 0.45;
        ctx.globalAlpha = hit ? 0.35 + 0.3 * Math.sin(t * 14) : 0.9;
        tank(ctx, w - 26, h / 2 - 8, Math.PI, '#e08585');
        tank(ctx, w - 26, h / 2 + 10, Math.PI, '#e08585');
        ctx.globalAlpha = 1;
      };
    },
    mine(w, h, t) {
      return (ctx) => {
        box(ctx, 8, 10, w - 16, h - 20);
        const k = frac(t / 2.0);
        // 地雷（布设在中央）
        ctx.fillStyle = '#D9A066';
        ctx.beginPath(); ctx.arc(w / 2, h - 20, 4.4, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#D9A066'; ctx.lineWidth = 1.4;
        for (let i = 0; i < 4; i++) {
          const a = i * TAU / 4 + t * 0.8;
          ctx.beginPath();
          ctx.moveTo(w / 2 + Math.cos(a) * 5.4, h - 20 + Math.sin(a) * 5.4);
          ctx.lineTo(w / 2 + Math.cos(a) * 7.6, h - 20 + Math.sin(a) * 7.6);
          ctx.stroke();
        }
        // 敌坦克驶近 → 触发爆炸
        const ex = w - 22 - k * (w / 2 - 26);
        if (k < 0.68) tank(ctx, ex, h - 20, Math.PI, '#e08585');
        else {
          const e = (k - 0.68) / 0.32;
          ctx.globalAlpha = 1 - e;
          ctx.strokeStyle = '#FFC24A'; ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.arc(w / 2, h - 20, 6 + e * 26, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
        }
      };
    },
    radar(w, h, t) {
      return (ctx) => {
        const cx = 22, cy = h / 2;
        tank(ctx, cx, cy, 0);
        // 扫描扇区
        const a = t * 2.4;
        const grad = ctx.createConicGradient ? null : null;
        ctx.save();
        ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = 'rgba(124,240,160,0.22)';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 40, -0.5, 0.5); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(124,240,160,0.8)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(40, 0); ctx.stroke();
        ctx.restore();
        // 敌人方位点（扫描到时亮起）
        const e1 = { x: w - 24, y: 16 }, e2 = { x: w - 30, y: h - 16 };
        const ang = a => ((a % TAU) + TAU) % TAU;
        for (const e of [e1, e2]) {
          const ea = ang(Math.atan2(e.y - cy, e.x - cx));
          const sa = ang(a);
          const vis = ang(sa - ea) < 0.9;
          ctx.globalAlpha = vis ? 0.95 : 0.22;
          ctx.fillStyle = '#ff9a9a';
          ctx.beginPath(); ctx.arc(e.x, e.y, 3, 0, TAU); ctx.fill();
        }
        ctx.globalAlpha = 1;
      };
    }
  };

  /** 通用入口：把 (w,h,t) 柯里化的写法统一成 draw(ctx,w,h,t) */
  function draw(type, ctx, w, h, t) {
    const d = DEMOS[type];
    if (!d) return;
    d(w, h, t)(ctx);
  }

  return { draw };
})();
