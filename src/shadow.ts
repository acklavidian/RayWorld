import * as RL from "raylib";
import { getMesh } from "./scene.ts";

// ─── Shader sources ───────────────────────────────────────────────────────────

// Depth pass: uses raylib's built-in `mvp` uniform (set by BeginMode3D with the
// light camera) so we get the correct orthographic projection for free.
const DEPTH_VS = `#version 330
in vec3 vertexPosition;
uniform mat4 mvp;
void main() { gl_Position = mvp * vec4(vertexPosition, 1.0); }
`;
const DEPTH_FS = `#version 330
out vec4 finalColor;
void main() { finalColor = vec4(1.0); }   // colour unused; depth fills FBO automatically
`;

// Main scene pass: Blinn-Phong + 3×3 PCF shadow mapping.
// lightVP is computed CPU-side to exactly match raylib's internal depth-pass
// MVP (including the Y-flip raylib applies when rendering to render textures).
const SCENE_VS = `#version 330
in vec3 vertexPosition;
in vec2 vertexTexCoord;
in vec3 vertexNormal;
in vec4 vertexColor;
uniform mat4 mvp;
uniform mat4 matModel;
uniform mat4 matNormal;
out vec3 fragPosition;
out vec2 fragTexCoord;
out vec3 fragNormal;
void main() {
    fragPosition = vec3(matModel * vec4(vertexPosition, 1.0));
    fragTexCoord = vertexTexCoord;
    fragNormal   = normalize(vec3(matNormal * vec4(vertexNormal, 1.0)));
    gl_Position  = mvp * vec4(vertexPosition, 1.0);
}
`;
const SCENE_FS = `#version 330
in vec3 fragPosition;
in vec2 fragTexCoord;
in vec3 fragNormal;
uniform sampler2D texture0;     // albedo
uniform vec4      colDiffuse;
uniform vec3      lightDir;     // unit vector from light toward scene
uniform vec4      lightColor;
uniform vec4      ambient;      // unused (kept for uniform compatibility)
uniform vec3      viewPos;
uniform mat4      lightVP;      // matches the depth-pass MVP exactly
uniform sampler2D shadowMap;
uniform int       shadowMapResolution;

// Point lights
#define MAX_POINT_LIGHTS 16
uniform int   numPointLights;
uniform vec3  pointLightPos[MAX_POINT_LIGHTS];
uniform vec3  pointLightColor[MAX_POINT_LIGHTS];
uniform float pointLightRange[MAX_POINT_LIGHTS];

out vec4 finalColor;
void main() {
    vec4 texelColor = texture(texture0, fragTexCoord);
    vec3 normal     = normalize(fragNormal);
    vec3 l          = -lightDir;
    float NdotL     = max(dot(normal, l), 0.0);
    vec3 viewD      = normalize(viewPos - fragPosition);

    // Hemisphere ambient: dim base lighting
    vec3 skyAmbient    = vec3(0.06, 0.07, 0.10);
    vec3 groundAmbient = vec3(0.02, 0.015, 0.015);
    float hemi         = dot(normal, vec3(0.0, 1.0, 0.0)) * 0.5 + 0.5;
    vec3 ambientLight  = mix(groundAmbient, skyAmbient, hemi);

    // Blinn-Phong specular for directional light
    float specCo = 0.0;
    if (NdotL > 0.0) {
        vec3 halfV = normalize(l + viewD);
        specCo = pow(max(dot(normal, halfV), 0.0), 32.0);
    }

    // Direct (sun) light contribution — modulated by shadow
    vec3 directLight = lightColor.rgb * NdotL + vec3(specCo * 0.3);

    // Transform fragment to light clip space, then to [0,1] UV range
    vec4 lsPos = lightVP * vec4(fragPosition, 1.0);
    lsPos.xyz /= lsPos.w;
    lsPos.xyz  = (lsPos.xyz + 1.0) * 0.5;
    float curDepth = lsPos.z;
    float bias     = max(0.0002 * (1.0 - dot(normal, l)), 0.00002) + 0.00001;

    // 3x3 PCF shadow
    int  hits   = 0;
    vec2 texel  = vec2(1.0 / float(shadowMapResolution));
    for (int x = -1; x <= 1; x++)
        for (int y = -1; y <= 1; y++)
            if (curDepth - bias > texture(shadowMap, lsPos.xy + texel * vec2(x, y)).r)
                hits++;
    float shadowFactor = 1.0 - float(hits) / 9.0;

    // Point lights — local illumination with falloff
    vec3 pointLighting = vec3(0.0);
    for (int i = 0; i < numPointLights; i++) {
        vec3 toLight = pointLightPos[i] - fragPosition;
        float dist = length(toLight);
        float range = pointLightRange[i];
        if (dist < range) {
            vec3 plDir = toLight / dist;
            float plNdotL = max(dot(normal, plDir), 0.0);
            // Smooth quadratic falloff
            float t = 1.0 - dist / range;
            float atten = t * t;
            pointLighting += pointLightColor[i] * plNdotL * atten;
            // Point light specular
            if (plNdotL > 0.0) {
                vec3 plHalf = normalize(plDir + viewD);
                float plSpec = pow(max(dot(normal, plHalf), 0.0), 48.0);
                pointLighting += pointLightColor[i] * plSpec * atten * 0.4;
            }
        }
    }

    // Combine: ambient always visible, sun modulated by shadow, point lights unshadowed
    vec3 albedo = texelColor.rgb * colDiffuse.rgb;
    vec3 color  = albedo * (ambientLight + directLight * shadowFactor * 0.15 + pointLighting);

    // Gamma correction
    finalColor = vec4(pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), texelColor.a * colDiffuse.a);
}
`;

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
