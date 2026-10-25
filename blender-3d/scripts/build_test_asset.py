# 测试资产构建脚本（阶段1验证用）
# 用法: blender -b --factory-startup --python scripts/build_test_asset.py
# 产出: source/test_cube.blend + exports/test_cube.glb + previews/test_cube_preview.png
import os
import sys
from pathlib import Path

import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[1]
BLEND_PATH = ROOT / "source" / "test_cube.blend"
GLB_PATH = ROOT / "exports" / "test_cube.glb"
PREVIEW_PATH = ROOT / "previews" / "test_cube_preview.png"

for p in (BLEND_PATH.parent, GLB_PATH.parent, PREVIEW_PATH.parent):
    p.mkdir(parents=True, exist_ok=True)

print("=== build_test_asset ===")

# 从空场景开始，保证结果可复现
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def look_at(obj, target):
    """让物体的 -Z 轴朝向目标（适用于摄像机和灯光）。"""
    direction = mathutils.Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# ---- 1. 立方体 ----
bpy.ops.mesh.primitive_cube_add(size=2.0, location=(0.0, 0.0, 0.0))
cube = bpy.context.active_object
cube.name = "TestCube"
print("cube_created:", cube.name)

# ---- 2. 材质 ----
mat = bpy.data.materials.new("TestOrangeMat")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.85, 0.35, 0.08, 1.0)
bsdf.inputs["Roughness"].default_value = 0.45
cube.data.materials.append(mat)
print("material_created:", mat.name)

# ---- 3. 摄像机 ----
cam_data = bpy.data.cameras.new("Camera")
cam_obj = bpy.data.objects.new("Camera", cam_data)
scene.collection.objects.link(cam_obj)
cam_obj.location = (4.0, -4.0, 3.0)
look_at(cam_obj, (0.0, 0.0, 0.0))
scene.camera = cam_obj
print("camera_created:", cam_obj.name)

# ---- 4. 灯光与世界环境（预览渲染需要） ----
light_data = bpy.data.lights.new("Sun", type="SUN")
light_data.energy = 3.0
light_obj = bpy.data.objects.new("Sun", light_data)
scene.collection.objects.link(light_obj)
light_obj.location = (4.0, -4.0, 6.0)
look_at(light_obj, (0.0, 0.0, 0.0))

world = bpy.data.worlds.new("World")
world.use_nodes = True
bg = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs[0].default_value = (0.9, 0.9, 0.95, 1.0)
scene.world = world
print("light_and_world_ready")

# ---- 5. 保存 .blend ----
bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
print("blend_saved:", BLEND_PATH, BLEND_PATH.stat().st_size, "bytes")

# ---- 6. 导出 GLB ----
bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB")
print("glb_exported:", GLB_PATH, GLB_PATH.stat().st_size, "bytes")

# ---- 7. 渲染预览图（EEVEE 优先，逐级回退） ----
scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW_PATH)


def render_with_fallback():
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES", "BLENDER_WORKBENCH"):
        try:
            scene.render.engine = eng
            if eng == "CYCLES":
                scene.cycles.device = "CPU"
                scene.cycles.samples = 16
            if "EEVEE" in eng and hasattr(scene, "eevee"):
                try:
                    scene.eevee.taa_render_samples = 32
                except Exception:
                    pass
            if eng == "BLENDER_WORKBENCH" and hasattr(scene.display, "shading"):
                scene.display.shading.color_type = "MATERIAL"
            bpy.ops.render.render(write_still=True)
            return eng
        except Exception as e:
            print("engine_failed:", eng, repr(e))
    raise RuntimeError("all render engines failed")


used_engine = render_with_fallback()
print("preview_rendered:", PREVIEW_PATH, "engine:", used_engine)

# ---- 8. 自检 ----
ok = all(p.exists() and p.stat().st_size > 0 for p in (BLEND_PATH, GLB_PATH, PREVIEW_PATH))
print("files_check:", "OK" if ok else "FAILED")
if not ok:
    sys.exit(1)
print("BUILD_OK")
