"""
RayWorld Blender Addon — Side panel for editing scene node metadata.

Install: Edit → Preferences → Add-ons → Install → select this file.
The panel appears in the 3D Viewport sidebar under the "RayWorld" tab.
"""

bl_info = {
    "name":        "RayWorld Scene Metadata",
    "author":      "RayWorld",
    "version":     (1, 0, 0),
    "blender":     (3, 6, 0),
    "location":    "View3D > Sidebar > RayWorld",
    "description": "Edit RayWorld metadata fields on scene objects",
    "category":    "Game Engine",
}

import bpy
from bpy.props import (
    StringProperty, BoolProperty, EnumProperty, PointerProperty
)
from bpy.types import Panel, PropertyGroup, Operator


# ─── Property group ──────────────────────────────────────────────────────────

class RayWorldObjectProps(PropertyGroup):
    physics_type: EnumProperty(
        name="Physics Type",
        items=[
            ("",         "(none)",    "No physics"),
            ("building", "Building",  "AABB box collider"),
            ("static",   "Static",    "Triangle mesh collider"),
            ("dynamic",  "Dynamic",   "Convex hull rigid body"),
        ],
        default="",
    )
    prefab: StringProperty(name="Prefab", default="")
    tags: StringProperty(name="Tags", default="", description="Comma-separated tags")
    trigger_id: StringProperty(name="Trigger ID", default="")
    spawn_type: EnumProperty(
        name="Spawn Type",
        items=[
            ("",       "(none)",  "Not a spawn point"),
            ("player", "Player",  "Player spawn location"),
            ("item",   "Item",    "Item spawn location"),
            ("npc",    "NPC",     "NPC spawn location"),
        ],
        default="",
    )
    networked: BoolProperty(name="Networked", default=False)
    interactable: BoolProperty(name="Interactable", default=False)


# ─── Sync operators ──────────────────────────────────────────────────────────

class RAYWORLD_OT_sync_to_custom(Operator):
    """Write RayWorld panel values to Blender custom properties (for glTF export)"""
    bl_idname = "rayworld.sync_to_custom"
    bl_label = "Sync to Custom Properties"

    def execute(self, context):
        obj = context.active_object
        if not obj:
            self.report({"WARNING"}, "No active object")
            return {"CANCELLED"}

        rw = obj.rayworld

        # Clear old RayWorld keys
        for key in list(obj.keys()):
            if key in ("physicsType", "prefab", "tags", "triggerId",
                       "spawnType", "networked", "interactable"):
                del obj[key]

        # Write non-empty values
        if rw.physics_type:
            obj["physicsType"] = rw.physics_type
        if rw.prefab:
            obj["prefab"] = rw.prefab
        if rw.tags:
            obj["tags"] = rw.tags
        if rw.trigger_id:
            obj["triggerId"] = rw.trigger_id
        if rw.spawn_type:
            obj["spawnType"] = rw.spawn_type
        if rw.networked:
            obj["networked"] = 1
        if rw.interactable:
            obj["interactable"] = 1

        self.report({"INFO"}, f"Synced RayWorld metadata to {obj.name}")
        return {"FINISHED"}


class RAYWORLD_OT_sync_from_custom(Operator):
    """Read custom properties into the RayWorld panel"""
    bl_idname = "rayworld.sync_from_custom"
    bl_label = "Load from Custom Properties"

    def execute(self, context):
        obj = context.active_object
        if not obj:
            self.report({"WARNING"}, "No active object")
            return {"CANCELLED"}

        rw = obj.rayworld
        rw.physics_type = obj.get("physicsType", "")
        rw.prefab = obj.get("prefab", "")
        rw.tags = obj.get("tags", "")
        rw.trigger_id = obj.get("triggerId", "")
        rw.spawn_type = obj.get("spawnType", "")
        rw.networked = bool(obj.get("networked", False))
        rw.interactable = bool(obj.get("interactable", False))

        self.report({"INFO"}, f"Loaded RayWorld metadata from {obj.name}")
        return {"FINISHED"}


class RAYWORLD_OT_sync_all(Operator):
    """Sync all objects in scene to custom properties for export"""
    bl_idname = "rayworld.sync_all"
    bl_label = "Sync All Objects"

    def execute(self, context):
        count = 0
        for obj in bpy.data.objects:
            if hasattr(obj, "rayworld"):
                rw = obj.rayworld
                # Only sync if at least one field is set
                has_data = (rw.physics_type or rw.prefab or rw.tags or
                           rw.trigger_id or rw.spawn_type or
                           rw.networked or rw.interactable)
                if has_data:
                    # Temporarily set as active to reuse sync logic
                    prev_active = context.view_layer.objects.active
                    context.view_layer.objects.active = obj
                    bpy.ops.rayworld.sync_to_custom()
                    context.view_layer.objects.active = prev_active
                    count += 1

        self.report({"INFO"}, f"Synced {count} objects")
        return {"FINISHED"}


# ─── Panel ────────────────────────────────────────────────────────────────────

class RAYWORLD_PT_main(Panel):
    bl_label = "RayWorld"
    bl_idname = "RAYWORLD_PT_main"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "RayWorld"

    def draw(self, context):
        layout = self.layout
        obj = context.active_object

        if not obj:
            layout.label(text="No active object")
            return

        rw = obj.rayworld

        layout.label(text=f"Object: {obj.name}", icon="OBJECT_DATA")
        layout.separator()

        # Fields
        layout.prop(rw, "physics_type")
        layout.prop(rw, "prefab")
        layout.prop(rw, "tags")
        layout.prop(rw, "trigger_id")
        layout.prop(rw, "spawn_type")
        layout.prop(rw, "networked")
        layout.prop(rw, "interactable")

        layout.separator()

        # Sync buttons
        row = layout.row(align=True)
        row.operator("rayworld.sync_to_custom", icon="EXPORT")
        row.operator("rayworld.sync_from_custom", icon="IMPORT")
        layout.operator("rayworld.sync_all", icon="FILE_REFRESH")


# ─── Registration ─────────────────────────────────────────────────────────────

classes = (
    RayWorldObjectProps,
    RAYWORLD_OT_sync_to_custom,
    RAYWORLD_OT_sync_from_custom,
    RAYWORLD_OT_sync_all,
    RAYWORLD_PT_main,
)


def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Object.rayworld = PointerProperty(type=RayWorldObjectProps)


def unregister():
    del bpy.types.Object.rayworld
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
