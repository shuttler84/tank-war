# Blender 环境自检脚本：在 blender -b 后台模式下运行
# 输出 Blender/Python 版本、glTF 导出器可用性，供工作流前置校验使用
import sys
import bpy

print("=== Blender env check ===")
print("blender_version:", bpy.app.version_string)
print("python_version:", sys.version.split()[0])
print("python_prefix:", sys.prefix)

# glTF 导出插件检测
try:
    import addon_utils
    gltf_modules = [m.__name__ for m in addon_utils.modules() if "gltf" in m.__name__]
except Exception as e:
    gltf_modules = []
    print("addon_utils_error:", e)
print("gltf_addon_modules:", gltf_modules)

# 确保导出插件启用（已启用时无副作用）
for mod in gltf_modules:
    try:
        bpy.ops.preferences.addon_enable(module=mod)
        print("addon_enabled:", mod)
    except Exception as e:
        print("addon_enable_failed:", mod, e)

# 导出算子检测（Blender 4.x 为 export_scene.gltf，后续版本可能迁移）
has_export_scene_gltf = hasattr(bpy.ops.export_scene, "gltf")
has_wm_gltf_export = hasattr(bpy.ops.wm, "gltf_export")
print("operator_export_scene_gltf:", has_export_scene_gltf)
print("operator_wm_gltf_export:", has_wm_gltf_export)

# 渲染引擎可用性（按候选逐一试赋值，避免内省内部类）
engine_ok = []
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES", "BLENDER_WORKBENCH"):
    try:
        bpy.context.scene.render.engine = eng
        engine_ok.append(eng)
    except TypeError:
        pass
print("render_engines_available:", engine_ok)

if gltf_modules and (has_export_scene_gltf or has_wm_gltf_export):
    print("ENV_CHECK_OK")
else:
    print("ENV_CHECK_FAILED")
    sys.exit(1)
