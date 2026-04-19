import * as RL from "raylib";
import { PhysicsWorld } from "./physics.ts";
import { createPlayerState, updatePlayer, PlayerState, EYE_HEIGHT } from "./player.ts";
import { ShadowMap, updatePerFrame, renderDepthPass, renderDepthPassMap, setPointLights } from "./shadow.ts";
import { GameServer } from "./net/server.ts";
import { GameClient } from "./net/client.ts";
import { GAME_PORT } from "./net/protocol.ts";
import { RemotePlayer, updateAndDrawRemotePlayers, drawNametags } from "./remote_player.ts";
import { PauseSettings, createPauseMenuState, drawPauseMenu, PauseMenuState } from "./ui/pause_menu.ts";
import { getMesh, resolveRaylibMeshRange } from "./scene.ts";
import { loadScene, unloadScene, makeCameraForScene, SceneState, SCENE_FILE } from "./scene_loader.ts";
import { WorldRegistry, WorldObject } from "./world.ts";
import { BehaviorContext } from "./behavior.ts";
import { getPrefab } from "./prefab.ts";
import { parseNodeMetadata } from "./metadata.ts";
import { GameplayAPIImpl } from "./gameplay_api.ts";
import { registerAllPrefabs } from "./prefabs/registry.ts";
import { MapState, loadModularMap, unloadMap } from "./map_loader.ts";
import { Skybox, createSkybox, drawSkybox, destroySkybox } from "./skybox.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

const NET_UPDATE_HZ   = 20;
const LERP_ALPHA      = 0.25;
const GRAB_REACH      = 8;
const GRAB_HOLD_DIST  = 2.5;

// ─── Session result ──────────────────────────────────────────────────────────

export type SessionResult =
  | { action: "continue" }
  | { action: "exit_to_menu" };

// ─── GameSession ─────────────────────────────────────────────────────────────

export class GameSession {
  // Core state
  physics:   PhysicsWorld;
  ss:        SceneState | null;
  camera:    RL.Camera3D;
  player:    PlayerState;
  shadow:    ShadowMap;
  skybox:    Skybox;
  settings:  PauseSettings;
  world:     WorldRegistry;
  api:       GameplayAPIImpl;
  mapState:  MapState | null;

  // Networking
  server:        GameServer | null = null;
  client:        GameClient | null = null;
  remotePlayers: Map<number, RemotePlayer> = new Map();
  netAccum = 0;

  // Pause
  isPaused   = false;
  pauseMenu: PauseMenuState | null = null;

  // Grab
  grabName: string | null = null;
  grabDist = 0;

  // Hot-reload
  sceneReloadPending = false;
  private _reloadTimer: number | undefined;
  private _watcherAbort: AbortController | null = null;

  private constructor(
    physics:  PhysicsWorld,
    ss:       SceneState | null,
    shadow:   ShadowMap,
    settings: PauseSettings,
    world:    WorldRegistry,
    camera:   RL.Camera3D,
    mapState: MapState | null,
  ) {
    this.physics  = physics;
    this.ss       = ss;
    this.shadow   = shadow;
    this.skybox   = createSkybox();
    this.settings = settings;
    this.world    = world;
    this.camera   = camera;
    this.mapState = mapState;
    this.player   = createPlayerState();
    this.api      = new GameplayAPIImpl(world, physics, this.camera, this.player);
  }

  // ── Factory ──────────────────────────────────────────────────────────────────

  static async create(
    shadow: ShadowMap,
    settings: PauseSettings,
    mapPath?: string,
  ): Promise<GameSession> {
    registerAllPrefabs();
    const physics = await PhysicsWorld.create();
    const world = new WorldRegistry();

    if (mapPath) {
      // Modular map mode
      const mapState = loadModularMap(mapPath, "data/modular/asset_library.json", shadow, physics);
      physics.createCharacter(mapState.spawnX, mapState.spawnY + 0.05, mapState.spawnZ);
      const camY = mapState.spawnY + EYE_HEIGHT;
      const camera = new RL.Camera3D({
        position:   new RL.Vector3(mapState.spawnX, camY, mapState.spawnZ),
        target:     new RL.Vector3(mapState.spawnX, camY, mapState.spawnZ - 1),
        up:         new RL.Vector3(0, 1, 0),
        fovy:       settings.fov,
        projection: RL.CameraProjection.PERSPECTIVE,
      });
      // Upload point lights to shader
      if (mapState.lights.length > 0) {
        setPointLights(shadow, mapState.lights);
      }
      return new GameSession(physics, null, shadow, settings, world, camera, mapState);
    }

    // Legacy scene.glb mode
    const ss = loadScene(shadow, physics);
    physics.createCharacter(ss.spawnX, ss.spawnY + 0.05, ss.spawnZ);
    const camera = makeCameraForScene(ss, settings.fov);
    const session = new GameSession(physics, ss, shadow, settings, world, camera, null);
    _populateRegistry(world, ss, session);
    return session;
  }

  // ── Networking ───────────────────────────────────────────────────────────────

  async startHost(port: number = GAME_PORT): Promise<boolean> {
    this.server = new GameServer(port);
    this.server.start();
    this.client = new GameClient();
    return await this.client.connect("127.0.0.1", port);
  }

  async joinServer(hostname: string, port: number): Promise<boolean> {
    this.client = new GameClient();
    return await this.client.connect(hostname, port);
  }

  // ── Frame update ─────────────────────────────────────────────────────────────

  update(dt: number): SessionResult {
    // Escape toggles pause
    if (RL.IsKeyPressed(RL.KeyboardKey.ESCAPE)) {
      this.isPaused = !this.isPaused;
      if (this.isPaused) {
        RL.EnableCursor();
        this.pauseMenu = createPauseMenuState(this.settings);
      } else {
        RL.DisableCursor();
        this.pauseMenu = null;
      }
    }

    if (!this.isPaused) {
      updatePlayer(this.player, this.camera, this.physics, dt, this.settings.sensitivity, this.settings.invertY);

      // Grab mechanic
      const cp    = Math.cos(this.player.pitch);
      const lookX = -Math.sin(this.player.yaw) * cp;
      const lookY =  Math.sin(this.player.pitch);
      const lookZ = -Math.cos(this.player.yaw) * cp;

      if (RL.IsMouseButtonPressed(RL.MouseButton.RIGHT)) {
        const hit = this.physics.raycastDynamic(
          this.camera.position.x, this.camera.position.y, this.camera.position.z,
          lookX, lookY, lookZ, GRAB_REACH,
        );
        if (hit) { this.grabName = hit.name; this.grabDist = GRAB_HOLD_DIST; }
      }

      if (this.grabName && RL.IsMouseButtonDown(RL.MouseButton.RIGHT)) {
        const tx = this.camera.position.x + lookX * this.grabDist;
        const ty = this.camera.position.y + lookY * this.grabDist;
        const tz = this.camera.position.z + lookZ * this.grabDist;
        this.physics.setGrabVelocity(this.grabName, tx, ty, tz, dt);
      } else {
        this.grabName = null;
      }

      // Tick behaviors
      for (const obj of this.world.all()) {
        if (obj.behaviors.length === 0) continue;
        const ctx = this._makeBehaviorContext(obj, dt);
        for (const b of obj.behaviors) {
          b.update?.(ctx);
        }
      }

      this.physics.step(dt);
    }

    this.camera.fovy = this.settings.fov;

    // Network tick
    this.client?.tick();
    this.netAccum += dt;
    if (this.netAccum >= 1 / NET_UPDATE_HZ) {
      this.netAccum -= 1 / NET_UPDATE_HZ;
      this.client?.sendUpdate(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.player.yaw);
    }

    // Shadow depth pass
    updatePerFrame(this.shadow, this.camera);
    if (this.mapState) {
      renderDepthPassMap(this.shadow, this.mapState.models, this.mapState.instances);
    } else if (this.ss) {
      renderDepthPass(this.shadow, this.ss.model, this.ss.navRange);
    }

    // Main render
    RL.BeginDrawing();
    RL.ClearBackground(RL.Black);
    RL.BeginMode3D(this.camera);
    drawSkybox(this.skybox, this.camera);

    // Scene geometry
    if (this.mapState) {
      // Map mode: draw all placed instances
      for (const inst of this.mapState.instances) {
        const asset = this.mapState.models[inst.modelIndex];
        for (let i = 0; i < asset.meshCount; i++) {
          RL.DrawMesh(getMesh(asset.model, i), asset.mats[i], inst.transform);
        }
      }
    } else if (this.ss) {
      // Legacy mode: static scene meshes (skip nav_mesh and dynamic objects)
      for (let i = 0; i < this.ss.model.meshCount; i++) {
        if (this.ss.navRange && i >= this.ss.navRange.start && i < this.ss.navRange.start + this.ss.navRange.count) continue;
        if (this.ss.dynamicMeshIndices.has(i)) continue;
        RL.DrawMesh(getMesh(this.ss.model, i), this.ss.mats[i], this.ss.model.transform);
      }
    }

    // Point light markers (small glowing spheres)
    if (this.mapState) {
      for (const pl of this.mapState.lights) {
        const r = Math.min(pl.color[0] * 255, 255) | 0;
        const g = Math.min(pl.color[1] * 255, 255) | 0;
        const b = Math.min(pl.color[2] * 255, 255) | 0;
        RL.DrawSphere(
          new RL.Vector3(pl.position[0], pl.position[1], pl.position[2]),
          0.15, new RL.Color(r, g, b, 255),
        );
      }
    }

    // Debug: physics collider wireframes
    if (this.settings.showColliderWireframes) {
      this.physics.drawColliderWireframes(new RL.Color(0, 255, 80, 200));
    }

    // Dynamic physics objects with updated world transforms (scene mode only)
    if (this.ss) {
      for (const obj of this.ss.dynamicObjects) {
        const physMat = this.physics.getDynamicTransform(obj.name);
        if (!physMat) continue;
        for (let i = obj.range.start; i < obj.range.start + obj.range.count; i++) {
          RL.DrawMesh(getMesh(this.ss.model, i), this.ss.mats[i], physMat);
        }
      }
    }


    if (this.client) updateAndDrawRemotePlayers(this.client.remotePlayers, this.remotePlayers, LERP_ALPHA);
    RL.EndMode3D();

    if (this.client) drawNametags(this.remotePlayers, this.camera);
    _drawHUD(this.player.isGrounded, this.client?.localId ?? 0);

    // Pause menu overlay
    if (this.isPaused && this.pauseMenu) {
      const result = drawPauseMenu(this.pauseMenu);
      if (result?.action === "resume") {
        this.isPaused = false; this.pauseMenu = null; this.grabName = null;
        RL.DisableCursor();
      } else if (result?.action === "exit_to_menu") {
        this.isPaused = false; this.pauseMenu = null; this.grabName = null;
        RL.EnableCursor();
        RL.EndDrawing();
        return { action: "exit_to_menu" };
      }
    }

    RL.EndDrawing();
    return { action: "continue" };
  }

  // ── Hot-reload ───────────────────────────────────────────────────────────────

  async checkHotReload(): Promise<void> {
    if (!this.sceneReloadPending || !this.ss) return;
    this.sceneReloadPending = false;
    console.log("[hot-reload] reloading scene…");
    try {
      const newPhysics = await PhysicsWorld.create();
      const newSs      = loadScene(this.shadow, newPhysics);
      newPhysics.createCharacter(newSs.spawnX, newSs.spawnY + 0.05, newSs.spawnZ);

      unloadScene(this.ss);
      this.physics.destroy();
      this.ss      = newSs;
      this.physics = newPhysics;
      this.camera  = makeCameraForScene(this.ss, this.settings.fov);
      this.player  = createPlayerState();
      this.api.updateRefs(this.world, this.physics, this.camera, this.player);

      // Re-populate world registry
      this.world.clear();
      _populateRegistry(this.world, this.ss, this);

      console.log("[hot-reload] done");
    } catch (e) {
      console.error("[hot-reload] failed, keeping old scene:", e);
    }
  }

  startFileWatcher(): void {
    if (!this.ss) return;  // No file watcher in map mode
    this._watcherAbort = new AbortController();
    (async () => {
      try {
        for await (const event of Deno.watchFs(SCENE_FILE)) {
          if (this._watcherAbort?.signal.aborted) break;
          if (event.kind === "modify" || event.kind === "create") {
            clearTimeout(this._reloadTimer);
            this._reloadTimer = setTimeout(() => { this.sceneReloadPending = true; }, 500) as unknown as number;
          }
        }
      } catch (_) {
        // Watcher closed
      }
    })();
  }

  // ── Behavior context factory ─────────────────────────────────────────────────

  /** @internal Used by _populateRegistry during init */
  _makeBehaviorContext(obj: WorldObject, dt: number): BehaviorContext {
    return {
      self:    obj,
      world:   this.world,
      physics: this.physics,
      dt,
      camera:  this.camera,
      player:  this.player,
      api:     this.api,
    };
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  destroy(): void {
    // Destroy behaviors
    for (const obj of this.world.all()) {
      if (obj.behaviors.length === 0) continue;
      const ctx = this._makeBehaviorContext(obj, 0);
      for (const b of obj.behaviors) {
        b.destroy?.(ctx);
      }
    }
    this.world.clear();

    this._watcherAbort?.abort();
    clearTimeout(this._reloadTimer);
    this.client?.disconnect(); this.client = null;
    this.server?.stop();       this.server = null;
    this.remotePlayers.clear();
    if (this.mapState) unloadMap(this.mapState);
    if (this.ss) unloadScene(this.ss);
    destroySkybox(this.skybox);
    this.physics.destroy();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _populateRegistry(
  world: WorldRegistry,
  ss: SceneState,
  session: GameSession,
): void {
  const gltf = ss.gltf;
  if (!gltf.nodes) return;

  for (const node of gltf.nodes) {
    if (!node.name) continue;
    const physicsType = (node.extras?.["physicsType"] as string) ?? "";
    const meshRange   = resolveRaylibMeshRange(gltf, node.name);
    const spawnPos    = node.translation ?? null;

    const obj = world.add({
      name:          node.name,
      physicsType,
      meshRange,
      spawnPosition: spawnPos,
      extras:        node.extras ?? {},
    });

    // Parse metadata and apply tags
    const { metadata } = parseNodeMetadata(node.name, node.extras);
    if (metadata.tags) {
      for (const tag of metadata.tags) {
        world.addTag(obj, tag);
      }
    }

    // Resolve prefab and create behaviors
    if (metadata.prefab) {
      const prefabDef = getPrefab(metadata.prefab);
      if (prefabDef) {
        // Apply default tags from prefab
        if (prefabDef.defaultTags) {
          for (const tag of prefabDef.defaultTags) {
            world.addTag(obj, tag);
          }
        }
        // Create and init behaviors
        const params = metadata.scriptParams ?? {};
        for (const factory of prefabDef.behaviors) {
          const behavior = factory(params);
          obj.behaviors.push(behavior);
        }
        // Init all behaviors after attaching
        const ctx = session._makeBehaviorContext(obj, 0);
        for (const b of obj.behaviors) {
          b.init?.(ctx);
        }
      } else {
        console.warn(`[prefab] node "${node.name}" references unknown prefab "${metadata.prefab}"`);
      }
    }
  }
  console.log(`[world] registry populated: ${world.count} objects`);
}

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
