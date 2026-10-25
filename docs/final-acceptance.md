# 最终验收（交付阶段）：全量回归、新功能与交付清单

日期：2026-10-25 ｜ 环境：Windows 10 + Edge headless（SwiftShader，1440×900）+ Node 24 + Python http.server

## 0. 总结论

**全部硬性测试通过，交付就绪。** 四套自动化全绿：13 图逐图验收（A–H）
MAP_ROLLOUT_OK、7 摆位集成验收 INTEGRATION_CHECK_OK、69/69 逻辑回归、
原型页检查 3/3。本阶段两项 *** 新功能（道具图标化 + 主菜单道具图鉴）已实现并
通过实跑视觉核验；*** 卡死/视野跟随专项检查（H 段）13 图全过。
**游戏逻辑与地图数据文件全程零改动**（git diff 基线以来为空）。

## 1. 核心玩法回归（§一要求 → 实测结果）

执行：`node tests/integration-check.js`（classic，7 摆位）+ `node tests/run-tests.js`。
断言全部来自实跑（无头真实浏览器驱动真实输入管线），非代码审查。

| 检查项 | 覆盖断言（实测） | 结果 |
|---|---|---|
| 启动/重开/结束流程 | F-预备 对局开始+3D 就绪；F-重开 restart 恢复；F-胜负 全灭胜利结算（state=over result=victory score=500）；F-暂停/恢复 | 通过 |
| 玩家输入与坦克移动 | A 段 8 方向 × 40 帧累计位移 131–132px 沿指令方向；无跳位（3.50px/帧 ≤ 上限） | 通过 |
| 车身转向与炮塔独立旋转 | A-转向 平滑收敛且炮塔=车身角（玩法规则）；B 段 8 偏移角炮塔绕中轴精确、不带动车身、炮管随动（炮口件距轴心恒 23px） | 通过 |
| 炮管方向与炮口位置 | C 段 6 方向炮弹出自炮口 24px 生成圆 ±2.5px；3D 炮口件与逻辑生成点重合 ±3px | 通过 |
| 炮弹生成/飞行/反弹 | C-方向 初速=炮管方向；E-反弹 反射定律（分量镜像+速率守恒+不嵌墙）+ 贴墙 ≤10px + 45° 斜射镜像 | 通过 |
| 坦克与墙体碰撞 | D 段四向停墙 gap≈0（走廊或边界回退）+ 不穿墙 + 模型同步 0.00px | 通过 |
| 道具生成和拾取 | F-道具 走到道具点完成拾取（剩余 5/6）；道具刷新逻辑未改（69 项含道具回归） | 通过 |
| 敌方 AI | F-AI 任一敌方 6 秒内位移 >25px（13 图实测全过） | 通过 |
| UI 与现有操作方式 | 原版 HUD 方法原样接管（hudScale 上下文一致）；输入映射 Δ=0.0px（proto-check）；`?proto3d=0` 可回原版 2D | 通过 |
| 逻辑回归 | 69/69（含碰撞/反弹/AI/地图布局/等距投影全量断言），exit 0 | 通过 |

## 2. 地图回归（§二要求 → 实测结果）

执行：`node tests/map-rollout-check.js` → **MAP_ROLLOUT_OK（13 张地图全部通过）**
（12 固定 + 随机；任务书"六张"为口误，全项目共 13 张，全部覆盖）。
每图执行同一驱动 A–H 段（约 45 项断言）+ 一张实跑截图 `screenshots/map-<id>.png`。

| 检查项 | 结果 |
|---|---|
| 能否正常加载 | 通过（13 图 F-预备 全绿，kit 地图视觉生效 pieces>0） |
| 布局与原版一致 | 通过（地图数据文件 git diff 为空；69 项测试含全部地图布局/分段/碰撞校验） |
| 视觉模型与碰撞边界一致 | 通过（G-碰撞 视觉⊆碰撞逐边校验，13 图最大越界全部 0.000；视觉厚 0.70 ⊆ 碰撞带 0.9） |
| 墙体缝隙/穿插/模型缺失 | 通过（视觉抽查 city/crossfire/twin：实心块完整、无镂空/穿模/悬浮；G-墙高/地板/单网格断言全绿） |
| 不影响坦克移动与炮弹反弹 | 通过（A/D/E 段 13 图全绿） |
| 道具和出生点保持原有位置 | 通过（逻辑零改动；F 段按原刷新逻辑拾取成功；classic 基线 JSON 在档可比对） |
| *** 道具图标完整清晰（非颜色区分） | **通过**——3D 层道具由纯色球升级为**原版图标广告牌**（PickupIcons 复用 2D 原版绘制 → CanvasTexture → Sprite）；实跑截图放大核验：圆形描边+符号（闪电/放射/箭头）可区分、朝向镜头、无异常 |
| *** 主菜单道具图鉴 | **通过**——菜单新增可展开"道具图鉴"（10 种：图标贴图+名称+类别标签+效果+用法）；实跑截图核验：10 条目齐全、图标符号各异、文字可读、风格协调（`screenshots/integration-menu.png`） |
| *** 大图卡死 / 视野不跟随 | **通过**——新增 H 段：13 图相机逐帧跟随（含边界钳制基准，最大偏差 ≤6px=一帧尾随）；持续机动采样（10s 累计 ≥250px，实测 315–5508px）；最远端传送验证（可站立+可机动+视野即时跟随）；驱动诊断确认 mode=move 全程响应（无冻结） |

## 3. 实际运行截图（§三清单）

全部为无头真实浏览器实跑（非 Blender 渲染）：`screenshots/`

1. 完整地图游戏画面：`integration-overview.png`（?overview=1 全景）
2. 坦克在地图中移动：`integration-move.png`（另 13 图 `map-*.png` 均含坦克在图）
3. 炮塔与车身朝向不同：`integration-turret.png`（诊断偏移 90°）
4. 炮弹发射与反弹：`integration-muzzle.png` / `integration-wall.png` / `integration-bounce.png`
5. 其他地图代表画面：`map-{open,corridor,crossfire,loop,twin,city,fort,ring,hub,sectors,labyrinth,random}.png`（每图一张）
6. 新功能：`integration-menu.png`（道具图鉴）、`proto-classic.png`（游戏内道具图标）
7. 新旧对照：`compare-{move,wall,bounce}.png`；暗图核验副本 `*-enhanced.png`（仅灰阶拉伸）

## 4. 性能与资源（§四）

- **帧率**：SwiftShader 软渲染 1440×900 全程 60fps（13 图实测：26 万–138 万三角、
  21–24 draw calls；整图合并 1 网格）。真机 GPU 余量更大。无持续掉帧现象。
- **重复加载**：无——GLB×6（坦克+5 模块件）与贴图×4（colormap×3 变体+道具图标缓存）
  仅加载一次；切图 dispose 旧合并网格；材质共享。
- **加载错误**：无（H-控制台 断言 `__proto3d.errors` 为空，13 图 errors=0；
  proto-check 3 场景"错误=无"）。
- **内存/渲染**：几何体用后即释放（buildMap/merge 后 dispose 源几何）；
  无纹理重复实例（三套配色共享图集 UV）。
- 本阶段定位并修复的真实缺陷（均为渲染层）：
  ① kit 部件异步竞态——buildMap 仅守卫 wall/floor，其余三件未就绪时
  `entry.geo` 抛 TypeError（corridor 实跑捕获）→ 守卫补全；
  ② prototype-3d.html 缺 pickup-icons.js 标签 → 模块渲染道具时
  `PickupIcons is not defined`（proto-check 捕获）→ 补标签；
  ③ 测试运行器复用浏览器配置目录导致陈旧缓存假失败 → 三运行器运行前清档。
  修复后全量复跑全绿。

## 5. 资源与项目结构（§五）

- 可编辑 Blender 源：`blender-3d/source/toy_tank.glb` 的 `.blend` + 历史源 ✓
- 建模/导出脚本：`blender-3d/scripts/`（build/verify/inspect，Python+JS）✓
- 游戏 GLB：`blender-3d/exports/toy_tank.glb`（18 部件，炮口 24px 标定）✓
- 地图资源：`kenney_modular-space-kit_1.0/`（5 部件 + 3 配色图集在用）✓
- 资源目录清晰：`vendor/`（three.js r170）、`blender-3d/`、`kenney_*/`、`js/`、`tests/`、`docs/`、`screenshots/` ✓
- 来源与许可：three.js MIT（vendor/LICENSE-three）；Kenney 两包 CC0（各自 License.txt）；
  README 顶部已记录 ✓
- 启动与构建说明：`start.bat`（双击启动）+ `README.md`（3D 升级版说明节）✓
- **原始下载资源未被覆盖**：git diff 基线→HEAD 对两个 Kenney 目录为空（零改动）✓
- 备份未被修改：项目无其他备份目录；git 历史完整（7 个阶段提交）✓

## 6. 逐图验收汇总（§六-5）

| 图 | A–F 玩法 | G 视觉 | H 跟随/机动/可达 | 截图 | 结论 |
|---|---|---|---|---|---|
| classic | 通过 | 通过（越界 0.000） | 通过 | map-classic.png | **通过** |
| open | 通过 | 通过 | 通过 | map-open.png | **通过** |
| corridor | 通过 | 通过 | 通过 | map-corridor.png | **通过** |
| crossfire | 通过 | 通过 | 通过 | map-crossfire.png | **通过** |
| loop | 通过 | 通过 | 通过 | map-loop.png | **通过** |
| twin | 通过 | 通过 | 通过 | map-twin.png | **通过** |
| city | 通过 | 通过 | 通过 | map-city.png | **通过** |
| fort | 通过 | 通过 | 通过 | map-fort.png | **通过** |
| ring | 通过 | 通过 | 通过 | map-ring.png | **通过** |
| hub | 通过 | 通过 | 通过 | map-hub.png | **通过** |
| sectors | 通过 | 通过 | 通过 | map-sectors.png | **通过** |
| labyrinth | 通过 | 通过 | 通过 | map-labyrinth.png | **通过** |
| random | 通过 | 通过 | 通过 | map-random.png | **通过** |

## 7. 未解决问题及影响（§六-6）

1. **file:// 双击 index.html 回退 2D**（浏览器模块加载限制；start.bat 已绕过；
   单文件离线打包未做）——影响：不用 start.bat 时无双击即 3D。属既定后续项。
2. **labyrinth 性能信息行 drawCalls=2**：采样时刻对象池未激活的快照现象，非缺陷。
3. **极低端机器软渲染**：138 万三角在 SwiftShader 仍 60fps，但更弱核显无实测数据。
4. **Firefox/Safari 未验证**（原版 README 既有边界，未扩大）。

无未通过的硬性测试。

## 8. 启动与复测（§六-7）

```bash
# 启动（二选一）
start.bat                     # 需 Python 3；自动起服务并打开 3D 版
python -m http.server 8080    # 手动：浏览器开 http://127.0.0.1:8080/index.html

# 复测（按依赖顺序）
node tests/run-tests.js           # 69/69 逻辑回归（无需服务）
node tests/proto-check.js         # 原型页 3 场景（需服务）
node tests/integration-check.js   # classic 7 摆位 A–F+G+H（需服务，约 4 分钟）
node tests/map-rollout-check.js   # 全部 13 图 A–H + 截图（需服务，约 12 分钟）

# 体验开关
# ?proto3d=0 原版 2D ｜ ?overview=1 全景 ｜ ?turretdebug=90 炮塔演示 ｜ F1 调试层
```

## 9. 后续建议（不在本次实施）

- 阶段 2d 打磨：three.js 打包单 IIFE + GLB/贴图 base64 内嵌，恢复双击离线 3D；
- 光照/配色统一精调（当前三套官方配色，可加昼夜主题）；
- InstancedMesh 化地板（当前 1 draw call 已达标，属锦上添花）；
- 真机（独立显卡/高分屏）手感与性能抽测；
- 移动端触控（原版即无，非回归）。

## 10. 本阶段变更文件

- 新增：`js/pickup-icons.js`（图标工厂）、`js/pickup-legend.js`（菜单图鉴）、
  `docs/final-acceptance.md`
- 修改：`js/three-proto.js`（道具广告牌 Sprite + kit 部件守卫 + 状态面板错误首条）、
  `index.html`（图鉴容器 + 脚本标签）、`prototype-3d.html`（pickup-icons 标签）、
  `style.css`（图鉴样式）、`tests/integration-3d.page.js`（H 段 + 控制台断言 + menu 摆位）、
  `tests/integration-check.js`（menu 场景 + 运行前清档）、
  `tests/map-rollout-check.js`/`tests/proto-check.js`（运行前清档）、`README.md`（3D 版说明）
- 游戏逻辑与地图数据：零改动
