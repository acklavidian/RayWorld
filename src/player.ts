import * as RL from "raylib";
import * as Input from "./input.ts";
import { PhysicsWorld } from "./physics.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

export const EYE_HEIGHT       = 1.75;   // metres above feet (bottom of physics capsule)
export const MOVE_SPEED       = 5.0;    // m/s horizontal
export const LOOK_SENSITIVITY = 0.002;  // radians per pixel (base — multiplied by settings)
export const JUMP_SPEED       = 6.5;    // m/s initial upward velocity
export const GRAVITY          = 18.0;   // m/s² downward acceleration

// ─── State ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  yaw:        number;  // horizontal look angle (radians)
  pitch:      number;  // vertical look angle (radians, clamped)
  isGrounded: boolean;
}

export function createPlayerState(): PlayerState {
  return { yaw: 0, pitch: 0, isGrounded: true };
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Full player tick: mouse look → physics-driven movement → camera sync.
 * The CharacterVirtual inside `physics` must have been created before the
 * first call (via `physics.createCharacter`).
 */
export function updatePlayer(
  state:       PlayerState,
  camera:      RL.Camera3D,
  physics:     PhysicsWorld,
  dt:          number,
  sensitivity: number  = 1.0,
  invertY:     boolean = false,
): void {
  _applyLook(state, sensitivity, invertY);
  _applyPhysicsMovement(state, physics, dt);
  _updateCameraFromPhysics(camera, physics);
  _updateCameraTarget(state, camera);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _applyLook(
  state:       PlayerState,
  sensitivity: number,
  invertY:     boolean,
): void {
  const { dx, dy } = Input.getMouseDelta();
  const sens = LOOK_SENSITIVITY * sensitivity;
  state.yaw   -= dx * sens;
  state.pitch -= dy * sens * (invertY ? -1 : 1);
  state.pitch  = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.pitch));
}

/**
 * Converts WASD input into a desired velocity, applies gravity and jumping to
 * the Y component, then steps the physics character controller.
 *
 * Vertical velocity is read back from the character after each step so that
 * ceiling hits and physics-driven forces are reflected the next frame rather
 * than overridden by a manually tracked value.
 */
function _applyPhysicsMovement(
  state:   PlayerState,
  physics: PhysicsWorld,
  dt:      number,
): void {
  // Horizontal input → world-space velocity vector
  const fwdX =  -Math.sin(state.yaw);
  const fwdZ =  -Math.cos(state.yaw);
  const rgtX =   Math.cos(state.yaw);
  const rgtZ =  -Math.sin(state.yaw);

  let mx = 0, mz = 0;
  if (Input.isDown(Input.Action.MoveForward)) { mx += fwdX; mz += fwdZ; }
  if (Input.isDown(Input.Action.MoveBack))    { mx -= fwdX; mz -= fwdZ; }
  if (Input.isDown(Input.Action.MoveLeft))    { mx -= rgtX; mz -= rgtZ; }
  if (Input.isDown(Input.Action.MoveRight))   { mx += rgtX; mz += rgtZ; }

  const len = Math.hypot(mx, mz);
  const vx  = len > 0 ? (mx / len) * MOVE_SPEED : 0;
  const vz  = len > 0 ? (mz / len) * MOVE_SPEED : 0;

  // Read Y velocity from the character — post-collision value from last step.
  // This ensures a ceiling hit zeroes the velocity instead of fighting it.
  let vy = physics.getCharacterVelocityY();

  if (state.isGrounded) {
    vy = Math.max(0, vy);  // no downward drift while standing
  } else {
    vy -= GRAVITY * dt;    // integrate gravity while airborne
  }

  // Jump: apply upward impulse once per grounded press
  if (state.isGrounded && Input.isPressed(Input.Action.Jump)) {
    vy = JUMP_SPEED;
  }

  physics.stepCharacter(vx, vy, vz, dt);

  state.isGrounded = physics.isCharacterGrounded();
}

function _updateCameraFromPhysics(camera: RL.Camera3D, physics: PhysicsWorld): void {
  const pos = physics.getCharacterFeetPos();
  camera.position.x = pos.x;
  camera.position.y = pos.y + EYE_HEIGHT;
  camera.position.z = pos.z;
}

function _updateCameraTarget(state: PlayerState, camera: RL.Camera3D): void {
  const cp     = Math.cos(state.pitch);
  const lookX  = -Math.sin(state.yaw) * cp;
  const lookY  =  Math.sin(state.pitch);
  const lookZ  = -Math.cos(state.yaw) * cp;
  camera.target.x = camera.position.x + lookX;
  camera.target.y = camera.position.y + lookY;
  camera.target.z = camera.position.z + lookZ;
}
