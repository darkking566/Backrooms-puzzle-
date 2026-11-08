/* Shared grid contracts. Level-specific mechanics remain on their own interfaces. */
import type { Dir } from "../core/types";

export type LevelId = "level-0" | "level-1";
export type Pose = { i: number; j: number; d: Dir };
export const S = 4;                                    // cell size in metres
export const VIEW = 8;                                 // logic view distance in cells (renderer draws at most this far)

export type Zone = "hall" | "arch" | "pillar" | "dark" | "pit" | "manila" | "red";
export type BottleColor = "grey" | "green" | "blue" | "reddish";
export interface Panel { int: number; warm: number; flick?: boolean; red?: boolean }
export interface Bottle { liquid: string; color: BottleColor; full: boolean; sealed: boolean; spoiled: boolean; boiled?: boolean }
export interface GroundItem { key: string; id: string; bottle?: Bottle; x: number; z: number }
export interface Cell {
  i: number; j: number; ver: number;
  panel: Panel | "dead" | null; hole: boolean; pits: [number, number][]; items: GroundItem[];
  searched: boolean; salt: boolean;          // salt: firesalt crystals in a corner
}
export type Edge = "open" | "wall" | "arch" | "flicker" | "fakeflicker" | "mwall" | "door-wood" | "door-metal" | "door-manila"
  | "door-wood-open" | "door-metal-open" | "door-manila-open";

export interface WorldData {                            // what is saved
  seed: number; manila: [number, number];
  cells: Cell[]; edges: [string, Edge][]; fixed: string[]; picked: string[]; opened: [string, number][];
  flickerKey: string | null; fakeKey: string | null; corpse: [number, number] | null;
}

export const isOpenDoor = (t?: string) => !!t && t.endsWith("-open");
export const passable = (t?: string) => t === "open" || t === "arch" || isOpenDoor(t);
export const traversable = (t?: string) => passable(t) || t === "door-wood" || t === "door-manila";
export const solid = (t?: string) => !!t && !passable(t);
export function edgeKey(i: number, j: number, d: Dir | number): string { return d === 1 ? `v:${i},${j}` : d === 3 ? `v:${i - 1},${j}` : d === 2 ? `h:${i},${j}` : `h:${i},${j - 1}`; }
export function edgeCells(k: string): [[number, number], [number, number]] {
  const [t, rest] = k.split(":"); const [i, j] = rest.split(",").map(Number);
  return t === "v" ? [[i, j], [i + 1, j]] : [[i, j], [i, j + 1]];
}

export type Listener = (i: number, j: number) => void;
export interface World<Z extends string, D> {
  readonly level: LevelId;
  readonly seed: number;
  cells: Map<string, Cell>;
  edges: Map<string, Edge>;
  picked: Set<string>;
  opened: Map<string, number>;
  corpse: [number, number] | null;
  listeners: Listener[];
  hash(...n: number[]): number;
  zone(i: number, j: number): Z;
  stable(i: number, j: number): boolean;
  edgeAt(i: number, j: number, d: Dir | number): Edge | undefined;
  ensureAround(i: number, j: number, r?: number): void;
  visibleFrom(poses: Pose[]): Set<string>;
  toData(): D;
}
export interface Level0World extends World<Zone, WorldData> {
  readonly level: "level-0";
  manila: [number, number];
  fixed: Set<string>;
  flickerKey: string | null;
  fakeKey: string | null;
  inManila(i: number, j: number): boolean;
  manilaDist(i: number, j: number): number;
  redDist(i: number, j: number): number;
  redCoresNear(i: number, j: number): [number, number][];
  redEntrance(i: number, j: number): string;
  yellower(k: string): boolean;
  rollBottle(i: number, j: number, ver: number, salt?: number): Bottle;
  shiftUnseen(vis: Set<string>, sleeping?: boolean): number;
  unseenArchSite(poses: Pose[]): { i: number; j: number } | null;
  wallAhead(i: number, j: number, d: Dir, maxSteps?: number): string | null;
  straightRun(i: number, j: number, d: Dir, max?: number): number;
}
