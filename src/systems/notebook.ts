import type { ActiveWorld } from "../world/world";
/* Notebook memory is an observation, never a live view of the world. No DOM or random streams. */
import { DV, type Dir } from "../core/types";
import { hashWith } from "../core/rng";
import type { MapCell, MapEdge, MapKey, MapMark, RunState } from "../state/types";
import { edgeCells, isOpenDoor, passable, type Edge } from "../world/types";
import { hasTorch } from "./lighting";
import { H } from "./survival";

export const mapKey = (i: number, j: number): MapKey => `${i},${j}`;
export const NOTEBOOK_COOLDOWN = 6 * H;
const canSee = (r: RunState, w: ActiveWorld) => hasTorch(r) || (r.outageLeft <= 0 && w.zone(r.pos.i, r.pos.j) !== "dark");

export function mapEdge(edge: Edge | undefined): MapEdge {
  if (!edge) return "unknown";
  if (edge === "flicker" || edge === "fakeflicker") return "flicker";
  if (isOpenDoor(edge)) return "door-open";
  if (edge?.startsWith("door-")) return "door";
  return edge === "open" || edge === "arch" ? edge : "wall";
}

/** Applying this twice restores the original walls. The eligible set survives an open/wall swap. */
export function messyWalls(seed: number, i: number, j: number, ver: number, walls: MapCell["walls"]): MapCell["walls"] {
  const copy = [...walls] as MapCell["walls"];
  if (hashWith(seed, i, j, ver, 701) >= .15) return copy;
  const eligible = copy.flatMap((w, d) => w === "open" || w === "wall" ? [d] : []);
  if (eligible.length) {
    const d = eligible[Math.floor(hashWith(seed, i, j, ver, 702) * eligible.length)];
    copy[d] = copy[d] === "open" ? "wall" : "open";
  }
  return copy;
}

function snapshot(r: RunState, w: ActiveWorld, i: number, j: number, visited: boolean, visible = true): MapCell | null {
  const cell = w.cells.get(mapKey(i, j));
  if (!cell) return null;
  const walls = [0, 1, 2, 3].map(d => visible ? mapEdge(w.edgeAt(i, j, d)) : "unknown") as MapCell["walls"];
  const messy = r.stats.sanity < 35;
  return { walls: messy ? messyWalls(r.seed, i, j, cell.ver, walls) : walls,
    zone: visible ? w.zone(i, j) : "unknown", t: r.time, ver: cell.ver, messy, visited };
}

/** Record the current cell on entry; fill only blank pages ahead. Return a noticed discrepancy. */
export function recordNotebook(r: RunState, w: ActiveWorld, entered = false): boolean {
  if (!r.inv.some(x => x.id === "notebook")) return false;
  const { i, j, d } = r.pos, key = mapKey(i, j), old = r.map[key];
  if (!canSee(r, w)) {
    // Arriving in darkness cannot correct, erase or refresh an earlier drawing.
    if (old) old.visited = true;
    else { const cell = snapshot(r, w, i, j, true, false); if (cell) r.map[key] = cell; }
    return false;
  }
  let changed = false;
  if (entered || !old?.visited || old.zone === "unknown" || old.walls.includes("unknown")) {
    const next = snapshot(r, w, i, j, true);
    if (next) {
      if (old) {
        // Compare observations, not sanity-dependent pen errors or an invisible version change.
        const before = old.messy ? messyWalls(r.seed, i, j, old.ver, old.walls) : old.walls;
        const after = next.messy ? messyWalls(r.seed, i, j, next.ver, next.walls) : next.walls;
        changed = (old.zone !== "unknown" && old.zone !== next.zone) || before.some((edge, k) => edge !== "unknown" && edge !== after[k]);
      }
      r.map[key] = next;
    }
  }
  let a = i, b = j;
  for (let step = 0; step < 3; step++) {
    if (!passable(w.edgeAt(a, b, d))) break;
    a += DV[d][0]; b += DV[d][1];
    if (w.zone(a, b) === "dark" && !hasTorch(r)) break;
    const k = mapKey(a, b);
    if (!r.map[k]) { const cell = snapshot(r, w, a, b, false); if (cell) r.map[k] = cell; }
  }
  return changed;
}

/** Opening a nearby door changes just that observed edge, not the rest of an old drawing. */
export function recordNotebookDoor(r: RunState, w: ActiveWorld, edge: string) {
  if (!r.inv.some(x => x.id === "notebook") || !canSee(r, w)) return;
  const cells = edgeCells(edge), dirs: Dir[] = edge[0] === "v" ? [1, 3] : [2, 0];
  cells.forEach(([i, j], n) => { const cell = r.map[mapKey(i, j)]; if (cell) cell.walls[dirs[n]] = mapEdge(w.edges.get(edge)); });
}

export function setMapMark(r: RunState, key: MapKey, mark: MapMark | null) {
  if (!r.inv.some(x => x.id === "notebook") || !Object.hasOwn(r.map, key)) return;
  if (mark === null) { delete r.mapMarks[key]; return; }
  if (mark.kind === "custom") {
    const text = [...mark.text.trim().replace(/[\r\n\t]/g, " ")].slice(0, 20).join("");
    if (text) r.mapMarks[key] = { kind: "custom", text };
  } else if (mark.kind === "water" || mark.kind === "danger" || mark.kind === "exit") r.mapMarks[key] = { kind: mark.kind };
}

export function notebookReadBlock(r: RunState): "missing" | "blank" | "calm" | "cooldown" | null {
  if (!r.inv.some(x => x.id === "notebook")) return "missing";
  if (!Object.keys(r.map).length && !r.mapPages.some(p => Object.keys(p.map).length)) return "blank";
  if (r.stats.sanity >= 35) return "calm";
  if (r.lastNotebookRead !== null && r.time - r.lastNotebookRead < NOTEBOOK_COOLDOWN) return "cooldown";
  return null;
}
export function notebookReadGain(r: RunState): number {
  const cells = [...Object.values(r.map), ...r.mapPages.flatMap(p => Object.values(p.map))];
  return cells.filter(c => c.messy).length > cells.length / 2 ? 4 : 8;
}

export const mapOpacity = (now: number, recorded: number) => .25 + .75 * 2 ** (-Math.max(0, now - recorded) / (8 * H));
