/* Inventory possession and an explicit switch are separate from environmental darkness. */
import type { RunState } from "../state/types";
export const hasTorch = (r: RunState) => r.flashlightOn && r.inv.some(x => x.id === "flashlight");
