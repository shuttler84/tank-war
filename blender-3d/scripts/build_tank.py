# 玩具坦克构建脚本（阶段2b）
# 用法: blender -b --factory-startup --python scripts/build_tank.py
# 产出: source/toy_tank.blend + exports/toy_tank.glb + previews/toy_tank_*.png
#
# 设计（选型依据见 docs/tank-model-notes.md）：
#   底盘   = Toy Car Kit kart-oobi 车身（拆除驾驶员人偶与四个卡丁车轮）
#   负重轮 = Toy Car Kit wheel-dark ×6（复用 kit 零件）
#   其余   = Blender 基础几何体（kit 无炮塔/炮管/履带裙对应件）
# 朝向：车头 = -Y（与卡丁车原生朝向一致；导出 glTF 后为 +Z 前向）
# 层级：ToyTank(根EMPTY, 原点=地面中心)
#       ├─ Hull(卡丁车身) HullDeck TrackSkirtL/R WheelL1..3 WheelR1..3
#       └─ TurretPivot(EMPTY, 位于车体中轴上方)      ← 炮塔独立旋转轴
#          ├─ Turret TurretHatch Mantlet
#          └─ BarrelPivot(EMPTY, 炮塔中心高度)       ← 预留俯仰/后坐轴
#             ├─ Barrel MuzzleBrake
# 材质：命名纯色材质 Tank*（游戏绿色队配色），供引擎按队伍换色
# 尺寸：整体归一化到长(Y)=2.6 单位（1 单位 = 10 游戏像素），地面 z=0
import math
import sys
from pathlib import Path

import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT.parent / "kenney_car-kit" / "Models" / "GLB format"
BLEND_PATH = ROOT / "source" / "toy_tank.blend"
GLB_PATH = ROOT / "exports" / "toy_tank.glb"
PREVIEW_DIR = ROOT / "previews"
for p in (BLEND_PATH.parent, GLB_PATH.parent, PREVIEW_DIR):
    p.mkdir(parents=True, exist_ok=True)

print("=== build_tank ===")
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------- 工具 ----------

def hex_to_linear(h):
    """sRGB 十六进制 → Blender 线性色"""
    h = h.lstrip("#")
    return tuple(pow(int(h[i:i + 2], 16) / 255.0, 2.2) for i in (0, 2, 4)) + (1.0,)


def make_mat(name, hex_color, rough=0.62):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = hex_to_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = rough
    if "Metallic" in bsdf.inputs:
        bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def reparent(obj, parent):
    """保持世界变换不变地把 obj 挂到 parent 下"""
    bpy.context.view_layer.update()
    wm = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_local = parent.matrix_world.inverted() @ wm
    bpy.context.view_layer.update()


def add_bevel(obj, width, segments=2):
    bev = obj.modifiers.new("Bevel", "BEVEL")
    bev.width = width
    bev.segments = segments
    bev.limit_method = "ANGLE"
    bev.angle_limit = math.radians(40)


def subtree(objs):
    out = []
    stack = list(objs)
    while stack:
        o = stack.pop()
        out.append(o)
        stack.extend(o.children)
    return out


def world_bbox(objs):
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = mathutils.Vector((-1e9, -1e9, -1e9))
    for o in subtree(objs):
        if o.type != "MESH":
            continue
        wm = o.matrix_world
        for c in o.bound_box:
            v = wm @ mathutils.Vector(c)
            lo.x = min(lo.x, v.x); lo.y = min(lo.y, v.y); lo.z = min(lo.z, v.z)
            hi.x = max(hi.x, v.x); hi.y = max(hi.y, v.y); hi.z = max(hi.z, v.z)
    return lo, hi


# ---------- 材质（游戏绿色队配色 CONFIG.COLORS.tanks.green） ----------

MATS = {
    "TankHull":     make_mat("TankHull",     "#43B02A"),  # 车身主绿
    "TankHullLight": make_mat("TankHullLight", "#79D45E"),  # 上甲板浅绿
    "TankTrack":    make_mat("TankTrack",    "#1F5215"),  # 履带裙深绿
    "TankWheel":    make_mat("TankWheel",    "#1A3D12"),  # 负重轮
    "TankTurret":   make_mat("TankTurret",   "#43B02A"),  # 炮塔
    "TankHatch":    make_mat("TankHatch",    "#79D45E"),  # 舱盖
    "TankBarrel":   make_mat("TankBarrel",   "#2C7A1B"),  # 炮管
    "TankMuzzle":   make_mat("TankMuzzle",   "#143A0E"),  # 炮口制退器
    "TankMantlet":  make_mat("TankMantlet",  "#26671A"),  # 防盾
}


def set_single_material(mesh_obj, mat_name):
    """替换 mesh 的全部材质槽为单一命名材质"""
    mesh_obj.data.materials.clear()
    mesh_obj.data.materials.append(MATS[mat_name])


# ---------- 1. 导入卡丁车底盘 ----------

bpy.ops.import_scene.gltf(filepath=str(KIT / "kart-oobi.glb"))
kart = next(o for o in bpy.data.objects if o.name.startswith("kart-"))
kart.name = "Hull"
# 拆除驾驶员人偶与四个卡丁车轮（坦克用履带总成替代）
for o in list(bpy.data.objects):
    if "character" in o.name or "wheel" in o.name.lower():
        bpy.data.objects.remove(o, do_unlink=True)
set_single_material(kart, "TankHull")
print("hull_imported: kart-oobi, driver+kartwheels removed, verts=%d" % len(kart.data.vertices))

# ---------- 2. 根节点 ----------

root = bpy.data.objects.new("ToyTank", None)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = 0.4
scene.collection.objects.link(root)
reparent(kart, root)

# ---------- 3. 上甲板（盖住座椅基座与尾部排气管） ----------

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.05, 0.53))
deck = bpy.context.active_object
deck.name = "HullDeck"
deck.scale = (0.50, 0.66, 0.14)          # 世界尺寸 1.0 × 1.32 × 0.28
add_bevel(deck, 0.05)
bpy.ops.object.transform_apply(scale=True)
set_single_material(deck, "TankHullLight")
reparent(deck, root)

# ---------- 4. 履带侧裙 + 负重轮（复用 kit wheel-dark） ----------

bpy.ops.import_scene.gltf(filepath=str(KIT / "wheel-dark.glb"))
wheel_proto = next(o for o in bpy.data.objects if o.name == "wheel-dark")
bpy.data.objects.remove(wheel_proto, do_unlink=True)  # 原件只留 mesh 数据供复用
wheel_mesh = next(d for d in bpy.data.meshes if d.users == 0 and d.name.startswith("wheel"))
wheel_mesh.name = "TankWheelMesh"
wheel_mesh.materials.clear()
wheel_mesh.materials.append(MATS["TankWheel"])

for side, sx in (("L", 1), ("R", -1)):
    skirt = bpy.ops.mesh.primitive_cube_add(size=1, location=(sx * 0.62, 0.0, 0.31))
    skirt_obj = bpy.context.active_object
    skirt_obj.name = "TrackSkirt" + side
    skirt_obj.scale = (0.14, 0.95, 0.29)      # 世界 0.28 × 1.90 × 0.58
    add_bevel(skirt_obj, 0.05)
    bpy.ops.object.transform_apply(scale=True)
    set_single_material(skirt_obj, "TankTrack")
    reparent(skirt_obj, root)
    for i, wy in enumerate((-0.55, 0.0, 0.55)):
        w = bpy.data.objects.new("Wheel%s%d" % (side, i + 1), wheel_mesh)
        scene.collection.objects.link(w)
        w.location = (sx * 0.62, wy, 0.30)    # 半径 0.3，底部触地 z=0
        reparent(w, root)

# ---------- 5. 炮塔 + 炮管（kit 无对应件，基础几何体补充） ----------

turret_pivot = bpy.data.objects.new("TurretPivot", None)
turret_pivot.empty_display_type = "PLAIN_AXES"
scene.collection.objects.link(turret_pivot)
turret_pivot.location = (0, -0.02, 0.71)      # 车体中轴、上甲板之上
reparent(turret_pivot, root)

bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.50, depth=0.30,
                                    location=(0, -0.02, 0.83))
turret = bpy.context.active_object
turret.name = "Turret"
add_bevel(turret, 0.035)
bpy.ops.object.transform_apply(scale=True)
set_single_material(turret, "TankTurret")
reparent(turret, turret_pivot)

bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.15, depth=0.08,
                                    location=(0, 0.16, 1.00))
hatch = bpy.context.active_object
hatch.name = "TurretHatch"
set_single_material(hatch, "TankHatch")
reparent(hatch, turret_pivot)

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.48, 0.83))
mantlet = bpy.context.active_object
mantlet.name = "Mantlet"
mantlet.scale = (0.18, 0.10, 0.13)
add_bevel(mantlet, 0.03)
bpy.ops.object.transform_apply(scale=True)
set_single_material(mantlet, "TankMantlet")
reparent(mantlet, turret_pivot)

barrel_pivot = bpy.data.objects.new("BarrelPivot", None)
barrel_pivot.empty_display_type = "PLAIN_AXES"
scene.collection.objects.link(barrel_pivot)   # 必须链接进集合，否则会被 orphans_purge 清除
barrel_pivot.location = (0, -0.10, 0.86)      # 炮塔中轴上部（预留俯仰轴）
reparent(barrel_pivot, turret_pivot)

bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.075, depth=1.0,
                                    location=(0, -0.66, 0.86), rotation=(math.radians(90), 0, 0))
barrel = bpy.context.active_object
barrel.name = "Barrel"                        # 沿 -Y 伸出，根部藏于防盾内
set_single_material(barrel, "TankBarrel")
reparent(barrel, barrel_pivot)

bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.105, depth=0.16,
                                    location=(0, -1.16, 0.86), rotation=(math.radians(90), 0, 0))
muzzle = bpy.context.active_object
muzzle.name = "MuzzleBrake"
set_single_material(muzzle, "TankMuzzle")
reparent(muzzle, barrel_pivot)

# ---------- 6. 归一化尺寸：长(Y)=2.6，地面 z=0 ----------

bpy.context.view_layer.update()
lo, hi = world_bbox([root])
length = hi.y - lo.y
scale = 2.6 / length
root.scale = (scale, scale, scale)
bpy.context.view_layer.update()
lo, hi = world_bbox([root])
root.location.z -= lo.z                      # 触地
bpy.context.view_layer.update()
lo, hi = world_bbox([root])
print("tank_normalized: scale=%.4f dims=(%.2f, %.2f, %.2f) zmin=%.3f"
      % (scale, hi.x - lo.x, hi.y - lo.y, hi.z - lo.z, lo.z))

# 平滑法线统一关闭（Kenney 玩具风 = 平直着色）
for o in subtree([root]):
    if o.type == "MESH":
        for poly in o.data.polygons:
            poly.use_smooth = False

# ---------- 7. 清理孤儿数据 → 部件完整性断言 → 保存 .blend ----------

bpy.data.orphans_purge(do_recursive=True)

# 防御性断言：所有部件必须仍在 root 子树内且已链接进场景（防 orphans_purge 误删）
EXPECTED_PARTS = {"Hull", "HullDeck", "TrackSkirtL", "TrackSkirtR",
                  "TurretPivot", "Turret", "TurretHatch", "Mantlet",
                  "BarrelPivot", "Barrel", "MuzzleBrake",
                  "WheelL1", "WheelL2", "WheelL3", "WheelR1", "WheelR2", "WheelR3"}
present = {o.name for o in subtree([root])}
missing = EXPECTED_PARTS - present
unlinked = [n for n in sorted(EXPECTED_PARTS & present)
            if not any(n == o.name for o in bpy.context.scene.collection.all_objects)]
if missing or unlinked:
    print("part_check: FAILED missing=%s unlinked=%s" % (sorted(missing), unlinked))
    sys.exit(1)
print("part_check: OK (%d parts under root)" % len(present))

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
print("blend_saved:", BLEND_PATH, BLEND_PATH.stat().st_size, "bytes")

# ---------- 8. 导出 GLB（仅坦克子树，应用倒角修改器） ----------

bpy.ops.object.select_all(action="DESELECT")
for o in subtree([root]):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(GLB_PATH), export_format="GLB",
                          use_selection=True, export_apply=True)
print("glb_exported:", GLB_PATH, GLB_PATH.stat().st_size, "bytes")

# ---------- 9. 预览渲染（正面/侧面/顶部/斜俯视/尾部 + 炮塔旋转证明） ----------

ground_mat = make_mat("PreviewGround", "#9FB0BC", rough=0.95)
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, -0.001))
ground = bpy.context.active_object
ground.data.materials.append(ground_mat)

cam_data = bpy.data.cameras.new("Cam")
cam_data.lens = 50
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

sun_data = bpy.data.lights.new("Sun", type="SUN")
sun_data.energy = 3.2
sun = bpy.data.objects.new("Sun", sun_data)
scene.collection.objects.link(sun)
sun.location = (4, -5, 8)
sun.rotation_euler = (mathutils.Vector((0, 0, 0)) - sun.location).to_track_quat("-Z", "Y").to_euler()

fill_data = bpy.data.lights.new("Fill", type="SUN")
fill_data.energy = 1.1
fill = bpy.data.objects.new("Fill", fill_data)
scene.collection.objects.link(fill)
fill.location = (-5, 4, 6)
fill.rotation_euler = (mathutils.Vector((0, 0, 0)) - fill.location).to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("W")
world.use_nodes = True
next(n for n in world.node_tree.nodes if n.type == "BACKGROUND").inputs[0].default_value = (0.62, 0.70, 0.78, 1)
scene.world = world

scene.render.resolution_x = 960
scene.render.resolution_y = 720
scene.render.image_settings.file_format = "PNG"

scene.render.engine = "BLENDER_EEVEE"


def render_view(name, pos, target=None, roll=None):
    cam.location = pos
    if roll is not None:                      # 顶视图：手动欧拉角避免轨迹约束翻转
        cam.rotation_euler = (0, 0, roll)
    else:
        d = mathutils.Vector(target) - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(PREVIEW_DIR / ("toy_tank_%s.png" % name))
    bpy.ops.render.render(write_still=True)
    print("preview:", name)


render_view("front",   (0.0, -4.6, 1.8), target=(0, -0.2, 0.55))
render_view("side",    (4.8, 0.0, 1.8),  target=(0, 0.0, 0.55))
render_view("top",     (0.0, 0.0, 6.4),  roll=math.radians(180))
render_view("oblique", (-3.4, -3.9, 3.1), target=(0, -0.1, 0.5))
render_view("rear",    (0.0, 4.6, 1.8),  target=(0, 0.2, 0.55))

# 炮塔旋转证明：同一斜俯视机位，炮塔 0° → 90° → 180°（炮管跟随）
for deg in (90, 180):
    turret_pivot.rotation_euler.z = math.radians(deg)
    bpy.context.view_layer.update()
    render_view("turret%d" % deg, (-3.4, -3.9, 3.1), target=(0, -0.1, 0.5))
turret_pivot.rotation_euler.z = 0.0

# ---------- 10. 自检 ----------

ok = all(p.exists() and p.stat().st_size > 0 for p in
         [BLEND_PATH, GLB_PATH] + list(PREVIEW_DIR.glob("toy_tank_*.png")))
print("files_check:", "OK" if ok else "FAILED")
if not ok:
    sys.exit(1)
print("BUILD_OK")
