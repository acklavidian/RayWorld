import * as RL from "raylib";

import { parseGlbJson, findNode, resolveRaylibMeshRange, getMesh, makeSceneMaterials } from "./src/scene.ts";
import { buildNavMesh, navHeight, NavTri }   from "./src/navmesh.ts";
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
const NET_UPDATE_HZ   = 20; // position sends per second
const LERP_ALPHA      = 0.25; // remote player interpolation speed

// ─── State machine ────────────────────────────────────────────────────────────

type AppState =
  | "MAIN_MENU"
  | "SERVER_BROWSER"
  | "CONNECTING"      // async connect in progress
  | "PLAYING";

// ─── Init window ──────────────────────────────────────────────────────────────

RL.InitWindow(1280, 720, "3D Scene");
RL.SetTargetFPS(60);
RL.SetExitKey(RL.KeyboardKey.NULL); // disable default ESC-to-quit; we handle ESC ourselves

// ─── Load & parse scene ───────────────────────────────────────────────────────

let gltf;
try {
  gltf = parseGlbJson(SCENE_FILE);
} catch (e) {
  RL.CloseWindow();
  console.error(
    `\nFailed to open scene: ${e}` +
      `\n\nExport your Blender scene as GLB to: ${SCENE_FILE}` +
      `\nRequirements:` +
      `\n  - An object named "player"   (Empty)  → spawn point` +
      `\n  - A mesh named  "nav_mesh"            → walkable surfaces` +
      `\n  - Apply all transforms before export (Ctrl+A → All Transforms)\n`,
  );
  Deno.exit(1);
  throw e; // unreachable: satisfies TypeScript definite assignment
}

// Player spawn from "player" Empty node
let spawnX = 0, spawnZ = 0, spawnY = 2;
const playerNode = findNode(gltf, "player");
if (playerNode?.translation) {
  [spawnX, spawnY, spawnZ] = playerNode.translation;
  console.log(`Player spawn: (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);
} else {
  console.warn('No "player" Empty found — spawning at origin');
}

// Nav mesh range
const navRange = resolveRaylibMeshRange(gltf, "nav_mesh");
if (!navRange) console.warn('No "nav_mesh" found — movement will not be constrained');

// ─── Load model ───────────────────────────────────────────────────────────────

const scene = RL.LoadModel(SCENE_FILE);

// ─── Build nav mesh ───────────────────────────────────────────────────────────

const navTris: NavTri[] = [];
if (navRange) {
  for (let i = navRange.start; i < navRange.start + navRange.count; i++) {
    if (i < scene.meshCount) navTris.push(...buildNavMesh(getMesh(scene, i)));
  }
  console.log(`Nav mesh: ${navTris.length} triangles`);
}

// ─── Shadow map ───────────────────────────────────────────────────────────────

const lightPos    = new RL.Vector3(50, 80, 40);
const lightTarget = new RL.Vector3(0, 0, 0);
const shadow      = createShadowMap(lightPos, lightTarget, SHADOW_MAP_SIZE, SHADOW_ORTHO);
const sceneMats   = makeSceneMaterials(scene, shadow.sceneShader);

// ─── Player ───────────────────────────────────────────────────────────────────

function makeCamera(): RL.Camera3D {
  const groundAtSpawn = navHeight(navTris, spawnX, spawnZ);
  const camY          = (groundAtSpawn ?? spawnY) + EYE_HEIGHT;
  return new RL.Camera3D({
    position:   new RL.Vector3(spawnX, camY, spawnZ),
    target:     new RL.Vector3(spawnX, camY, spawnZ - 1),
    up:         new RL.Vector3(0, 1, 0),
    fovy:       70,
    projection: RL.CameraProjection.PERSPECTIVE,
  });
}

// ─── Networking ───────────────────────────────────────────────────────────────

let server: GameServer | null = null;
let client: GameClient | null = null;
const remotePlayers: Map<number, RemotePlayer> = new Map();

// Throttle position updates to NET_UPDATE_HZ
let netAccum = 0;

// ─── App state ────────────────────────────────────────────────────────────────

let appState: AppState = "MAIN_MENU";
let camera   = makeCamera();
let player   = createPlayerState();
let browserState: BrowserState | null = null;
let connectingPromise: Promise<boolean> | null = null;
let statusMsg = "";

const settings: PauseSettings      = createPauseSettings();
let isPaused  = false;
let pauseMenu: PauseMenuState | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function enterPlaying(): void {
  player    = createPlayerState();
  camera    = makeCamera();
  isPaused  = false;
  pauseMenu = null;
  remotePlayers.clear();
  appState  = "PLAYING";
  RL.DisableCursor();
}

function stopNetworking(): void {
  client?.disconnect();
  client = null;
  server?.stop();
  server = null;
  remotePlayers.clear();
}

// ─── Main loop ────────────────────────────────────────────────────────────────

while (!RL.WindowShouldClose()) {
  // Yield to Deno's event loop each frame so async I/O can run.
  await new Promise((r) => setTimeout(r, 0));

  const dt = RL.GetFrameTime();

  // ── State: MAIN_MENU ────────────────────────────────────────────────────────
  if (appState === "MAIN_MENU") {
    RL.BeginDrawing();
    const choice = drawMainMenu();
    RL.EndDrawing();

    if (choice?.action === "exit") {
      break;
    } else if (choice?.action === "host") {
      // Start server + connect as localhost client
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

    // Non-blocking poll of the connect promise
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
    // "pending" → keep waiting
    continue;
  }

  // ── State: PLAYING ──────────────────────────────────────────────────────────
  if (appState === "PLAYING") {
    // ESC → toggle pause menu
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

    // Player update (skip while paused)
    if (!isPaused) {
      updatePlayer(player, camera, navTris, dt, settings.sensitivity, settings.invertY);
    }

    // Keep camera FOV in sync with settings
    camera.fovy = settings.fov;

    // Network tick
    client?.tick();
    netAccum += dt;
    if (netAccum >= 1 / NET_UPDATE_HZ) {
      netAccum -= 1 / NET_UPDATE_HZ;
      client?.sendUpdate(
        camera.position.x,
        camera.position.y,
        camera.position.z,
        player.yaw,
      );
    }

    // Shadow depth pass
    updatePerFrame(shadow, camera);
    renderDepthPass(shadow, scene, navRange);

    // Main render
    RL.BeginDrawing();
    RL.ClearBackground(new RL.Color(100, 149, 237, 255)); // cornflower sky

    RL.BeginMode3D(camera);

    // Scene meshes (skip nav_mesh)
    for (let i = 0; i < scene.meshCount; i++) {
      if (navRange && i >= navRange.start && i < navRange.start + navRange.count) continue;
      RL.DrawMesh(getMesh(scene, i), sceneMats[i], scene.transform);
    }

    // Remote players
    if (client) {
      updateAndDrawRemotePlayers(client.remotePlayers, remotePlayers, LERP_ALPHA);
    }

    RL.EndMode3D();

    // Nametags (2D overlay)
    if (client) drawNametags(remotePlayers, camera);

    // HUD
    _drawHUD(player.isGrounded, client?.localId ?? 0);

    // Pause menu overlay
    if (isPaused && pauseMenu) {
      const result = drawPauseMenu(pauseMenu);
      if (result?.action === "resume") {
        isPaused  = false;
        pauseMenu = null;
        RL.DisableCursor();
      } else if (result?.action === "exit_to_menu") {
        isPaused  = false;
        pauseMenu = null;
        RL.EnableCursor();
        stopNetworking();
        appState = "MAIN_MENU";
      }
    }

    RL.EndDrawing();
  }
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

stopNetworking();
destroyShadowMap(shadow);
RL.UnloadModel(scene);
RL.CloseWindow();

// ─── HUD helper ───────────────────────────────────────────────────────────────

function _drawHUD(grounded: boolean, localId: number): void {
  const cx = RL.GetScreenWidth()  / 2 | 0;
  const cy = RL.GetScreenHeight() / 2 | 0;
  RL.DrawLine(cx - 10, cy, cx + 10, cy, RL.White);
  RL.DrawLine(cx, cy - 10, cx, cy + 10, RL.White);
  RL.DrawFPS(10, 10);
  if (localId > 0) {
    RL.DrawText(`Player ${localId}`, 10, 34, 14, new RL.Color(180, 220, 255, 200));
  }
  if (!grounded) {
    RL.DrawText("↑ AIRBORNE", cx - 40, cy - 30, 14, new RL.Color(255, 220, 80, 200));
  }
  RL.DrawText(
    "WASD: Move  Mouse: Look  Space: Jump  ESC: Menu",
    10, RL.GetScreenHeight() - 24, 14,
    new RL.Color(220, 220, 220, 200),
  );
}
