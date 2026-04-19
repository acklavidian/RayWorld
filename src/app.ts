import * as RL from "raylib";
import { ShadowMap } from "./shadow.ts";
import { createPauseSettings, PauseSettings } from "./ui/pause_menu.ts";
import { drawMainMenu } from "./ui/menu.ts";
import { createBrowserState, drawBrowser, BrowserState } from "./ui/browser.ts";
import { GAME_PORT } from "./net/protocol.ts";
import { GameSession } from "./game_session.ts";

// ─── App state machine ──────────────────────────────────────────────────────

type AppState = "MAIN_MENU" | "SERVER_BROWSER" | "CONNECTING" | "PLAYING";

export class App {
  private state:    AppState = "MAIN_MENU";
  private shadow:   ShadowMap;
  private settings: PauseSettings;

  // Session (PLAYING state)
  private session: GameSession | null = null;

  // Browser state
  private browserState: BrowserState | null = null;

  // Connecting state
  private connectingPromise: Promise<boolean> | null = null;
  private statusMsg = "";

  constructor(shadow: ShadowMap) {
    this.shadow   = shadow;
    this.settings = createPauseSettings();
  }

  // ── Main frame dispatch ──────────────────────────────────────────────────────

  /** Returns false when the app should exit. */
  async frame(): Promise<boolean> {
    const dt = RL.GetFrameTime();

    switch (this.state) {
      case "MAIN_MENU":      return this._frameMainMenu();
      case "SERVER_BROWSER":  return this._frameBrowser();
      case "CONNECTING":      return await this._frameConnecting();
      case "PLAYING":         return await this._framePlaying(dt);
    }
  }

  // ── MAIN_MENU ──────────────────────────────────────────────────────────────

  private _frameMainMenu(): boolean {
    RL.BeginDrawing();
    const choice = drawMainMenu();
    RL.EndDrawing();

    if (choice?.action === "exit") {
      return false;
    } else if (choice?.action === "host") {
      this._startHost();
    } else if (choice?.action === "test_map") {
      this._startTestMap();
    } else if (choice?.action === "browse") {
      this.browserState = createBrowserState();
      this.state = "SERVER_BROWSER";
    }
    return true;
  }

  // ── SERVER_BROWSER ─────────────────────────────────────────────────────────

  private _frameBrowser(): boolean {
    RL.BeginDrawing();
    const result = drawBrowser(this.browserState!);
    RL.EndDrawing();

    if (result?.action === "connect") {
      this._startConnect(result.hostname, result.port);
    } else if (result?.action === "back") {
      this.state = "MAIN_MENU";
    }
    return true;
  }

  // ── CONNECTING ─────────────────────────────────────────────────────────────

  private async _frameConnecting(): Promise<boolean> {
    RL.BeginDrawing();
    RL.ClearBackground(new RL.Color(15, 15, 25, 255));
    RL.DrawText(this.statusMsg, 20, RL.GetScreenHeight() / 2 | 0, 20, new RL.Color(220, 220, 220, 255));
    RL.EndDrawing();

    const raceResult = await Promise.race([
      this.connectingPromise!,
      new Promise<"pending">((r) => setTimeout(() => r("pending"), 0)),
    ]);

    if (raceResult === true) {
      console.log(`[client] connected as player ${this.session!.client!.localId}`);
      this._enterPlaying();
    } else if (raceResult === false) {
      console.warn("[client] connection failed");
      this.session?.destroy();
      this.session = null;
      this.state = "MAIN_MENU";
    }
    return true;
  }

  // ── PLAYING ────────────────────────────────────────────────────────────────

  private async _framePlaying(dt: number): Promise<boolean> {
    if (!this.session) { this.state = "MAIN_MENU"; return true; }

    // Check hot-reload
    await this.session.checkHotReload();

    const result = this.session.update(dt);
    if (result.action === "exit_to_menu") {
      this.session.destroy();
      this.session = null;
      this.state = "MAIN_MENU";
    }
    return true;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async _startHost(mapPath?: string): Promise<void> {
    this.session = await GameSession.create(this.shadow, this.settings, mapPath);
    this.session.startFileWatcher();
    this.state = "CONNECTING";
    this.connectingPromise = this.session.startHost(GAME_PORT);
    this.statusMsg = "Starting server…";
  }

  private async _startTestMap(): Promise<void> {
    this.session = await GameSession.create(
      this.shadow, this.settings, "data/modular/example_test_corridor_map.json",
    );
    // No networking for test map — go straight to playing
    this._enterPlaying();
  }

  private async _startConnect(hostname: string, port: number): Promise<void> {
    this.session = await GameSession.create(this.shadow, this.settings);
    this.session.startFileWatcher();
    this.state = "CONNECTING";
    this.connectingPromise = this.session.joinServer(hostname, port);
    this.statusMsg = `Connecting to ${hostname}:${port}…`;
  }

  private _enterPlaying(): void {
    this.state = "PLAYING";
    RL.DisableCursor();
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  destroy(): void {
    this.session?.destroy();
    this.session = null;
  }
}
