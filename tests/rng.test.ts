import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { draw, type Stream } from "../src/core/rng";
import { newMeta } from "../src/state/types";
import { makePack, packCode } from "../src/systems/symbol-lock";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
describe("puzzle stream isolation", () => {
  it("does not consume any of the six pre-existing streams", () => {
    const g = Game.newRun(c, newMeta(), 17, []), before = structuredClone(g.run.rng);
    g.run.lockedPack = makePack(c.puzzles[0], g.run, g.meta, g.run.pos, () => draw(g.run.rng, "puzzles"));
    g.dispatch({ type: "packExamine" }); g.dispatch({ type: "packMarks" }); g.dispatch({ type: "packAttempt", code: packCode(g.run.lockedPack) });
    for (const s of ["shift", "events", "loot", "body", "misc", "halluc"] as Stream[]) for (let k = 0; k < 10; k++) expect(draw(g.run.rng, s)).toBe(draw(before, s));
  });
});
