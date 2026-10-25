'use strict';
/* =========================================================
 * 启动入口
 * ========================================================= */

(function () {
  function boot() {
    const canvas = document.getElementById('game');
    const stage = document.getElementById('stage');
    if (!canvas || !stage) return;

    const game = new Game({ canvas, stage });
    const ui = new UI(game);

    game.resize();
    game.start();

    window.addEventListener('resize', () => game.resize());

    // 失焦自动暂停，避免鼠标状态残留与物理时间异常。
    // 双重防误判：① 开局 0.6s 宽限（点击"开始"瞬间窗口焦点可能抖动，
    // 表现为"没按暂停却弹暂停框"）；② document.hasFocus() 校验（真实失焦
    // 时为 false，页面内元素切换等伪 blur 事件时为 true）
    const blurShouldPause = () =>
      game.state === 'playing' && !document.hasFocus() && game.time > 0.6;
    window.addEventListener('blur', () => {
      if (blurShouldPause()) game.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && blurShouldPause()) game.pause();
    });

    game.input.onFirstInput = () => game.sound.resume();
    game.input.onPause = () => game.togglePause();
    game.input.onRestart = () => { if (game.state !== 'menu') game.restart(); };
    game.input.onDebug = () => { game.debugShowAimCircle = !game.debugShowAimCircle; };

    // 供自动化测试 / 截图使用
    window.__tankGame = game;
    window.__tankUI = ui;

    const q = new URLSearchParams(window.location.search || '');
    if (q.get('autostart') === '1') {
      game.startMatch({
        mapId: q.get('map') || 'classic',
        enemies: parseInt(q.get('enemies') || '2', 10),
        difficulty: q.get('difficulty') || 'normal'
      });
      const simSeconds = parseFloat(q.get('sim') || '0');
      if (simSeconds > 0) {
        if (q.get('fire') === '1') game.input.mouse.down = true;
        const steps = Math.floor(simSeconds * 60);
        for (let i = 0; i < steps; i++) game.update(1 / 60);
        game.acc = 0;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
