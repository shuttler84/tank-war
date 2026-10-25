'use strict';
/* =========================================================
 * 道具图标工厂（2D 原版图标的唯一权威复用）
 * 直接调用 pickup.js 的 Pickup.render 在离屏 canvas 上绘制，
 * 供 3D 广告牌贴图（three-proto.js）与主菜单道具图鉴
 * （pickup-legend.js）共用——图标与 2D 版完全一致，颜色+形状双区分。
 * ========================================================= */

const PickupIcons = (function () {
  const cache = {};
  const SIZE = 96;          // 2x 绘制空间（48×48 逻辑坐标），图标直径约 26px

  function canvasFor(type) {
    if (cache[type]) return cache[type];
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.scale(2, 2);
    const p = new Pickup(type, SIZE / 4, SIZE / 4);
    p.bob = 0;
    p.render(ctx, 0.55, null);   // time 固定 → 光晕/脉动取稳定中间值
    ctx.restore();
    cache[type] = c;
    return c;
  }

  return {
    /** 指定道具类型的图标画布（带缓存） */
    canvas: canvasFor,
    /** 图标 PNG 数据地址（<img> 用） */
    dataURL(type) { return canvasFor(type).toDataURL('image/png'); }
  };
})();
