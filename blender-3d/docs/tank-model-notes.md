# 玩具坦克模型：选型理由与改造说明（阶段 2b）

日期：2026-10-25 ｜ Blender 5.2.3 LTS（命令行无 UI）｜ 资源：Kenney Toy Car Kit（CC0）

## 1. 选型结论

**基础模型 = `kart-oobi.glb`（卡丁车）车身 + `wheel-dark.glb`（独立轮件）×6 作负重轮。**
炮塔 / 炮管 / 履带侧裙 / 上甲板在 kit 中无对应零件，用 Blender 基础几何体补充
（圆柱 + 倒角，保持低模玩具风）。

## 2. 候选比较（数据来自 `scripts/inspect_models.py` 实测）

| 候选 | 结构 | 改造为坦克的工作量评估 |
|---|---|---|
| kart-oobi 等 5 辆卡丁车 | 车身 + 4 独立轮 + 可拆驾驶员，三件分离 | **最小**：删人偶与轮子即得低矮底盘；中部地板平坦可放炮塔 |
| sedan / suv / delivery | 车身为一个封闭整体 mesh | 大：座舱与车身连成一体，做"敞开战斗舱"需切多边形 |
| hatchback-sports / race | 同上，且车身低趴流线 | 大：同上，且轮廓离坦克更远 |
| tractor | 后轮直径 1.05、重心高 | 中：农业感强，推倒重来比例失衡 |

选卡丁车的决定性理由：
1. **零件可独立选择**（车身/轮/人偶是分离物体），这是其他所有整车都不具备的；
2. 车身已自带**低矮宽扁比例**（0.93 × 1.43 × 0.59），与游戏坦克碰撞足迹
   （26 × 20，长宽比 1.3）天然接近，最终模型归一化后 1.98 × 2.60 × 1.25，长宽比 1.31；
3. 驾驶员人偶直接删除即可，无需修剪几何；
4. 5 辆卡丁车共享同一底盘 mesh（都是 1014 顶点），仅装饰件不同——后续做敌方
   坦克差异化时，同一管线换 kart-oodi/ooli/oopi/oozi 即可得到 5 种外观。

## 3. 朝向 / 原点 / 上色机制（实测）

- 车头朝 **-Y**（前轮 y=-0.324 < 后轮 y=+0.361），与 Blender 前向约定一致；
  导出 glTF 后（Y-up→Z-up 转换）为 +Z 前向，接入 Three.js 时按此对齐。
- kit 全部模型共用一张 `colormap` 调色板贴图，无法按队伍换色 → 全部替换为
  命名纯色材质（见 §5）。
- 模型归一化：整体缩放至长(Y)=2.6 单位（**1 单位 = 10 游戏像素**，即全长 26 px，
  等于 `CONFIG.TANK.hullLength`），底部触地 z=0，根节点原点 = 地面投影中心。

## 4. 部件层级（游戏接入约定）

```
ToyTank (EMPTY, 根，原点=地面中心)
├─ Hull                 kart-oobi 车身（坦克碰撞/移动直接驱动本节点即可）
├─ HullDeck             上甲板（基础几何，盖住座椅基座）
├─ TrackSkirtL / R      履带侧裙 ×2
├─ WheelL1..3 R1..3     负重轮 ×6（复用 kit wheel-dark mesh，X 轴=滚动轴）
└─ TurretPivot (EMPTY, 位于车体中轴 x=0、上甲板上方)   ← 炮塔独立旋转轴（Z）
   ├─ Turret / TurretHatch / Mantlet
   └─ BarrelPivot (EMPTY, 炮塔中心高度)               ← 预留俯仰轴（X）
      ├─ Barrel / MuzzleBrake
```

炮塔旋转 = 只转 `TurretPivot.rotation.z`；炮管随层级自动跟随；
**不需要旋转整个模型**。`BarrelPivot` 目前与炮塔同向（游戏用固定朝向开火），
预留俯仰与后坐动画轴。炮口世界位置 ≈ 沿炮塔 -Y 方向 1.51 单位（≈15 px，
与 `CONFIG.TANK.muzzleOffset=24` 的差值由 hull 前伸量补足，接入时再标定）。

## 5. 材质清单（命名纯色，供按队伍换色）

`TankHull / TankHullLight / TankTrack / TankWheel / TankTurret / TankHatch /
TankBarrel / TankMuzzle / TankMantlet` —— 色值取自游戏玩家绿
（`CONFIG.COLORS.tanks.green`）。换队伍色时在引擎侧对同名材质做 tint，
或对 `Tank*` 前缀材质替换主色即可。

## 6. 改造步骤（`scripts/build_tank.py`，可重复执行）

1. 导入 kart-oobi，删除驾驶员人偶与 4 个卡丁车轮，车身改名 `Hull`；
2. 补基础几何：上甲板、左右履带侧裙、炮塔（20 边圆柱+倒角）、舱盖、防盾、
   炮管（14 边圆柱）、炮口制退器；全部关键棱边加 2 段倒角保持玩具圆润感；
3. 负重轮复用 kit `wheel-dark` mesh ×6（每侧 3 个，X 轴=滚动轴）；
4. 建立 §4 层级（reparent 保持世界变换），归一化尺寸并触地；
5. 平直着色（Kenney 玩具风），清理孤儿数据，部件完整性断言后保存 `.blend`；
6. 导出 GLB（仅坦克子树、应用修改器），渲染 7 张预览
   （正/侧/顶/斜/尾 + 炮塔 90°/180° 旋转证明）。

## 7. 校验结果（`scripts/verify_tank.py`，独立重导入 GLB）

14/14 通过：部件与层级齐全；尺寸 1.98 × 2.60 × 1.25、zmin=0.000；
炮塔轴心 x=0.0000 在中轴上；旋转 TurretPivot 时 Hull 位移 0.000000（不动）、
炮管相对轴心偏移 (0,-0.83)→(0.83,0)（刚体旋转，模长不变，-Y→+X 正确）；
材质全为 Tank* 命名材质、无 colormap 残留；总顶点 7238（< 8000 预算，
预算依据：车身 1014 + 负重轮 6×528 + 炮塔组件约 3000）；无 NaN 顶点。

构建过程中校验抓到并修复的问题：
- `BarrelPivot` 创建后漏链进场景集合，被 `orphans_purge` 连带删除 → 补
  `scene.collection.objects.link` 并新增导出前部件完整性断言；
- glTF 导入节点为四元数旋转模式，校验脚本用 `rotation_euler` 赋值无效 →
  改用矩阵旋转（模式无关）。

## 8. 产物清单

| 文件 | 说明 |
|---|---|
| `blender-3d/source/toy_tank.blend` | 源工程（可 GUI 打开继续编辑） |
| `blender-3d/exports/toy_tank.glb` | glTF 2.0 二进制，134,944 字节，15 mesh / 9 材质 |
| `blender-3d/previews/toy_tank_{front,side,top,oblique,rear}.png` | 五视角预览（960×720，EEVEE） |
| `blender-3d/previews/toy_tank_turret{90,180}.png` | 炮塔旋转证明图 |
| `blender-3d/scripts/build_tank.py` | 建模+导出+渲染脚本（可重复执行） |
| `blender-3d/scripts/verify_tank.py` | 独立校验脚本 |
| `blender-3d/scripts/inspect_models.py` / `inspect_kart_detail.py` | 选型取证脚本 |
| `blender-3d/previews/candidate-kart-chassis.png` | 选型证据：卡丁车底盘拆件后形态 |

## 9. 已知取舍

- 卡丁车前保险杠与尾部排气管结构保留（任务要求尽量保留现有车身），在绿色
  材质下分别读作"前防浪板 / 车尾储物筒"，属玩具风特征而非缺陷；
- 负重轮略宽于侧裙、外缘露出约 0.06 单位，为有意的"外露悬挂"造型；
- 炮管根部藏在防盾内、炮塔底沿与上甲板留 0.02 重叠防穿帮，均非网格错误。

## 10. 未尽事项（留待游戏接入阶段）

- 本阶段仅 Blender 预览验收，**不构成游戏接入证明**；Three.js 加载、
  队伍色实例化、履带滚动动画在阶段 2a/2c 的接入任务中处理。
- 炮口偏移量与游戏 `muzzleOffset` 的精确标定在接入时进行。
