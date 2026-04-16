import * as RL from "raylib";

// ─── Colours ─────────────────────────────────────────────────────────────────

const C_BG         = new RL.Color(30,  30,  40,  230);
const C_BORDER     = new RL.Color(100, 100, 130, 255);
const C_HOVER      = new RL.Color(60,  60,  90,  255);
const C_ACTIVE     = new RL.Color(80,  120, 200, 255);
const C_TEXT       = new RL.Color(220, 220, 220, 255);
const C_TEXT_DIM   = new RL.Color(140, 140, 160, 255);
const C_INPUT_BG   = new RL.Color(20,  20,  30,  255);
const C_CURSOR     = new RL.Color(180, 180, 255, 200);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Rect { x: number; y: number; w: number; h: number; }

// ─── Hit testing ─────────────────────────────────────────────────────────────

function mouseInRect(r: Rect): boolean {
  const m = RL.GetMousePosition();
  return m.x >= r.x && m.x <= r.x + r.w && m.y >= r.y && m.y <= r.y + r.h;
}

// ─── Button ───────────────────────────────────────────────────────────────────

/**
 * Immediate-mode button.
 * Returns true on the frame the left mouse button is released inside the rect.
 */
export function Button(label: string, r: Rect, enabled = true): boolean {
  const hover   = enabled && mouseInRect(r);
  const pressed = hover && RL.IsMouseButtonDown(RL.MouseButton.LEFT);
  const clicked = hover && RL.IsMouseButtonReleased(RL.MouseButton.LEFT);

  const bg = pressed ? C_ACTIVE : hover ? C_HOVER : C_BG;
  RL.DrawRectangle(r.x, r.y, r.w, r.h, bg);
  RL.DrawRectangleLines(r.x, r.y, r.w, r.h, C_BORDER);

  const fontSize = 16;
  const tw = RL.MeasureText(label, fontSize);
  const tx = r.x + (r.w - tw) / 2 | 0;
  const ty = r.y + (r.h - fontSize) / 2 | 0;
  RL.DrawText(label, tx, ty, fontSize, enabled ? C_TEXT : C_TEXT_DIM);

  return clicked && enabled;
}

// ─── TextInput ────────────────────────────────────────────────────────────────

export interface TextInputState {
  text:    string;
  focused: boolean;
  cursor:  number; // caret position (chars from start)
}

export function createTextInput(initial = ""): TextInputState {
  return { text: initial, focused: false, cursor: initial.length };
}

/**
 * Immediate-mode single-line text input.
 * Click to focus; type to append; Backspace to delete; Enter to confirm.
 * Returns true when the user presses Enter.
 */
export function TextInput(state: TextInputState, r: Rect, placeholder = ""): boolean {
  // Focus / blur on click
  if (RL.IsMouseButtonPressed(RL.MouseButton.LEFT)) {
    state.focused = mouseInRect(r);
    if (state.focused) state.cursor = state.text.length;
  }

  let submitted = false;

  if (state.focused) {
    // Character input
    let ch: string;
    while ((ch = RL.GetCharPressed()) !== "") {
      state.text   = state.text.slice(0, state.cursor) + ch + state.text.slice(state.cursor);
      state.cursor++;
    }

    // Backspace
    if (RL.IsKeyPressed(RL.KeyboardKey.BACKSPACE) || RL.IsKeyDown(RL.KeyboardKey.BACKSPACE)) {
      if (state.cursor > 0) {
        state.text   = state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor);
        state.cursor--;
      }
    }

    // Left / Right cursor movement
    if (RL.IsKeyPressed(RL.KeyboardKey.LEFT)) {
      state.cursor = Math.max(0, state.cursor - 1);
    }
    if (RL.IsKeyPressed(RL.KeyboardKey.RIGHT)) {
      state.cursor = Math.min(state.text.length, state.cursor + 1);
    }

    // Enter = submit
    if (RL.IsKeyPressed(RL.KeyboardKey.ENTER)) {
      submitted = true;
      state.focused = false;
    }
  }

  // Draw background
  RL.DrawRectangle(r.x, r.y, r.w, r.h, C_INPUT_BG);
  RL.DrawRectangleLines(r.x, r.y, r.w, r.h, state.focused ? C_ACTIVE : C_BORDER);

  const fontSize = 16;
  const pad = 6;
  const displayText = state.text.length > 0 ? state.text : "";
  const showPlaceholder = displayText.length === 0 && !state.focused;

  RL.DrawText(
    showPlaceholder ? placeholder : displayText,
    r.x + pad,
    r.y + (r.h - fontSize) / 2 | 0,
    fontSize,
    showPlaceholder ? C_TEXT_DIM : C_TEXT,
  );

  // Draw cursor
  if (state.focused && (Date.now() / 500 | 0) % 2 === 0) {
    const cursorX = r.x + pad + RL.MeasureText(state.text.slice(0, state.cursor), fontSize);
    const cursorY = r.y + (r.h - fontSize) / 2 | 0;
    RL.DrawLine(cursorX, cursorY, cursorX, cursorY + fontSize, C_CURSOR);
  }

  return submitted;
}

// ─── Label ────────────────────────────────────────────────────────────────────

export function Label(text: string, x: number, y: number, fontSize = 16, color?: RL.Color): void {
  RL.DrawText(text, x, y, fontSize, color ?? C_TEXT);
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function Panel(r: Rect): void {
  RL.DrawRectangle(r.x, r.y, r.w, r.h, C_BG);
  RL.DrawRectangleLines(r.x, r.y, r.w, r.h, C_BORDER);
}
