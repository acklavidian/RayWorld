// ─── Scene Node Metadata ─────────────────────────────────────────────────────
// Canonical fields recognized in Blender custom properties (glTF extras).

export interface SceneNodeMetadata {
  physicsType?:   "building" | "static" | "dynamic";
  prefab?:        string;
  tags?:          string[];       // comma-separated in Blender, parsed to array
  triggerId?:     string;
  spawnType?:     "player" | "item" | "npc";
  networked?:     boolean;
  interactable?:  boolean;
  scriptParams?:  Record<string, unknown>;
}

// ─── Known field names ───────────────────────────────────────────────────────

const KNOWN_FIELDS = new Set<string>([
  "physicsType",
  "prefab",
  "tags",
  "triggerId",
  "spawnType",
  "networked",
  "interactable",
  "scriptParams",
]);

const VALID_PHYSICS_TYPES = new Set(["building", "static", "dynamic"]);
const VALID_SPAWN_TYPES   = new Set(["player", "item", "npc"]);

// ─── Validation result ───────────────────────────────────────────────────────

export interface ValidationMessage {
  level:   "error" | "warning";
  node:    string;
  message: string;
}

// ─── Parser / validator ──────────────────────────────────────────────────────

export function parseNodeMetadata(
  nodeName: string,
  extras: Record<string, unknown> | undefined,
): { metadata: SceneNodeMetadata; messages: ValidationMessage[] } {
  const messages: ValidationMessage[] = [];
  const metadata: SceneNodeMetadata = {};

  if (!extras) return { metadata, messages };

  // Warn on unknown fields
  for (const key of Object.keys(extras)) {
    if (!KNOWN_FIELDS.has(key)) {
      messages.push({ level: "warning", node: nodeName, message: `Unknown metadata field "${key}"` });
    }
  }

  // physicsType
  if ("physicsType" in extras) {
    const val = extras["physicsType"];
    if (typeof val !== "string" || !VALID_PHYSICS_TYPES.has(val)) {
      messages.push({
        level: "error", node: nodeName,
        message: `physicsType must be one of: ${[...VALID_PHYSICS_TYPES].join(", ")} (got "${val}")`,
      });
    } else {
      metadata.physicsType = val as SceneNodeMetadata["physicsType"];
    }
  }

  // prefab
  if ("prefab" in extras) {
    const val = extras["prefab"];
    if (typeof val !== "string" || val.length === 0) {
      messages.push({ level: "error", node: nodeName, message: `prefab must be a non-empty string` });
    } else {
      metadata.prefab = val;
    }
  }

  // tags
  if ("tags" in extras) {
    const val = extras["tags"];
    if (typeof val === "string") {
      metadata.tags = val.split(",").map(t => t.trim()).filter(t => t.length > 0);
    } else if (Array.isArray(val)) {
      metadata.tags = val.filter(t => typeof t === "string") as string[];
    } else {
      messages.push({ level: "error", node: nodeName, message: `tags must be a comma-separated string or array` });
    }
  }

  // triggerId
  if ("triggerId" in extras) {
    const val = extras["triggerId"];
    if (typeof val !== "string" || val.length === 0) {
      messages.push({ level: "error", node: nodeName, message: `triggerId must be a non-empty string` });
    } else {
      metadata.triggerId = val;
    }
  }

  // spawnType
  if ("spawnType" in extras) {
    const val = extras["spawnType"];
    if (typeof val !== "string" || !VALID_SPAWN_TYPES.has(val)) {
      messages.push({
        level: "error", node: nodeName,
        message: `spawnType must be one of: ${[...VALID_SPAWN_TYPES].join(", ")} (got "${val}")`,
      });
    } else {
      metadata.spawnType = val as SceneNodeMetadata["spawnType"];
    }
  }

  // networked
  if ("networked" in extras) {
    const val = extras["networked"];
    if (typeof val !== "boolean" && val !== 0 && val !== 1) {
      messages.push({ level: "error", node: nodeName, message: `networked must be a boolean` });
    } else {
      metadata.networked = !!val;
    }
  }

  // interactable
  if ("interactable" in extras) {
    const val = extras["interactable"];
    if (typeof val !== "boolean" && val !== 0 && val !== 1) {
      messages.push({ level: "error", node: nodeName, message: `interactable must be a boolean` });
    } else {
      metadata.interactable = !!val;
    }
  }

  // scriptParams
  if ("scriptParams" in extras) {
    const val = extras["scriptParams"];
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      metadata.scriptParams = val as Record<string, unknown>;
    } else {
      messages.push({ level: "error", node: nodeName, message: `scriptParams must be an object` });
    }
  }

  return { metadata, messages };
}

// ─── Scene-level validation ──────────────────────────────────────────────────

export interface SceneValidationResult {
  messages: ValidationMessage[];
  hasErrors: boolean;
}

export function validateScene(
  nodes: Array<{ name?: string; extras?: Record<string, unknown> }>,
): SceneValidationResult {
  const messages: ValidationMessage[] = [];
  let hasPlayerSpawn = false;
  const triggerIds = new Map<string, string[]>(); // triggerId → node names

  for (const node of nodes) {
    const name = node.name ?? "(unnamed)";
    const { messages: nodeMessages, metadata } = parseNodeMetadata(name, node.extras);
    messages.push(...nodeMessages);

    // Check for player spawn
    if (name === "player" || metadata.spawnType === "player") {
      hasPlayerSpawn = true;
    }

    // Track trigger IDs for duplicate detection
    if (metadata.triggerId) {
      const existing = triggerIds.get(metadata.triggerId) ?? [];
      existing.push(name);
      triggerIds.set(metadata.triggerId, existing);
    }
  }

  // Missing player spawn
  if (!hasPlayerSpawn) {
    messages.push({
      level: "error", node: "(scene)",
      message: 'No player spawn found — add an object named "player" or set spawnType="player"',
    });
  }

  // Duplicate trigger IDs
  for (const [triggerId, nodeNames] of triggerIds) {
    if (nodeNames.length > 1) {
      messages.push({
        level: "warning", node: "(scene)",
        message: `Duplicate triggerId "${triggerId}" on nodes: ${nodeNames.join(", ")}`,
      });
    }
  }

  return {
    messages,
    hasErrors: messages.some(m => m.level === "error"),
  };
}
