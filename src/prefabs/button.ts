import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

/**
 * Pressable button prefab.
 * When interacted with (or player is close enough), sends an event to
 * a linked object identified by a target name.
 *
 * scriptParams:
 *   target — name of the object to notify (default: "")
 *   pressRange — distance to auto-press (default: 2)
 *   cooldown — seconds between presses (default: 1)
 */

function createButtonBehavior(params: Record<string, unknown>): Behavior {
  const target     = String(params["target"]     ?? "");
  const pressRange = Number(params["pressRange"] ?? 2);
  const cooldown   = Number(params["cooldown"]   ?? 1);

  let cooldownTimer = 0;
  let wasInRange    = false;

  return {
    update(ctx: BehaviorContext) {
      if (cooldownTimer > 0) {
        cooldownTimer -= ctx.dt;
      }

      if (!ctx.api) return;

      const playerPos = ctx.api.getPlayerPosition();
      const spawnPos  = ctx.self.def.spawnPosition;
      if (!spawnPos) return;

      const dx   = playerPos.x - spawnPos[0];
      const dy   = playerPos.y - spawnPos[1];
      const dz   = playerPos.z - spawnPos[2];
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      const inRange = dist < pressRange;
      // Auto-press on entry
      if (inRange && !wasInRange && cooldownTimer <= 0) {
        _press(ctx);
      }
      wasInRange = inRange;
    },

    onInteract(ctx: BehaviorContext) {
      if (cooldownTimer <= 0) {
        _press(ctx);
      }
    },
  };

  function _press(ctx: BehaviorContext): void {
    cooldownTimer = cooldown;
    ctx.api?.log(`Button "${ctx.self.name}" pressed`);

    // Notify target object's behaviors
    if (target && ctx.api) {
      const targetObj = ctx.api.findByName(target);
      if (targetObj) {
        ctx.api.log(`Button → notifying "${target}"`);
        // Trigger onInteract on the target's behaviors
        for (const b of targetObj.behaviors) {
          b.onInteract?.({
            ...ctx,
            self: targetObj,
          });
        }
      } else {
        ctx.api.log(`Button target "${target}" not found`);
      }
    }
  }
}

export const buttonPrefab: PrefabDef = {
  name: "button",
  behaviors: [createButtonBehavior],
  defaultTags: ["button", "interactable"],
};
