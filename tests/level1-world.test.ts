import { describe, expect, it } from "vitest";
import { Level1 } from "../src/world/level1";
import { DV, type Dir } from "../src/core/types";
import { edgeCells, passable } from "../src/world/types";
import { loadContent } from "../tools/content-plugin";
const rules = loadContent().levels[0];
describe("stable warehouse generation", () => {
  it("always has an equipment-free marked route and a connected base", () => {
    for (let seed = 0; seed < 150; seed++) {
      const w = new Level1(seed, rules); let i = 0, j = 0;
      expect(w.distance).toBeGreaterThanOrEqual(8); expect(w.distance).toBeLessThanOrEqual(12);
      for (let n = 0; n < w.distance; n++) {
        const d = w.routeMark(i, j)!; expect(d).not.toBeNull(); expect(passable(w.edgeAt(i, j, d))).toBe(true);
        i += DV[d][0]; j += DV[d][1];
      }
      expect(w.zone(i, j)).toBe("alpha");
      expect(w.zone(...w.global(w.distance + 1, 1))).toBe("alpha");
    }
  });
  it("makes reciprocal edges and never creates a cell with no retreat", () => {
    const w = new Level1(7, rules); w.ensureAround(0, 0);
    for (const c of w.cells.values()) {
      let ways = 0;
      for (let d = 0; d < 4; d++) {
        const ni = c.i + DV[d][0], nj = c.j + DV[d][1];
        expect(w.edgeAt(c.i, c.j, d)).toBe(w.edgeAt(ni, nj, (d + 2) % 4));
        if (passable(w.edgeAt(c.i, c.j, d))) ways++;
      }
      expect(ways).toBeGreaterThan(0);
    }
  });
  it("preserves searched cells, dropped items and opened crates across eviction and reload", () => {
    const w = new Level1(99, rules); w.ensureAround(0, 0);
    w.cells.get("0,0")!.searched = true;
    w.cells.get("0,0")!.items.push({ key: "dropped", id: "notebook", x: 0, z: 0 });
    const crate = [...w.crates.values()].find(c => c.kind !== "emergency")!; crate.opened = true; crate.items = [];
    const originalEdges = [...w.edges].filter(([k]) => edgeCells(k).some(([i, j]) => i === 0 && j === 0));
    w.ensureAround(50, 50);
    const restored = new Level1(99, rules, structuredClone(w.toData())); restored.ensureAround(0, 0);
    expect(restored.cells.get("0,0")!.items[0].key).toBe("dropped"); expect(restored.cells.get("0,0")!.searched).toBe(true);
    expect(restored.crates.get(crate.id)?.items).toEqual([]); expect(restored.crates.get(crate.id)?.opened).toBe(true);
    for (const [k, v] of originalEdges) expect(restored.edges.get(k)).toBe(v);
  });
  it("has identical geometry and supplies regardless of exploration order", () => {
    const a = new Level1(103, rules), b = new Level1(103, rules);
    a.ensureAround(0, 0); a.ensureAround(20, 20); b.ensureAround(20, 20); b.ensureAround(0, 0);
    for (let i = -8; i < 30; i++) for (let j = -8; j < 30; j++) for (let d = 0; d < 4; d++) expect(a.edgeAt(i, j, d as Dir)).toBe(b.edgeAt(i, j, d));
    const sort = (w: Level1) => [...w.crates].sort(([x], [y]) => x.localeCompare(y));
    expect(sort(a)).toEqual(sort(b));
    expect(a.crates.get("arrival")!.items.map(x => x.id)).toEqual(["almond_water", "bandage"]);
  });
});
