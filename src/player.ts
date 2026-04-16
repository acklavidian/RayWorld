import * as RL from "raylib";
import * as Input from "./input.ts";
import { navHeight, NavTri } from "./navmesh.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

export const EYE_HEIGHT      = 1.75;  // metres above nav surface
export const MOVE_SPEED      = 5.0;   // m/s horizontal
export const LOOK_SENSITIVITY  = 0.002; // radians per pixel (base — multiplied by settings)
export const JUMP_SPEED      = 6.5;   // m/s initial upward velocity
export const GRAVITY         = 18.0;  // m/s² downward acceleration

// ─── State ────────────────────────────────────────────────────────────────────

export interface PlayerState {
  yaw:        number; // horizontal look angle (radians)
  pitch:      number; // vertical look angle (radians, clamped)
  velY:       number; // vertical velocity (m/s, positive = up)
  isGrounded: boolean;
}

export function createPlayerState(): PlayerState {
  return { yaw: 0, pitch: 0, velY: 0, isGrounded: true };
}

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Full player tick: mouse look → horizontal movement with wall-slide collision
 * → jump / gravity → ground snap → camera target.
 *
 * Modifies `state` and `camera` in place.
 */
export function updatePlayer(
  state:       PlayerState,
  camera:      RL.Camera3D,
  navTris:     NavTri[],
  dt:          number,
  sensitivity: number = 1.0,
  invertY:     boolean = false,
): void {
  _applyLook(state, camera, sensitivity, invertY);
  _applyMovement(state, camera, navTris, dt);
  _applyVertical(state, camera, navTris, dt);
  _updateCameraTarget(state, camera);
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function _applyLook(
  state:       PlayerState,
  _camera:     RL.Camera3D,
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
 * Horizontal movement with three-step wall-slide collision:
 *   1. Try full (dx, dz) move.
 *   2. If blocked, try X-axis slide (dx, 0).
 *   3. If still blocked, try Z-axis slide (0, dz).
 *
 * Each attempt checks that the destination lies on the nav mesh.
 * When no nav mesh is loaded all movement is free.
 */
function _applyMovement(
  state:   PlayerState,
  camera:  RL.Camera3D,
  navTris: NavTri[],
  dt:      number,
): void {
  const fwdX = -Math.sin(state.yaw);
  const fwdZ = -Math.cos(state.yaw);
  const rgtX =  Math.cos(state.yaw);
  const rgtZ = -Math.sin(state.yaw);

  let mx = 0, mz = 0;
  if (Input.isDown(Input.Action.MoveForward)) { mx += fwdX; mz += fwdZ; }
  if (Input.isDown(Input.Action.MoveBack))    { mx -= fwdX; mz -= fwdZ; }
  if (Input.isDown(Input.Action.MoveLeft))    { mx -= rgtX; mz -= rgtZ; }
  if (Input.isDown(Input.Action.MoveRight))   { mx += rgtX; mz += rgtZ; }

  const len = Math.hypot(mx, mz);
  if (len === 0) return;

  const step = MOVE_SPEED * dt / len;
  const dx   = mx * step;
  const dz   = mz * step;
  const ox   = camera.position.x;
  const oz   = camera.position.z;

  const onNav = (x: number, z: number) =>
    navTris.length === 0 || navHeight(navTris, x, z) !== null;

  if (onNav(ox + dx, oz + dz)) {
    // Full move
    camera.position.x = ox + dx;
    camera.position.z = oz + dz;
  } else if (onNav(ox + dx, oz)) {
    // Slide along X wall — preserve Z
    camera.position.x = ox + dx;
  } else if (onNav(ox, oz + dz)) {
    // Slide along Z wall — preserve X
    camera.position.z = oz + dz;
  }
  // else: fully blocked, no movement this frame
}

/**
 * Vertical axis: jumping, gravity, and ground landing.
 * Jump is triggered once per grounded press of the Jump action.
 */
function _applyVertical(
  state:   PlayerState,
  camera:  RL.Camera3D,
  navTris: NavTri[],
  dt:      number,
): void {
  // Initiate jump
  if (state.isGrounded && Input.isPressed(Input.Action.Jump)) {
    state.velY      = JUMP_SPEED;
    state.isGrounded = false;
  }

  // Apply gravity and integrate position
  state.velY        -= GRAVITY * dt;
  camera.position.y += state.velY * dt;

  // Ground collision: land when feet reach (or pass through) the nav surface
  const gy = navTris.length > 0
    ? navHeight(navTris, camera.position.x, camera.position.z)
    : null;

  if (gy !== null && camera.position.y <= gy + EYE_HEIGHT) {
    camera.position.y = gy + EYE_HEIGHT;
    state.velY        = 0;
    state.isGrounded  = true;
  } else if (gy === null) {
    // Off the nav mesh (e.g. walked to edge while jumping): treat as airborne.
    state.isGrounded = false;
  }
}

function _updateCameraTarget(state: PlayerState, camera: RL.Camera3D): void {
  const cp = Math.cos(state.pitch);
  const lookX = -Math.sin(state.yaw) * cp;
  const lookY =  Math.sin(state.pitch);
  const lookZ = -Math.cos(state.yaw) * cp;
  camera.target.x = camera.position.x + lookX;
  camera.target.y = camera.position.y + lookY;
  camera.target.z = camera.position.z + lookZ;
}
