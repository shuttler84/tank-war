'use strict';
/* =========================================================
 * 输入：鼠标坐标转换（含摄像机偏移） + 双模式控制 + 键盘辅助
 *
 * 鼠标位置同时保存两份：
 *   canvasX/Y —— 视口/画布坐标（CSS 像素，画布铺满窗口时即窗口坐标）
 *   x/y       —— 世界坐标 = 摄像机偏移 + 视口坐标
 * 大地图摄像机移动时，即使鼠标不动，坦克也要保持指向同一个世界点，
 * 所以每帧都会用 canvasX/Y 重新换算 x/y。
 * ========================================================= */

class Input {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.camera = null;
    this.attached = false;
    const center = MapSize.current();
    this.mouse = {
      x: center.w / 2,
      y: center.h / 2,
      canvasX: center.w / 2,
      canvasY: center.h / 2,
      screenX: 0,
      screenY: 0,
      inside: false,
      down: false
    };
    this.onPause = null;
    this.onRestart = null;
    this.onDebug = null;
    this.onFirstInput = null;
    // 等距等非常规视图下的逆投影钩子：(canvasX, canvasY) -> 世界坐标
    // 由 Game 在启用等距视图时注入；为空时走"相机偏移"常规路径
    this.viewMapper = null;
    // 主动道具的一次性按键动作（由 Game 每帧消费）
    this.actions = { emp: false, mine: false };
    if (this.canvas) this.attach();
  }

  /** 设置/清除视口逆投影钩子 */
  setViewMapper(fn) {
    this.viewMapper = fn || null;
  }

  /** 浏览器坐标 -> 画布/视口坐标（1:1，单位为 CSS 像素） */
  toCanvas(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  /** 画布坐标 -> 世界坐标（等距视图走逆投影，常规视图叠加摄像机偏移） */
  syncWorld() {
    if (this.viewMapper) {
      const p = this.viewMapper(this.mouse.canvasX, this.mouse.canvasY);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
    } else if (this.camera) {
      this.mouse.x = this.camera.x + this.mouse.canvasX;
      this.mouse.y = this.camera.y + this.mouse.canvasY;
    } else {
      this.mouse.x = this.mouse.canvasX;
      this.mouse.y = this.mouse.canvasY;
    }
  }

  /** 兼容旧接口：直接按世界坐标设置鼠标 */
  toWorld(clientX, clientY) {
    const p = this.toCanvas(clientX, clientY);
    return { x: p.x + (this.camera ? this.camera.x : 0), y: p.y + (this.camera ? this.camera.y : 0) };
  }

  attach() {
    const canvas = this.canvas;
    const self = this;
    this.attached = true;

    const handleMove = (e) => {
      const p = self.toCanvas(e.clientX, e.clientY);
      self.mouse.canvasX = p.x;
      self.mouse.canvasY = p.y;
      self.mouse.screenX = e.clientX;
      self.mouse.screenY = e.clientY;
      self.syncWorld();
    };

    window.addEventListener('pointermove', handleMove, { passive: true });

    canvas.addEventListener('pointerdown', (e) => {
      handleMove(e);
      if (e.button === 0) {
        self.mouse.down = true;
        if (self.onFirstInput) self.onFirstInput();
        e.preventDefault();
      }
    });

    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) self.mouse.down = false;
    });

    window.addEventListener('blur', () => { self.mouse.down = false; });

    canvas.addEventListener('pointerleave', () => { self.mouse.inside = false; });
    canvas.addEventListener('pointerenter', () => { self.mouse.inside = true; });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const key = e.key.toLowerCase();
      if (key === 'p' || key === 'escape') {
        if (self.onPause) { self.onPause(); e.preventDefault(); }
      } else if (key === 'r') {
        if (self.onRestart) { self.onRestart(); e.preventDefault(); }
      } else if (key === 'f1') {
        if (self.onDebug) { self.onDebug(); e.preventDefault(); }
      } else if (key === 'q') {
        self.actions.mine = true;      // 布设地雷
        e.preventDefault();
      } else if (key === 'e') {
        self.actions.emp = true;       // 释放 EMP 脉冲
        e.preventDefault();
      }
    });

    this.reset();
  }

  reset() {
    this.mouse.down = false;
    this.actions.emp = false;
    this.actions.mine = false;
  }

  /** 消费一次性按键动作（读取后清除，避免重复触发） */
  consume(action) {
    if (!this.actions || !this.actions[action]) return false;
    this.actions[action] = false;
    return true;
  }
}

/* ---------------------------------------------------------
 * 玩家控制：圆内瞄准 / 圆外方向移动
 * 车体、炮管、炮口共用同一个朝向角度。
 * --------------------------------------------------------- */
class PlayerController {
  constructor(tank, input) {
    this.tank = tank;
    this.input = input;
    this.mode = 'aim';       // 'aim' | 'move'
    this.initialized = false;
    this.aimRadius = CONFIG.MOUSE.aimRadius;
    this.hysteresis = CONFIG.MOUSE.hysteresis;
  }

  reset() {
    this.initialized = false;
    this.mode = 'aim';
  }

  update() {
    const tank = this.tank;
    if (!tank.alive) { tank.moveIntent = 0; return; }

    const mx = this.input.mouse.x;
    const my = this.input.mouse.y;
    const dx = mx - tank.x;
    const dy = my - tank.y;
    const d = Math.sqrt(dx * dx + dy * dy);

    const R = this.aimRadius;
    const H = this.hysteresis;

    if (!this.initialized) {
      // 开局按明确规则确定初始模式：d <= R 即瞄准
      this.mode = d <= R ? 'aim' : 'move';
      this.initialized = true;
    } else if (this.mode === 'aim') {
      if (d > R + H) this.mode = 'move';
    } else {
      if (d <= R) this.mode = 'aim';
    }

    // 距离过近时无法得到可靠方向，保留之前的有效朝向
    if (d > CONFIG.MOUSE.minAimDistance) {
      tank.aimAngle = Math.atan2(dy, dx);
    }

    // 圆内：停止鼠标控制的平移，只旋转；圆外：朝鼠标方向持续移动
    tank.moveIntent = this.mode === 'move' ? 1 : 0;
  }
}
