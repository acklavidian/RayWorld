import * as RL from "raylib";
import { PlayerSnapshot } from "./net/protocol.ts";
import { EYE_HEIGHT } from "./player.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = EYE_HEIGHT - CAPSULE_RADIUS * 2;
const CAPSULE_SLICES = 8;
const CAPSULE_RINGS  = 4;
const PLAYER_COLOR   = new RL.Color(80, 180, 255, 220);
const NAMETAG_COLOR  = new RL.Color(255, 255, 255, 200);

// Walk animation
const WALK_CYCLE_SPEED  = 4.5;  // radians per metre travelled
const LEG_HIP_HEIGHT    = 0.6;  // above foot level
const LEG_LENGTH        = 0.62;
const LEG_SWING         = 0.45; // max swing angle (radians)
const LEG_WIDTH         = 0.14; // lateral offset from centre
const ARM_SHOULDER_H    = 1.1;  // above foot level
const ARM_LENGTH        = 0.45;
const ARM_SWING         = 0.3;
const ARM_WIDTH         = 0.25; // lateral offset from centre
const LIMB_RADIUS       = 0.07;
const LIMB_SLICES       = 4;
const LIMB_RINGS        = 2;
const LIMB_COLOR        = new RL.Color(50, 120, 210, 220);

// ─── Remote player state ─────────────────────────────────────────────────────

export interface RemotePlayer {
  id:        number;
  x:         number;
  y:         number;
  z:         number;
  yaw:       number;
  walkPhase: number; // accumulated walk cycle (radians)
}

export function createRemotePlayer(snap: PlayerSnapshot): RemotePlayer {
  return { id: snap.id, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw, walkPhase: 0 };
}

export function lerpRemotePlayer(
  rp:    RemotePlayer,
  snap:  PlayerSnapshot,
  alpha: number,
): void {
  rp.x   += (snap.x   - rp.x)   * alpha;
  rp.y   += (snap.y   - rp.y)   * alpha;
  rp.z   += (snap.z   - rp.z)   * alpha;
  rp.yaw += (snap.yaw - rp.yaw) * alpha;
}

// ─── Rendering ────────────────────────────────────────────────────────────────

export function drawRemotePlayer(rp: RemotePlayer): void {
  const footY    = rp.y - EYE_HEIGHT;
  const startPos = new RL.Vector3(rp.x, footY + CAPSULE_RADIUS,                    rp.z);
  const endPos   = new RL.Vector3(rp.x, footY + CAPSULE_RADIUS + CAPSULE_HEIGHT,   rp.z);

  RL.DrawCapsule(startPos, endPos, CAPSULE_RADIUS, CAPSULE_SLICES, CAPSULE_RINGS, PLAYER_COLOR);
  RL.DrawCapsuleWires(startPos, endPos, CAPSULE_RADIUS, CAPSULE_SLICES, CAPSULE_RINGS,
    new RL.Color(40, 100, 200, 180));

  _drawLegs(rp, footY);
}

function _drawLegs(rp: RemotePlayer, footY: number): void {
  const fwdX = -Math.sin(rp.yaw);
  const fwdZ = -Math.cos(rp.yaw);
  const rgtX =  Math.cos(rp.yaw);
  const rgtZ = -Math.sin(rp.yaw);

  const legSwing = Math.sin(rp.walkPhase) * LEG_SWING;
  const hipY     = footY + LEG_HIP_HEIGHT;

  // Left leg swings forward, right leg swings back
  _drawLimb(rp.x - rgtX * LEG_WIDTH, hipY, rp.z - rgtZ * LEG_WIDTH,
            fwdX, fwdZ,  legSwing, LEG_LENGTH);
  _drawLimb(rp.x + rgtX * LEG_WIDTH, hipY, rp.z + rgtZ * LEG_WIDTH,
            fwdX, fwdZ, -legSwing, LEG_LENGTH);

  // Arms swing opposite to same-side leg
  const armSwing  = Math.sin(rp.walkPhase) * ARM_SWING;
  const shoulderY = footY + ARM_SHOULDER_H;

  _drawLimb(rp.x - rgtX * ARM_WIDTH, shoulderY, rp.z - rgtZ * ARM_WIDTH,
            fwdX, fwdZ, -armSwing, ARM_LENGTH);
  _drawLimb(rp.x + rgtX * ARM_WIDTH, shoulderY, rp.z + rgtZ * ARM_WIDTH,
            fwdX, fwdZ,  armSwing, ARM_LENGTH);
}

/**
 * Draws a single limb capsule hanging from `(ox, oy, oz)` and swinging
 * forward/back by `swingAngle` radians around the right-hand axis.
 */
function _drawLimb(
  ox: number, oy: number, oz: number,
  fwdX: number, fwdZ: number,
  swingAngle: number,
  length: number,
): void {
  const ex = ox + fwdX * Math.sin(swingAngle) * length;
  const ey = oy - Math.cos(swingAngle) * length;
  const ez = oz + fwdZ * Math.sin(swingAngle) * length;
  RL.DrawCapsule(
    new RL.Vector3(ox, oy, oz),
    new RL.Vector3(ex, ey, ez),
    LIMB_RADIUS, LIMB_SLICES, LIMB_RINGS, LIMB_COLOR,
  );
}

// ─── Update + draw all remote players ────────────────────────────────────────

export function updateAndDrawRemotePlayers(
  remotes:   Map<number, PlayerSnapshot>,
  rps:       Map<number, RemotePlayer>,
  lerpAlpha: number,
): void {
  // Add newly discovered players
  for (const snap of remotes.values()) {
    if (!rps.has(snap.id)) rps.set(snap.id, createRemotePlayer(snap));
  }

  // Remove players that left
  for (const id of rps.keys()) {
    if (!remotes.has(id)) rps.delete(id);
  }

  // Lerp, advance walk cycle, and draw
  for (const rp of rps.values()) {
    const snap = remotes.get(rp.id);
    if (snap) {
      const prevX = rp.x, prevZ = rp.z;
      lerpRemotePlayer(rp, snap, lerpAlpha);
      const moved = Math.hypot(rp.x - prevX, rp.z - prevZ);
      rp.walkPhase += moved * WALK_CYCLE_SPEED;
    }
    drawRemotePlayer(rp);
  }
}

// ─── Nametags ─────────────────────────────────────────────────────────────────

export function drawNametags(
  rps:    Map<number, RemotePlayer>,
  camera: RL.Camera3D,
): void {
  for (const rp of rps.values()) {
    const worldPos = new RL.Vector3(
      rp.x,
      rp.y - EYE_HEIGHT + CAPSULE_HEIGHT + CAPSULE_RADIUS * 2 + 0.2,
      rp.z,
    );
    const screen = RL.GetWorldToScreen(worldPos, camera);
    if (screen.x < 0 || screen.y < 0) continue;
    const label = `P${rp.id}`;
    const w     = RL.MeasureText(label, 14);
    RL.DrawText(label, screen.x - w / 2 | 0, screen.y | 0, 14, NAMETAG_COLOR);
  }
}
