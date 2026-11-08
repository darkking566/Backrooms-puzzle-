import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { exportSave, importSave, migrateMeta, loadRun, persist } from "../src/state/save";
import { newMeta, SAVE_VERSION } from "../src/state/types";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
describe("v1 save additions", () => {
  it("adds defaults to old loaded and imported runs without rerolling a pack", async () => {
    const g = Game.newRun(c, newMeta(), 91, []), old = JSON.parse(JSON.stringify(g.save()));
    delete old.packPlan; delete old.lockedPack; delete old.rng.counters.puzzles;
    const meta = JSON.parse(JSON.stringify(g.meta)); delete meta.symbolLock;
    const s = importSave(exportSave(meta, old)); expect(s.meta.symbolLock).toEqual({ ruleNoteSeen: false, lastCode: null });
    expect(s.run!.packPlan).toBe("none"); expect(s.run!.lockedPack).toBeNull(); expect(s.run!.rng.counters.puzzles).toBe(0);
    await persist(s.meta, old); expect((await loadRun())!.packPlan).toBe("none"); expect(SAVE_VERSION).toBe(1);
  });
  it("merges partially populated nested meta fields", () => {
    const m = newMeta(); m.symbolLock = { ruleNoteSeen: true } as typeof m.symbolLock;
    expect(migrateMeta(m).symbolLock).toEqual({ ruleNoteSeen: true, lastCode: null });
  });
});
