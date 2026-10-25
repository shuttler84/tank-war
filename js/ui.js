'use strict';
/* =========================================================
 * 界面：全息指挥终端（主菜单 / 暂停 / 结算）
 * 菜单为 DOM 覆盖层，战场与背景地图预览由 Canvas 绘制
 * 地图卡片与缩略图由真实地图数据生成（与实际布局一致）
 * ========================================================= */

class UI {
  constructor(game) {
    this.game = game;
    this.screens = {
      menu: document.getElementById('screen-menu'),
      pause: document.getElementById('screen-pause'),
      over: document.getElementById('screen-over')
    };

    this.options = {
      map: 'classic',
      enemies: 2,
      lives: 3,
      difficulty: 'normal',
      sound: true
    };

    this.loadSettings();
    this.buildMapCards();
    this.bind();
    this.syncButtons();
    this.updateMapInfo();
    this.updateSummary();
    this.game.sound.enabled = this.options.sound;
    this.updateSoundLabel();
    this.updateFullscreenLabel();
    this.show('menu');

    game.onStateChange = (state, g) => this.onState(state, g);
  }

  /* ---------------- 设置持久化 ---------------- */

  loadSettings() {
    try {
      const raw = localStorage.getItem('tank-turmoil-settings');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object') {
        if (data.map) this.options.map = data.map;
        if (data.enemies) this.options.enemies = clamp(parseInt(data.enemies, 10) || 2, 1, 7);
        if (data.lives) this.options.lives = clamp(parseInt(data.lives, 10) || 3, 1, 9);
        if (data.difficulty) this.options.difficulty = data.difficulty;
        if (typeof data.sound === 'boolean') this.options.sound = data.sound;
      }
    } catch (e) { /* file:// 下可能不可用，忽略 */ }
  }

  saveSettings() {
    try {
      localStorage.setItem('tank-turmoil-settings', JSON.stringify(this.options));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------------- 地图卡片（真实缩略图） ---------------- */

  /** 用真实迷宫数据渲染一张缩略图（固定基准尺寸，保证与实际布局一致） */
  buildThumb(preset) {
    const W = 228, H = 152, K = 2;   // 2 倍缓冲保证高分屏清晰
    const canvas = document.createElement('canvas');
    canvas.width = W * K;
    canvas.height = H * K;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.scale(K, K);
    const T = CONFIG.THEME;
    ctx.fillStyle = T.thumbBg;
    ctx.fillRect(0, 0, W, H);

    try {
      const maze = preset.layout === 'random'
        ? Maze.createRandom('menu-thumb-' + preset.id, 960, 640)
        : Maze.createPreset(preset.id, 960, 640);
      const pad = 7;
      const s = Math.min((W - pad * 2) / maze.width, (H - pad * 2) / maze.height);
      const ox = (W - maze.width * s) / 2;
      const oy = (H - maze.height * s) / 2;
      // 冰面网格底纹
      ctx.strokeStyle = 'rgba(56, 216, 245, 0.07)';
      ctx.lineWidth = 0.5;
      const step = 80 * s;
      if (step > 3) {
        ctx.beginPath();
        for (let x = ox; x <= ox + maze.width * s; x += step) { ctx.moveTo(x, oy); ctx.lineTo(x, oy + maze.height * s); }
        for (let y = oy; y <= oy + maze.height * s; y += step) { ctx.moveTo(ox, y); ctx.lineTo(ox + maze.width * s, y); }
        ctx.stroke();
      }
      // 墙体（与实际布局同源）
      ctx.fillStyle = T.thumbWall;
      for (let i = 0; i < maze.walls.length; i++) {
        const w = maze.walls[i];
        ctx.fillRect(ox + w.x * s, oy + w.y * s, Math.max(0.8, w.w * s), Math.max(0.8, w.h * s));
      }
    } catch (e) {
      // 生成失败时退化为占位底图，不影响菜单可用性
    }
    ctx.strokeStyle = T.thumbBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    return canvas.toDataURL('image/png');
  }

  /** 生成全部地图卡片（小图 / 大图分组；随机地图归入大图组尾部） */
  buildMapCards() {
    const smallBox = document.getElementById('map-cards-small');
    const bigBox = document.getElementById('map-cards-big');
    if (!smallBox || !bigBox || typeof MAP_PRESETS === 'undefined') return;
    for (const preset of MAP_PRESETS) {
      const isRandom = preset.layout === 'random';
      const isBig = preset.size === 'big' || isRandom;
      const layoutName = (typeof MAP_LAYOUT_NAMES !== 'undefined' && MAP_LAYOUT_NAMES[preset.layout]) || preset.layout || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice map-card';
      btn.dataset.value = preset.id;
      btn.innerHTML =
        '<span class="thumb"><img alt="" draggable="false" src="' + this.buildThumb(preset) + '"></span>' +
        '<span class="card-name">' + preset.name + '</span>' +
        '<span class="card-meta">' + (isRandom
          ? '随机 · 每局变化'
          : (isBig ? '大图 · ' : '小图 · ') + layoutName) + '</span>' +
        (preset.tagline ? '<span class="card-tag">' + preset.tagline + '</span>' : '');
      (isBig ? bigBox : smallBox).appendChild(btn);
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  bind() {
    const groupOf = (el) => {
      const holder = el.closest('[data-group]');
      return holder ? holder.dataset.group : null;
    };

    document.querySelectorAll('.choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const group = groupOf(btn);
        if (!group) return;
        const raw = btn.dataset.value;
        this.options[group] = (group === 'enemies' || group === 'lives') ? parseInt(raw, 10) : raw;
        if (group === 'map') this.game.setMenuMap(raw, raw === 'random');
        this.syncButtons();
        if (group === 'map') this.updateMapInfo();
        this.updateSummary();
        this.saveSettings();
        this.game.sound.play('ui');
      });
    });

    const start = document.getElementById('btn-start');
    if (start) start.addEventListener('click', () => this.startFromMenu());

    const resume = document.getElementById('btn-resume');
    if (resume) resume.addEventListener('click', () => { this.game.sound.play('ui'); this.game.resume(); });

    const restart = document.getElementById('btn-restart');
    if (restart) restart.addEventListener('click', () => { this.game.sound.play('ui'); this.game.restart(); });

    const menu = document.getElementById('btn-menu');
    if (menu) menu.addEventListener('click', () => { this.game.sound.play('ui'); this.game.backToMenu(); });

    const again = document.getElementById('btn-again');
    if (again) again.addEventListener('click', () => { this.game.sound.play('ui'); this.game.restart(); });

    const menu2 = document.getElementById('btn-menu2');
    if (menu2) menu2.addEventListener('click', () => { this.game.sound.play('ui'); this.game.backToMenu(); });

    const soundBtn = document.getElementById('btn-sound');
    if (soundBtn) {
      soundBtn.addEventListener('click', () => {
        this.options.sound = !this.options.sound;
        this.game.sound.enabled = this.options.sound;
        this.updateSoundLabel();
        this.updateSummary();
        this.saveSettings();
        this.game.sound.play('ui');
      });
    }

    // 浏览器全屏（需要用户手势触发，这里提供显式入口）
    const fsBtn = document.getElementById('btn-fullscreen');
    if (fsBtn) {
      fsBtn.addEventListener('click', () => {
        const doc = document;
        try {
          const el = doc.documentElement;
          if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
            const req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (req) {
              const p = req.call(el);
              if (p && p.catch) p.catch(() => { /* 用户拒绝或不支持时忽略 */ });
            }
          } else {
            const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
            if (exit) {
              const p = exit.call(doc);
              if (p && p.catch) p.catch(() => {});
            }
          }
        } catch (e) { /* 部分环境不支持，忽略 */ }
        this.updateFullscreenLabel();
      });
      document.addEventListener('fullscreenchange', () => this.updateFullscreenLabel());
      document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenLabel());
    }

    // 战斗 HUD 暂停按钮
    const hudPause = document.getElementById('btn-hud-pause');
    if (hudPause) {
      hudPause.addEventListener('click', () => {
        this.game.sound.play('ui');
        this.game.pause();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || this.game.state !== 'menu') return;
      // 焦点在按钮上时由按钮自身处理，避免重复开局
      const tag = e.target && e.target.tagName;
      if (tag === 'BUTTON' || tag === 'INPUT') return;
      this.startFromMenu();
    });
  }

  startFromMenu() {
    this.game.sound.play('ui');
    this.game.sound.resume();
    this.game.startMatch({
      mapId: this.options.map,
      enemies: this.options.enemies,
      lives: this.options.lives,
      difficulty: this.options.difficulty
    });
  }

  /* ---------------- 状态展示 ---------------- */

  updateSoundLabel() {
    const btn = document.getElementById('btn-sound');
    if (btn) btn.textContent = this.options.sound ? '音效：开' : '音效：关';
  }

  updateFullscreenLabel() {
    const btn = document.getElementById('btn-fullscreen');
    if (!btn) return;
    const active = !!(document.fullscreenElement || document.webkitFullscreenElement);
    btn.textContent = active ? '⤢ 退出全屏' : '⛶ 全屏';
  }

  syncButtons() {
    document.querySelectorAll('[data-group]').forEach(holder => {
      const group = holder.dataset.group;
      const current = String(this.options[group]);
      holder.querySelectorAll('.choice').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === current);
      });
    });
    this.updateEnemyLimits();
  }

  /** 标准地图最多 5 辆敌人，大地图最多 7 辆；随机地图可能生成大图，按大地图上限处理 */
  isBigMap(mapId) {
    if (mapId === 'random') return true;
    const preset = typeof MAP_PRESETS !== 'undefined' && MAP_PRESETS.find(p => p.id === mapId);
    return !!(preset && (preset.size === 'big' || preset.big));
  }

  /** 显示当前所选地图的规模/布局类型/战术特色（背景画布即实时预览） */
  updateMapInfo() {
    const el = document.getElementById('map-info');
    if (!el) return;
    const preset = typeof MAP_PRESETS !== 'undefined' && MAP_PRESETS.find(p => p.id === this.options.map);
    if (!preset) { el.textContent = ''; return; }
    const hint = '<span class="map-hint">背景为实时地图预览 · 开战时按当前视口动态确定战场规模</span>';
    if (preset.id === 'random') {
      el.innerHTML = '<b>随机地图</b><span class="map-meta">随机布局 · 可复现</span><br>' +
        '每次开局从全部布局中抽取一种，按当前视口动态定规模；固定种子生成结果一致。' + hint;
      return;
    }
    const sizeLabel = preset.size === 'big' ? '大地图' : '小地图';
    const layoutLabel = (typeof MAP_LAYOUT_NAMES !== 'undefined' && MAP_LAYOUT_NAMES[preset.layout]) || preset.layout || '';
    el.innerHTML = '<b>' + preset.name + '</b><span class="map-meta">' + sizeLabel + ' · ' + layoutLabel + '</span><br>' +
      '战术特色：' + (preset.tactics || '') + hint;
  }

  /** 对局配置摘要（敌人 / 生命 / 难度 / 音效） */
  updateSummary() {
    const el = document.getElementById('settings-summary');
    if (!el) return;
    const diff = (typeof AI_DIFFICULTIES !== 'undefined' && AI_DIFFICULTIES[this.options.difficulty]) || null;
    el.innerHTML = '对局配置 · 敌 <b>' + this.options.enemies + '</b> · 命 <b>' + this.options.lives +
      '</b> · <b>' + (diff ? diff.name : this.options.difficulty) + '</b> · 音效' +
      (this.options.sound ? '开' : '关');
  }

  updateEnemyLimits() {
    const big = this.isBigMap(this.options.map);
    const max = big ? CONFIG.RULES.maxEnemiesBig : CONFIG.RULES.maxEnemiesSmall;
    const holder = document.querySelector('[data-group="enemies"]');
    if (holder) {
      holder.querySelectorAll('.choice').forEach(btn => {
        const v = parseInt(btn.dataset.value, 10);
        const disabled = v > max;
        btn.disabled = disabled;
        btn.classList.toggle('disabled', disabled);
      });
    }
    if (this.options.enemies > max) {
      this.options.enemies = max;
      this.syncButtons();
      return;
    }
    const note = document.getElementById('enemy-note');
    if (note) note.textContent = big
      ? '大地图最多 ' + CONFIG.RULES.maxEnemiesBig + ' 辆'
      : '标准图最多 ' + CONFIG.RULES.maxEnemiesSmall + ' 辆 · 选大地图可到 ' + CONFIG.RULES.maxEnemiesBig + ' 辆';
  }

  setHudPause(visible) {
    const btn = document.getElementById('btn-hud-pause');
    if (!btn) return;
    if (visible) btn.removeAttribute('hidden');
    else btn.setAttribute('hidden', '');
  }

  show(name) {
    Object.keys(this.screens).forEach(key => {
      const el = this.screens[key];
      if (!el) return;
      if (key === name) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
  }

  hideAll() {
    Object.keys(this.screens).forEach(key => {
      const el = this.screens[key];
      if (el) el.setAttribute('hidden', '');
    });
  }

  onState(state, game) {
    if (state === 'playing') {
      this.hideAll();
      this.setHudPause(true);
      return;
    }
    if (state === 'ending') {
      // 胜负已定（结算延迟期间）：隐藏暂停入口，避免无效操作
      this.setHudPause(false);
      return;
    }
    if (state === 'paused') {
      this.setHudPause(false);
      this.show('pause');
      return;
    }
    if (state === 'menu') {
      this.setHudPause(false);
      this.updateSoundLabel();
      this.updateSummary();
      this.show('menu');
      return;
    }
    if (state === 'over') {
      this.setHudPause(false);
      const victory = game.result === 'victory';
      const title = document.getElementById('over-title');
      const sub = document.getElementById('over-sub');
      const icon = document.getElementById('over-icon');
      const panel = document.querySelector('#screen-over .panel');

      if (title) title.textContent = victory ? '胜利' : '失败';
      if (sub) sub.textContent = victory
        ? '全部敌方坦克已被击毁，战场属于你。'
        : '你的坦克被击毁了，再来一次吧。';
      if (icon) {
        icon.textContent = victory ? '★' : '✖';
        icon.classList.toggle('win', victory);
        icon.classList.toggle('lose', !victory);
      }
      if (panel) panel.classList.toggle('is-win', victory);

      const score = document.getElementById('over-score');
      const kills = document.getElementById('over-kills');
      const time = document.getElementById('over-time');
      if (score) score.textContent = String(game.score);
      if (kills) kills.textContent = String(game.kills);
      if (time) time.textContent = game.time.toFixed(1) + ' 秒';

      this.show('over');
    }
  }
}
