# 坦克 GLB 独立校验脚本（阶段2b 验收）
# 用法: blender -b --factory-startup --python scripts/verify_tank.py
# 重新导入 exports/toy_tank.glb（不信任构建过程），逐项断言：
#   1) 部件与层级齐全（Hull/TurretPivot/Turret/BarrelPivot/Barrel/履带/负重轮）
#   2) 尺寸与触地（长≈2.6、宽≈2.0、高≤1.5、zmin≈0）
#   3) 炮塔轴心在车体中轴上（x≈0），且旋转 TurretPivot 时 Hull 不动、炮管跟随
#   4) 材质全部为命名 Tank* 材质，无 colormap 残留、无空槽
#   5) 复杂度与网格健康（总顶点数上限、无 NaN 顶点）
import math
import sys
from pathlib import Path

import bpy
import mathutils

ROOT = Path(__file__).resolve().parents[1]
GLB = ROOT / "exports" / "toy_tank.glb"
print("=== verify_tank ===")
print("glb:", GLB, GLB.stat().st_size, "bytes")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(GLB))

failures = []


def check(name, ok, detail=""):
    print("%-6s %s %s" % ("[PASS]" if ok else "[FAIL]", name, detail))
    if not ok:
        failures.append(name)


def find(name):
    return next((o for o in bpy.data.objects if o.name == name), None)


def subtree_center(objs):
    lo = mathutils.Vector((1e9, 1e9, 1e9))
    hi = mathutils.Vector((-1e9, -1e9, -1e9))
    stack = list(objs)
    meshes = 0
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type != "MESH":
            continue
        meshes += 1
        wm = o.matrix_world
        for c in o.bound_box:
            v = wm @ mathutils.Vector(c)
            lo.x = min(lo.x, v.x); lo.y = min(lo.y, v.y); lo.z = min(lo.z, v.z)
            hi.x = max(hi.x, v.x); hi.y = max(hi.y, v.y); hi.z = max(hi.z, v.z)
    return lo, hi, meshes


# ---- 1) 部件与层级 ----
required = ["Hull", "HullDeck", "TrackSkirtL", "TrackSkirtR", "TurretPivot",
            "Turret", "TurretHatch", "Mantlet", "BarrelPivot", "Barrel", "MuzzleBrake"]
objs = {n: find(n) for n in required}
check("parts_present", all(objs.values()),
      "missing=%s" % [n for n, o in objs.items() if not o])
wheels = [o for o in bpy.data.objects if o.name.startswith("Wheel")]
check("wheels_6", len(wheels) == 6, "found=%d" % len(wheels))

root = next((o for o in bpy.data.objects if o.name == "ToyTank"), None)
check("root_empty", root is not None and root.type == "EMPTY")
if root and objs["Barrel"]:
    chain = []
    p = objs["Barrel"].parent
    while p:
        chain.append(p.name)
        p = p.parent
    check("hierarchy_barrel_under_turret",
          "TurretPivot" in chain and "ToyTank" in chain, str(chain))

# ---- 2) 尺寸与触地 ----
lo, hi, mesh_count = subtree_center([root])
dims = (hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
check("dims_length_2.6", abs(dims[1] - 2.6) < 0.15, "len=%.3f" % dims[1])
check("dims_width_~2.0", abs(dims[0] - 2.0) < 0.25, "wid=%.3f" % dims[0])
check("dims_height_budget", dims[2] <= 1.5, "hgt=%.3f" % dims[2])
check("ground_contact", abs(lo.z) < 0.03, "zmin=%.3f" % lo.z)
print("       dims=(%.2f, %.2f, %.2f) meshes=%d" % (dims + (mesh_count,)))

# ---- 3) 炮塔轴心与炮管跟随（数值证明） ----
bpy.context.view_layer.update()
pivot = objs["TurretPivot"]
px = pivot.matrix_world.translation.x
check("turret_pivot_on_center_axis", abs(px) < 0.02, "pivot.x=%.4f" % px)


def barrel_center():
    bpy.context.view_layer.update()
    o = objs["Barrel"]
    wm = o.matrix_world
    return wm @ mathutils.Vector((0, 0, 0))  # 网格原点在炮管中部


hull_before = objs["Hull"].matrix_world.translation.copy()
b0 = barrel_center()

# glTF 导入节点为四元数旋转模式，rotation_euler 赋值无效；用矩阵旋转（模式无关）
R90 = mathutils.Matrix.Rotation(math.radians(90), 4, 'Z')
pivot.matrix_world = R90 @ pivot.matrix_world
b90 = barrel_center()
pivot_pos_90 = pivot.matrix_world.translation.copy()   # 必须在恢复前读取
hull_after = objs["Hull"].matrix_world.translation.copy()
pivot.matrix_world = R90.inverted() @ pivot.matrix_world

check("hull_unaffected_by_turret",
      (hull_before - hull_after).length < 1e-4,
      "delta=%.6f" % (hull_before - hull_after).length)
# 炮管原本朝 -Y；绕 Z +90° 后应朝 +X（模长不变，主轴从 Y 换到 X）
d0 = b0 - pivot.matrix_world.translation
d90 = b90 - pivot_pos_90
check("barrel_rotates_with_turret",
      abs(d0.length - d90.length) < 1e-4 and abs(d90.x) > 0.5 and abs(d90.y) < 0.1,
      "before=(%.2f,%.2f) after=(%.2f,%.2f)" % (d0.x, d0.y, d90.x, d90.y))
print("       barrel offset before=(%.2f, %.2f) after 90deg=(%.2f, %.2f)"
      % (d0.x, d0.y, d90.x, d90.y))

# ---- 4) 材质 ----
bad_mat = []
total_v = 0
for o in bpy.data.objects:
    if o.type != "MESH":
        continue
    total_v += len(o.data.vertices)
    if not o.data.materials:
        bad_mat.append(o.name + "(no-slot)")
    for m in o.data.materials:
        if m is None or not m.name.startswith("Tank"):
            bad_mat.append("%s(%s)" % (o.name, m.name if m else "None"))
check("materials_named", not bad_mat, str(bad_mat[:4]))
mat_names = sorted({m.name for o in bpy.data.objects if o.type == "MESH"
                    for m in o.data.materials if m})
print("       materials=%s" % mat_names)

# ---- 5) 复杂度与网格健康 ----
# 预算依据：车身 1014 + 6×kit 负重轮 3168（复用件固定成本）+ 炮塔/炮管组件
# 约 3000（含倒角）。7k 出头对主角级低模完全正常（原卡丁车整车 4699），上限 8000。
check("verts_budget", total_v < 8000, "total=%d" % total_v)
nan = [o.name for o in bpy.data.objects if o.type == "MESH"
       for v in o.data.vertices
       if any(math.isnan(c) for c in v.co)]
check("no_nan_verts", not nan, str(nan[:3]))
print("       total_verts=%d" % total_v)

print("")
if failures:
    print("TANK_VERIFY_FAILED:", failures)
    sys.exit(1)
print("TANK_VERIFY_OK")
