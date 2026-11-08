import { describe, expect, it, vi } from "vitest";
import { Game } from "../src/core/game";
import { newMeta, type Corpse } from "../src/state/types";
import { exportSave, importSave, migrateMeta } from "../src/state/save";
import { recordNotebook } from "../src/systems/notebook";
import { tick } from "../src/systems/survival";
import { loadContent } from "../tools/content-plugin";

const c = loadContent();
const body: Corpse = { run: 2, items: [], cause: "death_injury", note: { zh: "水。", en: "Water." } };
describe("level state compatibility", () => {
  it("migrates the old body once and respects an explicitly empty new collection", () => {
    expect(migrateMeta({ corpse: body }).corpses).toEqual({ "level-0": body });
    expect(migrateMeta({ corpse: body, corpses: {} }).corpses).toEqual({});
    const m = migrateMeta({ corpse: body });
    expect(migrateMeta(m)).toEqual(m); expect(m).not.toHaveProperty("corpse");
  });
  it("a Level 0 death only replaces that level's body", () => {
    const m = newMeta(); m.corpses["level-1"] = body;
    const g = Game.newRun(c, m, 11, []);
    g.run.inv.push({ key: "pain", id: "bottle", bottle: { liquid: "liquid_pain", color: "reddish", full: true, sealed: true, spoiled: false } });
    g.dispatch({ type: "drink", key: "pain" });
    expect(m.corpses["level-1"]).toEqual(body);
    expect(m.corpses["level-0"]?.cause).toBe("death_liquid_pain");
  });
  it("adds only defaults, including an already-counted stranger, to an old run", () => {
    const g = Game.newRun(c, newMeta(), 8, ["flashlight"]);
    const old = JSON.parse(JSON.stringify(g.save()));
    for (const key of ["level", "mapPages", "l1", "flashlightOn", "npcSeenThisRun", "pendingRewards"]) delete old[key];
    old.roomPerson = { ...old.roomPerson, variant: "first", entered: true, separated: true, present: false };
    const r = importSave(exportSave(g.meta, old)).run!;
    expect(r.level).toBe("level-0"); expect(r.flashlightOn).toBe(true); expect(r.l1).toBeNull();
    expect(r.mapPages).toEqual([]); expect(r.npcSeenThisRun).toEqual(["manila_stranger"]);
    expect(r.world).toEqual(old.world); expect(r.pos).toEqual(old.pos); expect(r.rng).toEqual(old.rng);
  });
  it("saves manual light state and stops recording unseen details with the light off", () => {
    const g = Game.newRun(c, newMeta(), 22, ["flashlight", "notebook"]);
    vi.spyOn(g.world, "zone").mockReturnValue("dark");
    expect(g.run.flashlightOn).toBe(true); expect(g.hasLight()).toBe(true);
    g.dispatch({ type: "toggleFlashlight" }); expect(g.hasLight()).toBe(false);
    g.run.map = {}; recordNotebook(g.run, g.world, true);
    expect(g.run.map["0,0"].walls).toEqual(["unknown", "unknown", "unknown", "unknown"]);
    const r = importSave(exportSave(g.meta, g.save())).run!; expect(r.flashlightOn).toBe(false);
  });
  it("keeps the existing Level 0 sanity rules even when a flashlight is available", () => {
    const g = Game.newRun(c, newMeta(), 33, ["flashlight"]);
    vi.spyOn(g.world, "zone").mockReturnValue("dark");
    const a = structuredClone(g.run), b = structuredClone(g.run); b.flashlightOn = false;
    tick(a, 60, "idle", g.env()); tick(b, 60, "idle", g.env());
    expect(a.stats).toEqual(b.stats); expect(a.stats.sanity).toBeLessThan(80);
  });
});
