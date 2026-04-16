import * as RL from "raylib";
import { PlayerSnapshot } from "./net/protocol.ts";
import { EYE_HEIGHT } from "./player.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

const CAPSULE_RADIUS = 0.35;                     // metres
const CAPSULE_HEIGHT = EYE_HEIGHT - CAPSULE_RADIUS * 2; // distance between hemisphere centres
const CAPSULE_SLICES = 8;
const CAPSULE_RINGS  = 4;
const PLAYER_COLOR   = new RL.Color(80, 180, 255, 220);
const NAMETAG_COLOR  = new RL.Color(255, 255, 255, 200);

// ─── Remote player state ─────────────────────────────────────────────────────

/** Smoothed remote player state, interpolated toward the server snapshot. */
export interface RemotePlayer {
  id:  number;
  x:   number;
  y:   number;
  z:   number;
  yaw: number;
}

export function createRemotePlayer(snap: PlayerSnapshot): RemotePlayer {
  return { id: snap.id, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw };
}

/**
 * Linearly interpolates the remote player toward the latest server snapshot.
 * `alpha` in [0, 1]: fraction per frame (e.g. 0.2 → lag of ~4–5 frames at 60 Hz).
 */
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

/**
 * Draws a capsule representing the remote player.
 * The snapshot stores the camera (eye) position; the capsule foot is at
 * `y - EYE_HEIGHT` and the top cap is at `y - CAPSULE_RADIUS`.
 */
export function drawRemotePlayer(rp: RemotePlayer): void {
  // Capsule bottom centre (at foot level + radius)
  const footY   = rp.y - EYE_HEIGHT;
  const startPos = new RL.Vector3(rp.x, footY + CAPSULE_RADIUS,               rp.z);
  const endPos   = new RL.Vector3(rp.x, footY + CAPSULE_RADIUS + CAPSULE_HEIGHT, rp.z);

  RL.DrawCapsule(startPos, endPos, CAPSULE_RADIUS, CAPSULE_SLICES, CAPSULE_RINGS, PLAYER_COLOR);
  RL.DrawCapsuleWires(startPos, endPos, CAPSULE_RADIUS, CAPSULE_SLICES, CAPSULE_RINGS,
    new RL.Color(40, 100, 200, 180));
}

/**
 * Updates and draws all remote players from the client's remote player map.
 * Call this inside BeginMode3D / EndMode3D.
 */
export function updateAndDrawRemotePlayers(
  remotes:    Map<number, PlayerSnapshot>,
  rps:        Map<number, RemotePlayer>,
  lerpAlpha:  number,
): void {
  // Add newly discovered players
  for (const snap of remotes.values()) {
    if (!rps.has(snap.id)) {
      rps.set(snap.id, createRemotePlayer(snap));
    }
  }

  // Remove players that left
  for (const id of rps.keys()) {
    if (!remotes.has(id)) rps.delete(id);
  }

  // Lerp and draw
  for (const rp of rps.values()) {
    const snap = remotes.get(rp.id);
    if (snap) lerpRemotePlayer(rp, snap, lerpAlpha);
    drawRemotePlayer(rp);
  }
}

/**
 * Draws 2D nametags ("P1", "P2", …) above each remote player.
 * Call this outside BeginMode3D (in 2D drawing phase) if you have world→screen
 * projection, or skip if not needed.  Requires `camera` for GetWorldToScreen.
 */
export function drawNametags(
  rps:    Map<number, RemotePlayer>,
  camera: RL.Camera3D,
): void {
  for (const rp of rps.values()) {
    const worldPos = new RL.Vector3(rp.x, rp.y - EYE_HEIGHT + CAPSULE_HEIGHT + CAPSULE_RADIUS * 2 + 0.2, rp.z);
    const screen   = RL.GetWorldToScreen(worldPos, camera);
    if (screen.x < 0 || screen.y < 0) continue; // behind camera
    const label = `P${rp.id}`;
    const w     = RL.MeasureText(label, 14);
    RL.DrawText(label, screen.x - w / 2 | 0, screen.y | 0, 14, NAMETAG_COLOR);
  }
}
