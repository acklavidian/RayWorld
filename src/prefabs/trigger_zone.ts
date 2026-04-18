import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

/**
 * Invisible trigger zone prefab.
 * Tracks whether the player is inside the zone and fires enter/exit events.
 *
 * scriptParams:
 *   radius — trigger radius in metres (default: 3)
 *   message — message to log when triggered (default: "")
 */

function createTriggerZoneBehavior(params: Record<string, unknown>): Behavior {
  const radius  = Number(params["radius"]  ?? 3);
  const message = String(params["message"] ?? "");

  let playerInside = false;

  return {
    update(ctx: BehaviorContext) {
      if (!ctx.api) return;

      const playerPos = ctx.api.getPlayerPosition();
      const spawnPos  = ctx.self.def.spawnPosition;
      if (!spawnPos) return;

      const dx   = playerPos.x - spawnPos[0];
      const dy   = playerPos.y - spawnPos[1];
      const dz   = playerPos.z - spawnPos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const wasInside = playerInside;
      playerInside = dist < radius;

      if (playerInside && !wasInside) {
        // Player entered
        const triggerId = ctx.self.def.extras["triggerId"] as string | undefined;
        ctx.api.log(`Trigger enter: "${ctx.self.name}"${triggerId ? ` (id: ${triggerId})` : ""}${message ? ` — ${message}` : ""}`);
      } else if (!playerInside && wasInside) {
        // Player exited
        ctx.api.log(`Trigger exit: "${ctx.self.name}"`);
      }
    },
  };
}

export const triggerZonePrefab: PrefabDef = {
  name: "trigger_zone",
  behaviors: [createTriggerZoneBehavior],
  defaultTags: ["trigger"],
};
