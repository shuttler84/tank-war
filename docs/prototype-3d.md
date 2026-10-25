# 3D 接入原型（阶段 2a）：架构决策与验证记录

日期：2026-10-25 ｜ 验证环境：Windows 10 + Edge headless（SwiftShader 软件渲染）+ python http.server

## 1. 渲染架构决策

**决策：引入 Three.js r170 作为 3D 视图层，采用"叠加画布 + 只读同步"的最小侵入方案。**

### 决策依据（对应审计结论）

- **现有渲染方式的限制**：项目是 Canvas 2D + 等距伪 3D 视图层（`js/isoview.js`）。
  Canvas 2D 无法加载 GLB 模型、无法做真实透视/光照/深度；把模型预渲染成多角度
  贴图需要覆盖 360° 任意朝向，贴图量不可行。要显示已验收的 3D 坦克，必须有 WebGL。
- **直接扩展的可行性**：不可行——Canvas 2D 没有 3D 管线；以现有代码"手写软件 3D"
  属于重写且质量更差。
- **引入 Three.js 的成本与风险**：
  - 成本：vendor 本地化 3 个文件共约 1.5MB（MIT 许可，`vendor/`）；原型入口
    `prototype-3d.html` 独立于 `index.html`；核心模块 `js/three-proto.js` 约 300 行。
  - 风险 1（file:// 限制）：ES Module 与 fetch 在 `file://` 下被禁，原型必须经
    本地 HTTP 服务运行。正式阶段计划把 Three 打包为单 IIFE + GLB base64 内嵌，
    保住双击离线体验（见阶段 2a 任务书与审计报告）。
  - 风险 2（视角差异）：现有 IsoView 是**各向异性**投影（`elev=1` 时墙面按
    1:1 世界比例绘制），物理正交相机无法逐像素复刻。原型采用真实 dimetric
    （方位 45°、俯角 35°），实测坦克投影差 ≤ 12px（小图）/ ≤ 57px（大图边缘，
    其中含相机中心偏移），画面观感一致、玩法无影响。
  - 风险 3（性能）：纯软件渲染（SwiftShader）下 60fps 正常；真机 GPU 无忧。
- **如何保留现有游戏循环/坐标/玩法**：
  - 游戏循环：`Game.tick`（固定步长 + rAF）原样运行；3D 每帧在 `game.render`
  被调用时同步（渲染接管方式：替换 `game.render` 为"3D 帧 + 原版 HUD 绘制"，
  HUD 仍由 `renderHUD/Radar/Minimap/Crosshair` 原方法完成）。
  - 坐标：约定 1 three 单位 = 10 游戏像素；游戏 `(x,y)` → three `(x/10, 0, y/10)`；
  车头映射 `root.rotation.y = π/2 − angle`。墙体直接读 `maze.walls`（碰撞与
  视图同源），墙高取 `iso.heightZ(maze)` 同一世界值。
  - 输入：注入 `input.viewMapper`（`control.js:32` 预留钩子），鼠标射线与地面
  平面求交做精确逆映射；实测与等距逆映射在画布中心差 0.0px。
  - 摄像机：跟随/钳制/整图适配复用 iso 相机逻辑（3D 相机目标 = iso 视口中心的
  世界坐标，缩放按 `iso.u` 标定菱形宽度），行为与原版一致。
  - 玩法：物理/AI/道具/胜负判定零改动（本阶段未修改任何现有文件）。

## 2. 修改文件清单

全部为**新增**，现有文件零修改（`git status` 仅出现未跟踪新文件）：

| 文件 | 说明 |
|---|---|
| `prototype-3d.html` | 原型入口（复刻 index.html DOM + WebGL 画布 + importmap + 诊断脚本） |
| `js/three-proto.js` | 3D 视图原型模块（渲染接管/只读同步/输入映射/状态面板） |
| `vendor/three.module.js` | Three.js r170 核心（MIT，jsdelivr→npmmirror 拉取） |
| `vendor/addons/loaders/GLTFLoader.js` | GLB 加载器（含相对依赖 utils/BufferGeometryUtils.js） |
| `tests/proto-check.js` | 无头浏览器检查（3 用例：截图 + DOM 状态断言） |
| `screenshots/proto-*.png` | 真实运行截图 ×3 |

## 3. 启动与验证方法

```bash
# 1) 启动本地服务（项目根目录）
python -m http.server 8080

# 2) 手动体验：浏览器打开
#    http://127.0.0.1:8080/prototype-3d.html
#    快速开局：…?autostart=1&map=classic&enemies=2
#    URL 参数：?proto3d=0 关闭 3D 对照原版；?turretlag=0 关闭炮塔滞后

# 3) 自动验证（无头 Edge 截图 + 状态断言）
node tests/proto-check.js        # 判定 PROTO_CHECK_OK

# 4) 原有回归测试（确认零影响）
node tests/run-tests.js          # 69/69 通过
```

无头验证判定项：截图生成、`WebGL ✓`、`GLB ok`、无 JS 错误（页面内错误钩子 +
DOM 状态面板双重采集）。截图环境：Edge headless 1440×900，SwiftShader 软件渲染，
`--virtual-time-budget=9000`（注：虚拟时间下 rAF 仅驱动约 7 帧，属无头模式特性，
不影响手动运行；页面状态面板因此改为首帧刷新）。

## 4. 验证结果摘要（2026-10-25 实测）

| 用例 | 结果 | 关键读数 |
|---|---|---|
| classic 小图战斗 | 通过 | 坦克 3 / 60fps / Δ投影 11.7px / Δ输入 0.0px |
| hub 大图战斗 | 通过 | 坦克 4 / 摄像机跟随 + 小地图菱形视野框正常 |
| 主菜单 | 通过 | 3D 地图作背景 + 菜单/地图卡片/设置全部正常 |

视觉确认（截图逐张核验）：3D 墙体盒（顶面/侧面光照）、坦克模型（车身/炮塔/
炮管可辨，队伍色正确：玩家绿、敌蓝/红）、原版 HUD/准星/暂停按钮/小地图正常、
无黑屏/错位/穿模/2D 残留。炮塔滞后（快速转向时炮管甩尾后跟上）演示了独立
旋转轴；`?turretlag=0` 可关闭。

## 5. 已知问题与边界

1. **file:// 不可用**：原型必须经 HTTP 服务（模块加载 + GLB fetch）。正式接入
   时按计划改单 IIFE 打包 + base64 内嵌。
2. **投影非逐像素一致**：物理相机 vs 各向异性 IsoView，坦克位置投影差
   ≤ 12px（小图中心区）~ 57px（大图边缘）；输入用射线映射不受影响。
3. **未 3D 化的元素**：道具/地雷/激光/粒子特效（爆炸、枪口、火花）仍只在
   HUD/逻辑层存在，画面上不可见；屏幕震动未接入 3D 相机。留待下一阶段。
4. **墙体为独立 Box mesh**：每张图数百个 draw call；正式阶段改 InstancedMesh
   或合并几何体。
5. **无头 rAF 帧数少**：虚拟时间预算下 rAF 很快静默，仅影响无头截图时长的
   画面演进，不影响判定与手动运行。
6. **炮口偏移未标定**：3D 炮管长度与游戏 `muzzleOffset=24px` 的对应关系在
   正式接入时标定（当前视觉差异不影响玩法）。
