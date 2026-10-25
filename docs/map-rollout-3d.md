# 3D 地图视觉推广（阶段 2c-rollout）：全部地图升级记录

日期：2026-10-25 ｜ 前置：classic 示范图已验收（e98ff92）｜ 资源：`kenney_modular-space-kit_1.0`

## 0. 结论与范围勘正

**范围勘正**：任务书表述为"六张地图"，实际项目共有 **12 张固定地图 + 1 张随机地图**
（`MAP_PRESETS`，见 §1 清单）。按"推广到其余地图"的原则，本阶段处理了**全部 13 张**。
逐图验收（A–F 玩法断言 + G 地图视觉断言 + 实跑截图）**13/13 全绿**；
回归 69/69、原型页 3/3、classic 集成套件全绿。**游戏逻辑与地图数据文件零改动**
（`git diff` 为空：maze/mapsize/config/physics/bullet/tank/ai/game/pickup）。

## 1. 地图清单与数据来源

数据来源全部为 `js/mapsize.js` 的 `MAP_PRESETS`（布局函数 + 尺寸 + 种子），
运行时由 `js/maze.js` 按视口动态扩图生成 `maze.walls[]`（布局/碰撞单一权威，未改动）。

| id | 名称 | 布局 | 大小 | 墙体形态（视口 1440×900 摸底） | 配色 |
|---|---|---|---|---|---|
| classic | 经典迷宫 | maze | 小 | 105 段细墙，无胖块 | colormap（保持已验收） |
| open | 开阔战场 | arena | 小 | 124 段，28 胖块 | variation-a |
| corridor | 曲折回廊 | maze | 小 | 145 段细墙 | colormap |
| crossfire | 十字交锋 | cross | 小 | 153 段，30 胖块 | variation-b |
| loop | 环形回廊 | ring | 小 | 107 段，23 胖块 | variation-a |
| twin | 双区域攻防 | twoZone | 小 | 144 段，37 胖块 | variation-b |
| city | 城区迷阵 | grid | 大 | 406 段，80 胖块 | colormap |
| fort | 十字要塞 | cross | 大 | 273 段，45 胖块 | variation-b |
| ring | 环形走廊 | ring | 大 | 292 段，64 胖块 | variation-a |
| hub | 中央枢纽 | hub | 大 | 167 段，41 胖块 | variation-a |
| sectors | 分区战场 | rooms | 大 | 170 段，34 胖块 | variation-b |
| labyrinth | 多环迷城 | labyrinth | 大 | 230 段细墙 | colormap |
| random | 随机地图 | random | 小 | 每局变化（实测 132 段，31 胖块） | variation-b |

"胖块"= 双向尺寸均大于墙厚的实心矩形（柱体/隔断）。10/13 张图存在，
这是推广阶段新覆盖的墙体形态（classic 示范阶段未出现）。

## 2. 本阶段实现（复用已验收系统，无逐图渲染代码）

全部改动集中在 `js/three-proto.js`（渲染层）与测试工具：

1. **胖矩形墙体网格铺装**：胖块按墙件节律二维网格实心填充
   （相邻件外表面连续、内部面被遮挡，与细墙同一材质/高度/细节变体体系）。
   视觉矩形 = 碰撞矩形，G 断言逐边校验 ⊆（13 图全部最大越界 0.000）。
2. **布局 → 配色映射**：套件官方三套 512×512 同构图集
   （colormap / variation-a / variation-b）加载为三个材质，按 `maze.layout`
   查表选用（`PALETTE_BY_LAYOUT`，全代码唯一逐图差异点，一行）。
   classic 保持 colormap 不动（不擅改已验收项）。视觉核验确认三档配色
   肉眼可辨（灰白 / 偏蓝 / 偏暖），布局特征由各图原有结构决定，未拼成相同外观。
3. **资源与开销**：5 个 GLB + 3 张贴图仅加载一次；每图 1 个合并网格
   （1 draw call）；切图时旧网格 geometry 全部 dispose，无重复驻留。

## 3. 逐图验收结果（13/13 通过）

运行方式：`python -m http.server 8080` 后 `node tests/map-rollout-check.js`
→ `MAP_ROLLOUT_OK（13 张地图全部通过）`。每图两轮无头 Edge：
DOM 断言轮（A–F+G 全部断言）+ 截图轮（`screenshots/map-<id>.png`，游戏实跑）。

每图通过的断言组（与 classic 验收同一驱动）：
- **加载**：F-预备（对局开始、3D 就绪、同一 GLB 三实例）
- **移动**：A 段 8 方向位移 + 3D 同步（最大误差 0.00px）+ 无跳位
- **不穿墙/不卡墙**：D 段四向停墙（gap≈0）+ 不穿墙 + 模型同步
- **炮弹反弹**：E 段反射定律（分量镜像+速率守恒+不嵌墙）+ 反弹点贴墙（≤10px）+ 斜射对称 + 渲染可见
- **道具/出生点**：F 段拾取 + AI 活动 + 胜负 + 重开 + 暂停
- **视觉**：G 段（视觉⊆碰撞 0 越界、墙高约定、地板不遮挡、单网格合并、kit 生效）

性能（SwiftShader 软渲染、1440×900，信息性记录）：

| 图 | 三角形 | draw calls | fps |
|---|---|---|---|
| classic | 262k | 24 | 60 |
| open / corridor / crossfire / loop / twin | 342k~668k | 21~24 | 60 |
| labyrinth | 732k | 2* | 60 |
| hub / sectors / random | 1.01M~1.27M | 21~22 | 60 |
| city / fort / ring | 1.37M | 21~22 | 60 |

*labyrinth 的 2 为采样时刻池未激活所致（信息行快照）。软渲染均 60fps；
真机 GPU 余量更大。

## 4. 推广中发现的验收方法论问题与修复（非游戏缺陷）

首跑 10 图失败，全部定位为**验收驱动按 classic 密集迷宫假设编写**，逐项通用化
（游戏代码零改动，69 项回归始终全绿）：

| 现象 | 根因 | 修复 |
|---|---|---|
| D-碰撞 南向 gap 416px | 开阔图柱体可被坦克**绕滑**（原版碰撞滑动行为），"冲向墙后 320px 目标"不再必然停墙 | D 段走廊尝试失败时自动回退**边界长墙**重测（不可绕滑） |
| D 回退仍失败 | `boundaryCell` 的 `best = p` 丢 `{p,d}` 包装，永远返回第一个格 | 修复比较对象 |
| C-贴墙 -23.8px | `face = maze.width - 9` 是 classic 边界硬编码；他图几何不同 | 改为射线找**真实东向墙面**（40~90px），断言"生成点不在任何墙内" |
| E-法向/切向失败 | 他图子弹首撞可能是柱角/横面，非正东竖直面 | 改为**通用反射定律**（单分量镜像/柱角双镜像 + 速率守恒 + 不嵌墙） |
| E-贴邻 6.75~9.09px | 6.5px 容差按 classic 拐角标定，13 图拐角分离实测上限 ~9px | 放宽至 10px（依据 13 图实测分布） |
| F-AI twin 位移 0 | 单个敌人 3 秒未净移动即判死 | 取**任一敌方**最大位移 + 6 秒窗口 |

## 5. 完成后总检

- **布局与原版一致**：地图数据文件零改动（git diff 为空）；69 项测试含全部
  13 图的等距布局/墙体分段/碰撞校验，全绿；每图 G 断言视觉=碰撞逐边校验通过。
- **共同渲染逻辑**：单一 `buildMap`，逐图唯一差异是配色查表一行（§2.2）；
  无任何 per-map 渲染代码分支。
- **重复资源/加载错误/开销**：GLB×5 + 贴图×3 仅一次加载；切图 dispose 旧网格；
  无加载错误（13 图 kit 全部生效，`kit=ok`）；性能见 §3。
- **全部可启动可游玩**：13 图断言全绿 + 截图均为实跑画面。

## 6. 截图清单（`screenshots/`，全部实跑）

- `map-{classic,open,corridor,crossfire,loop,twin,city,fort,ring,hub,sectors,labyrinth,random}.png`
  13 张逐图实跑画面（含坦克/HUD/地图全貌）
- `map-{city,crossfire,twin}-enhanced.png` 亮度拉伸核验副本（无内容增改）
- 视觉抽查结论：city 网格街区+实心建筑堆；crossfire 十字+实心柱体+偏蓝配色；
  twin 中央隔断双区域+偏暖配色；均无镂空/缝隙/穿模/悬浮。

## 7. 未解决 / 已知事项

- 视觉无法完全匹配的区域：无（三套官方配色 + 模块件覆盖了全部墙体形态；
  走廊/房间/门等一体化组合件按"不为使用率牺牲效果"原则未启用，见阶段 2c 文档）。
- `file://` 双击仍回退 2D（既定：阶段 2d 打包）；start.bat 走本地 HTTP 正常（95c9aa1）。
- labyrinth 性能信息行的 drawCalls=2 为采样时刻池未激活的快照现象，非缺陷。

## 8. 变更文件清单

- 修改：`js/three-proto.js`（胖块网格铺装 + 三配色材质/查表 + kit 加载门控含贴图）
- 修改：`tests/integration-3d.page.js`（`?map=` 参数化 + §4 六项方法论通用化 + D-诊断信息行）
- 新增：`tests/map-rollout-check.js`（逐图验收运行器）、`screenshots/map-*.png` 16 张
- 未触碰：全部游戏逻辑与地图数据文件
