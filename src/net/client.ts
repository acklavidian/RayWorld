import {
  Msg,
  encodePing, encodeJoin, encodeLeave, encodeUpdate,
  decodeWelcome, decodePlayerLeft, decodeState,
  msgType,
  PlayerSnapshot,
} from "./protocol.ts";

// ─── Incoming packet queue ────────────────────────────────────────────────────

type InPacket = { data: Uint8Array };

class PacketBuffer {
  private queue: InPacket[] = [];

  push(data: Uint8Array): void {
    this.queue.push({ data });
  }

  /** Drain and return all buffered packets since last call. */
  drain(): InPacket[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

// ─── Connection state ────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "joining"       // sent JOIN, waiting for WELCOME
  | "connected";

// ─── Client ───────────────────────────────────────────────────────────────────

export class GameClient {
  private socket:         Deno.DatagramConn | null = null;
  private buffer          = new PacketBuffer();
  private _state:         ConnectionState = "disconnected";
  private _localId        = 0;
  private serverHostname  = "";
  private serverPort      = 0;

  /** Latest snapshots received from the server (excludes local player). */
  remotePlayers: Map<number, PlayerSnapshot> = new Map();

  /** Fired when the server assigns us an ID. */
  onWelcome?: (id: number) => void;
  /** Fired when a remote player leaves. */
  onPlayerLeft?: (id: number) => void;

  get state(): ConnectionState { return this._state; }
  get localId(): number        { return this._localId; }

  /**
   * Ping a server to check availability.
   * Uses a temporary socket so it works before connect().
   * Returns true if PONG received within `timeoutMs`.
   */
  static async ping(hostname: string, port: number, timeoutMs = 1500): Promise<boolean> {
    const sock = Deno.listenDatagram({ transport: "udp", port: 0, hostname: "0.0.0.0" });
    try {
      await sock.send(encodePing(), { transport: "udp", hostname, port });
      const deadline = Date.now() + timeoutMs;
      const iter = sock[Symbol.asyncIterator]();
      while (Date.now() < deadline) {
        const remaining = deadline - Date.now();
        const raceResult = await Promise.race([
          iter.next(),
          new Promise<null>((r) => setTimeout(() => r(null), remaining)),
        ]);
        if (raceResult === null) break;
        const [data] = (raceResult as IteratorResult<[Uint8Array, Deno.Addr]>).value;
        if (msgType(new Uint8Array(data)) === Msg.PONG) return true;
      }
      return false;
    } finally {
      sock.close();
    }
  }

  /** Connect to a server. Sends JOIN and waits for WELCOME. Returns true on success. */
  async connect(hostname: string, port: number, timeoutMs = 3000): Promise<boolean> {
    if (this._state !== "disconnected") this.disconnect();

    this.serverHostname = hostname;
    this.serverPort     = port;
    this.socket         = Deno.listenDatagram({ transport: "udp", port: 0, hostname: "0.0.0.0" });
    this._state         = "joining";
    this.buffer         = new PacketBuffer();
    this.remotePlayers.clear();

    // Start background receive loop
    this._receiveLoop();

    // Send JOIN
    await this.socket.send(encodeJoin(), { transport: "udp", hostname, port });

    // Spin until WELCOME arrives or timeout
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && this._state === "joining") {
      await new Promise((r) => setTimeout(r, 10));
      this._processBuffer();
    }
    return this._localId > 0; // set when WELCOME received → state is "connected"
  }

  /** Call once per game frame: processes incoming packets. */
  tick(): void {
    if (this._state !== "connected") return;
    this._processBuffer();
  }

  /** Send our position to the server. */
  sendUpdate(x: number, y: number, z: number, yaw: number): void {
    if (!this.socket || this._state !== "connected") return;
    this._send(encodeUpdate(x, y, z, yaw));
  }

  /** Cleanly disconnect from the server. */
  disconnect(): void {
    if (this.socket) {
      try { this._send(encodeLeave()); } catch (_) { /* ignore */ }
      try { this.socket.close(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
    this._state = "disconnected";
    this._localId = 0;
    this.remotePlayers.clear();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _receiveLoop(): Promise<void> {
    if (!this.socket) return;
    try {
      for await (const [data, addr] of this.socket) {
        if (addr.transport !== "udp") continue;
        // Only accept packets from the server we connected to
        if (addr.hostname !== this.serverHostname || addr.port !== this.serverPort) continue;
        this.buffer.push(new Uint8Array(data));
      }
    } catch (_e) {
      // Socket closed — normal on disconnect
    }
  }

  private _processBuffer(): void {
    for (const { data } of this.buffer.drain()) {
      switch (msgType(data)) {
        case Msg.PONG:
          break;

        case Msg.WELCOME:
          if (this._state === "joining") {
            this._localId = decodeWelcome(data);
            this._state   = "connected";
            this.onWelcome?.(this._localId);
          }
          break;

        case Msg.STATE: {
          const snapshots = decodeState(data);
          const seen = new Set<number>();
          for (const snap of snapshots) {
            if (snap.id === this._localId) continue; // skip ourselves
            this.remotePlayers.set(snap.id, snap);
            seen.add(snap.id);
          }
          // Remove players absent from this snapshot
          for (const id of this.remotePlayers.keys()) {
            if (!seen.has(id)) this.remotePlayers.delete(id);
          }
          break;
        }

        case Msg.PLAYER_LEFT: {
          const id = decodePlayerLeft(data);
          this.remotePlayers.delete(id);
          this.onPlayerLeft?.(id);
          break;
        }
      }
    }
  }

  private _send(data: Uint8Array): void {
    this.socket?.send(data, {
      transport: "udp",
      hostname:  this.serverHostname,
      port:      this.serverPort,
    });
  }
}
