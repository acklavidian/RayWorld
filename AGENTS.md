# RayWorld — Agent Authoring Guide

This document explains how to add gameplay through prefabs and behaviors without breaking the engine.

## What's Safe to Edit

### Safe — Gameplay Layer
These files are designed for frequent modification:
- `src/prefabs/*.ts` — Add/edit prefab definitions
- `src/prefabs/registry.ts` — Register new prefabs
- `src/metadata.ts` — Extend metadata schema if needed
- `src/gameplay_api.ts` — Extend the scripting API

### Careful — Engine Layer
Modify only when necessary and verify with the testing checklist:
- `src/game_session.ts` — Core game loop, behavior ticking
- `src/app.ts` — State machine
- `src/scene_loader.ts` — Scene loading logic
- `src/world.ts` — Entity system

### Do Not Touch (unless fixing bugs)
- `main.ts` — Thin entry point, rarely needs changes
- `src/physics.ts` — Jolt WASM wrapper
- `src/player.ts` — FPS controller
- `src/scene.ts` — GLB parser, FFI mesh access
- `src/shadow.ts` — Shader system
- `src/net/*` — Network protocol
- `src/ui/*` — UI widgets
- `raylib/*` — FFI bindings

## Adding a Prefab — Step by Step

### 1. Create the prefab file

Create `src/prefabs/my_thing.ts`:

```typescript
import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

function createMyBehavior(params: Record<string, unknown>): Behavior {
  const speed = Number(params["speed"] ?? 1.0);

  return {
    init(ctx: BehaviorContext) {
      ctx.api?.log(`MyThing "${ctx.self.name}" initialized`);
    },

    update(ctx: BehaviorContext) {
      // Your per-frame logic here
      // ctx.dt is the frame delta time
      // ctx.api gives you safe access to game systems
    },

    destroy(ctx: BehaviorContext) {
      ctx.api?.log(`MyThing "${ctx.self.name}" destroyed`);
    },
  };
}

export const myThingPrefab: PrefabDef = {
  name: "my_thing",
  behaviors: [createMyBehavior],
  defaultTags: ["my_thing"],
};
```

### 2. Register it

Edit `src/prefabs/registry.ts`:
```typescript
import { myThingPrefab } from "./my_thing.ts";
// In registerAllPrefabs():
registerPrefab(myThingPrefab);
```

### 3. Tag objects in Blender

On the target object, set custom property: `prefab = "my_thing"`

Optional: `scriptParams = {"speed": 2.0}`

### 4. Validate

```sh
deno task validate
deno check main.ts
```

## BehaviorContext API Reference

Every behavior hook receives a `BehaviorContext`:

| Field     | Type              | Description |
|-----------|-------------------|-------------|
| `self`    | `WorldObject`     | The object this behavior is attached to |
| `world`   | `WorldRegistry`   | Query/modify all world objects |
| `physics` | `PhysicsWorld`    | Direct physics access (advanced) |
| `dt`      | `number`          | Frame delta time in seconds |
| `camera`  | `RL.Camera3D`     | Current camera |
| `player`  | `PlayerState`     | Player state (yaw, pitch, grounded) |
| `api`     | `GameplayAPI`     | Safe high-level gameplay functions |

### GameplayAPI Methods

**World:**
- `findByName(name)` → `WorldObject | undefined`
- `findByTag(tag)` → `WorldObject[]`
- `addTag(obj, tag)` / `removeTag(obj, tag)`

**Physics:**
- `raycast(ox, oy, oz, dx, dy, dz, maxDist)` → `{ name, dist } | null`

**Player:**
- `getPlayerPosition()` → `{ x, y, z }`
- `getPlayerYaw()` → `number`
- `isPlayerGrounded()` → `boolean`

**Camera:**
- `getCameraForward()` → `{ x, y, z }`

**Debug:**
- `log(message)` — prints `[gameplay] message`

## Example Prompts for AI Agents

- "Add a lamp prefab that toggles on/off when the player walks near it"
- "Create a moving platform that goes between two points"
- "Add a checkpoint system using trigger zones"
- "Make the crate break after 3 impacts"
- "Add a lever that opens a door when pressed"

## Metadata Schema

When adding new metadata fields to `src/metadata.ts`:
1. Add the field to `SceneNodeMetadata` interface
2. Add the field name to `KNOWN_FIELDS`
3. Add validation logic in `parseNodeMetadata()`
4. Update `tools/rayworld_blender.py` with the new field
