'use strict';
/* =========================================================
 * 阶段 2a 原型：Three.js 3D 视图层（只读同步，不改玩法）
 *
 * 挂载于 prototype-3d.html（index.html 不加载本文件）。
 * 原则与边界：
 *   - 游戏循环 / 物理 / AI / 规则 / 地图数据全部沿用，本模块只读状态做渲染；
 *   - 渲染接管方式：替换 game.render 为「3D 帧 + 原版 HUD 绘制」，
 *     HUD 仍由 game.renderHUD/Radar/Minimap/Crosshair 原方法绘制；
 *   - 输入接管方式：注入 input.viewMapper（control.js 预留的钩子），
 *     用射线与地面求交做「画布像素 → 世界像素」的精确逆映射；
 *   - 摄像机：正交 dimetric（方位 45°、俯角 35°），菱形宽度与现有
 *     IsoView 对齐（iso.u 标定），跟随逻辑复用 iso 相机（目标点 =
 *     iso 视口中心的世界坐标），因此跟随/钳制/整图适配行为与原版一致。
 *
 * 坐标约定：1 three 单位 = 10 游戏像素；游戏 (x, y) → three (x/10, 0, y/10)；
 * 车头朝向：模型 +Z 前向（glTF 约定），root.rotation.y = π/2 − angle。
 * URL 参数：?turretlag=0 关闭炮塔滞后（默认开，用于演示独立旋转）。
 * ========================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

(function () {
  const PX_PER_UNIT = 10;                       // 1 单位 = 10 游戏像素
  const q = new URLSearchParams(location.search);
  const TURRET_RATE = q.has('turretlag') ? Math.max(0, parseFloat(q.get('turretlag')) || 0) : 6;
  const ENABLED = q.get('proto3d') !== '0';

  const report = {
    webgl: false, glb: 'pending', meshes: 0, map: '', tanks: 0, bullets: 0,
    fps: 0, dProjPx: null, dInputPx: null, errors: []
  };
  window.__proto3d = report;

  window.addEventListener('error', e => report.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => report.errors.push(String(e.reason)));

  const statusEl = document.getElementById('proto-status');
  function setStatus(text, isErr) {
    window.__proto3dReported = true;          // 内联诊断脚本停止接管状态面板
    if (!statusEl) return;
    statusEl.innerHTML = '';
    const span = document.createElement('span');
    if (isErr) span.className = 'err';
    span.textContent = text;
    statusEl.appendChild(span);
  }

  /* ---------- 等待游戏实例（模块先于 main.js 的 DOMContentLoaded 执行） ---------- */

  function waitFor(cond, cb, tries) {
    if (cond()) { cb(); return; }
    if (tries <= 0) { setStatus('等待游戏实例超时：__tankGame 未出现', true); return; }
    setTimeout(() => waitFor(cond, cb, tries - 1), 50);
  }

  waitFor(() => window.__tankGame, () => {
    const game = window.__tankGame;
    try { boot(game); }
    catch (e) {
      report.errors.push('boot: ' + e.message);
      setStatus('3D 原型初始化失败：' + e.message, true);
      throw e;
    }
  }, 200);

  function boot(game) {
    /* ---------- 渲染器与场景 ---------- */

    const canvas = document.getElementById('gl');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      report.webgl = false;
      setStatus('WebGL 不可用：' + e.message + '（3D 关闭，2D 原版不受影响）', true);
      return;
    }
    report.webgl = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color(CONFIG.THEME.bgDeep));

    const scene = new THREE.Scene();
    const EL = 35 * Math.PI / 180;                       // 俯角 35°
    const AZ = 45 * Math.PI / 180;                       // 方位 45°
    const camDir = new THREE.Vector3(                    // 相机相对目标的方向
      Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);

    const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x0a1a28, 1.0);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-40, 90, -55);                      // 与现有等距视图受光方向接近
    scene.add(sun);

    /* ---------- 地图（只读 maze.walls，构建 3D 场景） ---------- */

    let mapGroup = null;
    let mapKey = null;

    function buildMap(maze) {
      if (mapGroup) {
        scene.remove(mapGroup);
        mapGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      }
      mapGroup = new THREE.Group();
      const u = 1 / PX_PER_UNIT;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(maze.width * u, maze.height * u),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.THEME.iso.ground), roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(maze.width * u / 2, 0, maze.height * u / 2);
      mapGroup.add(ground);

      const wallH = game.iso.heightZ(maze) * u;         // 与等距视图同一世界墙高
      const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.COLORS.wall), roughness: 0.85 });
      for (const w of maze.walls) {
        const box = new THREE.Mesh(
          new THREE.BoxGeometry(w.w * u, wallH, w.h * u), wallMat);
        box.position.set((w.x + w.w / 2) * u, wallH / 2, (w.y + w.h / 2) * u);
        mapGroup.add(box);
      }
      scene.add(mapGroup);
      mapKey = maze;
      report.map = maze.name + ' ' + (maze.width | 0) + 'x' + (maze.height | 0);
    }

    /* ---------- 坦克实例（GLB 加载一次，按队伍着色） ---------- */

    const tankPool = [];                                 // 与 game.tanks 对齐的实例
    let protoRoot = null;

    // GLB 材质名 → 队伍色字段（与游戏 CONFIG.COLORS.tanks 对应）
    const TEAM_TINT = {
      TankHull: 'body', TankTurret: 'body',
      TankHullLight: 'light', TankHatch: 'light',
      TankBarrel: 'barrel', TankMuzzle: 'outline',
      TankMantlet: 'dark', TankTrack: 'tread', TankWheel: 'outline'
    };

    function makeTankInstance(colorKey) {
      const inst = protoRoot.clone(true);
      const palette = CONFIG.COLORS.tanks[colorKey] || CONFIG.COLORS.tanks.green;
      inst.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        const field = TEAM_TINT[o.material.name];
        if (field) o.material.color.set(palette[field]);
        report.meshes++;
      });
      // 贴地圆形软阴影（对应原版等距视图的坦克落影）
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(1.55, 20),
        new THREE.MeshBasicMaterial({ color: 0x030a10, transparent: true, opacity: 0.32, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      scene.add(shadow);
      scene.add(inst);
      return {
        root: inst,
        turret: inst.getObjectByName('TurretPivot'),
        shadow,
        aimEased: 0
      };
    }

    new GLTFLoader().load('blender-3d/exports/toy_tank.glb', gltf => {
      protoRoot = gltf.scene;
      report.glb = 'ok';
    }, undefined, err => {
      report.glb = 'fail';
      report.errors.push('GLB: ' + err);
    });

    /* ---------- 子弹实例池 ---------- */

    const bulletGeo = new THREE.SphereGeometry(0.42, 10, 8);
    const bulletPool = [];
    function acquireBullet() {
      let b = bulletPool.find(x => !x.visible);
      if (!b) {
        b = new THREE.Mesh(bulletGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 }));
        scene.add(b);
        bulletPool.push(b);
      }
      b.visible = true;
      return b;
    }

    /* ---------- 输入映射：画布像素 →（射线求交）→ 世界像素 ---------- */

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();

    function viewMapper3d(cx, cy) {
      ndc.set((cx / game.viewW) * 2 - 1, -(cy / game.viewH) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        return { x: hitPoint.x * PX_PER_UNIT, y: hitPoint.z * PX_PER_UNIT };
      }
      return game.iso.unprojectAt(cx, cy, game.camera);   // 兜底（理论上不会走到）
    }

    /* ---------- 渲染接管：3D 帧 + 原版 HUD ---------- */

    const origRender = game.render.bind(game);

    game.render = function () {
      if (ENABLED) frame(game.time === undefined ? 1 / 60 : 1 / 60);
      // 2D 层：清屏后仅绘制 HUD（世界由 3D 呈现；菜单态由 DOM 覆盖层负责）
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      if (this.state !== 'menu' && this.player) {
        const hs = this.hudScale;
        const hw = this.viewW / hs, hh = this.viewH / hs;
        ctx.save();
        ctx.scale(hs, hs);
        this.renderHUD(ctx, hw, hh);
        this.renderRadar(ctx, hw, hh);
        this.renderMinimap(ctx, hw, hh);
        this.renderCrosshair(ctx, hw, hh);
        ctx.restore();
      }
    };

    /* ---------- 每帧同步 ---------- */

    const tmpV = new THREE.Vector3();
    const projV = new THREE.Vector3();
    let fpsAcc = 0, fpsN = 0, fpsT = 0;

    function frame(dt) {
      const menu = game.state === 'menu';
      const maze = menu ? game.menuMaze : game.maze;
      if (!maze) return;
      if (maze !== mapKey) buildMap(maze);

      /* 相机：目标点 = iso 视口中心对应的世界点；缩放按 iso.u 标定菱形宽度 */
      const iso = game.iso;
      const centerWorld = iso.unproject(game.camera.x + game.viewW / 2, game.camera.y + game.viewH / 2);
      tmpV.set(centerWorld.x / PX_PER_UNIT, 0, centerWorld.y / PX_PER_UNIT);
      camera.position.copy(tmpV).addScaledVector(camDir, 200);
      camera.lookAt(tmpV);
      const pxPerUnit = Math.SQRT2 * iso.u * PX_PER_UNIT;
      const top = game.viewH / (2 * pxPerUnit);
      if (Math.abs(camera.top - top) > 1e-6 || camera.aspect !== game.viewW / game.viewH) {
        camera.top = top; camera.bottom = -top;
        camera.aspect = game.viewW / game.viewH;
        camera.left = -top * camera.aspect; camera.right = top * camera.aspect;
        camera.updateProjectionMatrix();
        renderer.setSize(game.viewW, game.viewH, false);
      }

      /* 输入映射注入（startMatch 会重置为 iso 映射，需持续接管） */
      if (game.input.viewMapper !== viewMapper3d) game.input.setViewMapper(viewMapper3d);

      /* 坦克同步 */
      if (protoRoot && !menu) {
        while (tankPool.length < game.tanks.length) tankPool.push(makeTankInstance(game.tanks[tankPool.length].colorKey));
        while (tankPool.length > game.tanks.length) {
          const t = tankPool.pop();
          scene.remove(t.root); scene.remove(t.shadow);
        }
        for (let i = 0; i < game.tanks.length; i++) {
          const tank = game.tanks[i], inst = tankPool[i];
          inst.root.visible = inst.shadow.visible = tank.alive;
          if (!tank.alive) continue;
          inst.root.position.set(tank.x / PX_PER_UNIT, 0, tank.y / PX_PER_UNIT);
          inst.root.rotation.y = Math.PI / 2 - tank.angle;
          /* 炮塔独立旋转演示：朝向按角速度上限平滑追踪（滞后可见） */
          if (TURRET_RATE > 0) {
            inst.aimEased += angleDiff(inst.aimEased, tank.angle) * Math.min(1, TURRET_RATE * dt);
          } else {
            inst.aimEased = tank.angle;
          }
          if (inst.turret) inst.turret.rotation.y = tank.angle - inst.aimEased;
          inst.shadow.position.set(tank.x / PX_PER_UNIT, 0.02, tank.y / PX_PER_UNIT);
        }
      }

      /* 子弹同步 */
      for (const b of bulletPool) b.visible = false;
      if (!menu) {
        for (const bl of game.bullets) {
          if (bl.dead) continue;
          const m = acquireBullet();
          m.position.set(bl.x / PX_PER_UNIT, 0.55, bl.y / PX_PER_UNIT);
          m.material.color.set(bl.ownerColor || '#ffffff');
        }
      }
      report.bullets = game.bullets.length;
      report.tanks = menu ? 0 : game.tanks.length;

      /* 数值对照：玩家坦克在 3D 投影 vs 等距投影的像素差；两种输入映射差 */
      if (!menu && game.player && game.player.alive) {
        const p = game.player;
        projV.set(p.x / PX_PER_UNIT, 0, p.y / PX_PER_UNIT).project(camera);
        const px = (projV.x * 0.5 + 0.5) * game.viewW;
        const py = (-projV.y * 0.5 + 0.5) * game.viewH;
        const ip = iso.project(p.x, p.y, 0);
        const ix = ip.x - game.camera.x, iy = ip.y - game.camera.y;
        report.dProjPx = Math.max(Math.abs(px - ix), Math.abs(py - iy)).toFixed(1);
        const a = viewMapper3d(game.input.mouse.canvasX, game.input.mouse.canvasY);
        const b = iso.unprojectAt(game.input.mouse.canvasX, game.input.mouse.canvasY, game.camera);
        report.dInputPx = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)).toFixed(1);
      }

      renderer.render(scene, camera);

      /* 状态面板（首帧立即刷新，其后低频；无头虚拟时间下 rAF 帧数很少） */
      fpsN++; fpsAcc += dt;
      if (fpsN === 1 || fpsAcc - fpsT > 0.5) {
        report.fps = (fpsN / (fpsAcc - fpsT)).toFixed(0);
        fpsT = fpsAcc; fpsN = 0;
        const lines = [
          '3D 原型 · ' + report.fps + ' fps',
          'WebGL ✓  GLB ' + report.glb + (report.glb === 'ok' ? ' ✓' : ''),
          '地图 ' + report.map + ' · 坦克 ' + report.tanks + ' · 子弹 ' + report.bullets,
          'Δ投影(3D↔等距) ' + report.dProjPx + ' px · Δ输入映射 ' + report.dInputPx + ' px'
        ];
        if (report.errors.length) lines.push('错误 ' + report.errors.length + ' 条（详见 __proto3d.errors）');
        setStatus(lines.join('\n'), report.errors.length > 0);
      }
    }

    /* 窗口尺寸变化时同步渲染器 */
    window.addEventListener('resize', () => {
      renderer.setSize(game.viewW, game.viewH, false);
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    });

    report.ready = true;
  }
})();
