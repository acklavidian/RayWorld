import * as RL from "raylib";

import { parseGlbJson, findNode, findNodesByExtra, resolveRaylibMeshRange, getMesh, makeSceneMaterials, extractMeshData, GltfJson } from "./src/scene.ts";
import { PhysicsWorld } from "./src/physics.ts";
import { createPlayerState, updatePlayer, EYE_HEIGHT } from "./src/player.ts";
import { createShadowMap, updatePerFrame, renderDepthPass, destroyShadowMap } from "./src/shadow.ts";
import { GameServer } from "./src/net/server.ts";
import { GameClient } from "./src/net/client.ts";
import { GAME_PORT } from "./src/net/protocol.ts";
import { RemotePlayer, updateAndDrawRemotePlayers, drawNametags } from "./src/remote_player.ts";
import { drawMainMenu } from "./src/ui/menu.ts";
import { createBrowserState, drawBrowser, BrowserState } from "./src/ui/browser.ts";
import {
  createPauseSettings, createPauseMenuState, drawPauseMenu,
  PauseSettings, PauseMenuState,
} from "./src/ui/pause_menu.ts";

// ─── Config ───────────────────────────────────────────────────────────────────

const SCENE_FILE      = "assets/scene.glb";
const SHADOW_MAP_SIZE = 2048;
const SHADOW_ORTHO    = 50.0;
const NET_UPDATE_HZ   = 20;
const LERP_ALPHA      = 0.25;
const GRAB_REACH      = 8;    // metres — max distance to grab a physics object
const GRAB_HOLD_DIST  = 2.5;  // metres in front of camera the object is held at

// ─── State machine ────────────────────────────────────────────────────────────

type AppState = "MAIN_MENU" | "SERVER_BROWSER" | "CONNECTING" | "PLAYING";

// ─── Scene state ──────────────────────────────────────────────────────────────
// Everything derived from the GLB file. Swapped out on hot-reload.

interface DynamicObject { name: string; range: { start: number; count: number }; }

interface SceneState {
  gltf:               GltfJson;
  model:              RL.Model;
  spawnX:             number;
  spawnY:             number;
  spawnZ:             number;
  navRange:           { start: number; count: number } | null;
  mats:               RL.Material[];
  dynamicObjects:     DynamicObject[];
  dynamicMeshIndices: Set<number>;
}

function loadScene(shadow: ReturnType<typeof createShadowMap>, physics: PhysicsWorld): SceneState {
  const gltf = parseGlbJson(SCENE_FILE);

  // Spawn point
  let spawnX = 0, spawnY = 2, spawnZ = 0;
  const playerNode = findNode(gltf, "player");
  if (playerNode?.translation) {
    [spawnX, spawnY, spawnZ] = playerNode.translation;
    console.log(`Spawn: (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);
  } else {
    console.warn('No "player" Empty — spawning at origin');
  }

  // Nav mesh
  const navRange = resolveRaylibMeshRange(gltf, "nav_mesh");
  if (!navRange) console.warn('No "nav_mesh" — movement unconstrained');

  // Raylib model
  const model = RL.LoadModel(SCENE_FILE);

  // Physics — building AABB box colliders (nodes ending in _building)
  // Each mesh primitive gets its own tight-fitting box shape so the character
  // slides over surfaces without catching on triangle edges.
  let buildingBoxCount = 0;
  for (const node of findNodesByExtra(gltf, "physicsType", "building")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) { physics.addStaticBox(d.verts); buildingBoxCount++; }
    }
  }
  if (buildingBoxCount > 0) console.log(`[physics] building: ${buildingBoxCount} AABB box colliders`);
  else console.warn('[physics] no building nodes found — set custom property physicsType="building" in Blender');

  // Physics — additional static colliders (physicsType = "static")
  for (const node of findNodesByExtra(gltf, "physicsType", "static")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) physics.addStatic(d.verts, d.indices, d.triCount);
    }
    console.log(`[physics] static: "${node.name}"`);
  }

  // Build static broadphase tree now that all static bodies are registered.
  // Without this Jolt's tree may be empty and dynamic bodies fall through.
  physics.optimizeBroadPhase();

  // Physics — dynamic bodies
  const dynamicObjects: DynamicObject[] = [];
  const dynamicMeshIndices = new Set<number>();
  for (const node of findNodesByExtra(gltf, "physicsType", "dynamic")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    const allVerts: number[] = [];
    const primitiveData: { verts: Float32Array; indices: Uint16Array; triCount: number }[] = [];
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) { allVerts.push(...d.verts); primitiveData.push(d); }
      dynamicMeshIndices.add(i);
    }
    if (allVerts.length > 0) {
      physics.addDynamic(node.name, new Float32Array(allVerts), primitiveData);
      dynamicObjects.push({ name: node.name, range });
    }
  }

  // Materials (shadow shader applied per-mesh)
  const mats = makeSceneMaterials(model, shadow.sceneShader);

  return { gltf, model, spawnX, spawnY, spawnZ, navRange, mats, dynamicObjects, dynamicMeshIndices };
}

function unloadScene(ss: SceneState): void {
  RL.UnloadModel(ss.model);
}

function makeCameraForScene(ss: SceneState, fov = 70): RL.Camera3D {
  const camY = ss.spawnY + EYE_HEIGHT;
  return new RL.Camera3D({
    position:   new RL.Vector3(ss.spawnX, camY, ss.spawnZ),
    target:     new RL.Vector3(ss.spawnX, camY, ss.spawnZ - 1),
    up:         new RL.Vector3(0, 1, 0),
    fovy:       fov,
    projection: RL.CameraProjection.PERSPECTIVE,
  });
}

// ─── Init window ──────────────────────────────────────────────────────────────

RL.InitWindow(1280, 720, "3D Scene");
RL.SetTargetFPS(60);
RL.SetExitKey(RL.KeyboardKey.NULL);

// ─── Shadow map (persistent across reloads) ───────────────────────────────────

const lightPos    = new RL.Vector3(50, 80, 40);
const lightTarget = new RL.Vector3(0, 0, 0);
const shadow      = createShadowMap(lightPos, lightTarget, SHADOW_MAP_SIZE, SHADOW_ORTHO);

// ─── Initial scene load ───────────────────────────────────────────────────────

let physics: PhysicsWorld | null = null;
let ss: SceneState | null = null;
try {
  physics = await PhysicsWorld.create();
  ss = loadScene(shadow, physics);
  physics.createCharacter(ss.spawnX, ss.spawnY + 0.05, ss.spawnZ);
} catch (e) {
  RL.CloseWindow();
  console.error(
    `\nFailed to open scene: ${e}` +
    `\n\nExport your Blender scene as GLB to: ${SCENE_FILE}` +
    `\nRequirements:` +
    `\n  - An object named "player"  (Empty)  → spawn point` +
    `\n  - A mesh named  "nav_mesh"           → walkable surfaces` +
    `\n  - Apply all transforms before export (Ctrl+A → All Transforms)\n`,
  );
  Deno.exit(1);
  throw e;
}

// ─── Hot-reload watcher ───────────────────────────────────────────────────────

let sceneReloadPending = false;
let _reloadTimer: number | undefined;

(async () => {
  for await (const event of Deno.watchFs(SCENE_FILE)) {
    if (event.kind === "modify" || event.kind === "create") {
      clearTimeout(_reloadTimer);
      // Debounce 500 ms — Blender/editors fire multiple events per save
      _reloadTimer = setTimeout(() => { sceneReloadPending = true; }, 500) as unknown as number;
    }
  }
})();

// ─── Networking ───────────────────────────────────────────────────────────────

let server: GameServer | null = null;
let client: GameClient | null = null;
const remotePlayers: Map<number, RemotePlayer> = new Map();
let netAccum = 0;

// ─── App state ────────────────────────────────────────────────────────────────

let appState: AppState = "MAIN_MENU";
let camera   = makeCameraForScene(ss!);
let player   = createPlayerState();
let browserState: BrowserState | null = null;
let connectingPromise: Promise<boolean> | null = null;
let statusMsg = "";

const settings: PauseSettings       = createPauseSettings();
let isPaused   = false;
let pauseMenu: PauseMenuState | null = null;

// Grab state — right mouse button picks up dynamic physics objects
let grabName: string | null = null;
let grabDist = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enterPlaying(): void {
  player    = createPlayerState();
  camera    = makeCameraForScene(ss!, settings.fov);
  isPaused  = false;
  pauseMenu = null;
  remotePlayers.clear();
  appState  = "PLAYING";
  RL.DisableCursor();
}

function stopNetworking(): void {
  client?.disconnect(); client = null;
  server?.stop();       server = null;
  remotePlayers.clear();
}

// ─── Main loop ────────────────────────────────────────────────────────────────

while (!RL.WindowShouldClose()) {
  await new Promise((r) => setTimeout(r, 0));

  const dt = RL.GetFrameTime();

  // ── Hot-reload ──────────────────────────────────────────────────────────────
  if (sceneReloadPending && ss && physics) {
    sceneReloadPending = false;
    console.log("[hot-reload] reloading scene…");
    try {
      const newPhysics = await PhysicsWorld.create();
      const newSs      = loadScene(shadow, newPhysics);
      newPhysics.createCharacter(newSs.spawnX, newSs.spawnY + 0.05, newSs.spawnZ);
      // Swap in new state, tear down old
      unloadScene(ss);
      physics.destroy();
      ss      = newSs;
      physics = newPhysics;
      // Reset camera to new spawn; keep player in whatever state they were
      camera = makeCameraForScene(ss, settings.fov);
      if (appState === "PLAYING") player = createPlayerState();
      console.log("[hot-reload] done");
    } catch (e) {
      console.error("[hot-reload] failed, keeping old scene:", e);
    }
  }

  // ── State: MAIN_MENU ────────────────────────────────────────────────────────
  if (appState === "MAIN_MENU") {
    RL.BeginDrawing();
    const choice = drawMainMenu();
    RL.EndDrawing();

    if (choice?.action === "exit") {
      break;
    } else if (choice?.action === "host") {
      if (ss) { unloadScene(ss); ss = null; }
      if (physics) { physics.destroy(); physics = null; }
      physics = await PhysicsWorld.create();
      ss = loadScene(shadow, physics);
      physics.createCharacter(ss.spawnX, ss.spawnY + 0.05, ss.spawnZ);
      camera = makeCameraForScene(ss, settings.fov);
      server = new GameServer(GAME_PORT);
      server.start();
      client = new GameClient();
      appState = "CONNECTING";
      connectingPromise = client.connect("127.0.0.1", GAME_PORT);
      statusMsg = "Starting server…";
    } else if (choice?.action === "browse") {
      browserState = createBrowserState();
      appState = "SERVER_BROWSER";
    }
    continue;
  }

  // ── State: SERVER_BROWSER ───────────────────────────────────────────────────
  if (appState === "SERVER_BROWSER") {
    RL.BeginDrawing();
    const result = drawBrowser(browserState!);
    RL.EndDrawing();

    if (result?.action === "connect") {
      if (ss) { unloadScene(ss); ss = null; }
      if (physics) { physics.destroy(); physics = null; }
      physics = await PhysicsWorld.create();
      ss = loadScene(shadow, physics);
      physics.createCharacter(ss.spawnX, ss.spawnY + 0.05, ss.spawnZ);
      camera = makeCameraForScene(ss, settings.fov);
      client   = new GameClient();
      appState = "CONNECTING";
      connectingPromise = client.connect(result.hostname, result.port);
      statusMsg = `Connecting to ${result.hostname}:${result.port}…`;
    } else if (result?.action === "back") {
      appState = "MAIN_MENU";
    }
    continue;
  }

  // ── State: CONNECTING ───────────────────────────────────────────────────────
  if (appState === "CONNECTING") {
    RL.BeginDrawing();
    RL.ClearBackground(new RL.Color(15, 15, 25, 255));
    RL.DrawText(statusMsg, 20, RL.GetScreenHeight() / 2 | 0, 20, new RL.Color(220, 220, 220, 255));
    RL.EndDrawing();

    const raceResult = await Promise.race([
      connectingPromise!,
      new Promise<"pending">((r) => setTimeout(() => r("pending"), 0)),
    ]);

    if (raceResult === true) {
      console.log(`[client] connected as player ${client!.localId}`);
      enterPlaying();
    } else if (raceResult === false) {
      console.warn("[client] connection failed");
      stopNetworking();
      appState = "MAIN_MENU";
    }
    continue;
  }

  // ── State: PLAYING ──────────────────────────────────────────────────────────
  if (appState === "PLAYING") {
    if (!ss || !physics) { appState = "MAIN_MENU"; continue; }

    if (RL.IsKeyPressed(RL.KeyboardKey.ESCAPE)) {
      isPaused = !isPaused;
      if (isPaused) {
        RL.EnableCursor();
        pauseMenu = createPauseMenuState(settings);
      } else {
        RL.DisableCursor();
        pauseMenu = null;
      }
    }

    if (!isPaused) {
      updatePlayer(player, camera, physics, dt, settings.sensitivity, settings.invertY);

      // ── Grab mechanic ─────────────────────────────────────────────────────
      const cp = Math.cos(player.pitch);
      const lookX = -Math.sin(player.yaw) * cp;
      const lookY =  Math.sin(player.pitch);
      const lookZ = -Math.cos(player.yaw) * cp;

      if (RL.IsMouseButtonPressed(RL.MouseButton.RIGHT)) {
        // Try to pick up whatever we're aiming at
        const hit = physics.raycastDynamic(
          camera.position.x, camera.position.y, camera.position.z,
          lookX, lookY, lookZ, GRAB_REACH,
        );
        if (hit) { grabName = hit.name; grabDist = GRAB_HOLD_DIST; }
      }

      if (grabName && RL.IsMouseButtonDown(RL.MouseButton.RIGHT)) {
        const tx = camera.position.x + lookX * grabDist;
        const ty = camera.position.y + lookY * grabDist;
        const tz = camera.position.z + lookZ * grabDist;
        physics.setGrabVelocity(grabName, tx, ty, tz, dt);
      } else {
        grabName = null;
      }
      // ─────────────────────────────────────────────────────────────────────

      physics.step(dt);
    }

    camera.fovy = settings.fov;

    // Network tick
    client?.tick();
    netAccum += dt;
    if (netAccum >= 1 / NET_UPDATE_HZ) {
      netAccum -= 1 / NET_UPDATE_HZ;
      client?.sendUpdate(camera.position.x, camera.position.y, camera.position.z, player.yaw);
    }

    // Shadow depth pass
    updatePerFrame(shadow, camera);
    renderDepthPass(shadow, ss.model, ss.navRange);

    // Main render
    RL.BeginDrawing();
    RL.ClearBackground(new RL.Color(100, 149, 237, 255));
    RL.BeginMode3D(camera);

    // Static scene meshes (skip nav_mesh and dynamic objects)
    for (let i = 0; i < ss.model.meshCount; i++) {
      if (ss.navRange && i >= ss.navRange.start && i < ss.navRange.start + ss.navRange.count) continue;
      if (ss.dynamicMeshIndices.has(i)) continue;
      RL.DrawMesh(getMesh(ss.model, i), ss.mats[i], ss.model.transform);
    }

    // Debug: physics collider wireframes
    if (settings.showColliderWireframes) {
      physics.drawColliderWireframes(new RL.Color(0, 255, 80, 200));
    }

    // Dynamic physics objects with updated world transforms
    for (const obj of ss.dynamicObjects) {
      const mat = physics.getDynamicTransform(obj.name);
      if (!mat) continue;
      for (let i = obj.range.start; i < obj.range.start + obj.range.count; i++) {
        RL.DrawMesh(getMesh(ss.model, i), ss.mats[i], mat);
      }
    }

    if (client) updateAndDrawRemotePlayers(client.remotePlayers, remotePlayers, LERP_ALPHA);
    RL.EndMode3D();

    if (client) drawNametags(remotePlayers, camera);
    _drawHUD(player.isGrounded, client?.localId ?? 0);

    if (isPaused && pauseMenu) {
      const result = drawPauseMenu(pauseMenu);
      if (result?.action === "resume") {
        isPaused = false; pauseMenu = null; grabName = null; RL.DisableCursor();
      } else if (result?.action === "exit_to_menu") {
        isPaused = false; pauseMenu = null; grabName = null;
        RL.EnableCursor();
        stopNetworking();
        unloadScene(ss);
        physics.destroy();
        ss = null;
        physics = null;
        appState = "MAIN_MENU";
      }
    }

    RL.EndDrawing();
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

stopNetworking();
if (physics) physics.destroy();
destroyShadowMap(shadow);
if (ss) unloadScene(ss);
RL.CloseWindow();

// ─── HUD helper ───────────────────────────────────────────────────────────────

function _drawHUD(grounded: boolean, localId: number): void {
  const cx = RL.GetScreenWidth()  / 2 | 0;
  const cy = RL.GetScreenHeight() / 2 | 0;
  RL.DrawLine(cx - 10, cy, cx + 10, cy, RL.White);
  RL.DrawLine(cx, cy - 10, cx, cy + 10, RL.White);
  RL.DrawFPS(10, 10);
  if (localId > 0) RL.DrawText(`Player ${localId}`, 10, 34, 14, new RL.Color(180, 220, 255, 200));
  if (!grounded)   RL.DrawText("↑ AIRBORNE", cx - 40, cy - 30, 14, new RL.Color(255, 220, 80, 200));
  RL.DrawText(
    "WASD: Move  Mouse: Look  Space: Jump  RMB: Grab  ESC: Menu",
    10, RL.GetScreenHeight() - 24, 14, new RL.Color(220, 220, 220, 200),
  );
}
