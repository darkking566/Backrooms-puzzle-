import type { Level0World, WorldData } from "./types";
import type { Level1, Level1WorldData } from "./level1";
export type ActiveWorld = Level0World | Level1;
export type SavedWorld = WorldData | Level1WorldData;
