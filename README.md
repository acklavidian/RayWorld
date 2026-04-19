# RayWorld

A multiplayer 3D game engine built with [Deno](https://deno.com), [raylib](https://www.raylib.com), and [Jolt Physics](https://github.com/jrouwe/JoltPhysics). Load a Blender scene, host or join a server, and walk around with other players in real time. Author gameplay through prefabs and behaviors without touching engine code.

## Getting Started

### Prerequisites

**Deno** v2.0 or later — https://deno.com

| Platform | Command |
|----------|---------|
| macOS / Linux | `curl -fsSL https://deno.land/install.sh \| sh` |
| Windows (PowerShell) | `irm https://deno.land/install.ps1 \| iex` |

Verify: `deno --version`

**Blender** (optional) — required only for asset conversion and scene authoring.

### Cloning

This project uses a git submodule for the raylib bindings:

```bash
git clone --recurse-submodules https://github.com/JJLDonley/DenoRaylib550
```

If you already cloned without `--recurse-submodules`:

```bash
git submodule update --init
```

### Scene Setup

The game supports two scene modes:

1. **Legacy scene mode** — a single `assets/scene.glb` exported from Blender (see [Legacy Scene Setup](#legacy-scene-setup)).
2. **Modular map mode** — a JSON map file that references individual modular assets placed on a grid (see [Modular Map System](#modular-map-system)).

### Running

```bash
deno task dev
```

This starts the game with `--watch` — it reloads automatically when source files change. The scene also hot-reloads when `assets/scene.glb` is modified.

### Building a Release Binary

| Platform | Command |
|----------|---------|
| Windows  | `deno task W_Build` |
| Linux    | `deno task L_Build` |
| macOS    | `deno task M_Build` |

## How to Play

### Main Menu

- **Host Game** — starts a local server on port `7777` and connects automatically.
- **Join Game (Browse)** — server browser to enter a host address and connect.
- **Test Map** — loads the modular test map directly (no networking).

Up to **8 players** per session.

### Controls

| Input | Action |
|-------|--------|
| `W A S D` | Move |
| Mouse | Look around |
| `Space` | Jump |
| `Right Mouse` | Grab / hold physics objects |
| `ESC` | Pause menu |

### Pause Menu

Press `ESC` during gameplay to access:

- **Resume** — return to game
- **Settings** — mouse sensitivity, field of view, invert Y, debug wireframes
- **Exit to Main Menu** — leave the session

## Modular Map System

The modular map system lets you build levels by placing pre-made 3D assets on a grid, defined entirely in JSON. No Blender scene assembly required.

### Asset Pipeline

60 sci-fi modular assets (floors, walls, doorframes, railings, decorations, etc.) are converted from FBX source files to GLB format with normalization applied during conversion:

1. **Scale normalization** — all assets are scaled so their largest XZ dimension equals `TARGET_GRID_SIZE` (4m).
2. **Origin normalization** — all mesh origins are moved to bottom-center (XZ centered, Y=0 at the base). This means every asset sits on the ground at its placement position.

To convert assets (requires Blender):

```bash
deno task asset:convert
# or: blender --background --python tools/modular-assets/convert_to_glb.py
```

Source FBX files live in `assets/scifi_assets/fbx/`, converted GLBs in `assets/scifi_assets/glb/`.

### Asset Library

The asset library (`data/modular/asset_library.json`) catalogs all 60 assets with metadata:

- **role** — `floor`, `wall`, `door_frame`, `railing`, `wall_decor`, `stair`, `support`, `ramp`
- **blocksMovement** — whether the asset gets physics colliders that block the player
- **isStructural** — whether the asset is part of the room structure
- **sockets** — connection compatibility for each face (north/south/east/west/up/down)

To regenerate the library from scanned assets:

```bash
deno task asset:scan       # scan FBX files → scan_manifest.json
deno task asset:classify   # classify by role → classified_assets.json
deno task asset:library    # generate library → asset_library.json
```

### Map JSON Format

Maps are JSON files that define a grid-based level layout. Example:

```json
{
  "version": "1.0",
  "name": "Two Rooms",
  "grid": {
    "cellSize": [4, 4, 4],
    "dimensions": [4, 2, 2]
  },
  "spawn": [1, 0.1, 1],
  "placements": [
    {"assetId": "sm_floor_v1", "position": [0, 0, 0], "rotation": 0},
    {"assetId": "sm_wall_v0", "position": [-0.5, 0, 0], "rotation": 0},
    {"assetId": "sm_doorframe_single", "position": [1.5, 0, 1], "rotation": 0}
  ]
}
```

**Fields:**

| Field | Description |
|-------|-------------|
| `grid.cellSize` | World-space size of one grid cell `[x, y, z]` in metres |
| `grid.dimensions` | Grid extent (metadata, used for default spawn calculation) |
| `spawn` | Player spawn position in **world coordinates** (not grid) |
| `placements[].assetId` | Asset ID from the asset library |
| `placements[].position` | Grid coordinates `[x, y, z]` — world pos = position × cellSize |
| `placements[].rotation` | Y-axis rotation in degrees (0, 90, 180, 270) |

### Grid Conventions

- **cellSize `[4, 4, 4]`** — each grid unit is 4m in world space.
- **Floor/ceiling tiles** use integer grid positions (e.g. `[0, 0, 0]`, `[1, 0, 1]`).
- **Walls** use half-integer positions to sit on cell edges (e.g. `[-0.5, 0, 0]` for a west wall, `[0, 0, -0.5]` for a south wall).
- **Wall rotation**: `0` = thin in X, blocks X passage (east/west walls). `90` = thin in Z, blocks Z passage (north/south walls).
- **Ceiling tiles** are floor assets placed at Y=1. They render visually but have no physics colliders (to prevent the player getting stuck when jumping).

### Validating Maps

```bash
deno task map:validate
```

Checks that all referenced asset IDs exist in the library and placement positions are valid.

### Map Loader

At runtime, `src/map_loader.ts` handles:

1. Loading the asset library and map JSON
2. Loading each unique GLB model (deduplicated)
3. Computing world transforms: translate × rotate × (scale ×) model.transform
4. Creating physics colliders for structural/blocking assets
5. Setting up the player spawn point

## Architecture

```
main.ts                  — Entry point: window init, shadow map, App loop
src/
  app.ts                 — State machine (menu → browser → connecting → playing)
  game_session.ts        — PLAYING state: physics, scene, network, render, behaviors
  map_loader.ts          — Modular map loader (JSON → models + physics)
  scene_loader.ts        — Legacy scene loading / unloading / hot-reload
  world.ts               — WorldObject + WorldRegistry (entity system)
  behavior.ts            — Behavior interface + BehaviorContext
  prefab.ts              — PrefabDef registry
  metadata.ts            — Scene metadata schema, parser, validator
  gameplay_api.ts        — Scripting API for behaviors
  physics.ts             — Jolt Physics WASM wrapper
  player.ts              — First-person character controller
  scene.ts               — GLB parser, mesh/material helpers
  shadow.ts              — Shadow mapping (depth pass + PCF)
  remote_player.ts       — Remote player rendering + interpolation
  input.ts               — Key bindings + input queries
  net/                   — UDP networking (protocol, server, client)
  ui/                    — Menu screens + widget primitives
  prefabs/               — Built-in prefabs (door, trigger_zone, button, pickup, crate)
  tools/                 — CLI validators
tools/
  modular-assets/        — Asset pipeline tools
    convert_to_glb.py    — Blender batch converter: FBX → GLB (normalize scale + origin)
    scan.ts              — Scan FBX files → manifest
    classify.ts          — Classify assets by role
    generate_library.ts  — Generate asset library JSON
    validate_assets.ts   — Validate asset library
    validate_map.ts      — Validate map files
    types.ts             — Shared TypeScript types for maps and assets
  rayworld_blender.py    — Blender addon: metadata editing panel
  export_scene.py        — One-click Blender export + validate
data/
  modular/
    asset_library.json   — Asset catalog (60 assets with metadata)
    example_test_corridor_map.json — Example two-room test map
```

## Legacy Scene Setup

The legacy mode loads a single `assets/scene.glb` exported from Blender.

In Blender:

1. Add an **Empty** named `player` — this sets the spawn point.
2. Add a mesh named `nav_mesh` — walkable surfaces (optional).
3. Set **custom properties** on objects to configure physics and gameplay (see [Scene Metadata](#scene-metadata)).
4. Apply all transforms: `Ctrl+A` → **All Transforms**.
5. Export as GLB: `File → Export → glTF 2.0`, format **GLB**, with "Custom Properties" enabled.

A sample scene (`assets/scene.blend`) is included as a starting point.

### Validating a Scene

```bash
deno task validate
```

Checks scene metadata for errors (unknown fields, missing player spawn, invalid physics types, duplicate trigger IDs, unregistered prefab references).

## Scene Metadata

Objects in the GLB scene use Blender custom properties (exported as glTF `extras`):

| Field | Type | Description |
|-------|------|-------------|
| `physicsType` | `"building"` \| `"static"` \| `"dynamic"` | Physics collider type |
| `prefab` | string | Name of a registered prefab to attach behaviors |
| `tags` | comma-separated string | Tags for querying objects |
| `triggerId` | string | Unique ID for trigger identification |
| `spawnType` | `"player"` \| `"item"` \| `"npc"` | Spawn point type |
| `networked` | boolean | Whether the object syncs over the network |
| `interactable` | boolean | Whether the object responds to interaction |
| `scriptParams` | JSON object | Parameters passed to behavior factories |

### Physics Types

- **`building`** — AABB box colliders. Best for floors, walls, and boxy geometry. The character slides smoothly over these.
- **`static`** — Triangle mesh colliders. For detailed static geometry (ramps, irregular shapes).
- **`dynamic`** — Convex hull rigid bodies. Objects that move, can be grabbed, and respond to physics.

## Prefab System

Prefabs let you attach gameplay behaviors to scene objects through metadata alone.

### Built-in Prefabs

| Prefab | Description | Key Params |
|--------|-------------|------------|
| `door` | Sliding door, auto-opens by proximity | `slideX/Y/Z`, `speed`, `autoRange` |
| `trigger_zone` | Invisible volume, detects enter/exit | `radius`, `message` |
| `button` | Pressable, sends events to linked objects | `target`, `pressRange`, `cooldown` |
| `pickup` | Collectible, disappears on contact | `pickupRange`, `category` |
| `crate` | Dynamic physics crate | `breakable` |

### Adding a Custom Prefab

1. Create `src/prefabs/my_prefab.ts` with a `BehaviorFactory` and `PrefabDef`
2. Register it in `src/prefabs/registry.ts`
3. In Blender, set `prefab="my_prefab"` on the target object
4. Run `deno task validate` to check references

See `AGENTS.md` for detailed authoring instructions and API reference.

## Blender Addon

A Blender addon (`tools/rayworld_blender.py`) provides a sidebar panel for editing RayWorld metadata fields without manually setting custom properties.

Install: `Edit → Preferences → Add-ons → Install → select rayworld_blender.py`

The panel appears in `View3D → Sidebar → RayWorld`.

## Multiplayer

To play with others on the same network:

1. One player clicks **Host Game**.
2. Others click **Join Game (Browse)** and enter the host's IP with port `7777`.
3. Use the **Ping** button to check if a server is reachable before connecting.

Players appear as animated capsules with nametags. Positions sync at 20 Hz with client-side interpolation.
