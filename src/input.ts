import * as RL from "raylib";

// ─── Actions ──────────────────────────────────────────────────────────────────

/** Every logical action the player can perform. */
export enum Action {
  MoveForward,
  MoveBack,
  MoveLeft,
  MoveRight,
  Jump,
}

// ─── Key bindings ─────────────────────────────────────────────────────────────

/**
 * Rebindable map from Action → KeyboardKey.
 * Change a binding at runtime: `keyBindings.set(Action.Jump, RL.KeyboardKey.E)`
 */
export const keyBindings = new Map<Action, RL.KeyboardKey>([
  [Action.MoveForward, RL.KeyboardKey.W],
  [Action.MoveBack,    RL.KeyboardKey.S],
  [Action.MoveLeft,    RL.KeyboardKey.A],
  [Action.MoveRight,   RL.KeyboardKey.D],
  [Action.Jump,        RL.KeyboardKey.SPACE],
]);

// ─── Query helpers ────────────────────────────────────────────────────────────

/** True every frame the action's key is held down. */
export function isDown(action: Action): boolean {
  const key = keyBindings.get(action);
  return key !== undefined && RL.IsKeyDown(key);
}

/**
 * True only on the first frame the action's key is pressed.
 * Use for single-shot triggers like jumping.
 */
export function isPressed(action: Action): boolean {
  const key = keyBindings.get(action);
  return key !== undefined && RL.IsKeyPressed(key);
}

/** Returns raw mouse delta in pixels for this frame. */
export function getMouseDelta(): { dx: number; dy: number } {
  const md = RL.GetMouseDelta();
  return { dx: md.x, dy: md.y };
}
