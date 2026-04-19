// Modular asset pipeline — shared types, constants, and utility functions.
// No runtime game dependencies.

// ── Constants ──────────────────────────────────────────────────────────

export const ASSET_ROLES = [
  "floor", "wall", "wall_panel", "corner", "door_frame", "door",
  "ceiling", "stairs", "slope", "railing", "support", "trim",
  "platform", "decor", "unknown",
] as const;

export const SOCKET_TYPES = [
  "open", "doorway", "wall", "solid", "support", "empty", "railing", "none",
] as const;

export const SOCKET_FACES = [
  "north", "east", "south", "west", "up", "down",
] as const;

export const ALLOWED_FOOTPRINTS: [number, number, number][] = [
  [1, 1, 1],
  [2, 1, 1],
  [1, 1, 2],
  [2, 1, 2],
  [1, 2, 1],
];

// ── Types ──────────────────────────────────────────────────────────────

export type AssetRole = typeof ASSET_ROLES[number];
export type SocketType = typeof SOCKET_TYPES[number];
export type SocketFace = typeof SOCKET_FACES[number];
export type SocketMap = Record<SocketFace, SocketType>;

export interface AssetLibraryEntry {
  id: string;
  sourcePath: string;
  displayName: string;
  role: AssetRole;
  tags: string[];
  footprint: [number, number, number];
  rotationStep: number;
  sockets: SocketMap;
  pivot: string;
  rawBounds: [number, number, number];
  normalizedBounds: [number, number, number];
  walkable: boolean;
  blocksMovement: boolean;
  isStructural: boolean;
}

export interface AssetLibrary {
  version: string;
  grid: {
    cellSize: number;
    upAxis: string;
    forwardAxis: string;
  };
  assets: AssetLibraryEntry[];
}

export interface ClassifiedAssetEntry {
  sourceFile: string;
  assetId: string;
  displayName: string;
  role: AssetRole;
  tags: string[];
  confidence: number;
  footprint: [number, number, number];
  normalizedBounds: [number, number, number];
  requiresReview: boolean;
  warnings: string[];
}

export interface ClassifiedAssetLibrary {
  version: string;
  sourcePack: string;
  generatedAt: string;
  assets: ClassifiedAssetEntry[];
}

export interface MapPlacement {
  assetId: string;
  position: [number, number, number];
  rotation: number;
  notes?: string;
  ceiling?: boolean;  // true = skip physics collider (and shadow depth pass)
}

export interface MapLight {
  position: [number, number, number];  // world-space XYZ
  color:    [number, number, number];  // RGB, typically 0-2+ (HDR)
  range:    number;                    // falloff distance in metres
  notes?:   string;
}

export interface MapFile {
  version: string;
  name: string;
  grid: {
    cellSize: [number, number, number];
    dimensions: [number, number, number];
  };
  placements: MapPlacement[];
  lights?: MapLight[];
  spawn?: [number, number, number];  // world-space position; defaults to map center
}

export interface ValidationMessage {
  level: "error" | "warning" | "info";
  message: string;
  context?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationMessage[];
  warnings: ValidationMessage[];
  infos: ValidationMessage[];
}

// ── Socket Compatibility ───────────────────────────────────────────────

const SOCKET_COMPAT: Record<SocketType, SocketType[]> = {
  open: ["open", "doorway"],
  doorway: ["doorway", "open"],
  wall: ["wall"],
  solid: ["solid"],
  support: ["support"],
  empty: ["empty"],
  railing: ["railing", "open"],
  none: [],
};

export function socketsCompatible(a: SocketType, b: SocketType): boolean {
  return SOCKET_COMPAT[a]?.includes(b) ?? false;
}

// ── Face Utilities ─────────────────────────────────────────────────────

const OPPOSING: Record<SocketFace, SocketFace> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};

export function opposingFace(face: SocketFace): SocketFace {
  return OPPOSING[face];
}

// 90-degree CW rotation around Y axis: north→east→south→west→north
const CW_ORDER: SocketFace[] = ["north", "east", "south", "west"];

export function rotateSockets(sockets: SocketMap, degrees: number): SocketMap {
  const steps = ((degrees % 360) + 360) % 360 / 90;
  if (steps === 0) return { ...sockets };

  const result: SocketMap = { ...sockets };
  for (let i = 0; i < 4; i++) {
    const from = CW_ORDER[i];
    const to = CW_ORDER[(i + steps) % 4];
    result[to] = sockets[from];
  }
  // up/down unchanged
  result.up = sockets.up;
  result.down = sockets.down;
  return result;
}
