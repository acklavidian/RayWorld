// CLI: Classify scanned assets by role, tags, sockets, and footprint.
// Usage: deno run --allow-read --allow-write tools/modular-assets/classify.ts

import type {
  AssetRole,
  ClassifiedAssetEntry,
  ClassifiedAssetLibrary,
  SocketMap,
} from "./types.ts";

interface ScanManifestFile {
  filename: string;
  path: string;
  format: string;
  fileSize: number;
  assetId: string;
}

interface ScanManifest {
  version: string;
  scannedAt: string;
  sourceDir: string;
  fileCount: number;
  files: ScanManifestFile[];
}

// ── Classification Rules ───────────────────────────────────────────────

// Priority-ordered: first match wins. Patterns match against the filename
// after stripping the "SM_" prefix.
const ROLE_RULES: { pattern: RegExp; role: AssetRole }[] = [
  { pattern: /^DoorFrame_/i, role: "door_frame" },
  { pattern: /^Door_|^Door$/i, role: "door" },
  { pattern: /^WallDecor_/i, role: "decor" },
  { pattern: /^WallPanel_/i, role: "wall_panel" },
  { pattern: /^Wall_/i, role: "wall" },
  { pattern: /^Floor_Line_/i, role: "trim" },
  { pattern: /^Floor_/i, role: "floor" },
  { pattern: /^StairModule_/i, role: "stairs" },
  { pattern: /^Pente_/i, role: "slope" },
  { pattern: /^Railing_|^Angled_Railing/i, role: "railing" },
  { pattern: /^Rambard/i, role: "railing" },
  { pattern: /^Support_Beam|^Cross_Beam/i, role: "support" },
  { pattern: /^Corner_Cover/i, role: "corner" },
  { pattern: /^Pack_.*Floor/i, role: "floor" },
];

export function inferRoleFromFilename(filename: string): { role: AssetRole; confidence: number } {
  // Strip SM_ prefix and extension for matching
  const name = filename.replace(/\.\w+$/, "").replace(/^SM_/, "");

  for (const rule of ROLE_RULES) {
    if (rule.pattern.test(name)) {
      // Exact structural keywords get high confidence
      const isExact = /^(DoorFrame|Door|Wall|Floor|StairModule|Pente|Railing|Rambard|Support_Beam|Cross_Beam|Corner_Cover)/i.test(name);
      return { role: rule.role, confidence: isExact ? 0.95 : 0.75 };
    }
  }

  // Also handle Pack_ prefixed files
  const packName = filename.replace(/\.\w+$/, "").replace(/^Pack_SciFi_A_005_SM_/, "").replace(/^Pack_SciFi_A_005_/, "");
  if (packName !== name) {
    for (const rule of ROLE_RULES) {
      if (rule.pattern.test(packName)) {
        return { role: rule.role, confidence: 0.75 };
      }
    }
  }

  return { role: "unknown", confidence: 0.3 };
}

export function inferTagsFromFilename(filename: string, role: AssetRole): string[] {
  const tags = ["sci_fi"];

  const roleTags: Partial<Record<AssetRole, string[]>> = {
    floor: ["structural", "walkable"],
    wall: ["structural", "barrier"],
    wall_panel: ["structural", "barrier"],
    corner: ["structural"],
    door_frame: ["structural", "doorway"],
    door: ["interactive", "doorway"],
    ceiling: ["structural"],
    stairs: ["structural", "walkable", "vertical"],
    slope: ["structural", "walkable", "vertical"],
    railing: ["barrier", "safety"],
    support: ["structural"],
    trim: ["decorative", "floor_marking"],
    platform: ["structural", "walkable"],
    decor: ["decorative"],
  };

  if (roleTags[role]) tags.push(...roleTags[role]!);

  // Detect variant hints from filename
  const name = filename.toLowerCase();
  if (name.includes("large") || name.includes("wide")) tags.push("large");
  if (name.includes("double")) tags.push("double");
  if (name.includes("glass") || name.includes("window")) tags.push("transparent");
  if (name.includes("grate") || name.includes("vent")) tags.push("ventilation");

  return [...new Set(tags)];
}

// ── Default Sockets per Role ───────────────────────────────────────────

const DEFAULT_SOCKETS: Record<AssetRole, SocketMap> = {
  floor:      { north: "open", east: "open", south: "open", west: "open", up: "empty", down: "support" },
  wall:       { north: "wall", east: "solid", south: "wall", west: "solid", up: "empty", down: "support" },
  wall_panel: { north: "wall", east: "solid", south: "wall", west: "solid", up: "empty", down: "support" },
  corner:     { north: "solid", east: "solid", south: "wall", west: "wall", up: "empty", down: "support" },
  door_frame: { north: "doorway", east: "solid", south: "doorway", west: "solid", up: "empty", down: "support" },
  door:       { north: "doorway", east: "solid", south: "doorway", west: "solid", up: "empty", down: "support" },
  ceiling:    { north: "empty", east: "empty", south: "empty", west: "empty", up: "support", down: "empty" },
  stairs:     { north: "open", east: "solid", south: "open", west: "solid", up: "open", down: "support" },
  slope:      { north: "open", east: "solid", south: "open", west: "solid", up: "open", down: "support" },
  railing:    { north: "railing", east: "open", south: "railing", west: "open", up: "empty", down: "support" },
  support:    { north: "support", east: "support", south: "support", west: "support", up: "support", down: "support" },
  trim:       { north: "open", east: "open", south: "open", west: "open", up: "empty", down: "support" },
  platform:   { north: "open", east: "open", south: "open", west: "open", up: "empty", down: "support" },
  decor:      { north: "none", east: "none", south: "none", west: "none", up: "none", down: "none" },
  unknown:    { north: "none", east: "none", south: "none", west: "none", up: "none", down: "none" },
};

export function defaultSocketsForRole(role: AssetRole): SocketMap {
  return { ...DEFAULT_SOCKETS[role] };
}

// ── Default Footprints ─────────────────────────────────────────────────

export function defaultFootprintForRole(
  role: AssetRole,
  filename: string,
): [number, number, number] {
  const name = filename.toLowerCase();

  // Size hints from filename
  if (name.includes("_large")) return [2, 1, 2];
  if (name.includes("_double") && (role === "door" || role === "door_frame")) return [2, 1, 1];
  if (name.includes("stairmodule_long")) return [1, 1, 2];

  // Most assets are 1x1x1
  return [1, 1, 1];
}

// ── Display Name ───────────────────────────────────────────────────────

function buildDisplayName(filename: string): string {
  return filename
    .replace(/\.\w+$/, "")               // strip extension
    .replace(/^Pack_SciFi_A_005_/, "")    // strip pack prefix
    .replace(/^SM_/, "")                  // strip SM_ prefix
    .replace(/_/g, " ");                  // underscores to spaces
}

// ── Build Classified Entry ─────────────────────────────────────────────

function buildClassifiedAsset(file: ScanManifestFile): ClassifiedAssetEntry {
  const { role, confidence } = inferRoleFromFilename(file.filename);
  const tags = inferTagsFromFilename(file.filename, role);
  const footprint = defaultFootprintForRole(role, file.filename);
  const cellSize = 2.0;
  const normalizedBounds: [number, number, number] = [
    footprint[0] * cellSize,
    footprint[1] * cellSize,
    footprint[2] * cellSize,
  ];

  const warnings: string[] = [];
  if (role === "unknown") warnings.push("Could not determine role from filename");
  if (confidence < 0.8) warnings.push(`Low classification confidence: ${confidence}`);

  return {
    sourceFile: file.path,
    assetId: file.assetId,
    displayName: buildDisplayName(file.filename),
    role,
    tags,
    confidence,
    footprint,
    normalizedBounds,
    requiresReview: role === "unknown" || confidence < 0.8,
    warnings,
  };
}

// ── Main ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const scanPath = "data/modular/scan_manifest.json";

  let scanData: ScanManifest;
  try {
    scanData = JSON.parse(await Deno.readTextFile(scanPath));
  } catch {
    console.error(`Error: Could not read ${scanPath}`);
    console.error("Run 'deno task asset:scan' first.");
    Deno.exit(1);
  }

  const assets = scanData.files.map(buildClassifiedAsset);

  const result: ClassifiedAssetLibrary = {
    version: "1.0",
    sourcePack: "SciFi_A_005",
    generatedAt: new Date().toISOString(),
    assets,
  };

  const outPath = "data/modular/classified_assets.json";
  await Deno.writeTextFile(outPath, JSON.stringify(result, null, 2) + "\n");

  // Summary
  const roleCounts = new Map<string, number>();
  let reviewCount = 0;
  for (const a of assets) {
    roleCounts.set(a.role, (roleCounts.get(a.role) ?? 0) + 1);
    if (a.requiresReview) reviewCount++;
  }

  console.log(`Classified ${assets.length} assets:`);
  for (const [role, count] of [...roleCounts.entries()].sort()) {
    console.log(`  ${role}: ${count}`);
  }
  if (reviewCount > 0) {
    console.log(`\n${reviewCount} asset(s) require manual review.`);
  }
  console.log(`Output: ${outPath}`);
}
