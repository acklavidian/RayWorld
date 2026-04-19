import * as RL from "raylib";
import { getMesh } from "./scene.ts";

// ─── Shader sources ───────────────────────────────────────────────────────────

const _shaderDir = new URL(".", import.meta.url).pathname;
const DEPTH_VS = Deno.readTextFileSync(`${_shaderDir}shaders/depth.vert.glsl`);
const DEPTH_FS = Deno.readTextFileSync(`${_shaderDir}shaders/depth.frag.glsl`);
const SCENE_VS = Deno.readTextFileSync(`${_shaderDir}shaders/scene.vert.glsl`);
const SCENE_FS = Deno.readTextFileSync(`${_shaderDir}shaders/scene.frag.glsl`);

// ─── Types ────────────────────────────────────────────────────────────────────

/** All state owned by the shadow map system. */
export interface ShadowMap {
  fbo:         RL.RenderTexture;
  depthShader: RL.Shader;
  sceneShader: RL.Shader;
  depthMat:    RL.Material;   // default material + depth shader
  lightCam:    RL.Camera3D;   // orthographic light camera for depth pass
  lightVP:     RL.Matrix;     // CPU-side VP used as `lightVP` uniform

  // Cached uniform locations on sceneShader
  locLightVP:  number;
  locLightDir: number;
  locLightCol: number;
  locAmbient:  number;
  locViewPos:  number;
  locShadow:   number;
  locShadowRes:number;
  locNumPointLights: number;
  locPointLightPos:   number[];  // per-element locations
  locPointLightColor: number[];
  locPointLightRange: number[];
}

export interface PointLight {
  position: [number, number, number];
  color:    [number, number, number];
  range:    number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/** Convenience wrappers for SetShaderValue typed data. */
const f32 = (...vals: number[]) =>
  new Uint8Array(new Float32Array(vals).buffer) as unknown as Uint8Array<ArrayBuffer>;
const i32 = (...vals: number[]) =>
  new Uint8Array(new Int32Array(vals).buffer) as unknown as Uint8Array<ArrayBuffer>;

const v3 = (x: number, y: number, z: number) => new RL.Vector3(x, y, z);
const v3sub = (a: RL.Vector3, b: RL.Vector3) => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const v3len = (a: RL.Vector3) => Math.hypot(a.x, a.y, a.z);
const v3norm = (a: RL.Vector3) => {
  const l = v3len(a);
  return l > 0 ? v3(a.x / l, a.y / l, a.z / l) : v3(0, 0, 0);
};

/**
 * Creates the shadow map FBO, shaders, and materials.
 *
 * @param lightPos    World-space position of the directional light source.
 * @param lightTarget Point the light looks at (usually scene centre).
 * @param mapSize     Shadow map resolution in texels (e.g. 2048).
 * @param orthoSize   Half-extents of the orthographic capture volume in world
 *                    units (must cover the full scene).
 */
export function createShadowMap(
  lightPos:    RL.Vector3,
  lightTarget: RL.Vector3,
  mapSize:     number,
  orthoSize:   number,
): ShadowMap {
  const fbo         = RL.LoadRenderTexture(mapSize, mapSize);
  const depthShader = RL.LoadShaderFromMemory(DEPTH_VS, DEPTH_FS);
  const sceneShader = RL.LoadShaderFromMemory(SCENE_VS, SCENE_FS);

  // Depth material: default white mat with depth shader swapped in
  const depthMat    = RL.LoadMaterialDefault();
  depthMat.shader   = depthShader;

  // Light camera (orthographic, square; fovy = full height in world units)
  const lightCam = new RL.Camera3D({
    position:   lightPos,
    target:     lightTarget,
    up:         v3(0, 1, 0),
    fovy:       orthoSize * 2.0,
    projection: RL.CameraProjection.ORTHOGRAPHIC,
  });

  // CPU-side lightVP must match raylib's internal MVP during the depth pass.
  // raylib applies Scale(1,−1,1) to the projection when rendering to any FBO
  // (see rlOrtho() in rlgl.h: "invert Y axis for render textures").
  // near/far match raylib's RL_CULL_DISTANCE_NEAR / _FAR defaults.
  const NEAR = 0.01, FAR = 1000.0;
  const lightView  = RL.MatrixLookAt(lightPos, lightTarget, v3(0, 1, 0));
  const lightOrtho = RL.MatrixOrtho(
    -orthoSize, orthoSize, -orthoSize, orthoSize, NEAR, FAR,
  );
  const yFlip    = RL.MatrixScale(1.0, -1.0, 1.0);
  const lightProj = RL.MatrixMultiply(lightOrtho, yFlip); // ortho * Scale(1,-1,1)
  const lightVP   = RL.MatrixMultiply(lightProj, lightView);

  // Cache uniform locations
  const loc = (name: string) => RL.GetShaderLocation(sceneShader, name);
  const shadow: ShadowMap = {
    fbo, depthShader, sceneShader, depthMat, lightCam, lightVP,
    locLightVP:   loc("lightVP"),
    locLightDir:  loc("lightDir"),
    locLightCol:  loc("lightColor"),
    locAmbient:   loc("ambient"),
    locViewPos:   loc("viewPos"),
    locShadow:    loc("shadowMap"),
    locShadowRes: loc("shadowMapResolution"),
    locNumPointLights: loc("numPointLights"),
    locPointLightPos:   [] as number[],
    locPointLightColor: [] as number[],
    locPointLightRange: [] as number[],
  };

  // Cache per-element uniform locations for point light arrays
  const MAX_PL = 16;
  for (let i = 0; i < MAX_PL; i++) {
    shadow.locPointLightPos.push(loc(`pointLightPos[${i}]`));
    shadow.locPointLightColor.push(loc(`pointLightColor[${i}]`));
    shadow.locPointLightRange.push(loc(`pointLightRange[${i}]`));
  }

  // Set static uniforms (light direction, colour, ambient, resolution)
  const lightDir = v3norm(v3sub(lightTarget, lightPos));
  RL.SetShaderValue(sceneShader, shadow.locLightDir,
    f32(lightDir.x, lightDir.y, lightDir.z), RL.ShaderUniformDataType.VEC3);
  RL.SetShaderValue(sceneShader, shadow.locLightCol,
    f32(1.0, 0.98, 0.9, 1.0),               RL.ShaderUniformDataType.VEC4);
  RL.SetShaderValue(sceneShader, shadow.locAmbient,
    f32(0.3, 0.3, 0.35, 1.0),               RL.ShaderUniformDataType.VEC4);
  RL.SetShaderValue(sceneShader, shadow.locShadowRes,
    i32(mapSize),                            RL.ShaderUniformDataType.INT);
  RL.SetShaderValueMatrix(sceneShader, shadow.locLightVP, lightVP);
  // Bind depth texture to the shadowMap sampler (re-bound each frame)
  RL.SetShaderValueTexture(sceneShader, shadow.locShadow, fbo.depth);

  // Default: no point lights
  RL.SetShaderValue(sceneShader, shadow.locNumPointLights, i32(0), RL.ShaderUniformDataType.INT);

  return shadow;
}

/**
 * Upload point light data to the scene shader.  Call once after loading a map
 * (or whenever lights change).
 */
export function setPointLights(shadow: ShadowMap, lights: PointLight[]): void {
  const count = Math.min(lights.length, 16);
  RL.SetShaderValue(shadow.sceneShader, shadow.locNumPointLights,
    i32(count), RL.ShaderUniformDataType.INT);
  for (let i = 0; i < count; i++) {
    const pl = lights[i];
    RL.SetShaderValue(shadow.sceneShader, shadow.locPointLightPos[i],
      f32(pl.position[0], pl.position[1], pl.position[2]), RL.ShaderUniformDataType.VEC3);
    RL.SetShaderValue(shadow.sceneShader, shadow.locPointLightColor[i],
      f32(pl.color[0], pl.color[1], pl.color[2]), RL.ShaderUniformDataType.VEC3);
    RL.SetShaderValue(shadow.sceneShader, shadow.locPointLightRange[i],
      f32(pl.range), RL.ShaderUniformDataType.FLOAT);
  }
}

// ─── Per-frame ────────────────────────────────────────────────────────────────

/**
 * Updates uniforms that change every frame (view position for specular
 * highlights) and re-binds the shadow depth texture in case another draw call
 * clobbered its texture unit.
 */
export function updatePerFrame(shadow: ShadowMap, camera: RL.Camera3D): void {
  const p = camera.position;
  RL.SetShaderValue(
    shadow.sceneShader, shadow.locViewPos,
    new Uint8Array(new Float32Array([p.x, p.y, p.z]).buffer) as unknown as Uint8Array<ArrayBuffer>,
    RL.ShaderUniformDataType.VEC3,
  );
  RL.SetShaderValueTexture(shadow.sceneShader, shadow.locShadow, shadow.fbo.depth);
}

/**
 * Depth pass: renders `scene` from the light's perspective into the shadow
 * FBO.  Nav-mesh meshes are skipped (they are invisible geometry).
 *
 * Assumes transforms are baked — passes scene.transform as the model matrix.
 */
export function renderDepthPass(
  shadow:    ShadowMap,
  scene:     RL.Model,
  navRange:  { start: number; count: number } | null,
): void {
  RL.BeginTextureMode(shadow.fbo);
  RL.ClearBackground(RL.White);
  RL.BeginMode3D(shadow.lightCam);

  for (let i = 0; i < scene.meshCount; i++) {
    if (navRange && i >= navRange.start && i < navRange.start + navRange.count) continue;
    RL.DrawMesh(getMesh(scene, i), shadow.depthMat, scene.transform);
  }

  RL.EndMode3D();
  RL.EndTextureMode();
}

/**
 * Depth pass for modular maps: renders multiple instanced models from the
 * light's perspective into the shadow FBO.
 */
export function renderDepthPassMap(
  shadow:    ShadowMap,
  models:    { model: RL.Model; meshCount: number }[],
  instances: { modelIndex: number; transform: RL.Matrix; isCeiling: boolean }[],
): void {
  RL.BeginTextureMode(shadow.fbo);
  RL.ClearBackground(RL.White);
  RL.BeginMode3D(shadow.lightCam);

  for (const inst of instances) {
    if (inst.isCeiling) continue; // ceiling tiles must not cast shadows into rooms
    const m = models[inst.modelIndex];
    for (let i = 0; i < m.meshCount; i++) {
      RL.DrawMesh(getMesh(m.model, i), shadow.depthMat, inst.transform);
    }
  }

  RL.EndMode3D();
  RL.EndTextureMode();
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

export function destroyShadowMap(shadow: ShadowMap): void {
  RL.UnloadShader(shadow.depthShader);
  RL.UnloadShader(shadow.sceneShader);
  RL.UnloadRenderTexture(shadow.fbo);
}
