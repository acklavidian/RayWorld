// ─── Protocol constants ───────────────────────────────────────────────────────

export const GAME_PORT  = 7777;
export const MAX_PLAYERS = 8;

// ─── Message type IDs ────────────────────────────────────────────────────────

export const enum Msg {
  PING        = 1, // client → server: "are you there?"
  PONG        = 2, // server → client: "yes"
  JOIN        = 3, // client → server: request to join
  WELCOME     = 4, // server → client: u8 assigned_id
  UPDATE      = 5, // client → server: f32 x, y, z, yaw
  STATE       = 6, // server → client: u8 count, then per-player data
  LEAVE       = 7, // client → server: clean disconnect
  PLAYER_LEFT = 8, // server → client: u8 player_id
}

// ─── Packet sizes ────────────────────────────────────────────────────────────

/** [type(1)] */
export const PING_SIZE   = 1;
/** [type(1)] */
export const PONG_SIZE   = 1;
/** [type(1)] */
export const JOIN_SIZE   = 1;
/** [type(1), id(1)] */
export const WELCOME_SIZE = 2;
/** [type(1), x(4), y(4), z(4), yaw(4)] */
export const UPDATE_SIZE  = 17;
/** [type(1), id(1)] */
export const PLAYER_LEFT_SIZE = 2;
/** [type(1)] */
export const LEAVE_SIZE  = 1;
/** [type(1), count(1), (id(1)+x(4)+y(4)+z(4)+yaw(4))*count] */
export const stateSize = (count: number) => 2 + count * 17;

// ─── Per-player snapshot inside a STATE packet ───────────────────────────────

export interface PlayerSnapshot {
  id:  number;
  x:   number;
  y:   number;
  z:   number;
  yaw: number;
}

// ─── Encoders ────────────────────────────────────────────────────────────────

export function encodePing():  Uint8Array { return new Uint8Array([Msg.PING]); }
export function encodePong():  Uint8Array { return new Uint8Array([Msg.PONG]); }
export function encodeJoin():  Uint8Array { return new Uint8Array([Msg.JOIN]); }
export function encodeLeave(): Uint8Array { return new Uint8Array([Msg.LEAVE]); }

export function encodeWelcome(id: number): Uint8Array {
  return new Uint8Array([Msg.WELCOME, id]);
}

export function encodePlayerLeft(id: number): Uint8Array {
  return new Uint8Array([Msg.PLAYER_LEFT, id]);
}

export function encodeUpdate(x: number, y: number, z: number, yaw: number): Uint8Array {
  const buf = new Uint8Array(UPDATE_SIZE);
  const dv  = new DataView(buf.buffer);
  dv.setUint8(0, Msg.UPDATE);
  dv.setFloat32(1,  x,   true);
  dv.setFloat32(5,  y,   true);
  dv.setFloat32(9,  z,   true);
  dv.setFloat32(13, yaw, true);
  return buf;
}

export function encodeState(players: PlayerSnapshot[]): Uint8Array {
  const count = Math.min(players.length, MAX_PLAYERS);
  const buf   = new Uint8Array(stateSize(count));
  const dv    = new DataView(buf.buffer);
  dv.setUint8(0, Msg.STATE);
  dv.setUint8(1, count);
  let off = 2;
  for (let i = 0; i < count; i++) {
    const p = players[i];
    dv.setUint8(off,      p.id);
    dv.setFloat32(off + 1, p.x,   true);
    dv.setFloat32(off + 5, p.y,   true);
    dv.setFloat32(off + 9, p.z,   true);
    dv.setFloat32(off + 13, p.yaw, true);
    off += 17;
  }
  return buf;
}

// ─── Decoders ────────────────────────────────────────────────────────────────

/** Returns the message type byte, or 0 if the buffer is empty. */
export function msgType(data: Uint8Array): number {
  return data.length > 0 ? data[0] : 0;
}

export function decodeWelcome(data: Uint8Array): number {
  return data[1];
}

export function decodePlayerLeft(data: Uint8Array): number {
  return data[1];
}

export function decodeUpdate(data: Uint8Array): { x: number; y: number; z: number; yaw: number } {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    x:   dv.getFloat32(1,  true),
    y:   dv.getFloat32(5,  true),
    z:   dv.getFloat32(9,  true),
    yaw: dv.getFloat32(13, true),
  };
}

export function decodeState(data: Uint8Array): PlayerSnapshot[] {
  const dv     = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count  = dv.getUint8(1);
  const result: PlayerSnapshot[] = [];
  let off = 2;
  for (let i = 0; i < count; i++) {
    result.push({
      id:  dv.getUint8(off),
      x:   dv.getFloat32(off + 1,  true),
      y:   dv.getFloat32(off + 5,  true),
      z:   dv.getFloat32(off + 9,  true),
      yaw: dv.getFloat32(off + 13, true),
    });
    off += 17;
  }
  return result;
}
