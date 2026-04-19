// CLI: Validate asset_library.json for correctness.
// Usage: deno run --allow-read tools/modular-assets/validate_assets.ts

import {
  ALLOWED_FOOTPRINTS,
  ASSET_ROLES,
  SOCKET_FACES,
  SOCKET_TYPES,
} from "./types.ts";
import type {
  AssetLibrary,
  AssetLibraryEntry,
  ValidationMessage,
  ValidationResult,
} from "./types.ts";

function validateLibrary(library: AssetLibrary): ValidationResult {
  const errors: ValidationMessage[] = [];
  const warnings: ValidationMessage[] = [];
  const infos: ValidationMessage[] = [];
  const seenIds = new Set<string>();

  for (const asset of library.assets) {
    const ctx = `[${asset.id}]`;

    // Unique ID check
    if (seenIds.has(asset.id)) {
      errors.push({ level: "error", message: `Duplicate asset ID: ${asset.id}`, context: ctx });
    }
    seenIds.add(asset.id);

    // Role in taxonomy
    if (!ASSET_ROLES.includes(asset.role as typeof ASSET_ROLES[number])) {
      errors.push({ level: "error", message: `Invalid role "${asset.role}"`, context: ctx });
    }

    // Socket values valid
    for (const face of SOCKET_FACES) {
      const val = asset.sockets[face];
      if (!SOCKET_TYPES.includes(val as typeof SOCKET_TYPES[number])) {
        errors.push({ level: "error", message: `Invalid socket type "${val}" on face "${face}"`, context: ctx });
      }
    }

    // Socket faces are all present
    for (const face of SOCKET_FACES) {
      if (!(face in asset.sockets)) {
        errors.push({ level: "error", message: `Missing socket face "${face}"`, context: ctx });
      }
    }

    // Footprint in allowed list
    const fpMatch = ALLOWED_FOOTPRINTS.some(
      fp => fp[0] === asset.footprint[0] && fp[1] === asset.footprint[1] && fp[2] === asset.footprint[2],
    );
    if (!fpMatch) {
      errors.push({
        level: "error",
        message: `Footprint [${asset.footprint}] not in allowed list`,
        context: ctx,
      });
    }

    // Rotation step
    if (asset.rotationStep !== 90 && asset.rotationStep !== 180) {
      errors.push({ level: "error", message: `rotationStep must be 90 or 180, got ${asset.rotationStep}`, context: ctx });
    }

    // Warn if unknown role
    if (asset.role === "unknown") {
      warnings.push({ level: "warning", message: `Role is "unknown" — requires manual classification`, context: ctx });
    }

    // Source file exists
    try {
      Deno.statSync(asset.sourcePath);
    } catch {
      warnings.push({ level: "warning", message: `Source file not found: ${asset.sourcePath}`, context: ctx });
    }
  }

  infos.push({ level: "info", message: `Total assets: ${library.assets.length}` });
  infos.push({ level: "info", message: `Unique IDs: ${seenIds.size}` });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    infos,
  };
}

// ── Output Formatting ──────────────────────────────────────────────────

function printSection(title: string) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(` ${title}`);
  console.log(`${"═".repeat(60)}`);
}

function printResult(result: ValidationResult) {
  printSection("Asset Library Validation");

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

  if (result.infos.length > 0) {
    console.log("\nInfo:");
    for (const i of result.infos) {
      console.log(`  \u2713 ${i.message}`);
    }
  }

  printSection("Summary");
  console.log(`  Errors:   ${result.errors.length}`);
  console.log(`  Warnings: ${result.warnings.length}`);
  console.log(`  Result:   ${result.valid ? "\u2713 VALID" : "\u2717 INVALID"}`);
}

// ── Main ───────────────────────────────────────────────────────────────

if (import.meta.main) {
  const libPath = "data/modular/asset_library.json";

  let library: AssetLibrary;
  try {
    library = JSON.parse(await Deno.readTextFile(libPath));
  } catch {
    console.error(`Error: Could not read ${libPath}`);
    console.error("Run 'deno task asset:library' first.");
    Deno.exit(1);
  }

  const result = validateLibrary(library);
  printResult(result);
  Deno.exit(result.valid ? 0 : 1);
}
