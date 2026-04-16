import * as RL from "raylib";
import { GameClient } from "../net/client.ts";
import { GAME_PORT } from "../net/protocol.ts";
import { Button, TextInput, Panel, Label, createTextInput, TextInputState, Rect } from "./widgets.ts";

// ─── Result ───────────────────────────────────────────────────────────────────

export type BrowserResult =
  | { action: "connect"; hostname: string; port: number }
  | { action: "back" }
  | null; // still browsing

// ─── State ────────────────────────────────────────────────────────────────────

export interface BrowserState {
  hostnameInput: TextInputState;
  portInput:     TextInputState;
  statusMsg:     string;
  statusOk:      boolean;
  pinging:       boolean;
  recentServers: Array<{ hostname: string; port: number }>;
}

export function createBrowserState(): BrowserState {
  return {
    hostnameInput: createTextInput("127.0.0.1"),
    portInput:     createTextInput(String(GAME_PORT)),
    statusMsg:     "",
    statusOk:      false,
    pinging:       false,
    recentServers: [],
  };
}

// ─── Browser screen ───────────────────────────────────────────────────────────

/**
 * Draws the server browser for one frame.
 * `pingInFlight` indicates an async ping is running (disables Ping button).
 * Returns a BrowserResult when the user commits an action, or null to stay.
 */
export function drawBrowser(state: BrowserState): BrowserResult {
  const sw = RL.GetScreenWidth();
  const sh = RL.GetScreenHeight();

  RL.ClearBackground(new RL.Color(15, 15, 25, 255));

  // Panel
  const pw = 480, ph = 340;
  const px = (sw - pw) / 2 | 0;
  const py = (sh - ph) / 2 | 0;
  const panel: Rect = { x: px, y: py, w: pw, h: ph };
  Panel(panel);

  // Title
  Label("Join a Server", px + 16, py + 16, 22);

  let cy = py + 52;

  // Hostname
  Label("Server IP / Hostname", px + 16, cy, 14, new RL.Color(160, 160, 190, 255));
  cy += 20;
  TextInput(state.hostnameInput, { x: px + 16, y: cy, w: pw - 32, h: 34 }, "127.0.0.1");
  cy += 44;

  // Port
  Label("Port", px + 16, cy, 14, new RL.Color(160, 160, 190, 255));
  cy += 20;
  TextInput(state.portInput, { x: px + 16, y: cy, w: 120, h: 34 }, String(GAME_PORT));
  cy += 44;

  // Status message
  if (state.statusMsg.length > 0) {
    RL.DrawText(
      state.statusMsg, px + 16, cy, 14,
      state.statusOk
        ? new RL.Color(80, 200, 100, 255)
        : new RL.Color(220, 80, 80, 255),
    );
  }
  cy += 24;

  // Buttons row
  const btnH = 38, btnW = 120, gap = 10;
  let bx = px + 16;

  let result: BrowserResult = null;

  // Ping button
  if (Button(state.pinging ? "Pinging…" : "Ping", { x: bx, y: cy, w: btnW, h: btnH }, !state.pinging)) {
    const hostname = state.hostnameInput.text.trim();
    const port     = parseInt(state.portInput.text.trim(), 10) || GAME_PORT;
    state.pinging  = true;
    state.statusMsg = "Pinging…";
    state.statusOk  = false;
    // Kick off async ping — result delivered next frames via flag polling
    GameClient.ping(hostname, port).then((ok) => {
      state.pinging   = false;
      state.statusMsg = ok ? `Server at ${hostname}:${port} is online` : "No response (server offline or wrong address)";
      state.statusOk  = ok;
    });
  }
  bx += btnW + gap;

  // Connect button
  if (Button("Connect", { x: bx, y: cy, w: btnW, h: btnH })) {
    const hostname = state.hostnameInput.text.trim();
    const port     = parseInt(state.portInput.text.trim(), 10) || GAME_PORT;
    if (hostname.length > 0) {
      // Track recent
      const existing = state.recentServers.findIndex(
        (s) => s.hostname === hostname && s.port === port,
      );
      if (existing !== -1) state.recentServers.splice(existing, 1);
      state.recentServers.unshift({ hostname, port });
      if (state.recentServers.length > 5) state.recentServers.length = 5;
      result = { action: "connect", hostname, port };
    }
  }
  bx += btnW + gap;

  // Back
  if (Button("Back", { x: bx, y: cy, w: btnW, h: btnH })) {
    result = { action: "back" };
  }

  // Recent servers list
  if (state.recentServers.length > 0) {
    const ry = py + ph + 16;
    Label("Recent servers:", px, ry, 14, new RL.Color(140, 140, 160, 200));
    for (let i = 0; i < state.recentServers.length; i++) {
      const s   = state.recentServers[i];
      const lbl = `${s.hostname}:${s.port}`;
      const rr: Rect = { x: px, y: ry + 20 + i * 30, w: pw, h: 26 };
      if (Button(lbl, rr)) {
        state.hostnameInput.text   = s.hostname;
        state.hostnameInput.cursor = s.hostname.length;
        state.portInput.text       = String(s.port);
        state.portInput.cursor     = String(s.port).length;
      }
    }
  }

  return result;
}
