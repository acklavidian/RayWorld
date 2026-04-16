import {
  GAME_PORT, MAX_PLAYERS, Msg,
  encodePong, encodeWelcome, encodePlayerLeft, encodeState,
  decodeUpdate, msgType,
  PlayerSnapshot,
} from "./protocol.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerPlayer {
  id:         number;
  addrKey:    string; // "hostname:port"
  hostname:   string;
  port:       number;
  x: number; y: number; z: number; yaw: number;
  lastSeen:   number; // Date.now()
}

// ─── Server ───────────────────────────────────────────────────────────────────

export class GameServer {
  private socket:   Deno.DatagramConn;
  private players:  Map<string, ServerPlayer> = new Map();
  private nextId    = 1;
  private running   = false;
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly port: number = GAME_PORT) {
    this.socket = Deno.listenDatagram({ transport: "udp", port, hostname: "0.0.0.0" });
  }

  /** Start receiving packets and broadcasting state. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this._receive();
    // Broadcast STATE to all clients at ~20 Hz
    this.interval = setInterval(() => this._broadcast(), 50);
    console.log(`[server] listening on UDP :${this.port}`);
  }

  /** Gracefully shut down. */
  stop(): void {
    this.running = false;
    if (this.interval !== null) clearInterval(this.interval);
    this.socket.close();
    console.log("[server] stopped");
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async _receive(): Promise<void> {
    try {
      for await (const [data, addr] of this.socket) {
        if (!this.running) break;
        if (addr.transport !== "udp") continue;
        this._handle(new Uint8Array(data), addr.hostname, addr.port);
      }
    } catch (_e) {
      // Socket closed
    }
  }

  private _handle(data: Uint8Array, hostname: string, port: number): void {
    const key = `${hostname}:${port}`;
    const now = Date.now();

    // Timeout: evict players not seen in 5 s
    for (const [k, p] of this.players) {
      if (now - p.lastSeen > 5000) {
        this._evict(k);
      }
    }

    switch (msgType(data)) {
      case Msg.PING: {
        this._send(encodePong(), hostname, port);
        break;
      }

      case Msg.JOIN: {
        if (this.players.has(key)) break; // already joined
        if (this.players.size >= MAX_PLAYERS) break; // full
        const id = this.nextId++;
        const player: ServerPlayer = {
          id, addrKey: key, hostname, port,
          x: 0, y: 0, z: 0, yaw: 0,
          lastSeen: now,
        };
        this.players.set(key, player);
        this._send(encodeWelcome(id), hostname, port);
        console.log(`[server] player ${id} joined from ${key}`);
        break;
      }

      case Msg.UPDATE: {
        const player = this.players.get(key);
        if (!player) break;
        player.lastSeen = now;
        const pos = decodeUpdate(data);
        player.x   = pos.x;
        player.y   = pos.y;
        player.z   = pos.z;
        player.yaw = pos.yaw;
        break;
      }

      case Msg.LEAVE: {
        this._evict(key);
        break;
      }
    }
  }

  private _evict(key: string): void {
    const player = this.players.get(key);
    if (!player) return;
    this.players.delete(key);
    console.log(`[server] player ${player.id} left`);
    // Notify all remaining players
    const msg = encodePlayerLeft(player.id);
    for (const p of this.players.values()) {
      this._send(msg, p.hostname, p.port);
    }
  }

  private _broadcast(): void {
    if (this.players.size === 0) return;
    const snapshots: PlayerSnapshot[] = [];
    for (const p of this.players.values()) {
      snapshots.push({ id: p.id, x: p.x, y: p.y, z: p.z, yaw: p.yaw });
    }
    const msg = encodeState(snapshots);
    for (const p of this.players.values()) {
      this._send(msg, p.hostname, p.port);
    }
  }

  private _send(data: Uint8Array, hostname: string, port: number): void {
    try {
      this.socket.send(data, { transport: "udp", hostname, port });
    } catch (_e) {
      // Drop silently — client may have gone away
    }
  }
}
