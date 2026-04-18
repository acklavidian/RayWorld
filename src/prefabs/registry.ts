import { registerPrefab } from "../prefab.ts";
import { doorPrefab } from "./door.ts";
import { triggerZonePrefab } from "./trigger_zone.ts";
import { buttonPrefab } from "./button.ts";
import { pickupPrefab } from "./pickup.ts";
import { cratePrefab } from "./crate.ts";

let _registered = false;

export function registerAllPrefabs(): void {
  if (_registered) return;
  _registered = true;

  registerPrefab(doorPrefab);
  registerPrefab(triggerZonePrefab);
  registerPrefab(buttonPrefab);
  registerPrefab(pickupPrefab);
  registerPrefab(cratePrefab);
}
