# 候选模型检查脚本（阶段2b 选型用）
# 用法: blender -b --factory-startup --python scripts/inspect_models.py
# 逐个导入 Toy Car Kit 候选 GLB，打印部件树 / 世界尺寸 / 材质 / 顶点数，
# 帮助判断"哪些零件可以独立选择、改造成坦克的工作量"。
import bpy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT.parent / "kenney_car-kit" / "Models" / "GLB format"

CANDIDATES = [
    # 整车候选（改造成坦克的底盤/车身来源）
    "kart-oobi", "kart-oodi", "kart-ooli", "kart-oopi", "kart-oozi",
    "sedan", "hatchback-sports", "suv", "tractor", "delivery", "race",
    # 零件候选（履带轮 / 裙板 / 装甲板来源）
    "debris-tire", "debris-plate-a", "debris-plate-b",
    "debris-drivetrain-axle", "debris-bumper", "cone",
    "wheel-dark", "wheel-default",
]

print("=== inspect_models ===")
print("kit_dir_exists:", KIT.exists(), KIT)


def world_bbox(obj):
    corners = [mathutils.Vector(c) for c in obj.bound_box]
    wm = obj.matrix_world
    ws = [wm @ c for c in corners]
    xs = [v.x for v in ws]; ys = [v.y for v in ws]; zs = [v.z for v in ws]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


import mathutils  # noqa: E402  (bound_box 需要)


def base_color(mat):
    if not mat or not mat.use_nodes:
        return None
    for n in mat.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED":
            c = n.inputs["Base Color"].default_value
            return tuple(round(v, 3) for v in c)
    return None


def inspect(name):
    path = KIT / (name + ".glb")
    if not path.exists():
        print("!! missing:", name)
        return
    # 干净场景，避免相互干扰
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    empties = [o for o in bpy.data.objects if o.type == "EMPTY"]
    total_v = 0
    print("")
    print("#### %s  (%d mesh, %d empty)" % (name, len(meshes), len(empties)))
    for o in meshes:
        lo, hi = world_bbox(o)
        dim = tuple(round(hi[i] - lo[i], 3) for i in range(3))
        vcount = len(o.data.vertices)
        total_v += vcount
        mats = [m.name if m else "(空槽)" for m in o.data.materials]
        parent = o.parent.name if o.parent else "-"
        print("  %-28s parent=%-18s dim=%-22s verts=%-5d mats=%s"
              % (o.name, parent, str(dim), vcount, mats))
    for o in empties:
        print("  EMPTY %-24s children=%d loc=%s"
              % (o.name, len(o.children), tuple(round(v, 3) for v in o.location)))
    all_mats = sorted({m.name for m in bpy.data.materials if m.users})
    print("  TOTAL verts=%d  materials=%s" % (total_v, all_mats))


for c in CANDIDATES:
    inspect(c)

print("")
print("INSPECT_DONE")
