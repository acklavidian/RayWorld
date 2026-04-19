// CLI: Enrich classified assets into a full asset library.
// Usage: deno run --allow-read --allow-write tools/modular-assets/generate_library.ts

import type {
  AssetLibrary,
  AssetLibraryEntry,
  AssetRole,
  ClassifiedAssetEntry,
  ClassifiedAssetLibrary,
} from "./types.ts";
import { defaultSocketsForRole } from "./classify.ts";

// ── Enrichment Rules ───────────────────────────────────────────────────

const WALKABLE_ROLES: Set<AssetRole> = new Set([
  "floor", "platform", "stairs", "slope",
]);

const BLOCKS_MOVEMENT_ROLES: Set<AssetRole> = new Set([
  "wall", "wall_panel", "corner", "door_frame", "support",
]);

const STRUCTURAL_ROLES: Set<AssetRole> = new Set([
  "floor", "wall", "wall_panel", "corner", "door_frame",
  "ceiling", "stairs", "slope", "support",
]);

function enrichAsset(classified: ClassifiedAssetEntry): AssetLibraryEntry {
  const cellSize = 2.0;
  const rawBounds: [number, number, number] = [
    classified.footprint[0] * cellSize,
    classified.footprint[1] * cellSize,
    classified.footprint[2] * cellSize,
  ];

  return {
    id: classified.assetId,
    sourcePath: classified.sourceFile,
    displayName: classified.displayName,
    role: classified.role,
    tags: classified.tags,
    footprint: classified.footprint,
    rotationStep: 90,
    sockets: defaultSocketsForRole(classified.role),
    pivot: "bottom_center",
    rawBounds,
    normalizedBounds: classified.normalizedBounds,
    walkable: WALKABLE_ROLES.has(classified.role),
    blocksMovement: BLOCKS_MOVEMENT_ROLES.has(classified.role),
    isStructural: STRUCTURAL_ROLES.has(classified.role),
  };
}

// ── Main ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const classifiedPath = "data/modular/classified_assets.json";

  let classifiedData: ClassifiedAssetLibrary;
  try {
    classifiedData = JSON.parse(await Deno.readTextFile(classifiedPath));
  } catch {
    console.error(`Error: Could not read ${classifiedPath}`);
    console.error("Run 'deno task asset:classify' first.");
    Deno.exit(1);
  }

  const assets = classifiedData.assets.map(enrichAsset);

  const library: AssetLibrary = {
    version: "1.0",
    grid: {
      cellSize: 2.0,
      upAxis: "Y",
      forwardAxis: "-Z",
    },
    assets,
  };

  const outPath = "data/modular/asset_library.json";
  await Deno.writeTextFile(outPath, JSON.stringify(library, null, 2) + "\n");
  console.log(`Generated asset library with ${assets.length} entries.`);
  console.log(`Output: ${outPath}`);
}
