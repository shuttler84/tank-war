# 卡丁车细节检查：车头朝向 / 顶点色 / 底盘形状预览（选型证据）
# 用法: blender -b --factory-startup --python scripts/inspect_kart_detail.py
import bpy
import mathutils
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT.parent / "kenney_car-kit" / "Models" / "GLB format"
PREVIEW = ROOT / "previews" / "candidate-kart-chassis.png"
PREVIEW.parent.mkdir(parents=True, exist_ok=True)

print("=== inspect_kart_detail ===")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(KIT / "kart-oobi.glb"))

# 1) 各物体世界坐标（判断车头方向：front 轮的 Y 符号）
for o in bpy.data.objects:
    if o.type == "MESH":
        wloc = o.matrix_world.translation
        print("loc %-22s x=%7.3f y=%7.3f z=%7.3f" % (o.name, wloc.x, wloc.y, wloc.z))

# 2) 上色机制：顶点色 or 贴图
body = next(o for o in bpy.data.objects if o.name.startswith("kart-"))
print("color_attributes:", [(a.name, a.domain, a.data_type) for a in body.data.color_attributes])
mat = body.data.materials[0]
tex_nodes = [n.type for n in mat.node_tree.nodes]
print("material_nodes:", tex_nodes)
if mat.node_tree:
    for n in mat.node_tree.nodes:
        if n.type == "VERTEX_COLOR":
            print("vertex_color_node:", n.layer_name)

# 3) 底盘单独预览（拆掉驾驶员和四个轮子）
for o in list(bpy.data.objects):
    if "character" in o.name or "wheel" in o.name:
        bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
cam.location = (2.4, -2.4, 2.2)
d = mathutils.Vector((0, 0, 0.3)) - cam.location
cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
scene.camera = cam
cam_data.lens = 50

sun_d = bpy.data.lights.new("Sun", type="SUN")
sun_d.energy = 3
sun = bpy.data.objects.new("Sun", sun_d)
scene.collection.objects.link(sun)
sun.location = (3, -3, 5)
sun.rotation_euler = (mathutils.Vector((0, 0, 0)) - sun.location).to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("W")
world.use_nodes = True
next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.85, 0.88, 0.92, 1)
scene.world = world

scene.render.resolution_x = 640
scene.render.resolution_y = 480
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = str(PREVIEW)
for eng in ("BLENDER_EEVEE", "CYCLES", "BLENDER_WORKBENCH"):
    try:
        scene.render.engine = eng
        bpy.ops.render.render(write_still=True)
        print("chassis_preview:", PREVIEW, "engine:", eng)
        break
    except Exception as e:
        print("engine_failed:", eng, repr(e))
print("KART_DETAIL_DONE")
