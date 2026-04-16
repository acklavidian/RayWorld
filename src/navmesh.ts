import * as RL from "raylib";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavTri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

// ─── Build ────────────────────────────────────────────────────────────────────

/**
 * Reads vertex and index data from a raylib Mesh and returns a flat list of
 * triangles used for height-field queries and movement constraints.
 */
export function buildNavMesh(mesh: RL.Mesh): NavTri[] {
  const vPtr = Deno.UnsafePointer.create(mesh.verticesPtr);
  if (!vPtr) throw new Error("Nav mesh has no vertex data");
  const verts = new Float32Array(
    new Deno.UnsafePointerView(vPtr).getArrayBuffer(mesh.vertexCount * 12),
  );

  let indices: Uint16Array | null = null;
  if (mesh.indicesPtr !== 0n) {
    const iPtr = Deno.UnsafePointer.create(mesh.indicesPtr);
    if (iPtr) {
      indices = new Uint16Array(
        new Deno.UnsafePointerView(iPtr).getArrayBuffer(mesh.triangleCount * 6),
      );
    }
  }

  const tris: NavTri[] = [];
  for (let t = 0; t < mesh.triangleCount; t++) {
    const i0 = indices ? indices[t * 3]     : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    tris.push({
      ax: verts[i0 * 3], ay: verts[i0 * 3 + 1], az: verts[i0 * 3 + 2],
      bx: verts[i1 * 3], by: verts[i1 * 3 + 1], bz: verts[i1 * 3 + 2],
      cx: verts[i2 * 3], cy: verts[i2 * 3 + 1], cz: verts[i2 * 3 + 2],
    });
  }
  return tris;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Returns the interpolated surface Y at (x, z) using barycentric coordinates
 * projected onto XZ, or null when (x, z) is outside every triangle.
 */
export function navHeight(tris: NavTri[], x: number, z: number): number | null {
  for (const t of tris) {
    const dx0 = t.bx - t.ax, dz0 = t.bz - t.az;
    const dx1 = t.cx - t.ax, dz1 = t.cz - t.az;
    const px   = x - t.ax,   pz   = z - t.az;
    const d00  = dx0 * dx0 + dz0 * dz0;
    const d01  = dx0 * dx1 + dz0 * dz1;
    const d11  = dx1 * dx1 + dz1 * dz1;
    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) < 1e-8) continue;
    const v = (d11 * (px * dx0 + pz * dz0) - d01 * (px * dx1 + pz * dz1)) / denom;
    const w = (d00 * (px * dx1 + pz * dz1) - d01 * (px * dx0 + pz * dz0)) / denom;
    if (v >= -0.001 && w >= -0.001 && v + w <= 1.001) {
      return (1 - v - w) * t.ay + v * t.by + w * t.cy;
    }
  }
  return null;
}
