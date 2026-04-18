import { BehaviorFactory } from "./behavior.ts";

// ─── Prefab Definition ───────────────────────────────────────────────────────

export interface PrefabDef {
  /** Unique name matching the `prefab` metadata field in Blender. */
  name: string;

  /** Behavior factories — each creates one Behavior instance per object. */
  behaviors: BehaviorFactory[];

  /** Default tags applied to every object using this prefab. */
  defaultTags?: string[];
}

// ─── Prefab Registry ─────────────────────────────────────────────────────────

const _prefabs = new Map<string, PrefabDef>();

export function registerPrefab(def: PrefabDef): void {
  if (_prefabs.has(def.name)) {
    console.warn(`[prefab] overwriting existing prefab "${def.name}"`);
  }
  _prefabs.set(def.name, def);
  console.log(`[prefab] registered "${def.name}"`);
}

export function getPrefab(name: string): PrefabDef | undefined {
  return _prefabs.get(name);
}

export function getAllPrefabNames(): string[] {
  return [..._prefabs.keys()];
}

export function clearPrefabs(): void {
  _prefabs.clear();
}
