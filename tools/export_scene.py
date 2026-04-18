"""
RayWorld one-click export + validate script for Blender.

Usage from Blender:
  1. Open this file in Blender's text editor
  2. Run (Alt+P) to export and validate

Or from command line:
  blender scene.blend --background --python tools/export_scene.py
"""

import bpy
import subprocess
import os
import sys


def export_scene():
    """Export the current scene as GLB to assets/scene.glb"""

    # Determine project root (where deno.json lives)
    blend_path = bpy.data.filepath
    if blend_path:
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(blend_path)))
    else:
        # Fallback: assume script is in tools/
        project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    output_path = os.path.join(project_root, "assets", "scene.glb")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    print(f"[RayWorld] Exporting to: {output_path}")

    # Sync all RayWorld metadata to custom properties before export
    try:
        bpy.ops.rayworld.sync_all()
        print("[RayWorld] Synced all RayWorld metadata to custom properties")
    except Exception:
        print("[RayWorld] Warning: RayWorld addon not loaded, skipping metadata sync")

    # Export as GLB
    bpy.ops.export_scene.gltf(
        filepath=output_path,
        export_format="GLB",
        export_extras=True,           # Include custom properties
        export_apply=True,            # Apply modifiers
        export_cameras=False,
        export_lights=False,
    )

    print(f"[RayWorld] Export complete: {output_path}")

    # Run validation if deno is available
    validate_script = os.path.join(project_root, "src", "tools", "validate_scene.ts")
    if os.path.exists(validate_script):
        print("[RayWorld] Running scene validator...")
        try:
            result = subprocess.run(
                ["deno", "run", "--allow-read", validate_script, output_path],
                capture_output=True, text=True, timeout=10,
                cwd=project_root,
            )
            print(result.stdout)
            if result.stderr:
                print(result.stderr)
            if result.returncode != 0:
                print("[RayWorld] ⚠ Validation found errors — check output above")
            else:
                print("[RayWorld] ✓ Validation passed")
        except FileNotFoundError:
            print("[RayWorld] deno not found — skipping validation")
        except subprocess.TimeoutExpired:
            print("[RayWorld] Validation timed out")
    else:
        print("[RayWorld] Validator not found — skipping")


if __name__ == "__main__":
    export_scene()
