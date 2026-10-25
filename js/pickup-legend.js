'use strict';
/* =========================================================
 * 主菜单道具图鉴（升级版）
 * - 每种道具：图标贴图 + 名称/类别 + 效果/用法 + 功能演示动画（PickupDemos）
 * - 可滚动列表（max-height + overflow-y，滚轮原生支持）
 * - 展开时驱动单个 rAF 循环播放全部演示，收起自动停止
 * 纯普通脚本：2D 回退模式（file://）下同样可用
 * ========================================================= */

(function () {
  function build() {
    const grid = document.getElementById('pickup-legend-grid');
    const det = document.getElementById('pickup-legend');
    if (!grid || !det || typeof PICKUP_TYPES === 'undefined' || typeof PickupIcons === 'undefined') return;

    const KIND_USE = {
      weapon: '替换主炮 · 开火自动使用',
      boost: '拾取立即生效',
      ammo: '强化弹药 · 按次消耗',
      active: '主动释放（按键）',
      aura: '拾取立即生效'
    };
    const KIND_TAG = { weapon: '武器', boost: '强化', ammo: '弹药', active: '主动', aura: '感知' };
    const demos = [];   // { canvas, type }

    for (const key of PICKUP_KINDS) {
      const def = PICKUP_TYPES[key];
      const item = document.createElement('div');
      item.className = 'pk-item rarity-' + (def.rarity || 'common');

      let uses = '';
      if (def.shots) uses = ' × ' + def.shots() + ' 发';
      else if (def.charges) uses = ' × ' + def.charges() + ' 次';
      else if (def.time && def.time > 20) uses = ' · 持续 ' + Math.round(def.time) + 's';

      item.innerHTML =
        '<img class="pk-icon" alt="" draggable="false" src="' + PickupIcons.dataURL(key) + '">' +
        '<div class="pk-info">' +
          '<div class="pk-name">' + def.name +
            ' <span class="pk-kind pk-kind-' + def.kind + '">' + (KIND_TAG[def.kind] || def.kind) + '</span></div>' +
          '<div class="pk-desc">' + def.desc + uses + '</div>' +
          '<div class="pk-use">' + (KIND_USE[def.kind] || '') +
            (def.key ? ' · 按 ' + def.key + ' 释放' : '') + '</div>' +
        '</div>' +
        '<canvas class="pk-demo" width="132" height="76" title="功能演示"></canvas>';
      grid.appendChild(item);

      const cv = item.querySelector('.pk-demo');
      if (cv && typeof PickupDemos !== 'undefined') demos.push({ canvas: cv, type: key });
    }

    /* 演示动画：图鉴展开时单个 rAF 驱动全部画布，收起即停 */
    let rafId = 0;
    function tick() {
      if (!det.open) { rafId = 0; return; }
      const t = performance.now() / 1000;
      for (const d of demos) {
        const ctx = d.canvas.getContext('2d');
        ctx.clearRect(0, 0, d.canvas.width, d.canvas.height);
        PickupDemos.draw(d.type, ctx, d.canvas.width, d.canvas.height, t);
      }
      rafId = requestAnimationFrame(tick);
    }
    det.addEventListener('toggle', () => {
      if (det.open && !rafId) rafId = requestAnimationFrame(tick);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
