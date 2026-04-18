import type * as RL from "raylib";
import type { WorldObject, WorldRegistry } from "./world.ts";
import type { PhysicsWorld } from "./physics.ts";
import type { PlayerState } from "./player.ts";

// ─── Behavior Context ────────────────────────────────────────────────────────
// Passed to every behavior lifecycle hook so behaviors can interact with the
// world without importing modules directly.

export interface BehaviorContext {
  self:    WorldObject;
  world:   WorldRegistry;
  physics: PhysicsWorld;
  dt:      number;
  camera:  RL.Camera3D;
  player:  PlayerState;
  api:     GameplayAPI | null;  // wired in Phase 6
}

// Gameplay API interface — implemented by GameplayAPIImpl in gameplay_api.ts
export interface GameplayAPI {
  // World queries
  findByName(name: string): WorldObject | undefined;
  findByTag(tag: string): WorldObject[];
  addTag(obj: WorldObject, tag: string): void;
  removeTag(obj: WorldObject, tag: string): void;
  // Physics
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): { name: string; dist: number } | null;
  // Player
  getPlayerPosition(): { x: number; y: number; z: number };
  getPlayerYaw(): number;
  isPlayerGrounded(): boolean;
  // Camera
  getCameraForward(): { x: number; y: number; z: number };
  // Debug
  log(message: string): void;
}

// ─── Behavior Interface ──────────────────────────────────────────────────────

export interface Behavior {
  /** Called once when the behavior is attached to an object. */
  init?(ctx: BehaviorContext): void;

  /** Called every frame while the game is not paused. */
  update?(ctx: BehaviorContext): void;

  /** Called when the object is removed from the world. */
  destroy?(ctx: BehaviorContext): void;

  /** Called when a player interacts with the object (future). */
  onInteract?(ctx: BehaviorContext): void;

  /** Called when another object enters this object's trigger zone (future). */
  onTriggerEnter?(ctx: BehaviorContext, other: WorldObject): void;

  /** Called when another object exits this object's trigger zone (future). */
  onTriggerExit?(ctx: BehaviorContext, other: WorldObject): void;
}

// ─── Behavior Factory ────────────────────────────────────────────────────────
// A function that creates a Behavior instance, optionally using params from
// the scene metadata's scriptParams field.

export type BehaviorFactory = (params: Record<string, unknown>) => Behavior;
