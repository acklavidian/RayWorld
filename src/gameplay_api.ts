import * as RL from "raylib";
import { WorldObject, WorldRegistry } from "./world.ts";
import { PhysicsWorld } from "./physics.ts";
import type { PlayerState } from "./player.ts";
import type { GameplayAPI as IGameplayAPI } from "./behavior.ts";

// ─── Gameplay API ────────────────────────────────────────────────────────────
// Curated scripting surface for behaviors. Provides safe, stable functions
// that behaviors can call without directly touching engine internals.

export class GameplayAPIImpl implements IGameplayAPI {
  private _world:   WorldRegistry;
  private _physics: PhysicsWorld;
  private _camera:  RL.Camera3D;
  private _player:  PlayerState;

  constructor(world: WorldRegistry, physics: PhysicsWorld, camera: RL.Camera3D, player: PlayerState) {
    this._world   = world;
    this._physics = physics;
    this._camera  = camera;
    this._player  = player;
  }

  /** Update references when session state changes (e.g. hot-reload). */
  updateRefs(world: WorldRegistry, physics: PhysicsWorld, camera: RL.Camera3D, player: PlayerState): void {
    this._world   = world;
    this._physics = physics;
    this._camera  = camera;
    this._player  = player;
  }

  // ── World queries ──────────────────────────────────────────────────────────

  findByName(name: string): WorldObject | undefined {
    return this._world.getByName(name);
  }

  findByTag(tag: string): WorldObject[] {
    return [...this._world.getByTag(tag)];
  }

  addTag(obj: WorldObject, tag: string): void {
    this._world.addTag(obj, tag);
  }

  removeTag(obj: WorldObject, tag: string): void {
    this._world.removeTag(obj, tag);
  }

  // ── Transform ──────────────────────────────────────────────────────────────

  getTransform(obj: WorldObject): RL.Matrix | null {
    if (!obj.physicsBodyName) return null;
    return this._physics.getDynamicTransform(obj.physicsBodyName);
  }

  // ── Physics ────────────────────────────────────────────────────────────────

  raycast(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): { name: string; dist: number } | null {
    return this._physics.raycastDynamic(ox, oy, oz, dx, dy, dz, maxDist);
  }

  // ── Player ─────────────────────────────────────────────────────────────────

  getPlayerPosition(): { x: number; y: number; z: number } {
    return {
      x: this._camera.position.x,
      y: this._camera.position.y,
      z: this._camera.position.z,
    };
  }

  getPlayerYaw(): number {
    return this._player.yaw;
  }

  isPlayerGrounded(): boolean {
    return this._player.isGrounded;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────

  getCameraForward(): { x: number; y: number; z: number } {
    const cp = Math.cos(this._player.pitch);
    return {
      x: -Math.sin(this._player.yaw) * cp,
      y:  Math.sin(this._player.pitch),
      z: -Math.cos(this._player.yaw) * cp,
    };
  }

  // ── Debug ──────────────────────────────────────────────────────────────────

  drawLine(
    x1: number, y1: number, z1: number,
    x2: number, y2: number, z2: number,
    color?: RL.Color,
  ): void {
    RL.DrawLine3D(
      new RL.Vector3(x1, y1, z1),
      new RL.Vector3(x2, y2, z2),
      color ?? new RL.Color(255, 0, 255, 255),
    );
  }

  drawSphere(x: number, y: number, z: number, radius: number, color?: RL.Color): void {
    RL.DrawSphere(
      new RL.Vector3(x, y, z),
      radius,
      color ?? new RL.Color(255, 0, 255, 128),
    );
  }

  log(message: string): void {
    console.log(`[gameplay] ${message}`);
  }
}
