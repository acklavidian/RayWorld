import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

/**
 * Collectible pickup prefab.
 * Disappears (tags itself as collected) when the player comes close enough.
 *
 * scriptParams:
 *   pickupRange — distance to collect (default: 1.5)
 *   category — pickup category string for tracking (default: "item")
 */

function createPickupBehavior(params: Record<string, unknown>): Behavior {
  const pickupRange = Number(params["pickupRange"] ?? 1.5);
  const category    = String(params["category"]    ?? "item");
  let collected     = false;

  return {
    update(ctx: BehaviorContext) {
      if (collected) return;
      if (!ctx.api) return;

      const playerPos = ctx.api.getPlayerPosition();
      const spawnPos  = ctx.self.def.spawnPosition;
      if (!spawnPos) return;

      const dx   = playerPos.x - spawnPos[0];
      const dy   = playerPos.y - spawnPos[1];
      const dz   = playerPos.z - spawnPos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < pickupRange) {
        collected = true;
        ctx.api.addTag(ctx.self, "collected");
        ctx.api.log(`Pickup "${ctx.self.name}" collected (category: ${category})`);
      }
    },

    onInteract(ctx: BehaviorContext) {
      if (collected) return;
      collected = true;
      ctx.api?.addTag(ctx.self, "collected");
      ctx.api?.log(`Pickup "${ctx.self.name}" collected via interact (category: ${category})`);
    },
  };
}

export const pickupPrefab: PrefabDef = {
  name: "pickup",
  behaviors: [createPickupBehavior],
  defaultTags: ["pickup"],
};
