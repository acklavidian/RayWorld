import * as RL from "raylib";
import { getMesh } from "./scene.ts";

// ─── Shader sources ───────────────────────────────────────────────────────────

const _shaderDir = new URL(".", import.meta.url).pathname;
const SKY_VS = Deno.readTextFileSync(`${_shaderDir}shaders/skybox.vert.glsl`);
const SKY_FS = Deno.readTextFileSync(`${_shaderDir}shaders/skybox.frag.glsl`);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Skybox {
  shader: RL.Shader;
  mesh:   RL.Mesh;
  mat:    RL.Material;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createSkybox(): Skybox {
  const shader = RL.LoadShaderFromMemory(SKY_VS, SKY_FS);
  const mesh = RL.GenMeshCube(1.0, 1.0, 1.0);
  const mat = RL.LoadMaterialDefault();
  mat.shader = shader;
  return { shader, mesh, mat };
}

// ─── Per-frame ────────────────────────────────────────────────────────────────

/**
 * Draw the skybox cube centered on the camera.
 * Call INSIDE BeginMode3D, before any scene geometry.
 */
export function drawSkybox(sky: Skybox, camera: RL.Camera3D): void {
  const cx = camera.position.x;
  const cy = camera.position.y;
  const cz = camera.position.z;
  const s = 500.0;

  // Build transform: translate to camera + uniform scale
  const transform = new RL.Matrix({
    m0: s,   m1: 0, m2: 0,   m3: 0,
    m4: 0,   m5: s, m6: 0,   m7: 0,
    m8: 0,   m9: 0, m10: s,  m11: 0,
    m12: cx, m13: cy, m14: cz, m15: 1,
  });

  RL.DrawMesh(sky.mesh, sky.mat, transform);
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export function destroySkybox(sky: Skybox): void {
  RL.UnloadShader(sky.shader);
  // Note: mesh is owned by the material pipeline, no separate unload needed
}
