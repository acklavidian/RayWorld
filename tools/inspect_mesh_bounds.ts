/**
 * Quick tool to inspect mesh vertex bounds of GLB files.
 * Usage: deno run --allow-read --allow-ffi tools/inspect_mesh_bounds.ts
 */
import * as RL from "raylib";
import { extractMeshData } from "../src/scene.ts";

// Must init a window for raylib model loading
RL.InitWindow(1, 1, "inspect");

const files = [
  "assets/scifi_assets/glb/SM_Floor_V1.glb",
  "assets/scifi_assets/glb/SM_Wall_V0.glb",
  "assets/scifi_assets/glb/SM_DoorFrame_Single.glb",
];

for (const path of files) {
  const model = RL.LoadModel(path);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let mi = 0; mi < model.meshCount; mi++) {
    const d = extractMeshData(model, mi);
    if (!d) continue;
    for (let v = 0; v < d.verts.length; v += 3) {
      minX = Math.min(minX, d.verts[v]);   maxX = Math.max(maxX, d.verts[v]);
      minY = Math.min(minY, d.verts[v+1]); maxY = Math.max(maxY, d.verts[v+1]);
      minZ = Math.min(minZ, d.verts[v+2]); maxZ = Math.max(maxZ, d.verts[v+2]);
    }
  }
  const name = path.split("/").pop()!;
  console.log(`${name}:`);
  console.log(`  X: [${minX.toFixed(3)}, ${maxX.toFixed(3)}]  (${(maxX-minX).toFixed(3)}m)`);
  console.log(`  Y: [${minY.toFixed(3)}, ${maxY.toFixed(3)}]  (${(maxY-minY).toFixed(3)}m)`);
  console.log(`  Z: [${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]  (${(maxZ-minZ).toFixed(3)}m)`);
  RL.UnloadModel(model);
}

RL.CloseWindow();
