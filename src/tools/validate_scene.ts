#!/usr/bin/env -S deno run --allow-read
/**
 * Standalone scene validator — checks metadata in a GLB file without starting
 * the game or loading raylib.
 *
 * Usage: deno run --allow-read src/tools/validate_scene.ts [path/to/scene.glb]
 */

import { parseGlbJson, GltfJson } from "../scene.ts";
import { validateScene, parseNodeMetadata, ValidationMessage } from "../metadata.ts";

const scenePath = Deno.args[0] ?? "assets/scene.glb";

let gltf: GltfJson;
try {
  gltf = parseGlbJson(scenePath);
} catch (e) {
  console.error(`Failed to parse ${scenePath}: ${e}`);
  Deno.exit(1);
}

console.log(`Validating scene: ${scenePath}`);
console.log(`Nodes: ${gltf.nodes?.length ?? 0}`);
console.log(`Meshes: ${gltf.meshes?.length ?? 0}`);
console.log("");

// Per-node validation
const nodes = gltf.nodes ?? [];
const allMessages: ValidationMessage[] = [];

for (const node of nodes) {
  const name = node.name ?? "(unnamed)";
  const { metadata, messages } = parseNodeMetadata(name, node.extras);
  allMessages.push(...messages);

  // Summary line per node with metadata
  if (Object.keys(metadata).length > 0) {
    const fields = Object.entries(metadata)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(", ");
    console.log(`  ${name}: ${fields}`);
  }
}

// Scene-level checks
const result = validateScene(nodes);
allMessages.push(...result.messages);

// Deduplicate (parseNodeMetadata is called twice — once per-node, once in validateScene)
const seen = new Set<string>();
const unique: ValidationMessage[] = [];
for (const msg of allMessages) {
  const key = `${msg.level}:${msg.node}:${msg.message}`;
  if (!seen.has(key)) { seen.add(key); unique.push(msg); }
}

// Report
console.log("");
const errors   = unique.filter(m => m.level === "error");
const warnings = unique.filter(m => m.level === "warning");

if (warnings.length > 0) {
  console.log(`Warnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ⚠ [${w.node}] ${w.message}`);
}

if (errors.length > 0) {
  console.log(`Errors (${errors.length}):`);
  for (const e of errors) console.log(`  ✗ [${e.node}] ${e.message}`);
}

if (errors.length === 0 && warnings.length === 0) {
  console.log("✓ Scene metadata valid — no issues found.");
}

Deno.exit(errors.length > 0 ? 1 : 0);
