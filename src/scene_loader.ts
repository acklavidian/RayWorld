import * as RL from "raylib";
import { parseGlbJson, findNode, findNodesByExtra, resolveRaylibMeshRange, extractMeshData, makeSceneMaterials, GltfJson, transformVertsByMatrix, transformPoint } from "./scene.ts";
import { PhysicsWorld } from "./physics.ts";
import { EYE_HEIGHT } from "./player.ts";
import { ShadowMap } from "./shadow.ts";
import { validateScene } from "./metadata.ts";

// ─── Config ──────────────────────────────────────────────────────────────────

export const SCENE_FILE = "assets/scene.glb";

// ─── Scene state ─────────────────────────────────────────────────────────────

export interface DynamicObject {
  name:  string;
  range: { start: number; count: number };
}

export interface SceneState {
  gltf:               GltfJson;
  model:              RL.Model;
  modelTransform:     RL.Matrix;
  spawnX:             number;
  spawnY:             number;
  spawnZ:             number;
  navRange:           { start: number; count: number } | null;
  mats:               RL.Material[];
  dynamicObjects:     DynamicObject[];
  dynamicMeshIndices: Set<number>;
}

// ─── Scene loading ───────────────────────────────────────────────────────────

export function loadScene(shadow: ShadowMap, physics: PhysicsWorld): SceneState {
  const gltf = parseGlbJson(SCENE_FILE);

  // Validate scene metadata
  if (gltf.nodes) {
    const result = validateScene(gltf.nodes);
    for (const msg of result.messages) {
      const prefix = `[metadata] [${msg.node}]`;
      if (msg.level === "error") console.error(`${prefix} ${msg.message}`);
      else console.warn(`${prefix} ${msg.message}`);
    }
  }

  // Spawn point
  let spawnX = 0, spawnY = 2, spawnZ = 0;
  const playerNode = findNode(gltf, "player");
  if (playerNode?.translation) {
    [spawnX, spawnY, spawnZ] = playerNode.translation;
    console.log(`Spawn: (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);
  } else {
    console.warn('No "player" Empty — spawning at origin');
  }

  // Nav mesh
  const navRange = resolveRaylibMeshRange(gltf, "nav_mesh");
  if (!navRange) console.warn('No "nav_mesh" — movement unconstrained');

  // Raylib model
  const model = RL.LoadModel(SCENE_FILE);
  const xform = model.transform;

  // Diagnostic: log model.transform to verify it's non-identity
  console.log(
    `[scene] model.transform:\n` +
    `  ${xform.m0.toFixed(4)}  ${xform.m4.toFixed(4)}  ${xform.m8.toFixed(4)}  ${xform.m12.toFixed(4)}\n` +
    `  ${xform.m1.toFixed(4)}  ${xform.m5.toFixed(4)}  ${xform.m9.toFixed(4)}  ${xform.m13.toFixed(4)}\n` +
    `  ${xform.m2.toFixed(4)}  ${xform.m6.toFixed(4)}  ${xform.m10.toFixed(4)}  ${xform.m14.toFixed(4)}\n` +
    `  ${xform.m3.toFixed(4)}  ${xform.m7.toFixed(4)}  ${xform.m11.toFixed(4)}  ${xform.m15.toFixed(4)}`,
  );

  // Transform spawn point from GLB node space into model space
  [spawnX, spawnY, spawnZ] = transformPoint(spawnX, spawnY, spawnZ, xform);
  console.log(`Spawn (transformed): (${spawnX.toFixed(2)}, ${spawnY.toFixed(2)}, ${spawnZ.toFixed(2)})`);

  // Physics — building AABB box colliders (nodes ending in _building)
  let buildingBoxCount = 0;
  for (const node of findNodesByExtra(gltf, "physicsType", "building")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) { d.verts = transformVertsByMatrix(d.verts, xform); physics.addStaticBox(d.verts); buildingBoxCount++; }
    }
  }
  if (buildingBoxCount > 0) console.log(`[physics] building: ${buildingBoxCount} AABB box colliders`);
  else console.warn('[physics] no building nodes found — set custom property physicsType="building" in Blender');

  // Physics — additional static colliders (physicsType = "static")
  for (const node of findNodesByExtra(gltf, "physicsType", "static")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) { d.verts = transformVertsByMatrix(d.verts, xform); physics.addStatic(d.verts, d.indices, d.triCount); }
    }
    console.log(`[physics] static: "${node.name}"`);
  }

  // Build static broadphase tree now that all static bodies are registered.
  physics.optimizeBroadPhase();

  // Physics — dynamic bodies
  const dynamicObjects: DynamicObject[] = [];
  const dynamicMeshIndices = new Set<number>();
  for (const node of findNodesByExtra(gltf, "physicsType", "dynamic")) {
    if (!node.name) continue;
    const range = resolveRaylibMeshRange(gltf, node.name);
    if (!range) continue;
    const allVerts: number[] = [];
    const primitiveData: { verts: Float32Array; indices: Uint16Array; triCount: number }[] = [];
    for (let i = range.start; i < range.start + range.count; i++) {
      const d = extractMeshData(model, i);
      if (d) { d.verts = transformVertsByMatrix(d.verts, xform); allVerts.push(...d.verts); primitiveData.push(d); }
      dynamicMeshIndices.add(i);
    }
    if (allVerts.length > 0) {
      physics.addDynamic(node.name, new Float32Array(allVerts), primitiveData);
      dynamicObjects.push({ name: node.name, range });
    }
  }

  // Materials (shadow shader applied per-mesh)
  const mats = makeSceneMaterials(model, shadow.sceneShader);

  return { gltf, model, modelTransform: xform, spawnX, spawnY, spawnZ, navRange, mats, dynamicObjects, dynamicMeshIndices };
}

export function unloadScene(ss: SceneState): void {
  RL.UnloadModel(ss.model);
}

export function makeCameraForScene(ss: SceneState, fov = 70): RL.Camera3D {
  const camY = ss.spawnY + EYE_HEIGHT;
  return new RL.Camera3D({
    position:   new RL.Vector3(ss.spawnX, camY, ss.spawnZ),
    target:     new RL.Vector3(ss.spawnX, camY, ss.spawnZ - 1),
    up:         new RL.Vector3(0, 1, 0),
    fovy:       fov,
    projection: RL.CameraProjection.PERSPECTIVE,
  });
}
