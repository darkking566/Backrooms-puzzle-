import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { draw } from "../src/core/rng";
import { newMeta } from "../src/state/types";
import { makePack, matchesPack, packCode, validCode } from "../src/systems/symbol-lock";
import { loadContent } from "../tools/content-plugin";
const c = loadContent(), def = c.puzzles[0];
function setup(seed = 73) { const m = newMeta(), g = Game.newRun(c, m, seed, []); return { g, m }; }

describe("symbol locks", () => {
  it("generates matching clues and a reproducible answer, including zeros and repeats", () => {
    const answers = new Set<string>(); let zero = false, repeated = false;
    for (let seed = 0; seed < 100; seed++) {
      const { g, m } = setup(seed), { g: b, m: bm } = setup(seed);
      const p = makePack(def, g.run, m, { i: 2, j: 3 }, () => draw(g.run.rng, "puzzles"));
      const q = makePack(def, b.run, bm, { i: 2, j: 3 }, () => draw(b.run.rng, "puzzles"));
      expect(p).toEqual(q); const code = packCode(p); expect(matchesPack(p, code)).toBe(true);
      expect(new Set(p.order).size).toBe(3); expect(new Set(p.marksOrder).size).toBe(3);
      expect(p.items[0].id).toBe("almond_water"); answers.add(code.join(""));
      zero ||= code[0] === 0; repeated ||= new Set(code).size < 3;
      expect(matchesPack(p, code.map((n, k) => k ? n : (n + 1) % 10))).toBe(false);
    }
    expect(answers.size).toBeGreaterThan(80); expect(zero && repeated).toBe(true);
  });
  it("never repeats the preceding code and only uses the puzzles stream", () => {
    const { g, m } = setup();
    m.symbolLock.lastCode = "000"; const counters = { ...g.run.rng.counters };
    const p = makePack(def, g.run, m, { i: 0, j: 0 }, () => draw(g.run.rng, "puzzles"));
    expect(packCode(p).join("")).not.toBe("000"); expect(m.symbolLock.lastCode).toBe(packCode(p).join(""));
    const { puzzles: _a, ...old } = g.run.rng.counters, { puzzles: _b, ...before } = counters; expect(old).toEqual(before);
  });
  it.each([[1, 2], [0, 0, 10], [1, -1, 0], [1, 2, .5], [NaN, 0, 0]])("rejects invalid code %j", (...code) => { expect(validCode(code)).toBe(false); });
});
