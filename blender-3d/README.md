# blender-3d — 坦克动荡 3D 资源工作流

独立于游戏代码的 Blender 自动建模工作目录。本阶段（阶段1）只验证「脚本建模 → 保存 .blend → 导出 GLB → 校验 → 渲染预览」流程，尚未制作正式游戏模型，也未改动任何游戏文件。

## 环境信息

| 项目 | 值 |
|---|---|
| Blender | 5.2.3 LTS（Steam 版，2026-10-22 构建） |
| 可执行文件 | `E:\SteamLibrary\steamapps\common\Blender\blender.exe` |
| 内置 Python | 3.13.13（`E:\SteamLibrary\steamapps\common\Blender\5.2\python`） |
| glTF 插件 | `io_scene_gltf2`（默认启用，导出/导入算子均可用） |
| 渲染引擎 | `BLENDER_EEVEE`（5.2 中 EEVEE Next 已回归此名）、`CYCLES`、`BLENDER_WORKBENCH` |

## 目录结构

```
blender-3d/
├── scripts/    Blender 自动建模脚本（无 UI 后台运行）
├── source/     Blender 原始工程文件（.blend，可双击用 GUI 打开继续编辑）
├── exports/    导出的 GLB 模型（游戏引擎可用格式）
├── previews/   自动渲染的预览图（PNG）
├── build.log / verify.log   最近一次运行的完整日志
└── README.md
```

## 运行方法

以下命令在仓库根目录 `blender-3d/` 下执行（Git Bash / cmd 通用，cmd 下把正斜杠换成反斜杠）：

```bash
BLENDER="/e/SteamLibrary/steamapps/common/Blender/blender.exe"

# 0. 环境自检（版本、Python、glTF 插件、可用渲染引擎）
"$BLENDER" -b --factory-startup --python scripts/env_check.py

# 1. 构建 → 保存 .blend → 导出 GLB → 渲染预览（一条命令完成）
"$BLENDER" -b --factory-startup --python scripts/build_test_asset.py

# 2. 独立验证导出文件（不信任退出码，实际解析 GLB 并重新导入）
"$BLENDER" -b --factory-startup --python scripts/verify_export.py -- exports/test_cube.glb
```

`--` 后可传任意 GLB 路径；省略时默认验证 `exports/test_cube.glb`。

判定标准：`env_check` 打印 `ENV_CHECK_OK`；构建打印 `BUILD_OK`；验证打印 `VERIFY_OK` 且退出码为 0。验证包含三层：文件存在且 ≥1KB → GLB 二进制头（magic/version/length）与 JSON 内容解析 → Blender 重新导入统计 mesh/顶点/材质。

## 当前测试产物（阶段1）

| 文件 | 说明 |
|---|---|
| `source/test_cube.blend` | 立方体 TestCube（2m）+ 橙色材质 TestOrangeMat + 摄像机 + 太阳光，89.9 KB |
| `exports/test_cube.glb` | glTF 2.0 二进制，1968 字节，含 1 mesh / 24 顶点 / 1 材质 |
| `previews/test_cube_preview.png` | EEVEE 渲染 640×480 预览图 |

注意：GLB 中默认不包含摄像机（Blender glTF 导出器默认不导出相机，游戏资产也不需要）；摄像机保存在 `.blend` 工程内。如需携带相机可加 `export_cameras=True`。

## 后续如何扩展（给新模型脚本）

1. 复制 `build_test_asset.py` 改名（如 `build_tank_body.py`），替换建模段落（第 1–4 节），保持「保存 → 导出 → 渲染 → 自检」骨架不变。
2. 材质用 Principled BSDF 节点，颜色走 `Base Color`，导出 GLB 自动转 PBR metallic-roughness。
3. 每个 GLB 导出后必须跑一次 `verify_export.py`，确认顶点数/材质符合预期再进入游戏。

## 约束（阶段1验收用）

- 本目录完全独立，未读取、未修改游戏 `js/`、`style.css`、`index.html` 等任何文件。
- 所有 Blender 调用均带 `--factory-startup`，不污染用户配置。
- 不假设 Blender 已安装：`env_check.py` 可随时重跑确认环境。
