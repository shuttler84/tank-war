'use strict';
/* =========================================================
 * 3D 视图层（正式接入版）
 *
 * 边界（硬约束）：
 *   - 只读游戏状态做渲染，不写任何玩法状态；物理/AI/规则零改动；
 *   - 渲染接管：game.render → 「3D 帧 + 原版 HUD」；
 *   - 输入接管：input.viewMapper 射线逆映射（精确）；
 *   - 相机：复用 iso 相机跟随逻辑（目标 = iso 视口中心世界点）。
 *
 * 同步规则（与游戏逻辑逐项对齐）：
 *   - 位置：game (x,y)px → three (x/10, 0, y/10)；
 *   - 车身：root.rotation.y = π/2 − tank.angle（模型 +Z 前向）；
 *   - 炮塔：严格取 tank.angle（游戏规则 = 车体炮管同角，炮弹沿 angle 发射）；
 *     独立旋转轴通过 debugTurretOffset 仅作诊断演示，不影响玩法；
 *   - 炮口：模型炮尖已按 24px 标定（= CONFIG.TANK.muzzleOffset），炮弹
 *     生成点与炮尖重合；
 *   - 特效/道具/地雷/激光：直接消费 effects/pickups/mines/lasers 的世界
 *     坐标，位置天然一致。
 *
 * URL：?proto3d=0 关闭 3D（原版渲染）；?turretdebug=90 诊断炮塔偏移（度）；
 *       ?turretdebugspin 炮塔持续旋转（诊断）。
 * 挂载：index.html（file:// 下模块加载失败 → 原版 2D 等距，游戏不受影响）
 *       与 prototype-3d.html（带诊断面板的开发入口）。
 * ========================================================= */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

(function () {
  const PX = 10;                                    // 1 three 单位 = 10 游戏像素
  const q = new URLSearchParams(location.search);
  const ENABLED = q.get('proto3d') !== '0';

  const report = {
    webgl: false, glb: 'pending', mode: ENABLED ? '3d' : 'off',
    map: '', tanks: 0, bullets: 0, fps: 0, dProjPx: null, dInputPx: null,
    errors: [], ready: false, debugTurretOffset: parseFloat(q.get('turretdebug') || '0') * Math.PI / 180
  };
  window.__proto3d = report;

  window.addEventListener('error', e => report.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', e => report.errors.push(String(e.reason)));

  const statusEl = document.getElementById('proto-status');
  function setStatus(text, isErr) {
    if (!statusEl) return;
    window.__proto3dReported = true; // 停掉原型页内联诊断轮询，避免状态文本被覆盖
    statusEl.innerHTML = '';
    const span = document.createElement('span');
    if (isErr) span.className = 'err';
    span.textContent = text;
    statusEl.appendChild(span);
  }

  // 状态面板内容（GLB 异步完成时也会立即刷新；无头虚拟时间下 rAF 帧少，
  // 仅靠帧内 0.5s 节流会让 'GLB pending' 残留）
  function refreshStatusPanel() {
    const lines = [
      '3D 接入 · ' + report.fps + ' fps',
      'WebGL ✓  GLB ' + report.glb + (report.glb === 'ok' ? ' ✓' : ''),
      '地图 ' + report.map + ' · 坦克 ' + report.tanks + ' · 子弹 ' + report.bullets,
      'Δ投影 ' + report.dProjPx + ' px · Δ输入映射 ' + report.dInputPx + ' px'
    ];
    if (report.debugTurretOffset) lines.push('炮塔诊断偏移 ' + (report.debugTurretOffset * 180 / Math.PI).toFixed(0) + '°（不影响玩法）');
    if (report.errors.length) lines.push('错误 ' + report.errors.length + ' 条（__proto3d.errors）');
    setStatus(lines.join('\n'), report.errors.length > 0);
  }

  function waitFor(cond, cb, tries) {
    if (cond()) { cb(); return; }
    if (tries <= 0) { setStatus('等待游戏实例超时', true); return; }
    setTimeout(() => waitFor(cond, cb, tries - 1), 50);
  }

  waitFor(() => window.__tankGame, () => {
    try { boot(window.__tankGame); }
    catch (e) {
      report.errors.push('boot: ' + e.message);
      setStatus('3D 初始化失败：' + e.message, true);
    }
  }, 200);

  function boot(game) {
    let renderer;
    try {
      // preserveDrawingBuffer：rAF 停止后绘制缓冲仍可读（无头截图必需，
      // 对正常游玩无影响）
      renderer = new THREE.WebGLRenderer({
        canvas: document.getElementById('gl'), antialias: true, preserveDrawingBuffer: true
      });
    } catch (e) {
      report.webgl = false;
      report.errors.push('WebGL: ' + e.message);
      setStatus('WebGL 不可用（原版 2D 渲染不受影响）', true);
      return;                                        // 不接管渲染，原版照常运行
    }
    report.webgl = true;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.setClearColor(new THREE.Color(CONFIG.THEME.bgDeep));

    const scene = new THREE.Scene();
    const EL = 35 * Math.PI / 180, AZ = 45 * Math.PI / 180;
    const camDir = new THREE.Vector3(
      Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x0a1a28, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-40, 90, -55);
    scene.add(sun);

    /* 顶栏渲染模式指示（index.html 的 #view-mode，无则跳过） */
    const modeEl = document.getElementById('view-mode');
    if (modeEl) modeEl.textContent = 'v2.1 · 3D 视图';

    /* ---------- 地图（只读 maze.walls） ---------- */

    let mapGroup = null, mapKey = null;
    function buildMap(maze) {
      if (mapGroup) {
        scene.remove(mapGroup);
        mapGroup.traverse(o => { if (o.geometry && o.userData.wall) o.geometry.dispose(); });
      }
      mapGroup = new THREE.Group();
      const u = 1 / PX;
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(maze.width * u, maze.height * u),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.THEME.iso.ground), roughness: 0.95 }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(maze.width * u / 2, 0, maze.height * u / 2);
      mapGroup.add(ground);
      const wallH = game.iso.heightZ(maze) * u;
      const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.COLORS.wall), roughness: 0.85 });
      for (const w of maze.walls) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(w.w * u, wallH, w.h * u), wallMat);
        box.position.set((w.x + w.w / 2) * u, wallH / 2, (w.y + w.h / 2) * u);
        box.userData.wall = true;
        mapGroup.add(box);
      }
      scene.add(mapGroup);
      mapKey = maze;
      report.map = maze.name + ' ' + (maze.width | 0) + 'x' + (maze.height | 0);
    }

    /* ---------- 坦克实例（GLB 复用 + 队伍色） ---------- */

    const TEAM_TINT = {
      TankHull: 'body', TankTurret: 'body',
      TankHullLight: 'light', TankHatch: 'light',
      TankBarrel: 'barrel', TankMuzzle: 'outline',
      TankMantlet: 'dark', TankTrack: 'tread', TankWheel: 'outline'
    };
    const tankPool = [];
    let protoRoot = null;

    function makeTankInstance(colorKey) {
      const inst = protoRoot.clone(true);
      const palette = CONFIG.COLORS.tanks[colorKey] || CONFIG.COLORS.tanks.green;
      inst.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        const field = TEAM_TINT[o.material.name];
        if (field) o.material.color.set(palette[field]);
      });
      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(1.55, 20),
        new THREE.MeshBasicMaterial({ color: 0x030a10, transparent: true, opacity: 0.32, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.02;
      scene.add(shadow);
      scene.add(inst);
      return { root: inst, turret: inst.getObjectByName('TurretPivot'), muzzle: inst.getObjectByName('MuzzleBrake'), shadow };
    }

    new GLTFLoader().load('blender-3d/exports/toy_tank.glb',
      g => { protoRoot = g.scene; report.glb = 'ok'; refreshStatusPanel(); },
      undefined, err => { report.glb = 'fail'; report.errors.push('GLB: ' + err); refreshStatusPanel(); });

    /* ---------- 通用实例池 ---------- */

    function makePool(create) {
      const list = [];
      return {
        acquire() {
          let m = list.find(x => !x.visible);
          if (!m) { m = create(); scene.add(m); list.push(m); }
          m.visible = true;
          return m;
        },
        hideAll() { for (const m of list) m.visible = false; }
      };
    }

    const bulletPool = makePool(() => new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x666666 })));
    const pickupPool = makePool(() => new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 12, 10),
      new THREE.MeshStandardMaterial({ roughness: 0.35 })));
    const minePool = makePool(() => new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 0.95, 0.22, 12),
      new THREE.MeshStandardMaterial({ color: 0x6b4a26, roughness: 0.7 })));
    const ringPool = makePool(() => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.82, 1, 24),
        new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      return m;
    });
    const flashPool = makePool(() => {
      const m = new THREE.Mesh(
        new THREE.ConeGeometry(0.5, 1.7, 6),
        new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, depthWrite: false }));
      m.rotation.z = -Math.PI / 2;                   // 锥轴 +Y → +X，再按弹向偏航
      return m;
    });
    const laserPool = makePool(() => new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.24, 1),
      new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, depthWrite: false })));

    /* 粒子：单个 Points 动态缓冲（数百粒子零 draw call 开销） */
    const MAX_P = 512;
    const pPos = new Float32Array(MAX_P * 3);
    const pCol = new Float32Array(MAX_P * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
    const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
      size: 4.5, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false
    }));
    points.frustumCulled = false;
    scene.add(points);
    const tmpColor = new THREE.Color();

    /* ---------- 输入映射：射线求交（精确） ---------- */

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const ndc = new THREE.Vector2();
    const hitPoint = new THREE.Vector3();
    function viewMapper3d(cx, cy) {
      ndc.set((cx / game.viewW) * 2 - 1, -(cy / game.viewH) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      if (raycaster.ray.intersectPlane(groundPlane, hitPoint)) {
        return { x: hitPoint.x * PX, y: hitPoint.z * PX };
      }
      return game.iso.unprojectAt(cx, cy, game.camera);
    }

    /* ---------- 测试快照 API（读渲染层真实状态，供自动化验收） ---------- */

    const muzzleV = new THREE.Vector3();
    report.getSnapshot = function () {
      const tanks = [];
      for (let i = 0; i < game.tanks.length && i < tankPool.length; i++) {
        const t = game.tanks[i], inst = tankPool[i];
        tanks.push({
          state: { x: t.x, y: t.y, angle: t.angle, alive: t.alive },
          mesh: {
            x: inst.root.position.x * PX, z: inst.root.position.z * PX,
            yaw: inst.root.rotation.y, visible: inst.root.visible
          },
          turretYaw: inst.turret ? inst.root.rotation.y + inst.turret.rotation.y : null
        });
      }
      return { tanks, map: report.map };
    };
    report.getMuzzlePx = function (i) {
      const inst = tankPool[i];
      if (!inst || !inst.muzzle || !inst.root.visible) return null;
      inst.muzzle.getWorldPosition(muzzleV);
      return { x: muzzleV.x * PX, y: muzzleV.z * PX };
    };

    /* ---------- 渲染接管：3D 帧 + 原版 HUD ---------- */

    game.render = function () {
      if (ENABLED) frame(1 / 60);
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.viewW, this.viewH);
      if (this.state !== 'menu' && this.player) {
        const hs = this.hudScale, hw = this.viewW / hs, hh = this.viewH / hs;
        ctx.save();
        ctx.scale(hs, hs);
        this.renderHUD(ctx, hw, hh);
        this.renderRadar(ctx, hw, hh);
        this.renderMinimap(ctx, hw, hh);
        this.renderCrosshair(ctx, hw, hh);
        ctx.restore();
      }
    };

    /* ---------- 每帧只读同步 ---------- */

    const tmpV = new THREE.Vector3(), projV = new THREE.Vector3();
    let fpsN = 0, fpsAcc = 0, fpsT = 0, spinPhase = 0;

    function frame(dt) {
      const menu = game.state === 'menu';
      const maze = menu ? game.menuMaze : game.maze;
      if (!maze) return;
      if (maze !== mapKey) buildMap(maze);

      /* 相机（复用 iso 跟随；缩放按 iso.u 标定菱形宽度一致） */
      const iso = game.iso;
      const cw = iso.unproject(game.camera.x + game.viewW / 2, game.camera.y + game.viewH / 2);
      tmpV.set(cw.x / PX, 0, cw.y / PX);
      camera.position.copy(tmpV).addScaledVector(camDir, 200);
      camera.lookAt(tmpV);
      const pxPerUnit = Math.SQRT2 * iso.u * PX;
      const top = game.viewH / (2 * pxPerUnit);
      if (Math.abs(camera.top - top) > 1e-6 || camera.aspect !== game.viewW / game.viewH) {
        camera.top = top; camera.bottom = -top;
        camera.aspect = game.viewW / game.viewH;
        camera.left = -top * camera.aspect; camera.right = top * camera.aspect;
        camera.updateProjectionMatrix();
        renderer.setSize(game.viewW, game.viewH, false);
      }
      if (game.input.viewMapper !== viewMapper3d) game.input.setViewMapper(viewMapper3d);

      /* 坦克（实例复用：坦克数动态增减，池跟随 game.tanks） */
      if (protoRoot && !menu) {
        while (tankPool.length < game.tanks.length) tankPool.push(makeTankInstance(game.tanks[tankPool.length].colorKey));
        while (tankPool.length > game.tanks.length) {
          const t = tankPool.pop();
          scene.remove(t.root); scene.remove(t.shadow);
        }
        spinPhase += dt * 0.8;
        for (let i = 0; i < game.tanks.length; i++) {
          const tank = game.tanks[i], inst = tankPool[i];
          inst.root.visible = inst.shadow.visible = tank.alive;
          if (!tank.alive) continue;
          inst.root.position.set(tank.x / PX, 0, tank.y / PX);
          inst.root.rotation.y = Math.PI / 2 - tank.angle;
          /* 炮塔 = 游戏逻辑角（车体炮管同角是本项目玩法规则）；
           * debug 偏移仅用于诊断/截图演示独立旋转轴 */
          if (inst.turret) {
            inst.turret.rotation.y = -report.debugTurretOffset
              - (q.has('turretdebugspin') ? spinPhase : 0);
          }
          inst.shadow.position.set(tank.x / PX, 0.02, tank.y / PX);
        }
      }
      report.tanks = menu ? 0 : game.tanks.length;

      /* 子弹 */
      bulletPool.hideAll();
      if (!menu) {
        for (const bl of game.bullets) {
          if (bl.dead) continue;
          const m = bulletPool.acquire();
          m.position.set(bl.x / PX, 0.55, bl.y / PX);
          m.material.color.set(bl.ownerColor || '#ffffff');
          m.material.emissive.set(bl.ownerColor || '#666666');
          m.material.emissiveIntensity = 0.55;
        }
      }
      report.bullets = menu ? 0 : game.bullets.length;

      /* 道具（类型色 + 轻微悬浮动画，纯视觉） */
      pickupPool.hideAll();
      if (!menu) {
        for (let i = 0; i < game.pickups.length; i++) {
          const pk = game.pickups[i];
          const def = PICKUP_TYPES[pk.type];
          const m = pickupPool.acquire();
          m.position.set(pk.x / PX, 1.05 + Math.sin(game.time * 3 + i * 1.7) * 0.16, pk.y / PX);
          m.material.color.set(def ? def.color : '#ffffff');
          m.material.emissive.set(def ? def.color : '#222222');
          m.material.emissiveIntensity = 0.35;
        }
      }

      /* 地雷 */
      minePool.hideAll();
      if (!menu) {
        for (const mn of game.mines) {
          if (mn.dead) continue;
          const m = minePool.acquire();
          m.position.set(mn.x / PX, 0.12, mn.y / PX);
          m.material.emissive = m.material.emissive || new THREE.Color(0x000000);
          m.material.emissive.set(mn.armed ? 0x351a05 : 0x000000);
        }
      }

      /* 激光（分段光束，随 life 淡出） */
      laserPool.hideAll();
      if (!menu) {
        for (const ls of game.lasers) {
          const k = ls.life / ls.maxLife;
          for (const seg of ls.segments) {
            const m = laserPool.acquire();
            const x0 = seg.x0 / PX, y0 = seg.y0 / PX, x1 = seg.x1 / PX, y1 = seg.y1 / PX;
            const len = Math.hypot(x1 - x0, y1 - y0);
            m.position.set((x0 + x1) / 2, 0.85, (y0 + y1) / 2);
            m.scale.set(1, 1, len);
            m.rotation.y = Math.atan2(x1 - x0, y1 - y0);
            m.material.color.set(ls.color);
            m.material.opacity = Math.min(1, k * 1.6);
          }
        }
      }

      /* 特效（消费 game.effects 的世界坐标数据） */
      const fx = game.effects;
      ringPool.hideAll();
      for (const r of fx.rings) {
        const m = ringPool.acquire();
        m.position.set(r.x / PX, 0.06, r.y / PX);
        m.scale.setScalar(Math.max(0.3, r.r / PX));
        const k = r.life / r.maxLife;
        m.material.color.set(r.color);
        m.material.opacity = k * 0.85;
      }
      flashPool.hideAll();
      for (const f of fx.flashes) {
        const m = flashPool.acquire();
        m.position.set(f.x / PX, 0.85, f.y / PX);
        m.rotation.y = -f.angle;                    // 锥体基向 +X：yaw = −游戏角
        const k = f.life / f.maxLife;
        m.material.opacity = k;
        m.scale.setScalar(0.7 + k * 0.5);
      }
      let pn = 0;
      for (const p of fx.particles) {
        if (pn >= MAX_P) break;
        pPos[pn * 3] = p.x / PX;
        pPos[pn * 3 + 1] = 0.7;
        pPos[pn * 3 + 2] = p.y / PX;
        tmpColor.set(p.color);
        const k = p.life / p.maxLife;
        pCol[pn * 3] = tmpColor.r * Math.min(1, k * 1.5);
        pCol[pn * 3 + 1] = tmpColor.g * Math.min(1, k * 1.5);
        pCol[pn * 3 + 2] = tmpColor.b * Math.min(1, k * 1.5);
        pn++;
      }
      pGeo.setDrawRange(0, pn);
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;

      renderer.render(scene, camera);

      /* 数值对照（信息性：3D 投影 vs 等距投影；输入映射 vs 等距映射） */
      if (!menu && game.player && game.player.alive) {
        const p = game.player;
        projV.set(p.x / PX, 0, p.y / PX).project(camera);
        const px = (projV.x * 0.5 + 0.5) * game.viewW;
        const py = (-projV.y * 0.5 + 0.5) * game.viewH;
        const ip = iso.project(p.x, p.y, 0);
        report.dProjPx = Math.max(Math.abs(px - (ip.x - game.camera.x)),
          Math.abs(py - (ip.y - game.camera.y))).toFixed(1);
        const a = viewMapper3d(game.input.mouse.canvasX, game.input.mouse.canvasY);
        const b = iso.unprojectAt(game.input.mouse.canvasX, game.input.mouse.canvasY, game.camera);
        report.dInputPx = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)).toFixed(1);
      }

      /* 状态面板（首帧立即刷新；无面板则静默） */
      fpsN++; fpsAcc += dt;
      if (fpsN === 1 || fpsAcc - fpsT > 0.5) {
        report.fps = (fpsN / (fpsAcc - fpsT)).toFixed(0);
        if (fpsN > 1) { fpsT = fpsAcc; fpsN = 0; }
        refreshStatusPanel();
      }

      report.ready = true;
    }

    window.addEventListener('resize', () => {
      renderer.setSize(game.viewW, game.viewH, false);
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    });
  }
})();
