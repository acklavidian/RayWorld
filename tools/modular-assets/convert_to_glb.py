"""
Blender batch converter: FBX → GLB for modular assets.

Usage:
    blender --background --python tools/modular-assets/convert_to_glb.py

Reads all .fbx files from assets/scifi_assets/fbx/ and exports each as .glb
to assets/scifi_assets/glb/.

After import, each asset is normalized:
  1. Scaled so its largest XZ dimension equals TARGET_GRID_SIZE (2m)
  2. Origin moved to bottom-center (XZ centered, Y=0 at bottom)
This ensures all modular pieces snap to the same grid and sit on the floor
regardless of the FBX file's internal unit scale or pivot placement.
"""

import bpy
import os
import sys
import time
import mathutils

TARGET_GRID_SIZE = 4.0  # metres — all assets normalized to this XZ extent

# Resolve paths relative to this script
script_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.normpath(os.path.join(script_dir, "..", ".."))
input_dir = os.path.join(project_root, "assets", "scifi_assets", "fbx")
output_dir = os.path.join(project_root, "assets", "scifi_assets", "glb")

if not os.path.isdir(input_dir):
    print(f"ERROR: Input directory not found: {input_dir}")
    sys.exit(1)

os.makedirs(output_dir, exist_ok=True)

fbx_files = sorted(f for f in os.listdir(input_dir) if f.lower().endswith(".fbx"))
print(f"Found {len(fbx_files)} FBX files in {input_dir}")


def get_scene_bounds():
    """Measure the full bounding box of all mesh objects in world space.

    Returns (min_x, max_x, min_y_blender, max_y_blender, min_z_blender, max_z_blender)
    where Y is Blender's forward axis (maps to glTF Z) and Z is Blender's up (maps to glTF Y).
    """
    min_x = float('inf');  max_x = float('-inf')
    min_y = float('inf');  max_y = float('-inf')
    min_z = float('inf');  max_z = float('-inf')
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH':
            continue
        for corner in obj.bound_box:
            world_co = obj.matrix_world @ mathutils.Vector(corner)
            min_x = min(min_x, world_co.x); max_x = max(max_x, world_co.x)
            min_y = min(min_y, world_co.y); max_y = max(max_y, world_co.y)
            min_z = min(min_z, world_co.z); max_z = max(max_z, world_co.z)
            found = True
    if not found:
        return None
    return (min_x, max_x, min_y, max_y, min_z, max_z)


def normalize_scene():
    """Scale + reposition all objects: XZ extent → TARGET_GRID_SIZE, origin at bottom-center.

    After this function:
      - The largest XZ dimension equals TARGET_GRID_SIZE
      - The mesh is centered on X and Blender-Y (which becomes glTF Z)
      - The bottom of the mesh sits at Blender-Z = 0 (which becomes glTF Y = 0)
    """
    bounds = get_scene_bounds()
    if bounds is None:
        return 1.0
    min_x, max_x, min_y, max_y, min_z, max_z = bounds

    # 1. Scale to fit TARGET_GRID_SIZE
    xz_extent = max(max_x - min_x, max_y - min_y, 0.001)
    scale_factor = TARGET_GRID_SIZE / xz_extent
    need_scale = abs(scale_factor - 1.0) >= 0.05

    if need_scale:
        for obj in bpy.context.scene.objects:
            obj.scale *= scale_factor
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # Recompute bounds after scaling
        min_x *= scale_factor; max_x *= scale_factor
        min_y *= scale_factor; max_y *= scale_factor
        min_z *= scale_factor; max_z *= scale_factor

    # 2. Move origin to bottom-center
    #    center_x = (min_x + max_x) / 2
    #    center_y = (min_y + max_y) / 2  (Blender Y → glTF Z)
    #    bottom_z = min_z                 (Blender Z → glTF Y)
    cx = (min_x + max_x) / 2.0
    cy = (min_y + max_y) / 2.0
    bz = min_z  # bottom

    offset = mathutils.Vector((-cx, -cy, -bz))

    # Only apply offset if it's meaningful (> 1mm)
    if offset.length > 0.001:
        for obj in bpy.context.scene.objects:
            obj.location += offset
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
        print(f"  origin shifted by ({offset.x:.3f}, {offset.y:.3f}, {offset.z:.3f})")

    return scale_factor if need_scale else 1.0


converted = 0
skipped = 0
errors = 0
t0 = time.time()

for i, fbx_name in enumerate(fbx_files):
    fbx_path = os.path.join(input_dir, fbx_name)
    glb_name = os.path.splitext(fbx_name)[0] + ".glb"
    glb_path = os.path.join(output_dir, glb_name)

    print(f"[{i + 1}/{len(fbx_files)}] {fbx_name} → {glb_name}")

    try:
        # Clear scene
        bpy.ops.wm.read_factory_settings(use_empty=True)

        # Import FBX (preserve normals and materials)
        bpy.ops.import_scene.fbx(filepath=fbx_path, use_custom_normals=True)

        # Normalize: scale to grid + move origin to bottom-center
        sf = normalize_scene()
        if sf != 1.0:
            print(f"  scaled by {sf:.3f}x → {TARGET_GRID_SIZE}m grid")

        # Export as GLB
        bpy.ops.export_scene.gltf(
            filepath=glb_path,
            export_format="GLB",
            export_apply=True,
        )
        converted += 1
    except Exception as e:
        print(f"  ERROR: {e}")
        errors += 1

elapsed = time.time() - t0
print(f"\nDone in {elapsed:.1f}s — converted: {converted}, skipped: {skipped}, errors: {errors}")
