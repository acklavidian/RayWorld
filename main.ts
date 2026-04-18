import * as RL from "raylib";
import { createShadowMap, destroyShadowMap } from "./src/shadow.ts";
import { App } from "./src/app.ts";

// ─── Init window ─────────────────────────────────────────────────────────────

RL.InitWindow(1280, 720, "3D Scene");
RL.SetTargetFPS(60);
RL.SetExitKey(RL.KeyboardKey.NULL);

// ─── Shadow map (persistent across sessions) ────────────────────────────────

const lightPos    = new RL.Vector3(50, 80, 40);
const lightTarget = new RL.Vector3(0, 0, 0);
const shadow      = createShadowMap(lightPos, lightTarget, 2048, 50.0);

// ─── App ─────────────────────────────────────────────────────────────────────

const app = new App(shadow);

while (!RL.WindowShouldClose()) {
  await new Promise((r) => setTimeout(r, 0));
  const running = await app.frame();
  if (!running) break;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

app.destroy();
destroyShadowMap(shadow);
RL.CloseWindow();
