# 炮弹缩小 + 自伤机制 + 恶魔难度（交付报告）

日期：2026-10-25 ｜ 回归：92/92（三连跑）+ 集成 8 摆位 + 13 图 rollout + proto 3/3 + 浏览器端到端

## 一、架构审查结论（第一阶段，实施前确认）

| 项 | 现状 |
|---|---|
| 炮弹模型 | 3D 层实例池单点构造 `SphereGeometry(0.45)`（=4.5px 视觉半径），按弹位置/发射者色摆放 |
| 碰撞体 | `Bullet.radius = CONFIG.BULLET.radius`（3.6px）——墙壁 raycast、坦克命中（segmentCircle 半径和）、AI 视线（losRadius）、弹道预测全部引用同一 config |
| 穿透 | 无：弹按 substep 5px 分段 + 每段整段射线检测（墙）+ segmentCircle 扫掠（坦克），高速不漏检 |
| 归属/伤害 | `findTankHit` 内 `t.id === bullet.ownerId → skip` = **发射者永久豁免**（自伤过滤点）；`onBulletHit` 一击必杀 → 计分（玩家杀敌）/ onPlayerDown / checkVictory |
| 出生保护 | 无（炮口 24px > 命中半径和，靠 owner 豁免防自碰） |
| 难度 AI | `AI_DIFFICULTIES`（easy/normal/hard）；**AI 目标本来就只有玩家**（感知段唯一读 game.player 实时坐标；看不见走 lastKnown/共享情报/枪声 → 搜索 → 放弃管线完备）；hunter 上限 hard=3 |
| 难度 UI | index.html 三个 choice 按钮 → ui.js options → game.settings → `AI_DIFFICULTIES[key] || normal` |

**修改计划**：① config 改 radius + 3D 球体；② 删豁免 + 加短暂出生保护；③ demon 表项 + 锁定范围门控 + UI 按钮 + hunter 全员。

## 二、炮弹缩小（第二阶段）

- **碰撞半径**：`CONFIG.BULLET.radius: 3.6 → 1.8`（单点定义；反弹、命中、AI 视线、弹道预测全部随之生效——无任何复制硬编码）。
- **视觉模型**：3D 球 `SphereGeometry(0.45 → 0.225)`（同为 50%），高度 0.55 → 0.3 贴合地面；颜色/自发光/拖尾/速度/伤害/反弹数不变。
- **生成位置**：仍按 `muzzleOffset`（24px）+ 贴墙截短的原语义；断言"生成点在 [6, 28]px 合法区间、不在墙内、不在坦克内"通过——**未因缩放移位**。
- **穿透检查**：分段扫掠机制与半径无关，1.8px 弹不产生新穿透面；13 图 E 段反弹/命中全绿。
- **未动**：坦克碰撞箱（16px）、墙壁碰撞边界、反弹方向/次数公式。

## 三、自伤机制（第三阶段）

- 删除 `findTankHit` 的 owner 永久豁免；改为**出生保护**：`bullet.age < CONFIG.BULLET.spawnOwnerImmune(0.12s)` 内跳过发射者——只覆盖炮口生成瞬间，反弹（最早 ~0.14s 后）与寿命期内全部可自伤。
- 激光同步放开（`findLaserTarget` 不再过滤 owner）；**地雷维持原版"不伤布设者"**（任务范围仅炮弹，原设计是有意机制，报告说明）。
- 计分/统计：`onBulletHit` 原逻辑天然正确——玩家自伤不计分不扣击杀、`onPlayerDown` 扣命、敌军自伤走 checkVictory（敌全灭时 victoryBonus 属原版规则）。断言锁定：玩家自伤 lives-1/deaths+1/kills 与 score 不变。

## 四、恶魔难度（第四阶段）

- `AI_DIFFICULTIES.demon`（名称"恶魔"）：复用 hard 的战术量级（速度/射速/生命等无关数值未动），`demon: true` 标志。
- **目标选择**：`coordination: 0` + `assignAIRoles` hunter 上限=全体 → 所有敌坦克主动追击玩家；**不改变任何炮弹碰撞过滤**——敌方互伤照常（断言：demon 下 e1 击毁 e2）。
- **锁定范围**：`CONFIG.AI.demonLockRadius = 900px`（集中可调；取值依据：小图对角 1720px 的一半 ≈ 5.7s 坦克路程——压迫但非全图咬死）。**规则**：范围外且无视线 → `forgetIntel()` 清情报 + 进 wander 巡逻（复用现有放弃管线）；回范围内恢复标准感知（视线/情报/搜索全保留）。**永不穿墙追踪**——losClear 遮挡规则原样生效。
- UI：难度行新增"恶魔"按钮；重开/换难度经 startMatch 重建 AIController，规则正确重置（断言覆盖）。

## 五、测试结果（第五阶段；全部实际执行）

**新增 10 项 VM 测试**（真实输入管线）：

| 组 | 断言 | 结果 |
|---|---|---|
| 尺寸 | radius=1.8；新弹 speed/maxBounces 不变；生成点炮口区间/不在墙内坦克内 | 通过 |
| 自伤 | 玩家反弹自伤（lives-1/deaths+1/零计分）；敌反弹自伤（零击杀分，victoryBonus 除外）；出生保护短暂且过期后可命中；直射无永久豁免 | 通过 ×4 |
| 恶魔 | 表项注册+参数完整+原三难度无 demon 标志；范围内锁定（hasLos+lastKnown）/范围外清情报巡逻；敌间误伤保留；重开重置 | 通过 ×4 |

**回归**：92/92（三连跑稳定）＝原有 82 项全绿（AI 行为、炮弹反弹、道具、连射机制等未被破坏）；集成 8 摆位（含 C-生成点、E-反弹贴墙/反射定律、D-四向停墙）；**13 图 rollout 全绿**（缩小炮弹下全部反弹/碰撞断言重新校准后通过）；proto 3/3；浏览器端到端全过。

**实机截图**（screenshots/，无头 Edge 实跑）：
- `bullet-size-compare.png`：新旧炮弹同摆位对照（左=原 3.6，右=新 1.8）
- `difficulty-demon.png`（+`-enhanced`）：恶魔难度实跑——右上角"经典迷宫 · **恶魔**"、4 敌坦克、缩小炮弹清晰可见
- `map-demon.png`：13 图逐图验收附带记录

## 六、测试方法论自纠记录

demon 表项曾被正则误插到 AI_PERSONALITIES（测试抓到"demon 表项"失败）；反弹自伤测试曾被玩家开场反击污染统计（补 invuln 冻结）；误伤测试的固定点位在 960×640 基础图上隔墙（改 stub 空场确定性验证）；玩家曾在前测复活点挡枪（挪出弹道）；E 段"不嵌墙"断言旧余量 3.4px 不适配 1.8px 弹（改弹心不入墙+贴墙≥半半径语义）。全部为测试侧修正，游戏逻辑一次成型。

## 七、变更文件

| 文件 | 变更 |
|---|---|
| `js/config.js` | `BULLET.radius 1.8`、`BULLET.spawnOwnerImmune 0.12`、新增 `CONFIG.AI.demonLockRadius` |
| `js/game.js` | findTankHit 豁免→出生保护；findLaserTarget 放开；计分注释 |
| `js/ai.js` | `AI_DIFFICULTIES.demon`；感知段恶魔锁定范围门控 |
| `js/three-proto.js` | 弹视觉 0.225 + 高度 0.3 |
| `index.html` | 难度按钮"恶魔" |
| `tests/suite.js` | 新增 10 项测试 |
| `tests/integration-3d.page.js` | E 段不嵌墙断言自适应半径 |

## 八、未验证项

- 真人手感（恶魔压迫感/锁定范围 900px 是否合适——第一轮值，`CONFIG.AI.demonLockRadius` 一处可调）。
- 真机 GPU 下的视觉尺寸观感（SwiftShader 截图已核验比例）。
- 地雷"不伤布设者"是否需要跟随自伤放开——**有意保留**，待您决定。
