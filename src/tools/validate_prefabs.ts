#!/usr/bin/env -S deno run --allow-read
/**
 * Validates prefab references in a GLB scene against registered prefabs.
 *
 * Usage: deno run --allow-read src/tools/validate_prefabs.ts [path/to/scene.glb]
 *
 * Note: This only checks that prefab names referenced in scene metadata exist
 * in the prefab registry. Run after importing all prefab registrations.
 */

import { parseGlbJson, GltfJson } from "../scene.ts";
import { parseNodeMetadata } from "../metadata.ts";
import { getAllPrefabNames } from "../prefab.ts";

// Import all prefabs so the registry is populated
import "../prefabs/mod.ts";

const scenePath = Deno.args[0] ?? "assets/scene.glb";

let gltf: GltfJson;
try {
  gltf = parseGlbJson(scenePath);
} catch (e) {
  console.error(`Failed to parse ${scenePath}: ${e}`);
  Deno.exit(1);
}

console.log(`Validating prefab references: ${scenePath}`);

const registeredPrefabs = new Set(getAllPrefabNames());
console.log(`Registered prefabs: ${[...registeredPrefabs].join(", ") || "(none)"}`);
console.log("");

let errors = 0;
const referencedPrefabs = new Set<string>();
const unreferencedPrefabs = new Set(registeredPrefabs);

for (const node of gltf.nodes ?? []) {
  const name = node.name ?? "(unnamed)";
  const { metadata } = parseNodeMetadata(name, node.extras);

  if (metadata.prefab) {
    referencedPrefabs.add(metadata.prefab);
    unreferencedPrefabs.delete(metadata.prefab);

    if (!registeredPrefabs.has(metadata.prefab)) {
      console.log(`  ✗ [${name}] references unknown prefab "${metadata.prefab}"`);
      errors++;
    } else {
      console.log(`  ✓ [${name}] → prefab "${metadata.prefab}"`);
    }
  }
}

// Check for networked objects without a prefab (potential policy issue)
for (const node of gltf.nodes ?? []) {
  const name = node.name ?? "(unnamed)";
  const { metadata } = parseNodeMetadata(name, node.extras);
  if (metadata.networked && !metadata.prefab) {
    console.log(`  ⚠ [${name}] is networked but has no prefab — may lack sync policy`);
  }
}

console.log("");

if (unreferencedPrefabs.size > 0) {
  console.log(`Unreferenced prefabs (registered but not used in scene):`);
  for (const p of unreferencedPrefabs) {
    console.log(`  - ${p}`);
  }
}

if (referencedPrefabs.size === 0) {
  console.log("No prefab references found in scene.");
}

if (errors > 0) {
  console.log(`\n✗ ${errors} error(s) found.`);
} else {
  console.log("\n✓ All prefab references valid.");
}

Deno.exit(errors > 0 ? 1 : 0);
