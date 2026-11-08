import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { exportSave, importSave, migrateMeta } from "../src/state/save";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
function atBase(meta = newMeta(), seed = 131) {
  const g = Game.newRun(c, meta, seed, []); g.devJump("level1"); g.devJump("alpha"); g.dispatch({ type: "elderTalk" }); return g;
}
const hear = (g: Game, id: string) => g.dispatch({ type: "elderChoice", id });
describe("the elder at Alpha", () => {
  it("separates three different-run meetings and never unlocks later fragments on the first", () => {
    const m = newMeta(); m.roomPerson.flags.helped = m.roomPerson.flags.promisedAndLeft = m.roomPerson.flags.returnedWater = true;
    const g = atBase(m); hear(g, "room"); hear(g, "water");
    expect(g.elderChoices().map(c => c.id)).toEqual(["room", "water"]);
    expect(hear(g, "waiting").say).toEqual([]); expect(hear(g, "promise").say).toEqual([]);
    expect(m.clues).not.toContain("elder_waiting"); expect(m.clues).not.toContain("elder_promise");
    const second = atBase(m, 132); expect(second.run.l1!.elder.meeting).toBe(2);
    expect(hear(second, "waiting").say).toHaveLength(1); expect(hear(second, "promise").say).toEqual([]);
    const third = atBase(m, 133); expect(hear(third, "promise").say[0].zh).toContain("我去找更多，我會回來");
    expect(third.elderChoices().map(c => c.id)).toContain("returned");
  });
  it("requires hearing prerequisites, even on a late meeting", () => {
    const m = newMeta(); m.elder.meetings = 4; const g = atBase(m);
    expect(hear(g, "water").say).toEqual([]); expect(hear(g, "waiting").say).toEqual([]);
    expect(hear(g, "promise").say).toEqual([]); expect(m.clues).not.toContain("elder_last_water");
  });
  it("grants the fragment reward only on hearing the first water fragment, once across runs", () => {
    const g = atBase(); expect(g.run.pendingRewards.some(r => r.id === "elder:first-fragment")).toBe(false);
    hear(g, "room"); hear(g, "water"); hear(g, "water");
    expect(g.run.pendingRewards.filter(r => r.id === "elder:first-fragment").map(r => r.points)).toEqual([20]);
    const other = atBase(g.meta, 132); hear(other, "water");
    expect(other.run.pendingRewards.some(r => r.id === "elder:first-fragment")).toBe(false);
  });
  it("deduplicates canonical person familiarity within a run while counting the elder role", () => {
    const g = Game.newRun(c, newMeta(), 131, []);
    g.run.npcSeenThisRun.push("manila_stranger"); g.meta.npcMeetings.manila_stranger = 1;
    g.devJump("level1"); g.devJump("alpha"); g.dispatch({ type: "elderTalk" });
    expect(g.meta.npcMeetings.manila_stranger).toBe(1); expect(g.meta.elder.meetings).toBe(1);
    for (let i = 0; i < 5; i++) g.dispatch({ type: "elderTalk" });
    expect(g.meta.elder.meetings).toBe(1);
  });
  it("persists the meeting snapshot and does not count reload as a new run", () => {
    const g = atBase(); const save = importSave(exportSave(g.meta, g.save()))!;
    const loaded = new Game(c, save.meta, save.run!); loaded.dispatch({ type: "elderTalk" });
    expect(loaded.meta.elder.meetings).toBe(1); expect(loaded.run.l1!.elder.meeting).toBe(1);
  });
  it("migrates missing cross-run elder data and lets an existing Alpha save meet them", () => {
    const m = newMeta(); delete (m as Partial<typeof m>).elder;
    const migrated = migrateMeta(m); expect(migrated.elder).toEqual({ meetings: 0, rewardClaimed: false });
    const g = Game.newRun(c, migrated, 131, []); g.devJump("level1"); g.devJump("alpha");
    expect(g.run.l1!.elder.met).toBe(false); g.dispatch({ type: "elderTalk" }); expect(g.meta.elder.meetings).toBe(1);
  });
  it("rejects dialogue commands outside the base without leaking clues", () => {
    const g = Game.newRun(c, newMeta(), 131, []); g.devJump("level1");
    expect(g.dispatch({ type: "elderTalk" }).say).toEqual([]); expect(hear(g, "room").say).toEqual([]);
    expect(g.meta.elder.meetings).toBe(0);
  });
});
