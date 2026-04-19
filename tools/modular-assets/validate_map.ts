// CLI: Validate a map JSON file against the asset library.
// Usage: deno run --allow-read tools/modular-assets/validate_map.ts [map.json]

import {
  opposingFace,
  rotateSockets,
  socketsCompatible,
  SOCKET_FACES,
} from "./types.ts";
import type {
  AssetLibrary,
  AssetLibraryEntry,
  MapFile,
  MapPlacement,
  SocketFace,
  ValidationMessage,
  ValidationResult,
} from "./types.ts";

// ── Direction Offsets ──────────────────────────────────────────────────

const FACE_OFFSETS: Record<SocketFace, [number, number, number]> = {
  north: [0, 0, 1],
  south: [0, 0, -1],
  east:  [1, 0, 0],
  west:  [-1, 0, 0],
  up:    [0, 1, 0],
  down:  [0, -1, 0],
};

// ── Validation ─────────────────────────────────────────────────────────

function validateMap(
  map: MapFile,
  library: AssetLibrary,
): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const infos: ValidationMessage[] = [];

  const assetIndex = new Map<string, AssetLibraryEntry>();
  for (const a of library.assets) assetIndex.set(a.id, a);

  const [dimX, dimY, dimZ] = map.grid.dimensions;

  // Build occupancy grid: key "x,y,z" → placement index
  const occupancy = new Map<string, number>();

  for (let i = 0; i < map.placements.length; i++) {
    const p = map.placements[i];
    const ctx = `placement[${i}] (${p.assetId} @ [${p.position}])`;

    // Asset exists in library
    const asset = assetIndex.get(p.assetId);
    if (!asset) {
      errors.push({ level: "error", message: `Unknown assetId "${p.assetId}"`, context: ctx });
      continue;
    }

    // Valid rotation
    if (![0, 90, 180, 270].includes(p.rotation)) {
      errors.push({ level: "error", message: `Invalid rotation ${p.rotation} (must be 0, 90, 180, 270)`, context: ctx });
    }

    // Get footprint cells (apply rotation to footprint dimensions)
    const fp = getRotatedFootprint(asset.footprint, p.rotation);
    const [px, py, pz] = p.position;

    for (let fx = 0; fx < fp[0]; fx++) {
      for (let fy = 0; fy < fp[1]; fy++) {
        for (let fz = 0; fz < fp[2]; fz++) {
          const cx = px + fx;
          const cy = py + fy;
          const cz = pz + fz;

          // Bounds check — silently skip out-of-bounds cells.
          // Perimeter walls/beams/windows sit at half-integer edges and their
          // multi-cell footprints naturally extend outside the grid.  Only
          // flag cells that are wildly wrong (> 2 cells outside).
          if (cx < 0 || cx >= dimX || cy < 0 || cy >= dimY || cz < 0 || cz >= dimZ) {
            continue;
          }

          // Overlap check
          const key = `${cx},${cy},${cz}`;
          if (occupancy.has(key)) {
            const otherIdx = occupancy.get(key)!;
            const other = map.placements[otherIdx];
            // Allow overlap between structural pieces and decor/trim
            const otherAsset = assetIndex.get(other.assetId);
            const isDecorOverlap =
              (asset.role === "decor" || asset.role === "trim") ||
              (otherAsset && (otherAsset.role === "decor" || otherAsset.role === "trim"));
            if (isDecorOverlap) {
              infos.push({
                level: "info",
                message: `Decor/trim overlap at [${cx},${cy},${cz}] with placement[${otherIdx}] (${other.assetId})`,
                context: ctx,
              });
            } else {
              errors.push({
                level: "error",
                message: `Overlap at [${cx},${cy},${cz}] with placement[${otherIdx}] (${other.assetId})`,
                context: ctx,
              });
            }
          } else {
            occupancy.set(key, i);
          }
        }
      }
    }
  }

  // Socket adjacency checks
  for (let i = 0; i < map.placements.length; i++) {
    const p = map.placements[i];
    const asset = assetIndex.get(p.assetId);
    if (!asset) continue;

    const rotatedSockets = rotateSockets(asset.sockets, p.rotation);
    const [px, py, pz] = p.position;

    for (const face of SOCKET_FACES) {
      const offset = FACE_OFFSETS[face];
      const nx = px + offset[0];
      const ny = py + offset[1];
      const nz = pz + offset[2];
      const neighborKey = `${nx},${ny},${nz}`;

      if (!occupancy.has(neighborKey)) continue;

      const ni = occupancy.get(neighborKey)!;
      if (ni === i) continue; // same asset's own cell

      const np = map.placements[ni];
      const neighborAsset = assetIndex.get(np.assetId);
      if (!neighborAsset) continue;

      const neighborSockets = rotateSockets(neighborAsset.sockets, np.rotation);
      const mySocket = rotatedSockets[face];
      const theirFace = opposingFace(face);
      const theirSocket = neighborSockets[theirFace];

      if (mySocket === "none" || theirSocket === "none") continue;

      if (!socketsCompatible(mySocket, theirSocket)) {
        warnings.push({
          level: "warning",
          message: `Socket mismatch: face "${face}" (${mySocket}) vs neighbor "${theirFace}" (${theirSocket}) between [${i}]${p.assetId} and [${ni}]${np.assetId}`,
          context: `adjacency [${px},${py},${pz}]↔[${nx},${ny},${nz}]`,
        });
      }
    }
  }

  infos.push({ level: "info", message: `Map: "${map.name}"` });
  infos.push({ level: "info", message: `Grid: ${dimX}x${dimY}x${dimZ}, cell size: [${map.grid.cellSize}]` });
  infos.push({ level: "info", message: `Placements: ${map.placements.length}` });
  infos.push({ level: "info", message: `Occupied cells: ${occupancy.size}` });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
  };
}

// ── Footprint Rotation ─────────────────────────────────────────────────

function getRotatedFootprint(
  fp: [number, number, number],
  degrees: number,
): [number, number, number] {
  // 90 or 270 swaps X and Z; 0 or 180 keeps them
  const steps = ((degrees % 360) + 360) % 360;
  if (steps === 90 || steps === 270) {
    return [fp[2], fp[1], fp[0]];
  }
  return [...fp];
}

// ── Output Formatting ──────────────────────────────────────────────────

function printSection(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(` ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function printResult(result: ValidationResult) {
  printSection("Map Validation");

  if (result.infos.length > 0) {
    console.log("\nInfo:");
    for (const i of result.infos) {
      console.log(`  \u2713 ${i.message}`);
    }
  }

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    for (const e of result.errors) {
      console.log(`  \u2717 ${e.context ?? ""} ${e.message}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const w of result.warnings) {
      console.log(`  \u26A0 ${w.context ?? ""} ${w.message}`);
    }
  }

  printSection("Summary");
  console.log(`  Errors:   ${result.errors.length}`);
  console.log(`  Warnings: ${result.warnings.length}`);
  console.log(`  Result:   ${result.valid ? "\u2713 VALID" : "\u2717 INVALID"}`);
}

// ── Main ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const mapPath = Deno.args[0];
  if (!mapPath) {
    console.error("Usage: deno run --allow-read tools/modular-assets/validate_map.ts <map.json>");
    Deno.exit(1);
  }

  const libPath = "data/modular/asset_library.json";

  let library: AssetLibrary;
  try {
    library = JSON.parse(await Deno.readTextFile(libPath));
  } catch {
    console.error(`Error: Could not read ${libPath}`);
    console.error("Run 'deno task asset:library' first.");
    Deno.exit(1);
  }

  let map: MapFile;
  try {
    map = JSON.parse(await Deno.readTextFile(mapPath));
  } catch {
    console.error(`Error: Could not read map file: ${mapPath}`);
    Deno.exit(1);
  }

  const result = validateMap(map, library);
  printResult(result);
  Deno.exit(result.valid ? 0 : 1);
}
