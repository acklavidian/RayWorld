import * as RL from "raylib";
import { getMesh, extractMeshData, makeSceneMaterials, transformVertsByMatrix } from "./scene.ts";
import { PhysicsWorld } from "./physics.ts";
import type { ShadowMap } from "./shadow.ts";
import type { AssetLibrary, AssetLibraryEntry, MapFile } from "../tools/modular-assets/types.ts";

const DEG2RAD = Math.PI / 180;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LoadedAssetModel {
  id: string;
  model: RL.Model;
  meshCount: number;
  mats: RL.Material[];  // per-mesh, with shadow shader applied
  fitScale: number;     // uniform scale to fit model XZ footprint into one cell
}

export interface PlacedInstance {
  modelIndex: number;     // index into models[]
  transform: RL.Matrix;   // pre-computed world transform (model→rotate→translate)
}

export interface MapState {
  models: LoadedAssetModel[];
  instances: PlacedInstance[];
  spawnX: number;
  spawnY: number;
  spawnZ: number;
}

// ─── Matrix helpers (pure JS — avoids FFI return-value issues) ───────────────

function matRotateY(rad: number): RL.Matrix {
  const c = Math.cos(rad), s = Math.sin(rad);
  return new RL.Matrix({
    m0: c,   m1: 0, m2: -s,  m3: 0,
    m4: 0,   m5: 1, m6:  0,  m7: 0,
    m8: s,   m9: 0, m10: c,  m11: 0,
    m12: 0, m13: 0, m14: 0,  m15: 1,
  });
}

function matScale(s: number): RL.Matrix {
  return new RL.Matrix({
    m0: s,   m1: 0, m2: 0,   m3: 0,
    m4: 0,   m5: s, m6: 0,   m7: 0,
    m8: 0,   m9: 0, m10: s,  m11: 0,
    m12: 0, m13: 0, m14: 0,  m15: 1,
  });
}

function matTranslate(tx: number, ty: number, tz: number): RL.Matrix {
  return new RL.Matrix({
    m0: 1,   m1: 0, m2: 0,   m3: 0,
    m4: 0,   m5: 1, m6: 0,   m7: 0,
    m8: 0,   m9: 0, m10: 1,  m11: 0,
    m12: tx, m13: ty, m14: tz, m15: 1,
  });
}

/**
 * Matrix multiply C = A * B (apply B first, then A).
 * Uses the same field convention as transformPoint in scene.ts:
 *   x' = m0*x + m4*y + m8*z  + m12
 *   y' = m1*x + m5*y + m9*z  + m13
 *   z' = m2*x + m6*y + m10*z + m14
 */
function matMul(a: RL.Matrix, b: RL.Matrix): RL.Matrix {
  const af = [a.m0, a.m1, a.m2, a.m3, a.m4, a.m5, a.m6, a.m7,
              a.m8, a.m9, a.m10, a.m11, a.m12, a.m13, a.m14, a.m15];
  const bf = [b.m0, b.m1, b.m2, b.m3, b.m4, b.m5, b.m6, b.m7,
              b.m8, b.m9, b.m10, b.m11, b.m12, b.m13, b.m14, b.m15];
  const c = new Array<number>(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += af[4 * k + i] * bf[4 * j + k];
      }
      c[4 * j + i] = sum;
    }
  }
  return new RL.Matrix({
    m0: c[0], m1: c[1], m2: c[2], m3: c[3],
    m4: c[4], m5: c[5], m6: c[6], m7: c[7],
    m8: c[8], m9: c[9], m10: c[10], m11: c[11],
    m12: c[12], m13: c[13], m14: c[14], m15: c[15],
  });
}

// ─── Path conversion ─────────────────────────────────────────────────────────

function fbxToGlbPath(fbxPath: string): string {
  return fbxPath.replace(/\/fbx\//i, "/glb/").replace(/\.fbx$/i, ".glb");
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export function loadModularMap(
  mapPath: string,
  libraryPath: string,
  shadow: ShadowMap,
  physics: PhysicsWorld,
): MapState {
  // 1. Load asset library and build lookup
  const libJson: AssetLibrary = JSON.parse(Deno.readTextFileSync(libraryPath));
  const libLookup = new Map<string, AssetLibraryEntry>();
  for (const entry of libJson.assets) {
    libLookup.set(entry.id, entry);
  }
  console.log(`[map] loaded asset library: ${libJson.assets.length} assets`);

  // 2. Load map JSON
  const map: MapFile = JSON.parse(Deno.readTextFileSync(mapPath));
  console.log(`[map] loading "${map.name}" — ${map.placements.length} placements`);

  // 3. Collect unique asset IDs and read grid config
  const cellSize = map.grid.cellSize;
  const usedIds = new Set<string>();
  for (const p of map.placements) {
    usedIds.add(p.assetId);
  }

  // 4. Load each unique model
  const models: LoadedAssetModel[] = [];
  const idToModelIndex = new Map<string, number>();

  for (const id of usedIds) {
    const entry = libLookup.get(id);
    if (!entry) {
      console.warn(`[map] unknown asset id "${id}" — skipping`);
      continue;
    }
    const glbPath = fbxToGlbPath(entry.sourcePath);
    console.log(`[map] loading model: ${glbPath}`);
    const model = RL.LoadModel(glbPath);

    // Measure full bounding box across all meshes
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
    const xzSize = Math.max(maxX - minX, maxZ - minZ, 0.001);
    const rawFitScale = cellSize[0] / xzSize;
    // Only apply scaling when the model is roughly half the cell size (e.g. 1m floors
    // in a 2m grid). Assets that are already cell-sized (walls) or intentionally small
    // (corner posts, decorative) stay at 1.0.
    const fitScale = (rawFitScale >= 1.5 && rawFitScale <= 2.5) ? rawFitScale : 1.0;
    if (fitScale !== 1.0) console.log(`[map]   ${id}: fitScale=${fitScale.toFixed(3)}`);

    const mats = makeSceneMaterials(model, shadow.sceneShader);
    idToModelIndex.set(id, models.length);
    models.push({ id, model, meshCount: model.meshCount, mats, fitScale });
  }
  console.log(`[map] loaded ${models.length} unique models`);

  // 5. Create placed instances with transforms + physics colliders
  const instances: PlacedInstance[] = [];

  for (const p of map.placements) {
    const mIdx = idToModelIndex.get(p.assetId);
    if (mIdx === undefined) continue;
    const asset = models[mIdx];
    const entry = libLookup.get(p.assetId)!;

    // World position from grid coordinates
    const wx = p.position[0] * cellSize[0];
    const wy = p.position[1] * cellSize[1];
    const wz = p.position[2] * cellSize[2];

    // Build transform: T * R * S * M
    //   M = model.transform (GLB coordinate system conversion)
    //   S = uniform scale to fit model XZ footprint into one cell
    //   R = Y-axis rotation
    //   T = translation to world position
    const M = asset.model.transform;
    const S = asset.fitScale !== 1.0 ? matScale(asset.fitScale) : M; // skip identity multiply
    const SM = asset.fitScale !== 1.0 ? matMul(S, M) : M;
    const R = matRotateY(p.rotation * DEG2RAD);
    const T = matTranslate(wx, wy, wz);
    const transform = matMul(T, matMul(R, SM));

    instances.push({ modelIndex: mIdx, transform });

    // Physics colliders for structural / movement-blocking assets
    // Skip physics for ceiling tiles (floor-role assets placed above ground level)
    const isCeiling = entry.role === "floor" && p.position[1] > 0;
    if ((entry.blocksMovement || entry.isStructural) && !isCeiling) {
      for (let i = 0; i < asset.meshCount; i++) {
        const d = extractMeshData(asset.model, i);
        if (d) {
          const worldVerts = transformVertsByMatrix(d.verts, transform);
          physics.addStatic(worldVerts, d.indices, d.triCount);
        }
      }
    }
  }

  physics.optimizeBroadPhase();
  console.log(`[map] created ${instances.length} instances`);

  // 6. Compute spawn point
  let spawnX: number, spawnY: number, spawnZ: number;
  if (map.spawn) {
    [spawnX, spawnY, spawnZ] = map.spawn;
  } else {
    // Default: center of grid, 1m above ground
    const dim = map.grid.dimensions;
    spawnX = (dim[0] / 2) * cellSize[0];
    spawnY = 1.0;
    spawnZ = (dim[2] / 2) * cellSize[2];
  }
  console.log(`[map] spawn: (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);

  return { models, instances, spawnX, spawnY, spawnZ };
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

export function unloadMap(state: MapState): void {
  for (const asset of state.models) {
    RL.UnloadModel(asset.model);
  }
}
