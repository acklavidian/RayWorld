import type { Behavior, BehaviorContext } from "../behavior.ts";
import type { PrefabDef } from "../prefab.ts";

/**
 * Dynamic physics crate prefab.
 * Wraps existing dynamic body support — the crate is already a physics object
 * via physicsType="dynamic". This behavior adds gameplay tracking (e.g. tagging
 * when the crate is grabbed or at rest).
 *
 * scriptParams:
 *   breakable — whether the crate can be broken (default: false, future feature)
 */

function createCrateBehavior(params: Record<string, unknown>): Behavior {
  const _breakable = Boolean(params["breakable"] ?? false);

  return {
    init(ctx: BehaviorContext) {
      ctx.api?.log(`Crate "${ctx.self.name}" initialized (breakable: ${_breakable})`);
    },

    update(_ctx: BehaviorContext) {
      // Future: check velocity to detect impacts, breakage, etc.
    },

    onInteract(ctx: BehaviorContext) {
      ctx.api?.log(`Crate "${ctx.self.name}" interacted with`);
    },
  };
}

export const cratePrefab: PrefabDef = {
  name: "crate",
  behaviors: [createCrateBehavior],
  defaultTags: ["crate", "dynamic"],
};
