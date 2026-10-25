'use strict';
/* =========================================================
 * 主菜单道具图鉴：每种道具的图标（贴图）+ 使用方法 + 效果
 * 数据源：PICKUP_TYPES（pickup.js）——名称/描述/类别/次数或时长
 * 图标：PickupIcons（复用 2D 原版绘制）
 * 纯普通脚本：2D 回退模式（file://）下图鉴同样可用
 * ========================================================= */

(function () {
  function build() {
    const grid = document.getElementById('pickup-legend-grid');
    if (!grid || typeof PICKUP_TYPES === 'undefined' || typeof PickupIcons === 'undefined') return;

    const KIND_USE = {
      weapon: '替换主炮 · 开火自动使用',
      boost: '拾取立即生效',
      ammo: '强化弹药 · 按次消耗',
      active: '主动释放（按键）',
      aura: '拾取立即生效'
    };
    const KIND_TAG = { weapon: '武器', boost: '强化', ammo: '弹药', active: '主动', aura: '感知' };

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
        '</div>';
      grid.appendChild(item);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
