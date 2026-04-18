import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

/**
 * Sliding door prefab.
 * Opens when a player interacts (future onInteract hook) or comes within range.
 *
 * scriptParams:
 *   slideX, slideY, slideZ — direction and distance to slide (default: 0, 2, 0)
 *   speed — opening speed in m/s (default: 2)
 *   autoRange — distance at which the door auto-opens (default: 3, 0 = manual only)
 */

function createDoorBehavior(params: Record<string, unknown>): Behavior {
  const slideX = Number(params["slideX"] ?? 0);
  const slideY = Number(params["slideY"] ?? 2);
  const slideZ = Number(params["slideZ"] ?? 0);
  const speed  = Number(params["speed"]  ?? 2);
  const autoRange = Number(params["autoRange"] ?? 3);

  let openAmount = 0;  // 0 = closed, 1 = fully open
  let isOpen     = false;

  return {
    update(ctx: BehaviorContext) {
      // Auto-open based on player proximity
      if (autoRange > 0 && ctx.api) {
        const playerPos = ctx.api.getPlayerPosition();
        const spawnPos  = ctx.self.def.spawnPosition;
        if (spawnPos) {
          const dx = playerPos.x - spawnPos[0];
          const dy = playerPos.y - spawnPos[1];
          const dz = playerPos.z - spawnPos[2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          isOpen = dist < autoRange;
        }
      }

      // Animate open/close
      const target = isOpen ? 1 : 0;
      if (Math.abs(openAmount - target) > 0.001) {
        const dir = target > openAmount ? 1 : -1;
        openAmount += dir * speed * ctx.dt;
        openAmount = Math.max(0, Math.min(1, openAmount));
      }
    },

    onInteract(ctx: BehaviorContext) {
      isOpen = !isOpen;
      ctx.api?.log(`Door "${ctx.self.name}" ${isOpen ? "opening" : "closing"}`);
    },
  };
}

export const doorPrefab: PrefabDef = {
  name: "door",
  behaviors: [createDoorBehavior],
  defaultTags: ["door", "interactable"],
};
