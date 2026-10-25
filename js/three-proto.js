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
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

(function () {
  const PX = 10;                                    // 1 three 单位 = 10 游戏像素
  const q = new URLSearchParams(location.search);
  const ENABLED = q.get('proto3d') !== '0';
  const VIEW_ZOOM = Math.max(1, parseFloat(q.get('zoom') || '1.6'));  // 3D 视野拉近倍率

  const report = {
    webgl: false, glb: 'pending', kit: 'pending', mode: ENABLED ? '3d' : 'off',
    map: '', tanks: 0, bullets: 0, fps: 0, dProjPx: null, dInputPx: null,
    errors: [], ready: false,
    debugTurretOffset: parseFloat(q.get('turretdebug') || '0') * Math.PI / 180,
    debugOverview: q.has('overview')               // 全景取景（仅渲染层诊断，不改玩法视角）
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
      'WebGL ✓  GLB ' + report.glb + (report.glb === 'ok' ? ' ✓' : '')
        + '  Kit ' + report.kit + (report.kit === 'ok' ? ' ✓' : ''),
      '地图 ' + report.map + ' · 坦克 ' + report.tanks + ' · 子弹 ' + report.bullets
        + (report.tris ? ' · ' + (report.tris / 1000).toFixed(0) + 'k 三角/' + report.calls + ' 次' : ''),
      'Δ投影 ' + report.dProjPx + ' px · Δ输入映射 ' + report.dInputPx + ' px'
    ];
    if (report.debugTurretOffset) lines.push('炮塔诊断偏移 ' + (report.debugTurretOffset * 180 / Math.PI).toFixed(0) + '°（不影响玩法）');
    if (report.errors.length) {
      lines.push('错误 ' + report.errors.length + ' 条（__proto3d.errors）');
      lines.push('首条: ' + String(report.errors[0]).slice(0, 100));
    }
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

    /* ---------- 地图（只读 maze.walls；视觉 ⊆ 碰撞） ----------
     * kit 模式：Kenney Modular Space Kit 模块件拼装
     *   - template-wall(4×4.25×1) 铺墙段 / wall-detail-a 带面板细节变体 /
     *     wall-corner 方墩 / template-floor(4×4) 地板 + floor-detail-a 变体
     *   - 单一 colormap 材质 → mergeGeometries 全图合并为 1 个 Mesh（1 draw call）
     *   - 墙体缩放 S = min(等距墙高/4.25, 0.88)：厚度 1.001×S ≤ 0.881 单位，
     *     恒 ⊆ 碰撞带（wallThickness 9px = 0.9 单位）；墙段首尾与碰撞矩形对齐
     *   - 横墙顶 +0.01 / 纵墙顶 −0.01：十字交点顶面错位，避免共面 z-fight
     *   - kit 未就绪/失败 → 碰撞盒子回退（本函数始终可用）
     */
    let mapGroup = null, mapKey = null, mapVisual = null;
    let kitGeos = {};   // 名称 → { geo, bb }
    let kitMat = null;  // colormap 基准材质
    let kitMats = null; // [colormap, variation-a, variation-b] 三套配色
    const KIT_DIR = 'kenney_modular-space-kit_1.0/Models/GLB%20format/';
    /* 布局 → 配色索引：同一套拼装逻辑，地图间以官方配色变体区分风格；
     * classic(maze)=0 与已验收版本保持一致 */
    const PALETTE_BY_LAYOUT = {
      maze: 0, arena: 1, cross: 2, ring: 1, twoZone: 2,
      grid: 0, hub: 1, rooms: 2, labyrinth: 0, random: 2
    };

    function disposeMap() {
      if (!mapGroup) return;
      scene.remove(mapGroup);
      mapGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      mapGroup = null;
    }

    /* 确定性杂凑（地板/墙板细节变体派生，与 iso 的确定性装饰同思路） */
    function hash2(seed, a, b) {
      let h = seed | 0;
      h = Math.imul(h ^ (a * 0x9e3779b1), 0x85ebca6b);
      h = Math.imul(h ^ (b * 0xc2b2ae35), 0x27d4eb2f);
      h ^= h >>> 15;
      return (h >>> 0) / 4294967296;
    }

    /* 放置一份几何：底部对齐 yBase、中心对齐 (cx,cz)、yaw 旋转、非均匀缩放 */
    const placeM = new THREE.Matrix4(), placeQ = new THREE.Quaternion(),
      placeV = new THREE.Vector3(), placeS = new THREE.Vector3(), upY = new THREE.Vector3(0, 1, 0);
    function placeGeo(list, entry, cx, yBase, cz, sx, sy, sz, yaw) {
      const g = entry.geo.clone();
      const c = entry.bb.getCenter(placeV).clone();
      const q = yaw ? placeQ.setFromAxisAngle(upY, yaw).clone() : new THREE.Quaternion();
      // 世界变换 = T(锚点) · R · S · T(−局部中心)；再把底边落到 yBase
      const halfH = (entry.bb.max.y - entry.bb.min.y) / 2 * sy;
      placeM.compose(new THREE.Vector3(cx, yBase + halfH, cz), q, placeS.set(sx, sy, sz));
      placeM.multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
      g.applyMatrix4(placeM);
      list.push(g);
    }

    function buildMap(maze) {
      disposeMap();
      mapGroup = new THREE.Group();
      const u = 1 / PX;
      const wallHref = game.iso.heightZ(maze) * u;
      mapVisual = null;

      if (kitMat && kitGeos.wall && kitGeos.wallDetail && kitGeos.stub
        && kitGeos.floor && kitGeos.floorDetail) {
        /* -------- kit 模块拼装 -------- */
        const S = Math.min(wallHref / 4.25, 0.88);      // 厚度约束优先：1.001·0.88=0.881 ≤ 0.9
        const wallH = 4.25 * S, pieceLen = 4 * S;
        const list = [];
        const T = maze.thickness * u;
        let pieces = 0;

        // 地板：按墙件节律平铺（沉 0.02，坦克轮底 y=0 不与地板共面）
        const mapW = maze.width * u, mapH = maze.height * u;
        const nC = Math.max(1, Math.round(mapW / pieceLen)), nR = Math.max(1, Math.round(mapH / pieceLen));
        const tW = mapW / nC, tR = mapH / nR, floorY = -0.02;
        for (let r = 0; r < nR; r++) for (let c = 0; c < nC; c++) {
          const detail = hash2(maze.seed, c * 733 + 11, r * 977 + 3) < 0.16;
          placeGeo(list, detail ? kitGeos.floorDetail : kitGeos.floor,
            (c + 0.5) * tW, floorY, (r + 0.5) * tR, tW / 4, 1, tR / 4, 0);
          pieces++;
        }

        // 墙体：逐段铺模块（视觉矩形 ⊆ 碰撞矩形）
        const runs = [];
        const vtS = 1.001 * S;                            // 视觉厚度（恒 ≤ 0.881）
        for (let wi = 0; wi < maze.walls.length; wi++) {
          const w = maze.walls[wi];
          const x0 = w.x * u, z0 = w.y * u, x1 = (w.x + w.w) * u, z1 = (w.y + w.h) * u;
          const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          const horiz = w.w >= w.h;                       // 长轴 X / Z
          const len = horiz ? x1 - x0 : z1 - z0;
          let vr;
          if (w.w > T + 1 && w.h > T + 1) {
            // 胖矩形（实心块，arena/rooms/grid 等布局的柱体/隔断）：墙体模块
            // 网格铺装整块填充（相邻件外表面连续，内部面被遮挡）
            const gC = Math.max(1, Math.round((x1 - x0) / pieceLen));
            const gR = Math.max(1, Math.round((z1 - z0) / pieceLen));
            const gW = (x1 - x0) / gC, gD = (z1 - z0) / gR;
            for (let r = 0; r < gR; r++) for (let c = 0; c < gC; c++) {
              const detail = hash2(maze.seed, wi * 57 + 5, (r * gC + c) * 13) < 0.12;
              const entry = detail ? kitGeos.wallDetail : kitGeos.wall;
              placeGeo(list, entry,
                x0 + (c + 0.5) * gW, 0, z0 + (r + 0.5) * gD,
                gW / 4, S, gD / (detail ? 1.369 : 1.001), 0);
              pieces++;
            }
            vr = { x0, x1, z0, z1 };
          } else if (len < pieceLen * 0.5) {
            // 方墩/超短段：corner 柱居中（footprint 1.001² × S ⊆ 0.9²）
            placeGeo(list, kitGeos.stub, cx, 0, cz, S, S, S, 0);
            pieces++;
            vr = { x0: cx - vtS / 2, x1: cx + vtS / 2, z0: cz - vtS / 2, z1: cz + vtS / 2 };
          } else {
            let N = Math.max(1, Math.round(len / pieceLen));
            let stretch = len / (N * pieceLen);
            if (stretch > 1.25) { N++; stretch = len / (N * pieceLen); }
            else if (stretch < 0.8 && N > 1) { N--; stretch = len / (N * pieceLen); }
            const yBase = horiz ? 0.01 : -0.01;           // 十字交点顶面错位（0.2px）防 z-fight
            for (let i = 0; i < N; i++) {
              const a0 = (horiz ? x0 : z0) + i * len / N;
              const mid = a0 + len / (2 * N);
              const detail = hash2(maze.seed, wi * 131 + 17, i * 29) < 0.12;
              const entry = detail ? kitGeos.wallDetail : kitGeos.wall;
              const thS = detail ? 1.001 / 1.369 : 1;     // 细节件更厚，压回 1.001 等效厚度
              placeGeo(list, entry, horiz ? mid : cx, yBase, horiz ? cz : mid,
                S * stretch, S, S * thS, horiz ? 0 : Math.PI / 2);
              pieces++;
            }
            vr = horiz
              ? { x0, x1, z0: cz - vtS / 2, z1: cz + vtS / 2 }
              : { x0: cx - vtS / 2, x1: cx + vtS / 2, z0, z1 };
          }
          runs.push({ crash: { x0, z0, x1, z1 }, visual: vr, horiz, lenPx: +(len * PX).toFixed(1) });
        }

        const merged = BufferGeometryUtils.mergeGeometries(list, false);
        for (const g of list) g.dispose();
        const palette = PALETTE_BY_LAYOUT[maze.layout] || 0;
        const mesh = new THREE.Mesh(merged, (kitMats && kitMats[palette]) || kitMat);
        mesh.userData.map = true;
        mapGroup.add(mesh);
        mapVisual = { mode: 'kit', S: +S.toFixed(4), wallH: +wallH.toFixed(3), vt: +vtS.toFixed(3),
          wallHref: +wallHref.toFixed(3), pieces, floorTiles: nC * nR, floorY,
          layout: maze.layout, palette, runs, meshes: 1 };
      } else {
        /* -------- 回退：碰撞盒（kit 未就绪） -------- */
        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(maze.width * u, maze.height * u),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.THEME.iso.ground), roughness: 0.95 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.set(maze.width * u / 2, 0, maze.height * u / 2);
        mapGroup.add(ground);
        const wallMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(CONFIG.COLORS.wall), roughness: 0.85 });
        for (const w of maze.walls) {
          const box = new THREE.Mesh(new THREE.BoxGeometry(w.w * u, wallHref, w.h * u), wallMat);
          box.position.set((w.x + w.w / 2) * u, wallHref / 2, (w.y + w.h / 2) * u);
          box.userData.wall = true;
          mapGroup.add(box);
        }
        mapVisual = { mode: 'box', wallH: +wallHref.toFixed(3), pieces: maze.walls.length + 1, meshes: mapGroup.children.length };
      }
      scene.add(mapGroup);
      mapKey = maze;
      report.map = maze.name + ' ' + (maze.width | 0) + 'x' + (maze.height | 0);
      report.mapVisual = mapVisual;
    }

    /* Kenney Space Kit 加载：5 模块件 + 2 官方配色变体贴图，
     * 全部就绪后置 kit='ok'（失败位回退 colormap 配色，不阻塞） */
    (function loadKit() {
      const PARTS = {
        wall: 'template-wall', wallDetail: 'template-wall-detail-a', stub: 'template-wall-corner',
        floor: 'template-floor', floorDetail: 'template-floor-detail-a'
      };
      const keys = Object.keys(PARTS);
      let done = 0, texDone = 0;
      const texLoads = [null, null];
      function tryFinish() {
        if (done < keys.length || texDone < 2) return;
        kitMats = [kitMat];
        for (let i = 0; i < 2; i++) {
          const tex = texLoads[i];
          if (!tex) { kitMats.push(kitMat); continue; }   // 变体缺失 → 退基准配色
          const m = kitMat.clone();
          m.map = tex; m.needsUpdate = true;
          kitMats.push(m);
        }
        report.kit = 'ok';
        refreshStatusPanel();
        if (mapKey) buildMap(mapKey);                     // 已渲染的地图升级为 kit 版
      }
      for (const k of keys) {
        new GLTFLoader().load(KIT_DIR + PARTS[k] + '.glb', g => {
          let mesh = null;
          g.scene.traverse(o => { if (!mesh && o.isMesh) mesh = o; });
          if (!mesh) throw new Error(PARTS[k] + ' 无网格');
          const geo = mesh.geometry.clone();
          geo.computeBoundingBox();
          kitGeos[k] = { geo, bb: geo.boundingBox };
          if (!kitMat && mesh.material) {
            kitMat = mesh.material;                       // 全部件共用图集材质
            if (kitMat.map) kitMat.map.anisotropy = renderer.capabilities.getMaxAnisotropy();
          }
          done++;
          tryFinish();
        }, undefined, err => {
          report.kit = 'fail';
          report.errors.push('Kit[' + k + ']: ' + (err && err.message ? err.message : err));
          refreshStatusPanel();
        });
      }
      const TL = new THREE.TextureLoader();
      ['variation-a.png', 'variation-b.png'].forEach((name, i) => {
        TL.load('kenney_modular-space-kit_1.0/Models/Textures/' + name, tex => {
          tex.flipY = false;                              // 与 glTF UV 约定一致
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          texLoads[i] = tex;
          texDone++;
          tryFinish();
        }, undefined, () => { texDone++; tryFinish(); });  // 失败不阻塞，回退配色
      });
    })();

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
    /* 道具：原版图标广告牌（PickupIcons 复用 2D 绘制 → CanvasTexture），
     * 颜色 + 形状双区分，与主菜单图鉴同源 */
    const pickupTexCache = {};
    function pickupTexture(type) {
      if (!pickupTexCache[type]) {
        const tex = new THREE.CanvasTexture(PickupIcons.canvas(type));
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        pickupTexCache[type] = tex;
      }
      return pickupTexCache[type];
    }
    const pickupPool = makePool(() => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        transparent: true, depthWrite: false
      }));
      s.scale.set(2.3, 2.3, 1);
      return s;
    });
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
      new THREE.BoxGeometry(0.34, 0.34, 1),
      new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending })));
    /* 激光端点命中闪光（墙弹点/坦克命中点反馈） */
    const laserHitPool = makePool(() => new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending })));

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

    /** 世界坐标 → 屏幕像素（3D 相机投影；缩放/取景无关的瞄准基准） */
    report.project = function (wx, wy) {
      projV.set(wx / PX, 0, wy / PX).project(camera);
      return { x: (projV.x * 0.5 + 0.5) * game.viewW, y: (-projV.y * 0.5 + 0.5) * game.viewH };
    };

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
      if (report.debugOverview) {
        /* 全景取景（仅渲染层诊断/截图，玩法视角与输入不受影响）：
         * 把整张地图（含墙高）包络进正交视口 */
        const u2 = 1 / PX;
        const cx = maze.width * u2 / 2, cz = maze.height * u2 / 2;
        tmpV.set(cx, 0, cz);
        camera.position.copy(tmpV).addScaledVector(camDir, 200);
        camera.lookAt(tmpV);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        const wallH2 = (mapVisual && mapVisual.wallH) || 3;
        let hx = 0, hy = 0;
        for (let ci = 0; ci < 4; ci++) {
          const px = (ci & 1) ? maze.width * u2 : 0, pz = (ci & 2) ? maze.height * u2 : 0;
          for (const py of [0, wallH2]) {
            projV.set(px, py, pz).applyMatrix4(camera.matrixWorldInverse);
            hx = Math.max(hx, Math.abs(projV.x)); hy = Math.max(hy, Math.abs(projV.y));
          }
        }
        const mg = 1.08;
        const halfA = Math.max(hx * mg, hy * mg * (game.viewW / game.viewH));
        const halfB = halfA / (game.viewW / game.viewH);
        if (Math.abs(camera.top - halfB) > 1e-6 || camera.aspect !== game.viewW / game.viewH) {
          camera.top = halfB; camera.bottom = -halfB;
          camera.aspect = game.viewW / game.viewH;
          camera.left = -halfA; camera.right = halfA;
          camera.updateProjectionMatrix();
          renderer.setSize(game.viewW, game.viewH, false);
        }
      } else {
        /* 3D 跟随（精确解）：目标=玩家世界点，地图四角包围盒钳制在视口内。
         * 正交相机下"地面世界位移→屏幕位移"是精确线性映射（两个探针点求 2×2
         * 矩阵），不借道等距投影（两者边缘视差 12~57px，会把玩家挤出画面） */
        const pl = menu ? null : game.player;
        const top0 = game.viewH / (2 * Math.SQRT2 * iso.u * PX * VIEW_ZOOM);
        if (Math.abs(camera.top - top0) > 1e-6 || camera.aspect !== game.viewW / game.viewH) {
          camera.top = top0; camera.bottom = -top0;
          camera.aspect = game.viewW / game.viewH;
          camera.left = -top0 * camera.aspect; camera.right = top0 * camera.aspect;
          camera.updateProjectionMatrix();
          renderer.setSize(game.viewW, game.viewH, false);
        }
        const tx0 = pl && pl.alive ? pl.x / PX : maze.width / PX / 2;
        const tz0 = pl && pl.alive ? pl.y / PX : maze.height / PX / 2;
        // 先对准玩家（菜单对准地图中心），探针求 K 矩阵
        tmpV.set(tx0, 0, tz0);
        camera.position.copy(tmpV).addScaledVector(camDir, 200);
        camera.lookAt(tmpV);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();   // project() 依赖逆矩阵
        const prj = (wx, wz) => {
          projV.set(wx, 0, wz).project(camera);
          return { x: (projV.x * 0.5 + 0.5) * game.viewW, y: (-projV.y * 0.5 + 0.5) * game.viewH };
        };
        const s0 = prj(tx0, tz0);
        const Kx = { x: s0.x - prj(tx0 + 1, tz0).x, y: s0.y - prj(tx0 + 1, tz0).y };   // 世界 +x 单位 → 屏幕px（取负号=位移方向）
        const Kz = { x: s0.x - prj(tx0, tz0 + 1).x, y: s0.y - prj(tx0, tz0 + 1).y };
        // 地图四角相对玩家的屏幕偏移 → 包围盒
        const MW = maze.width / PX, MH = maze.height / PX;
        let b0x = 1e9, b1x = -1e9, b0y = 1e9, b1y = -1e9;
        for (const [wx, wz] of [[0, 0], [MW, 0], [0, MH], [MW, MH]]) {
          const ox = (wx - tx0) * -Kx.x + (wz - tz0) * -Kz.x;   // 角点屏幕 − 玩家屏幕
          const oy = (wx - tx0) * -Kx.y + (wz - tz0) * -Kz.y;
          b0x = Math.min(b0x, ox); b1x = Math.max(b1x, ox);
          b0y = Math.min(b0y, oy); b1y = Math.max(b1y, oy);
        }
        // 屏幕平移策略：地图覆盖视口 → 玩家居中、视口露出地图外才钳到边（无虚空）；
        // 地图小于视口 → 地图整体居中
        let dSx = 0, dSy = 0;
        if (b1x - b0x >= game.viewW) {
          if (s0.x + b0x > 0) dSx = -(s0.x + b0x);                       // 左缘露空 → 视口贴地图左缘
          else if (s0.x + b1x < game.viewW) dSx = game.viewW - (s0.x + b1x);
        } else dSx = (game.viewW - 2 * s0.x - b0x - b1x) / 2;
        if (b1y - b0y >= game.viewH) {
          if (s0.y + b0y > 0) dSy = -(s0.y + b0y);
          else if (s0.y + b1y < game.viewH) dSy = game.viewH - (s0.y + b1y);
        } else dSy = (game.viewH - 2 * s0.y - b0y - b1y) / 2;
        // 屏幕平移 dS = (Δx·Kx + Δz·Kz)（相机目标移动 Δ 时全体屏幕点反向移动）
        const det = Kx.x * Kz.y - Kz.x * Kx.y;
        let dxT = 0, dzT = 0;
        if (Math.abs(det) > 1e-9 && (dSx !== 0 || dSy !== 0)) {
          dxT = (dSx * Kz.y - dSy * Kz.x) / det;
          dzT = (Kx.x * dSy - Kx.y * dSx) / det;
        }
        tmpV.set(tx0 + dxT, 0, tz0 + dzT);
        camera.position.copy(tmpV).addScaledVector(camDir, 200);
        camera.lookAt(tmpV);
        report.camDebug = { s0x: s0.x.toFixed(0), s0y: s0.y.toFixed(0),
          bbox: [b0x.toFixed(0), b1x.toFixed(0), b0y.toFixed(0), b1y.toFixed(0)],
          dS: [dSx.toFixed(0), dSy.toFixed(0)], dT: [dxT.toFixed(2), dzT.toFixed(2)],
          Kx: [Kx.x.toFixed(1), Kx.y.toFixed(1)], Kz: [Kz.x.toFixed(1), Kz.y.toFixed(1)] };
      }
      if (game.input.viewMapper !== viewMapper3d) game.input.setViewMapper(viewMapper3d);

      /* 3D 视野供数：小地图常驻；视野四边形按用户要求隐藏（2D 原版保留） */
      game.forceMinimap = true;
      game.minimapHideViewRect = true;

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
          const m = pickupPool.acquire();
          m.material.map = pickupTexture(pk.type);
          m.material.needsUpdate = true;
          m.position.set(pk.x / PX, 1.1 + Math.sin(game.time * 3 + i * 1.7) * 0.16, pk.y / PX);
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

      /* 激光：分段光束 + 端点命中闪光（字段名对齐 pickup.js 的 x1,y1,x2,y2），
       * 随 life 淡出；命中坦克时 hitTank 有目标（伤害/爆炸由游戏逻辑走原特效管线） */
      laserPool.hideAll();
      laserHitPool.hideAll();
      let laserBeams = 0;
      if (!menu) {
        for (const ls of game.lasers) {
          const k = ls.life / ls.maxLife;
          for (const seg of ls.segments) {
            const x0 = seg.x1 / PX, z0 = seg.y1 / PX, x1 = seg.x2 / PX, z1 = seg.y2 / PX;
            const len = Math.hypot(x1 - x0, z1 - z0);
            if (len < 0.01) continue;
            const m = laserPool.acquire();
            m.position.set((x0 + x1) / 2, 0.85, (z0 + z1) / 2);
            m.scale.set(1, 1, len);
            m.rotation.y = Math.atan2(x1 - x0, z1 - z0);
            m.material.color.set(ls.color);
            m.material.opacity = Math.min(1, k * 1.6);
            const f = laserHitPool.acquire();
            f.position.set(x1, 0.85, z1);
            f.material.color.set(ls.color);
            f.material.opacity = Math.min(1, k * 1.8);
            f.scale.setScalar(0.55 + 0.5 * (1 - k));
            laserBeams++;
          }
        }
      }
      report.lasers = laserBeams;

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
      report.tris = renderer.info.render.triangles;   // 性能记录（验收用）
      report.calls = renderer.info.render.calls;

      /* 数值对照（信息性：3D 投影 vs 等距投影；输入映射 vs 等距映射）。
       * 视野拉近（VIEW_ZOOM）后两投影刻意不同：把等距点向视口中心按
       * 1/zoom 归一再比，差值才反映投影几何差而非缩放 */
      if (!menu && game.player && game.player.alive) {
        const p = game.player;
        projV.set(p.x / PX, 0, p.y / PX).project(camera);
        const px = (projV.x * 0.5 + 0.5) * game.viewW;
        const py = (-projV.y * 0.5 + 0.5) * game.viewH;
        const ip = iso.project(p.x, p.y, 0);
        const ix = game.viewW / 2 + (ip.x - game.camera.x - game.viewW / 2) / VIEW_ZOOM;
        const iy = game.viewH / 2 + (ip.y - game.camera.y - game.viewH / 2) / VIEW_ZOOM;
        report.dProjPx = Math.max(Math.abs(px - ix), Math.abs(py - iy)).toFixed(1);
        // 输入映射精度：世界→屏幕→世界往返闭合差（缩放无关）
        const sp = report.project(p.x, p.y);
        const rt = viewMapper3d(sp.x, sp.y);
        report.dInputPx = Math.max(Math.abs(rt.x - p.x), Math.abs(rt.y - p.y)).toFixed(1);
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
