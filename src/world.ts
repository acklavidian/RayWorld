import type { Behavior } from "./behavior.ts";

// ─── WorldObject Definition ──────────────────────────────────────────────────

/** Declarative shape parsed from a GLB scene node. */
export interface WorldObjectDef {
  name:          string;
  physicsType:   string;                              // "building" | "static" | "dynamic" | ""
  meshRange:     { start: number; count: number } | null;
  spawnPosition: [number, number, number] | null;
  extras:        Record<string, unknown>;
}

// ─── WorldObject ─────────────────────────────────────────────────────────────

let _nextId = 1;

export class WorldObject {
  readonly id:   number;
  readonly name: string;
  readonly tags: Set<string>;
  readonly def:  WorldObjectDef;
  physicsBodyName: string | null;
  behaviors: Behavior[] = [];

  constructor(def: WorldObjectDef) {
    this.id              = _nextId++;
    this.name            = def.name;
    this.tags            = new Set<string>();
    this.def             = def;
    this.physicsBodyName = def.physicsType === "dynamic" ? def.name : null;
  }
}

// ─── WorldRegistry ───────────────────────────────────────────────────────────

export class WorldRegistry {
  private _byId   = new Map<number, WorldObject>();
  private _byName = new Map<string, WorldObject>();
  private _byTag  = new Map<string, Set<WorldObject>>();

  add(def: WorldObjectDef): WorldObject {
    const obj = new WorldObject(def);
    this._byId.set(obj.id, obj);
    this._byName.set(obj.name, obj);
    for (const tag of obj.tags) {
      this._getTagSet(tag).add(obj);
    }
    return obj;
  }

  getById(id: number): WorldObject | undefined {
    return this._byId.get(id);
  }

  getByName(name: string): WorldObject | undefined {
    return this._byName.get(name);
  }

  getByTag(tag: string): Set<WorldObject> {
    return this._byTag.get(tag) ?? new Set();
  }

  addTag(obj: WorldObject, tag: string): void {
    obj.tags.add(tag);
    this._getTagSet(tag).add(obj);
  }

  removeTag(obj: WorldObject, tag: string): void {
    obj.tags.delete(tag);
    const set = this._byTag.get(tag);
    if (set) {
      set.delete(obj);
      if (set.size === 0) this._byTag.delete(tag);
    }
  }

  remove(obj: WorldObject): void {
    this._byId.delete(obj.id);
    this._byName.delete(obj.name);
    for (const tag of obj.tags) {
      const set = this._byTag.get(tag);
      if (set) {
        set.delete(obj);
        if (set.size === 0) this._byTag.delete(tag);
      }
    }
  }

  all(): IterableIterator<WorldObject> {
    return this._byId.values();
  }

  get count(): number {
    return this._byId.size;
  }

  clear(): void {
    this._byId.clear();
    this._byName.clear();
    this._byTag.clear();
  }

  private _getTagSet(tag: string): Set<WorldObject> {
    let set = this._byTag.get(tag);
    if (!set) { set = new Set(); this._byTag.set(tag, set); }
    return set;
  }
}
