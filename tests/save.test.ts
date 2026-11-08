import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { exportSave, importSave, migrateMeta, loadRun, persist } from "../src/state/save";
import { newMeta, SAVE_VERSION } from "../src/state/types";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
describe("v1 save additions", () => {
  it("adds defaults to old loaded and imported runs without rerolling a pack", async () => {
    const g = Game.newRun(c, newMeta(), 91, []), old = JSON.parse(JSON.stringify(g.save()));
    delete old.level;
    delete old.packPlan; delete old.lockedPack; delete old.rng.counters.puzzles;
    const meta = JSON.parse(JSON.stringify(g.meta)); delete meta.symbolLock;
    const s = importSave(exportSave(meta, old)); expect(s.meta.symbolLock).toEqual({ ruleNoteSeen: false, lastCode: null });
    expect(s.run!.level).toBe("level-0"); expect(s.run!.world).toEqual(old.world); expect(s.run!.rng.seed).toBe(old.rng.seed);
    expect(s.run!.packPlan).toBe("none"); expect(s.run!.lockedPack).toBeNull(); expect(s.run!.rng.counters.puzzles).toBe(0);
    await persist(s.meta, old); expect((await loadRun())!.packPlan).toBe("none"); expect(SAVE_VERSION).toBe(1);
  });
  it("merges partially populated nested meta fields", () => {
    const m = newMeta(); m.symbolLock = { ruleNoteSeen: true } as typeof m.symbolLock;
    expect(migrateMeta(m).symbolLock).toEqual({ ruleNoteSeen: true, lastCode: null });
  });
  it("loads phase-one packs unchanged and never inserts an encounter into an old run", () => {
    const g = Game.newRun(c, newMeta(), 73, []), old = JSON.parse(JSON.stringify(g.save()));
    old.lockedPack = { id: "fallen_pack", pos: { i: 0, j: 0 }, order: ["circle", "triangle", "square"], marksOrder: ["square", "circle", "triangle"], numbers: { circle: 0, triangle: 4, square: 4 }, seen: true, hasRuleNote: true, marksSeen: true, failures: 3, jammed: true, openedBy: null, items: [{ key: "old:water", id: "almond_water" }] };
    delete old.roomPerson; delete old.rng.counters.quests;
    const m = JSON.parse(JSON.stringify(g.meta)); delete m.roomPerson; delete m.npcMeetings;
    const s = importSave(exportSave(m, old)); expect(s.run!.lockedPack).toEqual(old.lockedPack);
    expect(s.run!.roomPerson.variant).toBe("none"); expect(s.run!.rng.counters.quests).toBe(0); expect(s.meta.npcMeetings).toEqual({});
    const partial = newMeta(); partial.roomPerson = { flags: { helped: true } } as typeof partial.roomPerson;
    const migrated = migrateMeta(partial); expect(migrated.roomPerson.flags.helped).toBe(true); expect(migrated.roomPerson.flags.waited).toBe(false); expect(migrated.roomPerson.phase).toBe("first");
  });

});
