// CLI: Generate an example test corridor map.
// Usage: deno run --allow-read --allow-write tools/modular-assets/generate_example.ts

import type { AssetLibrary, MapFile, MapPlacement } from "./types.ts";

/*
  Top-down view (Y=0):

  Z=5  [W] [W] [W] [W] [W] [W]
  Z=4  [W] [F] [F] [F] [F] [W]     W = wall, F = floor (room)
  Z=3  [W] [F] [F] [F] [F] [W]     D = doorframe+door
  Z=2  [W] [W] [D] [W] [W] [W]     . = corridor floor
  Z=1  [W] [.] [.] [.] [.] [W]
  Z=0  [W] [W] [W] [W] [W] [W]
        x=0  1   2   3   4   5
*/

function wall(x: number, z: number, rot = 0, notes?: string): MapPlacement {
  return { assetId: "sm_wall_v0", position: [x, 0, z], rotation: rot, ...(notes ? { notes } : {}) };
}

function floor(x: number, z: number, variant: string): MapPlacement {
  return { assetId: variant, position: [x, 0, z], rotation: 0 };
}

function generateExampleMap(): MapFile {
  const placements: MapPlacement[] = [];

  // ── Floor tiles ────────────────────────────────────────────────────
  // Corridor floor (z=1, x=1..4): variant v1
  for (let x = 1; x <= 4; x++) {
    placements.push(floor(x, 1, "sm_floor_v1"));
  }
  // Room floor (z=3..4, x=1..4): variant v2
  for (let z = 3; z <= 4; z++) {
    for (let x = 1; x <= 4; x++) {
      placements.push(floor(x, z, "sm_floor_v2"));
    }
  }

  // ── Perimeter walls ────────────────────────────────────────────────
  // Bottom wall (z=0): x=1..4 (corners at x=0,5 handled separately)
  for (let x = 1; x <= 4; x++) {
    placements.push(wall(x, 0, 0, "south wall"));
  }
  // Top wall (z=5): x=1..4
  for (let x = 1; x <= 4; x++) {
    placements.push(wall(x, 5, 0, "north wall"));
  }
  // Left wall (x=0): z=1..4
  for (let z = 1; z <= 4; z++) {
    placements.push(wall(0, z, 90, "west wall"));
  }
  // Right wall (x=5): z=1..4
  for (let z = 1; z <= 4; z++) {
    placements.push(wall(5, z, 270, "east wall"));
  }

  // ── Divider wall (z=2) with doorway ────────────────────────────────
  // z=2: walls at x=1,3,4 (x=0,5 already have side walls, x=2 has doorframe)
  placements.push(wall(1, 2, 0, "divider wall left"));
  placements.push(wall(3, 2, 0, "divider wall right"));
  placements.push(wall(4, 2, 0, "divider wall right"));

  // ── Doorframe at (2, 0, 2) ────────────────────────────────────────
  placements.push({
    assetId: "sm_doorframe_single",
    position: [2, 0, 2],
    rotation: 0,
    notes: "corridor-to-room doorframe",
  });

  // ── Corner posts at 4 outer corners ────────────────────────────────
  placements.push({
    assetId: "sm_corner_cover_post",
    position: [0, 0, 0],
    rotation: 0,
    notes: "SW corner",
  });
  placements.push({
    assetId: "sm_corner_cover_post",
    position: [5, 0, 0],
    rotation: 90,
    notes: "SE corner",
  });
  placements.push({
    assetId: "sm_corner_cover_post",
    position: [0, 0, 5],
    rotation: 270,
    notes: "NW corner",
  });
  placements.push({
    assetId: "sm_corner_cover_post",
    position: [5, 0, 5],
    rotation: 180,
    notes: "NE corner",
  });

  return {
    version: "1.0",
    name: "Test Corridor",
    grid: {
      cellSize: [2.0, 2.0, 2.0],
      dimensions: [6, 1, 6],
    },
    placements,
  };
}

// ── Main ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  // Validate that the library exists (for cross-reference)
  const libPath = "data/modular/asset_library.json";
  let library: AssetLibrary;
  try {
    library = JSON.parse(await Deno.readTextFile(libPath));
  } catch {
    console.error(`Warning: Could not read ${libPath} — skipping asset ID validation.`);
    console.error("Run 'deno task asset:library' first for full validation.");
    library = { version: "1.0", grid: { cellSize: 2.0, upAxis: "Y", forwardAxis: "-Z" }, assets: [] };
  }

  const map = generateExampleMap();

  // Quick check: all referenced asset IDs exist in library
  const knownIds = new Set(library.assets.map(a => a.id));
  if (knownIds.size > 0) {
    const usedIds = new Set(map.placements.map(p => p.assetId));
    for (const id of usedIds) {
      if (!knownIds.has(id)) {
        console.error(`Warning: Map references unknown asset "${id}"`);
      }
    }
  }

  const outPath = "data/modular/example_test_corridor_map.json";
  await Deno.writeTextFile(outPath, JSON.stringify(map, null, 2) + "\n");
  console.log(`Generated example map "${map.name}" with ${map.placements.length} placements.`);
  console.log(`Output: ${outPath}`);
}
