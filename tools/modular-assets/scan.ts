// CLI: Scan asset directory for supported 3D files.
// Usage: deno run --allow-read --allow-write tools/modular-assets/scan.ts [dir]

import { walk } from "https://deno.land/std@0.224.0/fs/walk.ts";
import { basename, relative } from "https://deno.land/std@0.224.0/path/mod.ts";

const SUPPORTED_EXTENSIONS = new Set([".fbx", ".obj", ".glb"]);
const DEFAULT_DIR = "assets/scifi_assets/fbx";

interface ScannedFile {
  filename: string;
  path: string;
  format: string;
  fileSize: number;
}

export function normalizeAssetId(filename: string): string {
  // Strip extension
  let id = filename.replace(/\.\w+$/, "");
  // Strip "Pack_SciFi_A_005_" prefix → keep "Pack_" to avoid collisions
  id = id.replace(/^Pack_SciFi_A_005_/, "Pack_");
  // Lowercase, replace spaces with underscores
  id = id.toLowerCase().replace(/\s+/g, "_");
  return id;
}

async function scanAssetFiles(dir: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  for await (const entry of walk(dir, { includeDirs: false })) {
    const ext = entry.name.substring(entry.name.lastIndexOf(".")).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    const stat = await Deno.stat(entry.path);
    files.push({
      filename: entry.name,
      path: relative(Deno.cwd(), entry.path),
      format: ext.replace(".", ""),
      fileSize: stat.size,
    });
  }
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return files;
}

if (import.meta.main) {
  const dir = Deno.args[0] ?? DEFAULT_DIR;

  try {
    await Deno.stat(dir);
  } catch {
    console.error(`Error: Directory not found: ${dir}`);
    Deno.exit(1);
  }

  const files = await scanAssetFiles(dir);

  // Check for ID collisions
  const idMap = new Map<string, string[]>();
  for (const f of files) {
    const id = normalizeAssetId(f.filename);
    const existing = idMap.get(id) ?? [];
    existing.push(f.filename);
    idMap.set(id, existing);
  }

  const collisions: string[] = [];
  for (const [id, sources] of idMap) {
    if (sources.length > 1) {
      collisions.push(`  ID "${id}" from: ${sources.join(", ")}`);
    }
  }
  if (collisions.length > 0) {
    console.error("WARNING: ID collisions detected:");
    for (const c of collisions) console.error(c);
  }

  const manifest = {
    version: "1.0",
    scannedAt: new Date().toISOString(),
    sourceDir: dir,
    fileCount: files.length,
    files: files.map(f => ({
      ...f,
      assetId: normalizeAssetId(f.filename),
    })),
  };

  const outPath = "data/modular/scan_manifest.json";
  await Deno.writeTextFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Scanned ${files.length} files from ${dir}`);
  console.log(`Output: ${outPath}`);
}
