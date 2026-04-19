import * as RL from "raylib";
import { Button, Panel, Label, Rect } from "./widgets.ts";

// ─── Result ───────────────────────────────────────────────────────────────────

export type MainMenuResult =
  | { action: "host" }
  | { action: "browse" }
  | { action: "test_map" }
  | { action: "exit" }
  | null; // still on the menu

// ─── Main menu ────────────────────────────────────────────────────────────────

/**
 * Draws the main menu for one frame.
 * Call every frame while in the MAIN_MENU state.
 * Returns the user's choice, or null if they haven't chosen yet.
 */
export function drawMainMenu(): MainMenuResult {
  const sw = RL.GetScreenWidth();
  const sh = RL.GetScreenHeight();

  // Backdrop
  RL.ClearBackground(new RL.Color(15, 15, 25, 255));

  // Title
  const title     = "3D Scene";
  const titleSize = 48;
  const tw        = RL.MeasureText(title, titleSize);
  RL.DrawText(title, (sw - tw) / 2 | 0, sh / 4 | 0, titleSize, new RL.Color(200, 220, 255, 255));

  const subtitle     = "Multiplayer Demo";
  const subtitleSize = 20;
  const stw          = RL.MeasureText(subtitle, subtitleSize);
  RL.DrawText(subtitle, (sw - stw) / 2 | 0, sh / 4 + titleSize + 8 | 0, subtitleSize,
    new RL.Color(140, 150, 180, 200));

  // Buttons
  const btnW = 260, btnH = 48, gap = 14;
  const bx = (sw - btnW) / 2 | 0;
  const by = sh / 2 | 0;

  const panelPad = 24;
  const panelH   = (btnH + gap) * 4 + panelPad * 2 - gap;
  const panel: Rect = { x: bx - panelPad, y: by - panelPad, w: btnW + panelPad * 2, h: panelH };
  Panel(panel);

  if (Button("Host Game", { x: bx, y: by, w: btnW, h: btnH })) {
    return { action: "host" };
  }

  if (Button("Join Game (Browse)", { x: bx, y: by + btnH + gap, w: btnW, h: btnH })) {
    return { action: "browse" };
  }

  if (Button("Test Map", { x: bx, y: by + (btnH + gap) * 2, w: btnW, h: btnH })) {
    return { action: "test_map" };
  }

  if (Button("Exit Game", { x: bx, y: by + (btnH + gap) * 3, w: btnW, h: btnH })) {
    return { action: "exit" };
  }

  return null;
}
