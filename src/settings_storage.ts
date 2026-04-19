import { createPauseSettings, PauseSettings } from "./ui/pause_menu.ts";

const SETTINGS_PATH = "./rayworld_settings.json";

/**
 * Loads settings from rayworld_settings.json.
 * Missing or unrecognised fields fall back to defaults, so old files
 * remain valid after new settings are added.
 */
export function loadSettings(): PauseSettings {
  const defaults = createPauseSettings();
  try {
    const text = Deno.readTextFileSync(SETTINGS_PATH);
    const data = JSON.parse(text) as Partial<PauseSettings>;
    return { ...defaults, ...data };
  } catch {
    return defaults;
  }
}

/** Writes the current settings to rayworld_settings.json. */
export function saveSettings(s: PauseSettings): void {
  try {
    Deno.writeTextFileSync(SETTINGS_PATH, JSON.stringify(s, null, 2));
  } catch (e) {
    console.warn("[settings] failed to save:", e);
  }
}
