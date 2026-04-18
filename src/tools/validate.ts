#!/usr/bin/env -S deno run --allow-read
/**
 * Unified validation entry point — runs all validators.
 *
 * Usage: deno task validate [path/to/scene.glb]
 */

import { parseGlbJson, GltfJson } from "../scene.ts";
import { validateScene, parseNodeMetadata, ValidationMessage } from "../metadata.ts";
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

const nodes = gltf.nodes ?? [];
let totalErrors   = 0;
let totalWarnings = 0;

// ─── 1. Scene metadata validation ────────────────────────────────────────────

console.log("═══ Scene Metadata ═══");
console.log(`File: ${scenePath}`);
console.log(`Nodes: ${nodes.length}, Meshes: ${gltf.meshes?.length ?? 0}`);
console.log("");

const sceneResult = validateScene(nodes);
for (const msg of sceneResult.messages) {
  const icon = msg.level === "error" ? "✗" : "⚠";
  console.log(`  ${icon} [${msg.node}] ${msg.message}`);
}
totalErrors   += sceneResult.messages.filter(m => m.level === "error").length;
totalWarnings += sceneResult.messages.filter(m => m.level === "warning").length;

if (sceneResult.messages.length === 0) {
  console.log("  ✓ No metadata issues.");
}
console.log("");

// ─── 2. Prefab reference validation ─────────────────────────────────────────

console.log("═══ Prefab References ═══");
const registeredPrefabs = new Set(getAllPrefabNames());
console.log(`Registered: ${[...registeredPrefabs].join(", ") || "(none)"}`);

const referencedPrefabs = new Set<string>();
for (const node of nodes) {
  const name = node.name ?? "(unnamed)";
  const { metadata } = parseNodeMetadata(name, node.extras);
  if (metadata.prefab) {
    referencedPrefabs.add(metadata.prefab);
    if (!registeredPrefabs.has(metadata.prefab)) {
      console.log(`  ✗ [${name}] references unknown prefab "${metadata.prefab}"`);
      totalErrors++;
    }
  }
  if (metadata.networked && !metadata.prefab) {
    console.log(`  ⚠ [${name}] is networked but has no prefab`);
    totalWarnings++;
  }
}

if (referencedPrefabs.size === 0) {
  console.log("  (no prefab references in scene)");
}

// Check for duplicate trigger IDs (already covered by validateScene, but show separately)
const triggerIds = new Map<string, string[]>();
for (const node of nodes) {
  const name = node.name ?? "(unnamed)";
  const { metadata } = parseNodeMetadata(name, node.extras);
  if (metadata.triggerId) {
    const arr = triggerIds.get(metadata.triggerId) ?? [];
    arr.push(name);
    triggerIds.set(metadata.triggerId, arr);
  }
}

for (const [tid, names] of triggerIds) {
  if (names.length > 1) {
    console.log(`  ⚠ Duplicate triggerId "${tid}" on: ${names.join(", ")}`);
  }
}

console.log("");

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("═══ Summary ═══");
if (totalErrors === 0 && totalWarnings === 0) {
  console.log("✓ All checks passed — no issues found.");
} else {
  if (totalErrors > 0)   console.log(`✗ ${totalErrors} error(s)`);
  if (totalWarnings > 0) console.log(`⚠ ${totalWarnings} warning(s)`);
}

Deno.exit(totalErrors > 0 ? 1 : 0);
