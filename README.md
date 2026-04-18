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

The game loads its world from `assets/scene.glb`. Export a Blender scene there before running.

In Blender:

1. Add an **Empty** named `player` — this sets the spawn point.
2. Add a mesh named `nav_mesh` — walkable surfaces (optional, movement is unconstrained without it).
3. Set **custom properties** on objects to configure physics and gameplay (see [Scene Metadata](#scene-metadata)).
4. Apply all transforms: `Ctrl+A` → **All Transforms**.
5. Export as GLB: `File → Export → glTF 2.0`, format **GLB**, with "Custom Properties" enabled.

A sample scene (`assets/scene.blend`) is included as a starting point.

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

### Validating a Scene

```bash
deno task validate
```

Checks scene metadata for errors (unknown fields, missing player spawn, invalid physics types, duplicate trigger IDs, unregistered prefab references).

## How to Play

### Main Menu

- **Host Game** — starts a local server on port `7777` and connects automatically.
- **Join Game (Browse)** — server browser to enter a host address and connect.

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

## Architecture

```
main.ts                  — Entry point: window init, shadow map, App loop
src/
  app.ts                 — State machine (menu → browser → connecting → playing)
  game_session.ts        — PLAYING state: physics, scene, network, render, behaviors
  scene_loader.ts        — Scene loading / unloading / hot-reload
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
  rayworld_blender.py    — Blender addon: metadata editing panel
  export_scene.py        — One-click Blender export + validate
```

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
