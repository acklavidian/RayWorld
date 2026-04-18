# RayWorld — Project Guide for Claude

## Project Location
- **Root:** `/Users/rx/Desktop/rayworld/RayWorld/` (note: the git repo is inside the `RayWorld/` subdirectory, not the parent)
- **Deno binary:** `/Users/rx/.deno/bin/deno` (not on default PATH in all shells)

## Overview
Multiplayer 3D game built with Deno, TypeScript, raylib (FFI), Jolt Physics (WASM), and Blender scenes exported as GLB. Gameplay is authored through prefabs and behaviors attached to scene objects via metadata.

## Tech Stack
- **Runtime:** Deno (TypeScript, top-level await)
- **Rendering:** raylib 5.5 via FFI bindings in `raylib/` (git submodule)
- **Physics:** Jolt Physics via `npm:jolt-physics` (WASM, async init)
- **Scene format:** glTF Binary (`.glb`) exported from Blender
- **Networking:** UDP datagrams (custom binary protocol, 20 Hz)

## Directory Structure
```
main.ts                  — Thin entry point (~30 lines): window, shadow, App loop
src/
  app.ts                 — App class: top-level state machine (menu/browser/connecting/playing)
  game_session.ts        — GameSession class: PLAYING state (physics, scene, network, render, behaviors)
  scene_loader.ts        — Scene loading/unloading, metadata validation on load
  world.ts               — WorldObject + WorldRegistry (triple-indexed entity lookup)
  behavior.ts            — Behavior interface + BehaviorContext + GameplayAPI interface
  prefab.ts              — PrefabDef interface + prefab registry (registerPrefab/getPrefab)
  metadata.ts            — SceneNodeMetadata schema, parseNodeMetadata(), validateScene()
  gameplay_api.ts        — GameplayAPIImpl: safe scripting surface for behaviors
  physics.ts             — PhysicsWorld: Jolt WASM wrapper (character controller, rigid bodies, raycasts)
  player.ts              — PlayerState + first-person controller (WASD + mouse look + jump)
  scene.ts               — GLB JSON parsing, raylib mesh range resolution, material setup
  shadow.ts              — Shadow map: depth FBO + Blinn-Phong + 3x3 PCF shader
  remote_player.ts       — Remote player capsule rendering + walk animation + lerp
  input.ts               — Action enum + rebindable key bindings + mouse delta
  navmesh.ts             — Navigation mesh utilities
  net/
    protocol.ts          — Message types, binary encode/decode, packet sizes
    server.ts            — GameServer: UDP listen, player tracking, state broadcast
    client.ts            — GameClient: connect, tick, send position updates
  ui/
    menu.ts              — Main menu (Host / Browse / Exit)
    browser.ts           — Server browser (IP input, ping, connect)
    pause_menu.ts        — Pause overlay (resume, settings, exit to menu)
    widgets.ts           — Button, Slider, Toggle, TextInput, Panel, Label
  prefabs/
    mod.ts               — Import entry point (calls registerAllPrefabs)
    registry.ts          — registerAllPrefabs() — imports and registers all built-in prefabs
    door.ts              — Sliding door (auto-open by proximity)
    trigger_zone.ts      — Invisible trigger volume (enter/exit detection)
    button.ts            — Pressable button (sends events to linked objects)
    pickup.ts            — Collectible item (disappears on contact)
    crate.ts             — Dynamic physics crate
  tools/
    validate.ts          — Unified validation entry point (scene + prefabs)
    validate_scene.ts    — Standalone scene metadata validator (CLI)
    validate_prefabs.ts  — Prefab reference validator
tools/
  rayworld_blender.py    — Blender addon: RayWorld metadata side panel
  export_scene.py        — One-click Blender export + validate script
assets/
  scene.glb              — The active game scene (exported from Blender)
```

## Critical Patterns and Gotchas

### Async Yield in Main Loop
The `await new Promise(r => setTimeout(r, 0))` in `main.ts` is **critical** — it yields to Deno's async I/O so networking and file watchers work. Never remove it or bury it inside a class method.

### Raylib FFI Lifecycle
- `RL.InitWindow()` **must** happen in `main.ts` before any other raylib call
- `RL.CloseWindow()` **must** happen after all cleanup (App.destroy, destroyShadowMap)
- Shadow map is created once and passed into sessions — it persists across host/join cycles

### Physics WASM Init
`PhysicsWorld.create()` is async (loads Jolt WASM). `GameSession.create()` is therefore also async. The App methods that create sessions use `await`.

### Circular Type Imports
`world.ts` imports `Behavior` from `behavior.ts`, and `behavior.ts` references `WorldObject`/`WorldRegistry` from `world.ts`. This is resolved using `import type` in `behavior.ts` — **do not change these to regular imports**.

### Hot-Reload
Scene hot-reload replaces the entire `PhysicsWorld` + `SceneState` + re-populates the `WorldRegistry`. The `GameSession` object itself is **not** destroyed — internal state is swapped. The file watcher uses 500ms debounce.

### Jolt BroadPhaseLayer Casts
`physics.ts` uses `as any` casts on lines 91-92 for `MapObjectToBroadPhaseLayer` calls. This is because the Jolt WASM bindings have imprecise TypeScript types for `BroadPhaseLayer`. These casts are intentional.

## Scene Metadata Fields
Objects in the GLB use Blender custom properties (glTF `extras`):
- `physicsType`: `"building"` | `"static"` | `"dynamic"`
- `prefab`: string matching a registered PrefabDef name
- `tags`: comma-separated string
- `triggerId`: unique string for trigger identification
- `spawnType`: `"player"` | `"item"` | `"npc"`
- `networked`: boolean
- `interactable`: boolean
- `scriptParams`: JSON object passed to behavior factories

## State Machine
```
MAIN_MENU → SERVER_BROWSER → CONNECTING → PLAYING
                                              ↓
                                         (ESC → pause menu → exit to menu → MAIN_MENU)
```
`App` owns the state machine. `GameSession` owns everything inside `PLAYING`.

## Dev Commands
```sh
deno task dev            # Run game (with --watch)
deno check main.ts       # Type-check
deno task validate       # Validate scene metadata + prefab refs
```

## Common Tasks

### Add a new prefab
1. Create `src/prefabs/my_prefab.ts` with a `BehaviorFactory` and `PrefabDef`
2. Export the `PrefabDef` (e.g. `export const myPrefab: PrefabDef = { ... }`)
3. Import and register in `src/prefabs/registry.ts`
4. In Blender, set `prefab="my_prefab"` on the target object
5. `deno check main.ts && deno task validate`

### Add a new behavior
1. Create a factory: `(params: Record<string, unknown>) => Behavior`
2. Behavior hooks receive `BehaviorContext` with: `self`, `world`, `physics`, `dt`, `camera`, `player`, `api`
3. Use `ctx.api` for safe operations (findByName, findByTag, getPlayerPosition, raycast, etc.)

### Add a new metadata field
1. Add to `SceneNodeMetadata` interface in `src/metadata.ts`
2. Add field name to `KNOWN_FIELDS` set
3. Add parsing/validation logic in `parseNodeMetadata()`
4. Update `tools/rayworld_blender.py` with the new property

### Extend the gameplay API
1. Add methods to `GameplayAPI` interface in `src/behavior.ts`
2. Implement in `GameplayAPIImpl` class in `src/gameplay_api.ts`

## Testing Checklist
1. `deno check main.ts` — zero type errors
2. Main menu renders, all buttons work
3. Host → gameplay works (WASD, mouse look, jump, grab with RMB)
4. Pause → settings (sensitivity, FOV, invert, wireframes) → resume → exit to menu
5. Re-host → still works (no resource leaks — check texture IDs don't climb indefinitely)
6. Server browser → connect to remote → multiplayer sync
7. Hot-reload: modify `scene.glb` → reloads without crash
8. WorldRegistry count matches scene node count in logs
