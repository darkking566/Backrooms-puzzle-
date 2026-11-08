import { describe, expect, it } from "vitest";
import { Level0, edgeKey, passable, VIEW } from "../src/world/level0";
import { DV, ck } from "../src/core/types";

const snapshot = (w: Level0) => [...w.edges].sort().join("|") + [...w.cells.values()].map(c => `${c.i},${c.j},${JSON.stringify(c.panel)}`).sort().join("|");

describe("Level 0 generator", () => {
  it("is deterministic per seed", () => {
    const a = new Level0(1234), b = new Level0(1234), c = new Level0(99);
    a.ensureAround(0, 0); b.ensureAround(0, 0); c.ensureAround(0, 0);
    expect(snapshot(a)).toBe(snapshot(b));
    expect(snapshot(a)).not.toBe(snapshot(c));
  });
  it("round-trips through saved data", () => {
    const a = new Level0(77); a.ensureAround(0, 0); a.shiftUnseen(a.visibleFrom([{ i: 0, j: 0, d: 0 }]));
    const b = new Level0(77, JSON.parse(JSON.stringify(a.toData())));
    expect(snapshot(b)).toBe(snapshot(a));
  });
  it("never leaves a reachable cell with fewer than two ways on (except red rooms)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new Level0(seed); w.ensureAround(0, 0);
      for (let i = -VIEW + 1; i < VIEW; i++) for (let j = -VIEW + 1; j < VIEW; j++) {
        if (w.zone(i, j) === "red" || w.zone(i, j) === "manila") continue;
        const n = [0, 1, 2, 3].filter(d => { const t = w.edgeAt(i, j, d); return passable(t) || t === "door-wood" || t === "door-manila"; }).length;
        expect(n, `seed ${seed} cell ${i},${j}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
  it("a random walk keeps moving for 400 steps (no traps)", () => {
    const w = new Level0(42); let i = 0, j = 0; w.ensureAround(0, 0);
    let x = 7;
    for (let s = 0; s < 400; s++) {
      const opts = [0, 1, 2, 3].filter(d => passable(w.edgeAt(i, j, d)) && w.zone(i + DV[d][0], j + DV[d][1]) !== "red");
      expect(opts.length, `stuck at ${i},${j}`).toBeGreaterThan(0);
      x = (x * 1103515245 + 12345) & 0x7fffffff; const d = opts[x % opts.length];
      i += DV[d][0]; j += DV[d][1]; w.ensureAround(i, j);
      if (s % 3 === 0) w.shiftUnseen(w.visibleFrom([{ i, j, d: d as 0 }]));
    }
  });
  it("shift never changes what you can see", () => {
    const w = new Level0(5); w.ensureAround(0, 0);
    const vis = w.visibleFrom([{ i: 0, j: 0, d: 0 }]);
    const before = [...vis].map(k => JSON.stringify(w.cells.get(k))).join();
    const keepEdge = edgeKey(0, -1, 0), t = w.edges.get(keepEdge);
    w.shiftUnseen(vis);
    expect([...vis].map(k => JSON.stringify(w.cells.get(k))).join()).toBe(before);
    expect(w.edges.get(keepEdge)).toBe(t);
    expect(w.cells.has(ck(0, 0))).toBe(true);
  });
  it("places the Manila Room with four doors and red rooms with one way in", () => {
    const w = new Level0(31337); const [mi, mj] = w.manila; w.ensureAround(mi, mj);
    const doors = [...w.manilaDoors()].map(k => w.edges.get(k));
    expect(doors.every(t => t === "door-manila")).toBe(true);
    for (let i = mi - 8; i < mi + 8; i++) for (let j = mj - 8; j < mj + 8; j++) if (w.zone(i, j) === "red") {
      expect([0, 1, 2, 3].filter(d => passable(w.edgeAt(i, j, d))).length).toBeLessThanOrEqual(1);
    }
  });
});
