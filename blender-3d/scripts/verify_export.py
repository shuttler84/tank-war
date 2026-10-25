# GLB 导出验证脚本（不信任"命令成功退出"，实际解析文件内容）
# 用法: blender -b --factory-startup --python scripts/verify_export.py -- [可选: glb文件路径]
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB_PATH = Path(args[0]) if args else ROOT / "exports" / "test_cube.glb"

print("=== verify_export ===")
print("target:", GLB_PATH)
failures = []

# ---- 检查1: 文件存在且非空 ----
if not GLB_PATH.exists():
    print("FAIL: 文件不存在")
    sys.exit(1)
size = GLB_PATH.stat().st_size
print(f"file_size: {size} bytes")
if size < 1000:
    failures.append(f"文件过小({size} bytes)，疑似空模型")

# ---- 检查2: GLB 二进制结构（magic / version / length 与实际一致） ----
with open(GLB_PATH, "rb") as f:
    data = f.read()
magic, version, length = struct.unpack_from("<4sII", data, 0)
print("magic:", magic, "version:", version, "declared_length:", length)
if magic != b"glTF":
    failures.append(f"magic 错误: {magic!r}，不是有效 GLB")
if version != 2:
    failures.append(f"glTF 版本异常: {version}")
if length != size:
    failures.append(f"声明长度 {length} 与实际 {size} 不一致")

# JSON chunk 内容
if magic == b"glTF":
    chunk_len, chunk_type = struct.unpack_from("<I4s", data, 12)
    gltf = json.loads(data[20:20 + chunk_len].decode("utf-8"))
    meshes = gltf.get("meshes", [])
    accessor_count = len(gltf.get("accessors", []))
    scene_mesh_names = [n.get("name") for n in gltf.get("nodes", []) if "mesh" in n]
    materials = [m.get("name") for m in gltf.get("materials", [])]
    cameras = gltf.get("cameras", [])
    print("json_meshes:", len(meshes), "accessors:", accessor_count)
    print("json_nodes_with_mesh:", scene_mesh_names)
    print("json_materials:", materials)
    print("json_cameras:", len(cameras))
    if not meshes:
        failures.append("GLB 中没有 mesh")
    if not materials:
        failures.append("GLB 中没有材质")

# ---- 检查3: Blender 重新导入并统计几何 ----
import bpy  # noqa: E402

bpy.ops.wm.read_factory_settings(use_empty=True)
if hasattr(bpy.ops.import_scene, "gltf"):
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
elif hasattr(bpy.ops.wm, "gltf_import"):
    bpy.ops.wm.gltf_import(filepath=str(GLB_PATH))
else:
    failures.append("Blender 没有可用的 glTF 导入算子")

mesh_objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
vert_total = sum(len(o.data.vertices) for o in mesh_objs)
mat_names = {m.name for o in mesh_objs for m in o.data.materials if m}
print("reimported_meshes:", [o.name for o in mesh_objs])
print("reimported_total_vertices:", vert_total)
print("reimported_materials:", sorted(mat_names))
if not mesh_objs:
    failures.append("重新导入后场景中没有 mesh 对象")
if vert_total < 8:
    failures.append(f"顶点数异常({vert_total})，立方体至少应有 8 个顶点")
if not mat_names:
    failures.append("重新导入后没有材质")

# ---- 汇总 ----
if failures:
    print("VERIFY_FAILED:")
    for f_ in failures:
        print("  -", f_)
    sys.exit(1)
print("VERIFY_OK")
