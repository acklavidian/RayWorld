// deno-lint-ignore-file no-explicit-any
import initJolt from "jolt-physics";
import * as RL from "raylib";

// ─── Broad-phase / object layer constants ─────────────────────────────────────

const OBJ_LAYER_STATIC  = 0;
const OBJ_LAYER_DYNAMIC = 1;
const NUM_OBJ_LAYERS    = 2;
const BP_LAYER_STATIC   = 0;
const BP_LAYER_DYNAMIC  = 1;
const NUM_BP_LAYERS     = 2;

// ─── Dynamic body physical properties ────────────────────────────────────────

const DYNAMIC_DENSITY         = 8000;  // kg/m³ — roughly cast iron; default is 1000
const DYNAMIC_FRICTION        = 0.8;   // surface grip
const DYNAMIC_RESTITUTION     = 0.1;   // low bounce
const DYNAMIC_LINEAR_DAMPING  = 0.3;   // resistance to sliding
const DYNAMIC_ANGULAR_DAMPING = 0.4;   // resistance to spinning

// ─── Character controller constants ──────────────────────────────────────────

const CHAR_HALF_HEIGHT = 0.6;          // m — half-height of the cylindrical portion
const CHAR_RADIUS      = 0.3;          // m — capsule radius
// Total capsule height = 2*CHAR_HALF_HEIGHT + 2*CHAR_RADIUS = 1.8 m
const CHAR_MASS        = 70;           // kg
const CHAR_MAX_SLOPE   = Math.PI / 3;  // 60°

// ─── Internal types ───────────────────────────────────────────────────────────

interface DynamicEntry {
  id: any;    // Jolt BodyID
  cx: number; // rest-pose centroid (world space)
  cy: number;
  cz: number;
}

interface StaticDebugEntry {
  verts:    Float32Array;
  indices:  Uint16Array;
  triCount: number;
}

interface DynamicDebugPrimitive {
  verts:    Float32Array;  // centroid-local space
  indices:  Uint16Array;
  triCount: number;
}

// ─── PhysicsWorld ─────────────────────────────────────────────────────────────

export class PhysicsWorld {
  private _J:             any;   // Jolt WASM module
  private _jolt:          any;   // JoltInterface
  private _bi:            any;   // BodyInterface
  private _objPairFilter: any;   // ObjectLayerPairFilterTable  — kept for character filter construction
  private _objVsBpFilter: any;   // ObjectVsBroadPhaseLayerFilterTable — same
  private _dynamics    = new Map<string, DynamicEntry>();
  private _idToName    = new Map<number, string>();  // BodyID index → name (for ray-hit lookup)
  private _staticDebug:  StaticDebugEntry[] = [];
  private _dynamicDebug = new Map<string, DynamicDebugPrimitive[]>();
  private _boxDebug:    Array<{ cx: number; cy: number; cz: number; hx: number; hy: number; hz: number }> = [];

  // Character controller
  private _character:    any = null;  // CharacterVirtual
  private _extUpdateCfg: any = null;  // ExtendedUpdateSettings (allocated once, reused)

  private constructor(
    J: any, jolt: any,
    objPairFilter: any,
    objVsBpFilter: any,
  ) {
    this._J             = J;
    this._jolt          = jolt;
    this._bi            = jolt.GetPhysicsSystem().GetBodyInterface();
    this._objPairFilter = objPairFilter;
    this._objVsBpFilter = objVsBpFilter;
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  static async create(): Promise<PhysicsWorld> {
    const J = await initJolt();

    const objFilter = new J.ObjectLayerPairFilterTable(NUM_OBJ_LAYERS);
    objFilter.EnableCollision(OBJ_LAYER_STATIC,  OBJ_LAYER_DYNAMIC);
    objFilter.EnableCollision(OBJ_LAYER_DYNAMIC, OBJ_LAYER_DYNAMIC);

    const bpIface = new J.BroadPhaseLayerInterfaceTable(NUM_OBJ_LAYERS, NUM_BP_LAYERS);
    bpIface.MapObjectToBroadPhaseLayer(OBJ_LAYER_STATIC,  BP_LAYER_STATIC as any);
    bpIface.MapObjectToBroadPhaseLayer(OBJ_LAYER_DYNAMIC, BP_LAYER_DYNAMIC as any);

    const objBpFilter = new J.ObjectVsBroadPhaseLayerFilterTable(
      bpIface, NUM_BP_LAYERS, objFilter, NUM_OBJ_LAYERS,
    );

    const settings = new J.JoltSettings();
    settings.mObjectLayerPairFilter         = objFilter;
    settings.mBroadPhaseLayerInterface      = bpIface;
    settings.mObjectVsBroadPhaseLayerFilter = objBpFilter;
    // Explicit capacities — Jolt silently drops bodies/contacts when limits are hit.
    settings.mMaxBodies                     = 1024;
    settings.mMaxBodyPairs                  = 65536;
    settings.mMaxContactConstraints         = 10240;

    const jolt = new J.JoltInterface(settings);
    J.destroy(settings);

    // Match rigid-body gravity to the character controller so everything falls
    // at the same rate (Jolt default is -9.81 m/s²).
    const grav = new J.Vec3(0, -18, 0);
    jolt.GetPhysicsSystem().SetGravity(grav);
    J.destroy(grav);

    console.log("[physics] JoltPhysics initialised");
    return new PhysicsWorld(J, jolt, objFilter, objBpFilter);
  }

  // ── Character controller ────────────────────────────────────────────────────

  /**
   * Creates a CharacterVirtual capsule.
   * `x, y, z` is the **feet** position (bottom of the capsule).
   * The capsule centre is placed at y + CHAR_HALF_HEIGHT + CHAR_RADIUS.
   */
  createCharacter(x: number, y: number, z: number): void {
    const J = this._J;

    const capsuleCfg  = new J.CapsuleShapeSettings(CHAR_HALF_HEIGHT, CHAR_RADIUS);
    const shapeResult = capsuleCfg.Create();
    J.destroy(capsuleCfg);

    if (shapeResult.HasError()) {
      console.error("[physics] character capsule error:", shapeResult.GetError().c_str());
      return;
    }

    const charSettings                       = new J.CharacterVirtualSettings();
    charSettings.mMass                       = CHAR_MASS;
    charSettings.mMaxSlopeAngle              = CHAR_MAX_SLOPE;
    charSettings.mShape                      = shapeResult.Get();
    charSettings.mUp                         = new J.Vec3(0, 1, 0);
    // Prevent catching on internal triangle edges (shared edges between adjacent
    // triangles in the nav mesh that Jolt would otherwise treat as obstacles).
    charSettings.mEnhancedInternalEdgeRemoval = true;
    // Collide with both faces of every triangle — guards against winding-order
    // mismatches between the glTF export and Jolt's expected front-face direction.
    charSettings.mBackFaceMode               = J.EBackFaceMode_CollideWithBackFaces;

    const centerY = y + CHAR_HALF_HEIGHT + CHAR_RADIUS;

    this._character = new J.CharacterVirtual(
      charSettings,
      new J.RVec3(x, centerY, z),
      J.Quat.prototype.sIdentity(),
      this._jolt.GetPhysicsSystem(),
    );

    J.destroy(charSettings);

    // Allocate ExtendedUpdateSettings once — reused every step.
    if (this._extUpdateCfg) J.destroy(this._extUpdateCfg);
    this._extUpdateCfg = new J.ExtendedUpdateSettings();

    console.log(
      `[physics] character created at feet (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`,
    );
  }

  /**
   * Moves the character controller one time-step.
   * Set velocity BEFORE calling — this method writes the desired velocity to
   * the character then calls ExtendedUpdate (stair-step + floor-stick).
   *
   * `vx, vz` — desired horizontal velocity in world space (m/s)
   * `vy`     — vertical velocity (m/s, positive = up; caller applies gravity)
   * `dt`     — frame delta (seconds)
   */
  stepCharacter(vx: number, vy: number, vz: number, dt: number): void {
    if (!this._character || !this._extUpdateCfg) return;
    const J = this._J;

    const vel = new J.Vec3(vx, vy, vz);
    this._character.SetLinearVelocity(vel);
    J.destroy(vel);

    const gravity   = new J.Vec3(0, -18, 0);
    const bpFilter  = new J.DefaultBroadPhaseLayerFilter(this._objVsBpFilter, OBJ_LAYER_DYNAMIC);
    const objFilter = new J.DefaultObjectLayerFilter(this._objPairFilter,    OBJ_LAYER_DYNAMIC);
    const bodyFilter  = new J.BodyFilter();
    const shapeFilter = new J.ShapeFilter();

    this._character.ExtendedUpdate(
      dt, gravity, this._extUpdateCfg,
      bpFilter, objFilter, bodyFilter, shapeFilter,
      this._jolt.GetTempAllocator(),
    );

    J.destroy(gravity);
    J.destroy(bpFilter);
    J.destroy(objFilter);
    J.destroy(bodyFilter);
    J.destroy(shapeFilter);
  }

  /**
   * Returns the character's **feet** position (bottom of the capsule) in world space.
   */
  getCharacterFeetPos(): { x: number; y: number; z: number } {
    if (!this._character) return { x: 0, y: 0, z: 0 };
    const pos = this._character.GetPosition();
    return {
      x: pos.GetX(),
      y: pos.GetY() - CHAR_HALF_HEIGHT - CHAR_RADIUS,
      z: pos.GetZ(),
    };
  }

  /**
   * Returns the character's current Y velocity as resolved by the last ExtendedUpdate.
   * Use this as the starting point for gravity / jump each frame so that ceiling hits
   * and external forces are reflected rather than overridden by manual tracking.
   */
  getCharacterVelocityY(): number {
    if (!this._character) return 0;
    return this._character.GetLinearVelocity().GetY();
  }

  /**
   * True when the character is standing on ground (including steep slopes).
   */
  isCharacterGrounded(): boolean {
    if (!this._character) return true;
    const J     = this._J;
    const state = this._character.GetGroundState();
    return state === J.EGroundState_OnGround || state === J.EGroundState_OnSteepGround;
  }

  // ── Body creation ───────────────────────────────────────────────────────────

  /**
   * Add a non-moving triangle-mesh collider.
   * Vertices must already be in world space (Blender: Apply All Transforms).
   *
   * Key: MeshShapeSettings has two overloads —
   *   (TriangleList, PhysicsMaterialList?)               ← 2-arg
   *   (VertexList, IndexedTriangleList, PhysicsMaterialList)  ← 3-arg (materialList required)
   * We always pass all three args so Emscripten picks the correct overload.
   */
  addStatic(verts: Float32Array, indices: Uint16Array, triCount: number): void {
    const J = this._J;

    // Store a copy for debug wireframe rendering (original single-sided data).
    this._staticDebug.push({
      verts:    verts.slice(),
      indices:  indices.slice(),
      triCount,
    });

    // ── Weld duplicate vertices ──────────────────────────────────────────────
    // Merges vertices at the same world position so Jolt can identify shared
    // edges between adjacent triangles.  Without this, every edge looks like
    // a boundary edge and EnhancedInternalEdgeRemoval has nothing to act on —
    // the character catches on every triangle seam in the nav mesh.
    const PREC  = 1e5; // round to 0.01 mm — absorbs float export noise
    const wPos: number[] = [];
    const keyToNew = new Map<string, number>();

    const wIdx = new Uint16Array(triCount * 3);
    for (let i = 0; i < triCount * 3; i++) {
      const s = indices[i];
      const x = Math.round(verts[s * 3]     * PREC) / PREC;
      const y = Math.round(verts[s * 3 + 1] * PREC) / PREC;
      const z = Math.round(verts[s * 3 + 2] * PREC) / PREC;
      const k = `${x},${y},${z}`;
      let   n = keyToNew.get(k);
      if (n === undefined) { n = wPos.length / 3; wPos.push(x, y, z); keyToNew.set(k, n); }
      wIdx[i] = n;
    }
    console.log(`[physics] static mesh: ${verts.length / 3} verts → ${wPos.length / 3} after weld, ${triCount} tris`);

    const vertList = new J.VertexList();
    for (let i = 0; i < wPos.length / 3; i++) {
      const v = new J.Float3(wPos[i * 3], wPos[i * 3 + 1], wPos[i * 3 + 2]);
      vertList.push_back(v);
      J.destroy(v);
    }

    const triList = new J.IndexedTriangleList();
    for (let t = 0; t < triCount; t++) {
      const tri = new J.IndexedTriangle(wIdx[t * 3], wIdx[t * 3 + 1], wIdx[t * 3 + 2], 0);
      triList.push_back(tri);
      J.destroy(tri);
    }

    // Pass an explicit PhysicsMaterialList so Emscripten selects the
    // (VertexList, IndexedTriangleList, PhysicsMaterialList) overload.
    const matList = new J.PhysicsMaterialList();
    const meshCfg = new J.MeshShapeSettings(vertList, triList, matList);
    J.destroy(vertList);
    J.destroy(triList);
    J.destroy(matList);

    // Default threshold cos(5°) = 0.996 marks ANY seam with > 5° normal
    // difference as an active (obstacle) edge.  Lower it to cos(30°) so only
    // real ledges / walls (> 30° angle between adjacent triangles) become
    // obstacles — gentle nav-mesh undulation slides smoothly.
    meshCfg.mActiveEdgeCosThresholdAngle = Math.cos(30 * Math.PI / 180); // ~0.866

    meshCfg.Sanitize(); // removes degenerate triangles before shape creation
    const result = meshCfg.Create();

    if (result.HasError()) {
      console.error("[physics] static mesh shape error:", result.GetError().c_str());
      J.destroy(meshCfg);
      return;
    }

    const bodyCfg = new J.BodyCreationSettings(
      result.Get(),
      new J.RVec3(0, 0, 0),
      J.Quat.prototype.sIdentity(),
      J.EMotionType_Static,
      OBJ_LAYER_STATIC,
    );
    // Let the character controller's contact manifold suppress contacts at
    // internal mesh edges (complements mActiveEdgeCosThresholdAngle above).
    bodyCfg.mEnhancedInternalEdgeRemoval = true;
    const body = this._bi.CreateBody(bodyCfg);
    this._bi.AddBody(body.GetID(), J.EActivation_DontActivate);

    J.destroy(bodyCfg);
    J.destroy(meshCfg);
  }

  /**
   * Adds an AABB box static collider that tightly wraps the supplied vertices.
   * Box shapes have no internal triangle edges so the character slides
   * over them without snagging, making them ideal for building floors and walls.
   */
  addStaticBox(verts: Float32Array): void {
    const J = this._J;
    if (verts.length < 9) return;

    // Compute tight AABB
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < verts.length / 3; i++) {
      const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    // Clamp half-extents to a tiny minimum so Jolt never gets a zero-size box.
    const hx = Math.max((maxX - minX) / 2, 0.001);
    const hy = Math.max((maxY - minY) / 2, 0.001);
    const hz = Math.max((maxZ - minZ) / 2, 0.001);

    // Store for debug wireframe rendering
    this._boxDebug.push({ cx, cy, cz, hx, hy, hz });

    const halfExt = new J.Vec3(hx, hy, hz);
    const boxCfg  = new J.BoxShapeSettings(halfExt);
    J.destroy(halfExt);

    const result = boxCfg.Create();
    J.destroy(boxCfg);

    if (result.HasError()) {
      console.error("[physics] box shape error:", result.GetError().c_str());
      return;
    }

    const bodyCfg = new J.BodyCreationSettings(
      result.Get(),
      new J.RVec3(cx, cy, cz),
      J.Quat.prototype.sIdentity(),
      J.EMotionType_Static,
      OBJ_LAYER_STATIC,
    );
    const body = this._bi.CreateBody(bodyCfg);
    this._bi.AddBody(body.GetID(), J.EActivation_DontActivate);
    J.destroy(bodyCfg);
  }

  /**
   * Add a physics-simulated convex-hull body.
   * Vertices are in world space. The centroid is computed and used as the
   * initial body position; the shape is expressed relative to that centroid.
   */
  addDynamic(
    name: string,
    verts: Float32Array,
    debugPrimitives?: { verts: Float32Array; indices: Uint16Array; triCount: number }[],
  ): void {
    const J = this._J;
    const n = verts.length / 3;
    if (n === 0) return;

    // Centroid → initial world position of the physics body
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      cx += verts[i * 3]; cy += verts[i * 3 + 1]; cz += verts[i * 3 + 2];
    }
    cx /= n; cy /= n; cz /= n;

    // Store per-primitive mesh data in centroid-local space for wireframe debug rendering.
    if (debugPrimitives && debugPrimitives.length > 0) {
      const localPrims: DynamicDebugPrimitive[] = [];
      for (const prim of debugPrimitives) {
        const localVerts = new Float32Array(prim.verts.length);
        for (let i = 0; i < prim.verts.length / 3; i++) {
          localVerts[i * 3]     = prim.verts[i * 3]     - cx;
          localVerts[i * 3 + 1] = prim.verts[i * 3 + 1] - cy;
          localVerts[i * 3 + 2] = prim.verts[i * 3 + 2] - cz;
        }
        localPrims.push({ verts: localVerts, indices: prim.indices, triCount: prim.triCount });
      }
      this._dynamicDebug.set(name, localPrims);
    }

    // Build convex hull with vertices in centroid-local space
    const hullCfg = new J.ConvexHullShapeSettings();
    hullCfg.mDensity = DYNAMIC_DENSITY;
    for (let i = 0; i < n; i++) {
      const v = new J.Vec3(
        verts[i * 3] - cx, verts[i * 3 + 1] - cy, verts[i * 3 + 2] - cz,
      );
      hullCfg.mPoints.push_back(v);
      J.destroy(v);
    }

    const result = hullCfg.Create();
    if (result.HasError()) {
      console.error(`[physics] dynamic hull error for "${name}":`, result.GetError().c_str());
      J.destroy(hullCfg);
      return;
    }

    const bodyCfg = new J.BodyCreationSettings(
      result.Get(),
      new J.RVec3(cx, cy, cz),
      J.Quat.prototype.sIdentity(),
      J.EMotionType_Dynamic,
      OBJ_LAYER_DYNAMIC,
    );
    bodyCfg.mFriction                    = DYNAMIC_FRICTION;
    bodyCfg.mRestitution                 = DYNAMIC_RESTITUTION;
    bodyCfg.mLinearDamping               = DYNAMIC_LINEAR_DAMPING;
    bodyCfg.mAngularDamping              = DYNAMIC_ANGULAR_DAMPING;
    // Continuous collision detection (linear sweep) prevents fast-moving bodies
    // from tunneling through the nav mesh in a single physics step.
    bodyCfg.mMotionQuality               = J.EMotionQuality_LinearCast;
    // Smooth movement along nav mesh triangle edges.
    bodyCfg.mEnhancedInternalEdgeRemoval = true;
    const body   = this._bi.CreateBody(bodyCfg);
    const bodyId = body.GetID();
    this._bi.AddBody(bodyId, J.EActivation_Activate);

    this._dynamics.set(name, { id: bodyId, cx, cy, cz });
    this._idToName.set(bodyId.GetIndexAndSequenceNumber(), name);
    console.log(
      `[physics] dynamic body "${name}" at (${cx.toFixed(2)}, ${cy.toFixed(2)}, ${cz.toFixed(2)})`,
    );

    J.destroy(bodyCfg);
    J.destroy(hullCfg);
  }

  // ── Grab / interaction ──────────────────────────────────────────────────────

  /**
   * Casts a ray from (ox,oy,oz) along (dx,dy,dz) up to maxDist metres.
   * Returns the name and hit distance of the closest dynamic body, or null.
   * Static geometry stops the ray but is never returned — you can't grab walls.
   */
  raycastDynamic(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    maxDist: number,
  ): { name: string; dist: number } | null {
    const J = this._J;

    const ray       = new J.RRayCast(new J.RVec3(ox, oy, oz), new J.Vec3(dx * maxDist, dy * maxDist, dz * maxDist));
    const settings  = new J.RayCastSettings();
    const collector = new J.CastRayClosestHitCollisionCollector();
    const bpFilter  = new J.DefaultBroadPhaseLayerFilter(this._objVsBpFilter, OBJ_LAYER_DYNAMIC);
    const objFilter = new J.DefaultObjectLayerFilter(this._objPairFilter,    OBJ_LAYER_DYNAMIC);
    const bodyFilter  = new J.BodyFilter();
    const shapeFilter = new J.ShapeFilter();

    this._jolt.GetPhysicsSystem().GetNarrowPhaseQuery().CastRay(
      ray, settings, collector, bpFilter, objFilter, bodyFilter, shapeFilter,
    );

    // Read result before destroying collector — mBodyID lives inside collector memory.
    const hadHit = collector.HadHit();
    const idNum  = hadHit ? collector.mHit.mBodyID.GetIndexAndSequenceNumber() : 0;
    const frac   = hadHit ? collector.mHit.mFraction : 1;

    J.destroy(collector); J.destroy(shapeFilter); J.destroy(bodyFilter);
    J.destroy(objFilter);  J.destroy(bpFilter);
    J.destroy(settings);   J.destroy(ray);

    if (!hadHit) return null;
    const name = this._idToName.get(idNum);
    if (!name) return null;               // hit a static body — can't grab
    return { name, dist: frac * maxDist };
  }

  /**
   * Drives a grabbed dynamic body toward world position (tx, ty, tz).
   * Call every frame while the grab button is held, before physics.step().
   * Zeroes angular velocity to stop the object spinning while held.
   */
  setGrabVelocity(
    name: string,
    tx: number, ty: number, tz: number,
    dt: number,
  ): void {
    const entry = this._dynamics.get(name);
    if (!entry) return;
    const J = this._J;

    const pos = this._bi.GetPosition(entry.id);
    const GAIN      = 20;   // m/s per m of positional error
    const MAX_SPEED = 20;   // velocity cap (m/s)

    let vx = (tx - pos.GetX()) * GAIN;
    let vy = (ty - pos.GetY()) * GAIN + 18 * dt;  // +18*dt cancels gravity in the coming step
    let vz = (tz - pos.GetZ()) * GAIN;

    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (spd > MAX_SPEED) { const s = MAX_SPEED / spd; vx *= s; vy *= s; vz *= s; }

    const vel  = new J.Vec3(vx, vy, vz);
    const zero = new J.Vec3(0, 0, 0);
    this._bi.SetLinearAndAngularVelocity(entry.id, vel, zero);
    this._bi.ActivateBody(entry.id);
    J.destroy(vel);
    J.destroy(zero);
  }

  // ── Debug rendering ─────────────────────────────────────────────────────────

  /**
   * Draws all physics collider shapes as wireframe lines.
   * Must be called inside BeginMode3D / EndMode3D.
   * Note: creates temporary Vector3 objects per triangle — disable when not needed.
   */
  drawColliderWireframes(color: RL.Color): void {
    // Static mesh colliders — draw each triangle as three edges
    for (const { verts, indices, triCount } of this._staticDebug) {
      for (let t = 0; t < triCount; t++) {
        const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
        const a = new RL.Vector3(verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2]);
        const b = new RL.Vector3(verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2]);
        const c = new RL.Vector3(verts[i2 * 3], verts[i2 * 3 + 1], verts[i2 * 3 + 2]);
        RL.DrawLine3D(a, b, color);
        RL.DrawLine3D(b, c, color);
        RL.DrawLine3D(c, a, color);
      }
    }

    // Dynamic bodies — draw mesh wireframe with current physics transform
    for (const [name, prims] of this._dynamicDebug) {
      const entry = this._dynamics.get(name);
      if (!entry) continue;

      const pos = this._bi.GetPosition(entry.id);
      const rot = this._bi.GetRotation(entry.id);
      const px = pos.GetX(), py = pos.GetY(), pz = pos.GetZ();
      const qx = rot.GetX(), qy = rot.GetY(), qz = rot.GetZ(), qw = rot.GetW();

      for (const { verts, indices, triCount } of prims) {
        for (let t = 0; t < triCount; t++) {
          const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
          const a = _qrotate(verts[i0*3], verts[i0*3+1], verts[i0*3+2], qx, qy, qz, qw, px, py, pz);
          const b = _qrotate(verts[i1*3], verts[i1*3+1], verts[i1*3+2], qx, qy, qz, qw, px, py, pz);
          const c = _qrotate(verts[i2*3], verts[i2*3+1], verts[i2*3+2], qx, qy, qz, qw, px, py, pz);
          RL.DrawLine3D(new RL.Vector3(a.x, a.y, a.z), new RL.Vector3(b.x, b.y, b.z), color);
          RL.DrawLine3D(new RL.Vector3(b.x, b.y, b.z), new RL.Vector3(c.x, c.y, c.z), color);
          RL.DrawLine3D(new RL.Vector3(c.x, c.y, c.z), new RL.Vector3(a.x, a.y, a.z), color);
        }
      }
    }

    // Box colliders — draw 12-edge wireframe cube
    for (const { cx, cy, cz, hx, hy, hz } of this._boxDebug) {
      const x0 = cx - hx, x1 = cx + hx;
      const y0 = cy - hy, y1 = cy + hy;
      const z0 = cz - hz, z1 = cz + hz;
      // Bottom face
      RL.DrawLine3D(new RL.Vector3(x0, y0, z0), new RL.Vector3(x1, y0, z0), color);
      RL.DrawLine3D(new RL.Vector3(x1, y0, z0), new RL.Vector3(x1, y0, z1), color);
      RL.DrawLine3D(new RL.Vector3(x1, y0, z1), new RL.Vector3(x0, y0, z1), color);
      RL.DrawLine3D(new RL.Vector3(x0, y0, z1), new RL.Vector3(x0, y0, z0), color);
      // Top face
      RL.DrawLine3D(new RL.Vector3(x0, y1, z0), new RL.Vector3(x1, y1, z0), color);
      RL.DrawLine3D(new RL.Vector3(x1, y1, z0), new RL.Vector3(x1, y1, z1), color);
      RL.DrawLine3D(new RL.Vector3(x1, y1, z1), new RL.Vector3(x0, y1, z1), color);
      RL.DrawLine3D(new RL.Vector3(x0, y1, z1), new RL.Vector3(x0, y1, z0), color);
      // Vertical edges
      RL.DrawLine3D(new RL.Vector3(x0, y0, z0), new RL.Vector3(x0, y1, z0), color);
      RL.DrawLine3D(new RL.Vector3(x1, y0, z0), new RL.Vector3(x1, y1, z0), color);
      RL.DrawLine3D(new RL.Vector3(x1, y0, z1), new RL.Vector3(x1, y1, z1), color);
      RL.DrawLine3D(new RL.Vector3(x0, y0, z1), new RL.Vector3(x0, y1, z1), color);
    }
  }

  // ── Broadphase ──────────────────────────────────────────────────────────────

  /**
   * Must be called once after all static bodies have been added and before the
   * first simulation step.  Builds the static broadphase acceleration tree so
   * that dynamic bodies (and the character controller) can collide against it.
   */
  optimizeBroadPhase(): void {
    this._jolt.GetPhysicsSystem().OptimizeBroadPhase();
    console.log("[physics] broadphase optimised");
  }

  // ── Simulation ──────────────────────────────────────────────────────────────

  step(dt: number): void {
    this._jolt.Step(Math.min(dt, 0.1), 1);

    // Kill plane: deactivate dynamic bodies that fall below Y=-50
    for (const [name, entry] of this._dynamics) {
      const pos = this._bi.GetPosition(entry.id);
      if (pos.GetY() < -50) {
        this._bi.DeactivateBody(entry.id);
      }
    }
  }

  // ── Query ───────────────────────────────────────────────────────────────────

  /**
   * Returns the raylib world-space Matrix for a named dynamic body.
   * Computes: v' = R * (v - centroid) + physPos
   * Built manually to match the proven wireframe rendering math.
   */
  getDynamicTransform(name: string): RL.Matrix | null {
    const entry = this._dynamics.get(name);
    if (!entry) return null;

    const pos = this._bi.GetPosition(entry.id);
    const rot = this._bi.GetRotation(entry.id);

    const px = pos.GetX(), py = pos.GetY(), pz = pos.GetZ();
    const qx = rot.GetX(), qy = rot.GetY(), qz = rot.GetZ(), qw = rot.GetW();
    const cx = entry.cx, cy = entry.cy, cz = entry.cz;

    // Rotation matrix from quaternion (standard: v' = R * v)
    const xx = qx * qx, yy = qy * qy, zz = qz * qz;
    const xy = qx * qy, xz = qx * qz, yz = qy * qz;
    const wx = qw * qx, wy = qw * qy, wz = qw * qz;

    const r00 = 1 - 2 * (yy + zz), r01 = 2 * (xy - wz),     r02 = 2 * (xz + wy);
    const r10 = 2 * (xy + wz),     r11 = 1 - 2 * (xx + zz),  r12 = 2 * (yz - wx);
    const r20 = 2 * (xz - wy),     r21 = 2 * (yz + wx),      r22 = 1 - 2 * (xx + yy);

    // Translation = pos - R * centroid
    const tx = px - (r00 * cx + r01 * cy + r02 * cz);
    const ty = py - (r10 * cx + r11 * cy + r12 * cz);
    const tz = pz - (r20 * cx + r21 * cy + r22 * cz);

    // Build column-major raylib Matrix directly
    // Row layout: row0=(m0,m1,m2,m3), row1=(m4,m5,m6,m7), etc.
    return new RL.Matrix({
      m0: r00,  m1: r01,  m2: r02,  m3: tx,
      m4: r10,  m5: r11,  m6: r12,  m7: ty,
      m8: r20,  m9: r21,  m10: r22, m11: tz,
      m12: 0,   m13: 0,   m14: 0,   m15: 1,
    });
  }

  dynamicNames(): IterableIterator<string> {
    return this._dynamics.keys();
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  destroy(): void {
    if (this._extUpdateCfg) this._J.destroy(this._extUpdateCfg);
    this._J.destroy(this._jolt);
  }
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/**
 * Rotates local vector (lx, ly, lz) by unit quaternion (qx, qy, qz, qw)
 * then adds world translation (tx, ty, tz).
 * Uses the Rodrigues-style formula:  v' = v + 2*qw*(q×v) + 2*(q×(q×v))
 */
function _qrotate(
  lx: number, ly: number, lz: number,
  qx: number, qy: number, qz: number, qw: number,
  tx: number, ty: number, tz: number,
): { x: number; y: number; z: number } {
  const t0 = 2 * (qy * lz - qz * ly);
  const t1 = 2 * (qz * lx - qx * lz);
  const t2 = 2 * (qx * ly - qy * lx);
  return {
    x: lx + qw * t0 + (qy * t2 - qz * t1) + tx,
    y: ly + qw * t1 + (qz * t0 - qx * t2) + ty,
    z: lz + qw * t2 + (qx * t1 - qy * t0) + tz,
  };
}
