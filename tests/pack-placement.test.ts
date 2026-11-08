import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { ck, DV, type Dir } from "../src/core/types";
import { newMeta } from "../src/state/types";
import { edgeKey, traversable } from "../src/world/level0";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
function archGame() {
  const m = newMeta(); m.runs = 1; const g = Game.newRun(c, m, 1234, []);
  const cell = [...g.world.cells.values()].find(c => g.world.zone(c.i, c.j) === "arch")!;
  g.run.pos = { i: cell.i, j: cell.j, d: 0 }; g.world.ensureAround(cell.i, cell.j);
  g.run.moves = 8; g.run.packPlan = "arch"; return g;
}
describe("unseen pack placement", () => {
  it("only chooses stable reachable arch cells outside the movement's old and new views", () => {
    const g = archGame(), before = { ...g.run.pos };
    const d = ([0, 1, 2, 3] as Dir[]).find(d => traversable(g.world.edgeAt(before.i, before.j, d)) && g.world.zone(before.i + DV[d][0], before.j + DV[d][1]) === "arch")!;
    g.world.edges.set(edgeKey(before.i, before.j, d), "open"); g.dispatch({ type: "move", d });
    const p = g.run.lockedPack!; expect(p).not.toBeNull(); expect(g.world.zone(p.pos.i, p.pos.j)).toBe("arch");
    expect(g.world.visibleFrom([before, g.run.pos]).has(ck(p.pos.i, p.pos.j))).toBe(false);
    const old = structuredClone(p); g.world.shiftUnseen(new Set()); g.world.ensureAround(100, 100); g.world.ensureAround(p.pos.i, p.pos.j); expect(g.run.lockedPack).toEqual(old);
  });
  it("waits when no unseen reachable candidate exists", () => {
    const g = archGame(); expect(g.world.unseenArchSite([g.run.pos])).not.toBeNull();
    const poses = [...g.world.cells.values()].flatMap(c => ([0, 1, 2, 3] as Dir[]).map(d => ({ i: c.i, j: c.j, d })));
    expect(g.world.unseenArchSite(poses)).toBeNull();
  });
  it("has no first-run packs and preselects later runs reproducibly", () => {
    const first = Game.newRun(c, newMeta(), 1, []); expect(first.run.packPlan).toBe("none"); expect(first.run.rng.counters.puzzles).toBe(0);
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 30; seed++) { const a = newMeta(), b = newMeta(); a.runs = b.runs = 1; const x = Game.newRun(c, a, seed, []), y = Game.newRun(c, b, seed, []); expect(x.run.packPlan).toBe(y.run.packPlan); outcomes.add(x.run.packPlan); }
    expect(outcomes.size).toBe(2);
  });
});
