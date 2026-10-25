# classic 示范地图 3D 视觉升级（阶段 2c）：记录、实现与验收

日期：2026-10-25 ｜ 资源：`kenney_modular-space-kit_1.0` ｜ 验收环境：Edge headless（SwiftShader，1440×900）

## 0. 结论

经典迷宫（classic）的 3D 视觉已由"纯色碰撞盒"升级为 Kenney 太空站模块套件
拼装（浅色地板 + 带面板细节的模块化墙体）。**迷宫布局、碰撞边界、通道、
出生点、道具逻辑零改动**——`maze.walls[]` 仍是布局与碰撞的唯一权威，3D
层只读拼装。验收：A–F 玩法断言 + 新增 G 段地图视觉断言（6 摆位）连续
2 轮全绿；69/69 回归、原型页检查 3/3 通过；267k 三角 / 24 draw calls /
SwiftShader 软渲染 60fps。

## 1. 示范地图选择与改造前基线

**选择：classic（经典迷宫）**。理由：小图但元素齐全——外围闭合边界墙、
内部横竖隔断、十字/T/L 转角、走廊与开阔战斗区兼有；也是阶段 3 验收
所用地图，新旧对照最直接。

改造前基线（`tests/map-baseline-classic.json`，由 `node tests/map-baseline.js`
以与 69 项测试相同的 VM 方式导出）：

- 布局：960×640px 基础版（12×8 格，格宽 80px，墙厚 9px）。运行时按视口
  动态扩图（1440×900 窗口下约 1408×804px），布局逻辑同一 `MAP_PRESETS` 源。
- 墙体：46 段轴对齐矩形（水平 22 / 垂直 24），最长 969px（边界墙），
  最短 9px（方墩）；墙体矩形同时用于碰撞、射线与渲染（单一数据源）。
- 碰撞边界：`maze.walls` + `Physics.circleRectOverlap`（坦克半径 16px）+
  子弹反弹（半径 3px，最多反弹数按配置）；可通行采样比例 0.578。
- 出生点：玩家 (840,120)，敌 (280,520)、(360,120)（classic 布局确定）。
- 道具：6 个（cluster/laser/triple/shield/rapid 等，种子确定点位见 JSON）。
- 改造前游戏截图：`screenshots/before-{move,turret,muzzle,wall,bounce}.png`
  （阶段 3 提交 5acb6c0 的原样导出，纯色盒墙）。

## 2. 布局保持（硬约束核对）

- 未移动/增删任何墙体、通道、出生点、道具逻辑、可通行区域、反弹边界；
- 未修改 `js/maze.js`、`js/physics.js`、`js/bullet.js`、`js/tank.js` 等任何
  游戏逻辑文件（本阶段全部改动在渲染层 `js/three-proto.js` 与测试工具）；
- `buildMap` 只读 `maze.walls`/`maze.seed`；kit 加载失败时回退原碰撞盒渲染。

## 3. 使用的模型与材质（Space Kit 清单）

| 部件（GLB） | 模块尺寸(单位) | 三角数 | 用途 |
|---|---|---|---|
| `template-floor` | 4×4×0 | 4 | 地板平铺（50×29 = 1450 块） |
| `template-floor-detail-a` | 4×0×0 | 4 | 地板细节变体（种子确定性 ~16%，纯平面零高度） |
| `template-wall` | 4×4.25×1.001 | 428 | 墙体标准件（沿墙段铺装） |
| `template-wall-detail-a` | 4×4.25×1.369 | 960 | 墙体面板细节变体（~12%，厚度压回 1.001 等效） |
| `template-wall-corner` | 1.001×4.05×1.001 | 58 | 方墩/超短墙段 |
| `Textures/colormap.png` | — | — | 全部件共用的单一图集贴图（各部件 UV 取色） |

未使用的 36 件（corridor-*/room-*/gate-*/stairs 等）为地板墙一体的组合件
或场景件，不适合任意迷宫布局，按"不为使用率牺牲效果"弃用。

## 4. 拼装算法（程序生成，非手工摆图）

`js/three-proto.js` `buildMap()`：

- **标定**：`S = min(等距墙高/4.25, 0.88)`。classic 视口版墙高 2.972 单位
  → S=0.699，视觉墙厚 0.700 单位 ⊆ 碰撞带 0.9 单位（每侧内缩 0.1 单位
  = 1px），墙段首尾与碰撞矩形精确对齐。
- **墙体**：每段墙按 `N=round(段长/件长)` 铺 N 件（拉伸系数夹在 0.8–1.25），
  纵墙绕 Y 旋转 90°；横墙顶 +0.01/纵墙顶 −0.01（0.2px 错位）消除十字
  交点共面顶面 z-fight；方墩（<半件长）用 corner 柱。
- **地板**：与墙件同节律平铺（沉 0.02 单位，坦克轮底 y=0 不共面），
  细节变体由 `hash2(maze.seed,…)` 确定性派生（同 iso 装饰的确定性思路）。
- **合并**：全部件共享 colormap 材质 → `mergeGeometries` 合并为
  **1 个网格（整图 1 draw call）**，1966 件、约 26.7 万三角。
- **装饰物位置安全性**：仅有的"装饰"是零高度地板细节贴片与墙内嵌面板，
  均在碰撞带/地面内，无可交互、无遮挡。

## 5. 视觉与碰撞分离（必须测试项 → 结果）

新增 **G 段断言**（`tests/integration-3d.page.js`，随 A–F 每摆位执行）：

| 必测项 | 断言 | 结果 |
|---|---|---|
| 墙体视觉位置与碰撞位置相符 | 每段墙视觉矩形 ⊆ 碰撞矩形（逐边越界 ≤0.03 单位） | PASS 最大越界 0.000（端头平齐、厚度向内缩 0.1） |
| 坦克不穿墙/不卡墙、通道可通行 | A 段 8 方向移动 + D 段四向贴墙（间隙 0.01px、不穿墙） | PASS（沿用阶段 3 断言，本轮同样全绿） |
| 炮弹在原边界反弹 | E 段垂直反弹（距墙 5.49px、法向反向、切向不变）+ 45° 斜射镜像 | PASS |
| 地板不遮挡坦克/炮弹/UI | 地板 y=−0.02 ≤ 坦克底盘 0；HUD 原方法绘制 | PASS |
| 墙高不致坦克被完全遮挡 | 墙高=等距约定 2.972 单位（≈坦克高 2.5 倍，与阶段 3 已验收一致）+ 截图视觉核验"坦克完整可见" | PASS |
| 模型尺寸不符时优先改模型 | 缩放标定在拼装层完成（S 上限 0.88 保厚度 ⊆ 碰撞带），未动任何游戏常量 | PASS |

> 记录一次断言自纠：G-碰撞 初版比较方向写反（把"内缩"当"越界"），修正
> 后以真实数据确认"最大越界 0.000、厚度内缩 0.100"——数值证明拼装精确。

## 6. 实际游戏截图（全部为无头实跑，非 Blender 预览）

| 文件 | 场景 | 视觉核验结论 |
|---|---|---|
| `integration-overview.png`(+`-enhanced`) | **完整地图运行画面**（全景取景 `?overview=1`，仅渲染层） | 浅色太空站地板平铺+细节、模块墙带面板装饰、3 坦克分布、迷宫布局完整、无穿模/悬浮/贴图错位 |
| `integration-move.png`(同上) | 坦克在地图中行驶 | 绿色玩家+十字准星完整醒目、蓝色敌坦克、墙不遮坦克 |
| `integration-wall.png`(同上) | 坦克贴近墙体 | 炮口贴模块墙视觉零间隙、无穿模 |
| `integration-bounce.png`(同上) | 炮弹碰墙反弹 | 炮弹贴墙带白色反弹光环、反弹边界与墙视觉一致 |
| `compare-{move,wall,bounce}.png` | **新旧对照**（左=阶段 3 纯色盒，右=本阶段模块套件） | 同一摆位同一地图 |

**新旧视觉变化**：深蓝底+纯色低多边形盒 → 浅灰白太空站地板与带面板
分割线/警示细节的模块墙；画面中亮度像素占比 6.9%→31.9%（平均亮度
29.8→43.3），坦克在浅色背景上对比更突出；夜景氛围保留（背景仍为深空色）。
`-enhanced` 后缀为 0–110 灰阶拉伸的人眼核验副本（仅调亮，无内容增改）。

## 7. 性能与已知问题

- 性能（SwiftShader 软渲染、1440×900）：**267,244 三角 / 24 draw calls /
  60fps**。整张地图 1 draw call（合并网格）；其余为坦克/子弹/特效实例。
  真机 GPU 余量更大。
- 已知/边界：
  - 墙体细节变体与地板细节是贴图级差异，远景下较微妙（按种子确定性）。
  - `file://` 双击仍回退原版 2D（模块加载限制，阶段 2d 打包解决）。
  - kit 加载失败（网络/路径异常）自动回退纯色碰撞盒渲染并标记
    `__proto3d.kit='fail'`，游戏可玩性不受影响。
  - 视觉墙厚每侧内缩 1px（0.1 单位）——碰撞权威不变，贴墙截图已核验
    视觉贴合无空洞感。

## 8. 运行与复测

```bash
python -m http.server 8080
# 打开 http://localhost:8080/index.html          （classic 直接可玩）
# ?overview=1 全景取景；?proto3d=0 回原版 2D；?itest=1 自动验收

node tests/integration-check.js   # A–F + G 六摆位，期望 INTEGRATION_CHECK_OK
node tests/run-tests.js           # 69/69
node tests/proto-check.js         # PROTO_CHECK_OK（原型页亦用 kit 拼装）
node tests/map-baseline.js        # 重导 classic 布局基线 JSON
node blender-3d/scripts/inspect_kit.js   # Space Kit 部件尺寸/材质盘点
# 截图工具：tests/png-stats.js（像素统计）/ png-crop.js（增强）/ png-join.js（对照拼图）
```

## 9. 本阶段文件清单

- 修改：`js/three-proto.js`（kit 加载 + buildMap 模块拼装 + 全景相机 +
  性能计数 + 状态面板 kit 字段）、`tests/integration-3d.page.js`（G 段 +
  kit 等待 + overview 摆位）、`tests/integration-check.js`（overview 场景）
- 新增：`tests/map-baseline.js`、`tests/png-join.js`、
  `blender-3d/scripts/inspect_kit.js`、`tests/map-baseline-classic.json`、
  `screenshots/integration-overview*.png`、`before-*.png`、`compare-*.png`
- 未触碰任何游戏逻辑/地图数据文件
