import * as RL from "raylib";
import { Button, Slider, Toggle, Panel, Label, Rect } from "./widgets.ts";
import { LOOK_SENSITIVITY } from "../player.ts";

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface PauseSettings {
  sensitivity:          number;  // multiplier applied to LOOK_SENSITIVITY (default 1.0)
  fov:                  number;  // degrees (default 70)
  invertY:              boolean;
  showColliderWireframes: boolean; // debug: draw physics collider outlines
}

export function createPauseSettings(): PauseSettings {
  return { sensitivity: 1.0, fov: 70, invertY: false, showColliderWireframes: false };
}

// ─── State ────────────────────────────────────────────────────────────────────

type PauseView = "main" | "settings";

export interface PauseMenuState {
  view:     PauseView;
  settings: PauseSettings;
}

export function createPauseMenuState(settings: PauseSettings): PauseMenuState {
  return { view: "main", settings };
}

// ─── Result ───────────────────────────────────────────────────────────────────

export type PauseMenuResult =
  | { action: "resume" }
  | { action: "exit_to_menu" }
  | null; // still showing menu

// ─── Draw ─────────────────────────────────────────────────────────────────────

/**
 * Draws the pause menu overlay for one frame.
 * Returns a PauseMenuResult when the user picks an action, null otherwise.
 */
export function drawPauseMenu(state: PauseMenuState): PauseMenuResult {
  // Semi-transparent backdrop over the scene
  RL.DrawRectangle(0, 0, RL.GetScreenWidth(), RL.GetScreenHeight(),
    new RL.Color(0, 0, 0, 140));

  if (state.view === "settings") {
    _drawSettings(state);
    return null;
  }
  return _drawMain(state);
}

// ─── Main view ────────────────────────────────────────────────────────────────

function _drawMain(state: PauseMenuState): PauseMenuResult {
  const sw = RL.GetScreenWidth();
  const sh = RL.GetScreenHeight();

  const pw = 300, ph = 248;
  const px = ((sw - pw) / 2) | 0;
  const py = ((sh - ph) / 2) | 0;
  Panel({ x: px, y: py, w: pw, h: ph });

  const title = "PAUSED";
  Label(title, (px + (pw - RL.MeasureText(title, 24)) / 2) | 0, py + 16, 24);

  const btnW = 240, btnH = 44, gap = 12;
  const bx = (px + (pw - btnW) / 2) | 0;
  let by = py + 56;

  if (Button("Resume", { x: bx, y: by, w: btnW, h: btnH })) {
    return { action: "resume" };
  }
  by += btnH + gap;

  if (Button("Settings", { x: bx, y: by, w: btnW, h: btnH })) {
    state.view = "settings";
  }
  by += btnH + gap;

  if (Button("Exit to Main Menu", { x: bx, y: by, w: btnW, h: btnH })) {
    return { action: "exit_to_menu" };
  }

  return null;
}

// ─── Settings view ────────────────────────────────────────────────────────────

function _drawSettings(state: PauseMenuState): void {
  const sw = RL.GetScreenWidth();
  const sh = RL.GetScreenHeight();
  const s  = state.settings;

  const pw = 420, ph = 356;
  const px = ((sw - pw) / 2) | 0;
  const py = ((sh - ph) / 2) | 0;
  Panel({ x: px, y: py, w: pw, h: ph });

  const title = "Settings";
  Label(title, (px + (pw - RL.MeasureText(title, 22)) / 2) | 0, py + 14, 22);

  const sliderW = pw - 64;
  const sliderX = px + 32;
  let cy = py + 52;

  // ── Mouse Sensitivity ──────────────────────────────────────────────────────
  const sensDeg = s.sensitivity.toFixed(1);
  Label(`Mouse Sensitivity  ${sensDeg}×`,
    sliderX, cy, 14, new RL.Color(160, 160, 190, 255));
  cy += 20;
  s.sensitivity = Slider(s.sensitivity, 0.1, 5.0,
    { x: sliderX, y: cy, w: sliderW, h: 32 });
  cy += 46;

  // ── Field of View ──────────────────────────────────────────────────────────
  const fovDeg = Math.round(s.fov);
  Label(`Field of View  ${fovDeg}°`,
    sliderX, cy, 14, new RL.Color(160, 160, 190, 255));
  cy += 20;
  s.fov = Slider(s.fov, 60, 110,
    { x: sliderX, y: cy, w: sliderW, h: 32 });
  cy += 46;

  // ── Invert Y ───────────────────────────────────────────────────────────────
  s.invertY = Toggle("Invert Y Look", s.invertY,
    { x: sliderX, y: cy, w: sliderW, h: 38 });
  cy += 52;

  // ── Physics Collider Wireframes ────────────────────────────────────────────
  s.showColliderWireframes = Toggle("Show Collider Wireframes", s.showColliderWireframes,
    { x: sliderX, y: cy, w: sliderW, h: 38 });
  cy += 52;

  // ── Back ───────────────────────────────────────────────────────────────────
  const btnW = 160;
  if (Button("Back", { x: (px + (pw - btnW) / 2) | 0, y: cy, w: btnW, h: 38 })) {
    state.view = "main";
  }
}
