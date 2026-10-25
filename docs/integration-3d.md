# 3D 坦克全面接入（阶段 3）：实现、验收与回归记录

日期：2026-10-25 ｜ 验证环境：Windows 10 + Edge headless（`--enable-unsafe-swiftshader` 软件渲染，1440×900，虚拟时间预算 14s）

## 0. 结论

3D 坦克已接入正式游戏 `index.html`：玩家操控、炮口弹道、碰撞边界、
炮弹反弹、道具/AI/胜负全部维持原版逻辑；硬性验收 A–F 共 39 项断言
全部通过（连续 3 轮全绿），5 张真实游戏截图经像素统计 + 亮度增强 +
放大视觉核验确认内容正确；回归 69/69 项测试与原型页检查（proto-check
3/3）全过。**未修改任何游戏规则、地图布局、子弹物理、AI、碰撞代码。**

## 1. 修改文件清单

| 文件 | 变更 | 说明 |
|---|---|---|
| `index.html` | 修改（正式入口首次变更） | `#gl`（WebGL，垫底）+ `#game`（2D HUD，在上）双层画布与内联样式；importmap 解析本地 `vendor/three`；模块脚本 + `tests/integration-3d.page.js` 驱动标签；`#view-mode` 徽标；file:// 下模块加载失败时自动回退原版 2D（优雅降级） |
| `js/three-proto.js` | 全量重写（约 480 行） | 3D 视图层：渲染接管（3D 帧 + 原版 HUD 方法）、只读状态同步、坦克实例池（同一 GLB 多实例 + 队伍染色）、子弹/道具/地雷/激光/特效（粒子/光环/炮口闪光）、墙体由 `maze.walls` 生成、3D 射线逆投影输入映射、等距跟随相机标定、快照/炮口测试 API |
| `blender-3d/scripts/build_tank.py` | 修改 | 炮管延长标定：炮口尖端精确到 24px（游戏 `muzzleOffset`），固定根缩放 1.3001 |
| `blender-3d/scripts/verify_tank.py` | 修改 | 新增 `muzzle_at_24px` 检查（15/15 PASS，尖端 = 2.400 单位 = 24.0px） |
| `blender-3d/exports/toy_tank.glb` | 重新导出 | 标定后的模型（18 部件，7238 顶点不变） |
| `tests/integration-3d.page.js` | 新增 | 页内验收驱动（仅 `?itest=1` 生效）：A–F 断言 + 5 种确定性摆位截图 |
| `tests/integration-check.js` | 新增 | 无头运行器：每个摆位跑 截图 + DOM 断言 两轮，输出裁决 |
| `tests/png-stats.js` | 新增 | 无依赖 PNG 像素统计（Node zlib 解码），截图有效性客观判据 |
| `tests/png-crop.js` | 新增 | 无依赖 PNG 裁剪/亮度拉伸/放大，暗部增强核验工具 |
| `prototype-3d.html` | 修改（1 行） | 加载页内验收驱动脚本标签（与 index.html 一致） |
| `screenshots/integration-{move,turret,muzzle,wall,bounce}.png` | 新增 | 5 张真实游戏截图（原始） |
| `screenshots/integration-*-enhanced.png` | 新增 | 同名 `-enhanced` 为 0–90 亮度拉伸副本（原始图偏暗，副本便于人眼核验；非合成，仅灰阶拉伸） |

未触碰：`js/game.js`、`js/tank.js`、`js/bullet.js`、`js/maze.js`、`js/physics.js`、`js/ai.js`、`js/control.js`、`js/isoview.js`、`js/pickup.js`、`js/effects.js`、`js/config.js`、地图预设——全部游戏逻辑原样。

## 2. 关键实现决策

- **坐标标定**：1 three 单位 = 10 游戏像素；游戏 (x, y) → three (x/10, 0, y/10)。
  车体 `root.rotation.y = π/2 − tank.angle`（模型 +Z 朝前）。
- **炮塔 = 游戏逻辑角**：本项目玩法是"车身、炮塔、弹道同角"（子弹沿
  `tank.angle` 从 24px 炮口射出）。视觉炮塔严格等于 `tank.angle`；炮塔
  **独立旋转轴**通过模型层 `TurretPivot` 验证（B 段 8 个偏移角逐一精确
  断言，`?turretdebug=deg` 仅渲染层诊断偏移，不影响玩法）。
- **炮口一致性**：不改游戏常量，而是把模型炮管在 Blender 里延长到精确
  24px（`verify_tank.py` 15/15 PASS），C 段证明 3D 炮口件与逻辑生成点
  重合（±3px）。
- **渲染接管**：`game.render` 被替换为「3D 帧 + 原版
  `renderHUD/renderRadar/renderMinimap/renderCrosshair`」，HUD 绘制上下文
  （`hudScale` 缩放包装）与原版逐行一致；`?proto3d=0` 一键回到原版 2D。
- **输入**：`Input.viewMapper` 钩子换成 3D 地面射线逆投影（与相机严格互逆，
  proto-check Δ输入映射 = 0.0px），原操控逻辑零修改。
- **相机**：复用游戏 iso 跟随目标点；缩放按 `pxPerUnit = √2 · iso.u · 10`
  标定，菱形铺满视口与原版观感一致。
- **多实例复用**：GLB 解析一次 `protoRoot`，`makeTankInstance` 用
  `SkinnedMesh`-free 的 `clone()` + 材质克隆（Tank* 材质按队伍染色映射）
  + 实例池 `acquire/hideAll`，3 坦克同图无串扰。
- **无头截图必要条件**（本阶段踩坑结论）：WebGLRenderer 需
  `preserveDrawingBuffer: true`；且冻结画面时不能停 rAF（合成器无新
  damage 则截图空缓冲）——驱动改为「停逻辑 + 仅渲染循环」。

## 3. 硬性验收结果（A–F，39 项断言）

运行方式：`node tests/integration-check.js` → 输出 `INTEGRATION_CHECK_OK（A–F 全部通过）`。
连续 3 轮全绿。断言明细（节选数值）：

- **A 移动/转向/同步**：8 方向累计位移均沿指令方向（131.0–132.1px/40 帧）；
  3D 网格位置/朝向与状态最大误差 0.00px；最大步长 3.50px/帧（≤ 速度上限）；
  平滑转向收敛且炮塔=车身角。 ✔
- **B 炮塔独立轴**：8 个偏移角（0–360°/45°）炮塔 yaw 逐一精确；炮塔旋转
  不带动车身；炮口件中心距轴心恒 23px（炮口制动器中心，尖端 24px）。 ✔
- **C 炮口/弹道**：6 方向炮弹均出自炮口 24px 生成圆（±2.5px）；初速方向 =
  炮管方向；3D 炮口件与逻辑生成点重合（±3px）；不在墙内生成；贴墙开火
  生成点距墙面 4.8px（墙外）。 ✔
- **D 碰撞边界**：东南西北 4 向停在墙面（间隙 0.01px）、不穿墙、模型与
  状态一致；视觉足迹 19.8px < 碰撞圆直径 32px。 ✔
- **E 炮弹反弹**：垂直入射反弹点距墙面 5.49px（≤6.5px 含拐角分离余量）、
  法向速度反向、切向不变；45° 斜射分量镜像（入射 (0.91,−0.41) → 出射
  (0.91,0.41)）；反弹期间 3D 层子弹在渲染（bullets=2）；60 帧内存活。 ✔
- **F 玩法回归**：拾取（剩余 5/6）、AI 活动（位移 357px）、全灭胜利结算
  （state=over result=victory score=500）、restart 恢复（tanks=3）、
  暂停/恢复正常。 ✔

驱动稳定性约定（记录在脚本头注释）：全员无敌（防 AI 流弹提前终局）、
A–E 清空道具并冻结刷新（防随机 laser/triple/speed 改变移动与弹道）、
采样点显式 `game.render()`（读渲染层状态前刷新）。

## 4. 截图与视觉核验

5 张真实截图（无头 Edge 实跑游戏页面，非 Blender 渲染、非合成）：

| 文件 | 场景 | 核验结论 |
|---|---|---|
| `integration-move.png` | 坦克行驶 | 等距 3D 迷宫完整；绿色玩家（带准星）+ 红/蓝敌坦克；HUD 齐全；日志全 PASS |
| `integration-turret.png` | 炮塔偏转 90°（诊断） | 炮塔/炮管明显脱离车身轴线约 90°，车身不动 |
| `integration-muzzle.png` | 炮弹出膛 | 亮绿炮弹位于炮口正前 0.3–0.5 车身处、与炮管共线、间有炮口白闪；HUD「武器系统就绪」 |
| `integration-wall.png` | 车头贴墙 | 六负重轮+炮塔+炮管清晰；炮口紧贴墙面视觉零间隙、无穿模 |
| `integration-bounce.png` | 炮弹反弹 | 炮弹贴墙面带白色反弹光环，坦克炮管仍指发射方向 |

核验方法（三重）：① `png-stats.js` 像素统计证明画布内容存在（平均亮度
29.8、量化色 144–216 种、右上 HUD 区最大亮度 233，对比纯黑 PNG 约 5KB/几种颜色）；
② `-enhanced.png` 亮度拉伸副本 + ③ 关键区域 2–3 倍放大裁剪逐张视觉判读。
**注意**：原始截图整体偏暗（游戏夜景配色 + 无头软件渲染），人眼直接看
建议看 `-enhanced` 副本；副本仅做 0–90 灰阶拉伸，无任何内容添加。

## 5. 本阶段发现并修复的问题（按任务书"先定位再最小修复"）

1. **无头截图全黑（画布内容缺失）**
   - 定位：DOM 断言轮一切正常且画布 `toDataURL` 有内容（gl 159KB/game 73KB），
     仅截图捕获为空 → 合成器问题，非渲染问题。
   - 修复：① `preserveDrawingBuffer: true`；② 驱动冻结改为「停逻辑更新 +
     仅渲染循环」（rAF 停止后无合成 damage，截图读空缓冲）。
2. **炮口摆位被随机激光道具污染**：视觉核验发现 HUD 显示「激光炮 ×7」——
   摆位期间拾取激光后 `fire()` 发激光束而非炮弹，截图无炮弹出膛。
   - 修复：`applyPose` 沿用 A–E 稳定性约定（清道具/重置武器/全员无敌），
     复跑后 HUD 为「武器系统就绪」，炮弹出现。
3. **原型页 proto-check 失败（WebGL/GLB FAIL）**：重写模块丢了
   `window.__proto3dReported` 声明，原型页内联诊断轮询覆盖状态面板；
   另外固定 dt 使 0.5s 状态节流在虚拟时间下不再触发，`GLB pending` 残留。
   - 修复：恢复声明 + GLB 异步完成时立即刷新状态。修复后 proto-check 3/3 通过
     （渲染本身一直是正常的——像素统计与阶段 2a 已验收截图一致）。

## 6. 未解决 / 已知事项

- **原始截图偏暗**（非缺陷）：游戏配色为深蓝夜景风，无头 SwiftShader 下更暗。
  下阶段替换地图视觉（Kenney Space Kit）时统一调整光照/配色，不在本阶段
  为截图美观改动渲染参数。
- **file:// 直接双击**：ES Module + importmap 在 `file://` 下不执行 → 自动
  回退原版 2D 可玩。3D 模式需本地 HTTP（`start.bat` 已含 http.server 方案，
  与阶段 2a 记录一致）；打包为单 IIFE + 内嵌资源属下阶段决策。
- **视觉炮塔恒等于车身角**是玩法规则使然（弹道同源）；独立旋转轴已验证
  但游戏中不表现（`?turretdebug=` 可演示）。
- 等距各向异性投影与物理正交相机的边缘视差（大图 ≤57px，阶段 2a 已记录）
  维持原样，不影响玩法。

## 7. 运行与复测方法

```bash
# 1) 本地服务（3D 需要；file:// 自动回退 2D）
python -m http.server 8000
#    浏览器打开 http://localhost:8000/index.html

# 2) 3D 集成验收（A–F + 5 张截图，约 3 分钟）
node tests/integration-check.js     # 期望末行 INTEGRATION_CHECK_OK

# 3) 回归
node tests/run-tests.js             # 期望 69/69，退出码 0
node tests/proto-check.js           # 期望 PROTO_CHECK_OK（3 场景）

# 4) 截图核验工具
node tests/png-stats.js screenshots/integration-move.png   # 像素统计
node tests/png-crop.js in.png out.png 0 0 1440 900 0 90 1  # 亮度拉伸副本

# 5) 单独体验
#    http://localhost:8000/index.html?proto3d=0          → 强制原版 2D
#    http://localhost:8000/index.html?turretdebug=90     → 炮塔诊断偏移演示
```

## 8. 任务书硬性条款对照

| 条款 | 结果 |
|---|---|
| 原操控方式（鼠标驱动/瞄准射击） | ✔ 输入映射换 3D 逆投影，操控代码零修改，Δ映射 0.0px |
| 3D 位置/车体朝向与游戏状态同步 | ✔ A 段最大误差 0.00px |
| 炮塔独立于车身、炮管随炮塔 | ✔ 模型 TurretPivot 层级 + B 段 8 角精确断言 |
| 炮口位置=逻辑生成位置 | ✔ Blender 标定 24px + C 段 ±3px 重合（改模型不改规则） |
| 碰撞/反弹/道具/胜负不变 | ✔ 未改任何逻辑文件；D/E/F 段断言 + 69/69 回归 |
| 同一 GLB 多坦克实例复用 | ✔ 实例池 + 材质克隆，3 坦克同图 |
| 不为模型便利改规则 | ✔ 唯一"改动"是模型几何（炮管延长） |
| A–F 实测并留档 | ✔ 39 项断言 3 轮全绿，结果在上 |
| 真实游戏截图 | ✔ 5 张无头实跑 + 像素统计 + 增强视觉核验 |
| 失败先定位来源再最小修复 | ✔ 第 5 节三个问题的定位-修复记录 |
