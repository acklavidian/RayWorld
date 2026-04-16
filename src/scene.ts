import * as RL from "raylib";

// ─── GLB / glTF JSON types ────────────────────────────────────────────────────

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
}

export interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  name?: string;
  mesh?: number; // index into gltf.meshes
  translation?: [number, number, number];
}

export interface GltfJson {
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
}

// ─── GLB parsing ──────────────────────────────────────────────────────────────

/**
 * Reads the JSON chunk embedded in a GLB file and returns the parsed glTF JSON.
 * GLB magic = "glTF" (0x46546C67), JSON chunk at byte offset 20.
 */
export function parseGlbJson(path: string): GltfJson {
  const data = Deno.readFileSync(path);
  const view = new DataView(data.buffer);
  if (view.getUint32(0, true) !== 0x46546C67) {
    throw new Error(`Not a GLB file: ${path}`);
  }
  const jsonChunkLen = view.getUint32(12, true);
  const jsonBytes    = data.slice(20, 20 + jsonChunkLen);
  return JSON.parse(new TextDecoder().decode(jsonBytes)) as GltfJson;
}

/** Finds the first glTF node whose name matches. */
export function findNode(gltf: GltfJson, name: string): GltfNode | undefined {
  return gltf.nodes?.find((n) => n.name === name);
}

/**
 * Resolves which raylib mesh indices (start … start+count-1) correspond to the
 * glTF node named `nodeName`.  Returns null when the node doesn't exist or has
 * no mesh.
 *
 * Raylib flattens all glTF primitives into a single Mesh[] array, so we sum
 * primitive counts of preceding meshes to find the correct offset.
 */
export function resolveRaylibMeshRange(
  gltf: GltfJson,
  nodeName: string,
): { start: number; count: number } | null {
  const node = findNode(gltf, nodeName);
  if (node?.mesh === undefined) return null;
  const gltfMeshIndex = node.mesh;
  let start = 0;
  for (let i = 0; i < gltfMeshIndex; i++) {
    start += gltf.meshes![i].primitives.length;
  }
  return { start, count: gltf.meshes![gltfMeshIndex].primitives.length };
}

// ─── Model / mesh helpers ─────────────────────────────────────────────────────

/** Returns the Mesh at `index` from a loaded Model. */
export function getMesh(model: RL.Model, index: number): RL.Mesh {
  const ptr = Deno.UnsafePointer.create(model.meshesPtr);
  if (!ptr) throw new Error("Model meshes pointer is null");
  const pv     = new Deno.UnsafePointerView(ptr);
  const offset = index * RL.Mesh.SIZE;
  const buf    = pv.getArrayBuffer(offset + RL.Mesh.SIZE);
  return new RL.Mesh(
    new Uint8Array(buf, offset, RL.Mesh.SIZE) as Uint8Array<ArrayBuffer>,
  );
}

/** Returns the Material at `index` from a loaded Model. */
export function getMaterial(model: RL.Model, index: number): RL.Material {
  const ptr = Deno.UnsafePointer.create(model.materialsPtr);
  if (!ptr) throw new Error("Model materials pointer is null");
  const pv     = new Deno.UnsafePointerView(ptr);
  const offset = index * RL.Material.SIZE;
  const buf    = pv.getArrayBuffer(offset + RL.Material.SIZE);
  return new RL.Material(
    new Uint8Array(buf, offset, RL.Material.SIZE) as Uint8Array<ArrayBuffer>,
  );
}

/** Reads the int[] that maps each mesh index to its material index. */
export function getMeshMaterialIndex(model: RL.Model, meshIndex: number): number {
  const ptr = Deno.UnsafePointer.create(model.meshMaterialPtr);
  if (!ptr) return 0;
  return new Deno.UnsafePointerView(ptr).getInt32(meshIndex * 4);
}

/**
 * Returns one Material per mesh, cloned from the model's original materials
 * but with `shader` replaced.  The mapsPtr still points into model memory so
 * the albedo texture remains accessible during DrawMesh.
 */
export function makeSceneMaterials(
  model: RL.Model,
  shader: RL.Shader,
): RL.Material[] {
  const mats: RL.Material[] = [];
  for (let i = 0; i < model.meshCount; i++) {
    const matIdx  = getMeshMaterialIndex(model, i);
    const origMat = getMaterial(model, matIdx);
    const buf     = new Uint8Array(RL.Material.SIZE);
    buf.set(origMat.buffer);
    const mat  = new RL.Material(buf);
    mat.shader = shader;
    mats.push(mat);
  }
  return mats;
}
