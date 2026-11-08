import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { exportSave, importSave } from "../src/state/save";
import { loadContent } from "../tools/content-plugin";
import { recordNotebook } from "../src/systems/notebook";

function setup(light = true) {
  const c = loadContent(); c.hazards[0].encounter.chance = c.hazards[0].encounter.lightChance = 1;
  const g = Game.newRun(c, newMeta(), 101, light ? ["flashlight"] : []); g.devJump("level1"); return g;
}
function notice(g: Game) {
  g.run.l1!.power = { phase: "warning", nextAt: g.run.time + 1 };
  return g.dispatch({ type: "wait" });
}
describe("warehouse power and Smilers", () => {
  it("interrupts a long action at a warning without granting search loot", () => {
    const g = setup(), before = g.run.time; g.run.l1!.power.nextAt = before + 1;
    const out = g.dispatch({ type: "search" });
    expect(out.interrupted).toBe(true); expect(out.minutes).toBe(1); expect(g.cellHere().searched).toBe(false);
    expect(g.run.l1!.power.phase).toBe("warning"); expect(g.run.l1!.encounter).toBeNull();
  });
  it("always leaves a new sighting at noticed, with no same-command injury", () => {
    const g = setup(), hp = g.run.stats.health, out = notice(g);
    expect(g.run.l1!.encounter?.phase).toBe("noticed"); expect(g.run.stats.health).toBe(hp);
    expect(out.captionVisual).toBe(true); expect(out.caption).toEqual(g.c.hazards[0].text.litCaption);
  });
  it("uses the unlit sighting even if the player owns no flashlight", () => {
    const g = setup(false), out = notice(g);
    expect(out.caption).toEqual(g.c.hazards[0].text.darkCaption);
    expect(out.say.map(t => t.en).join(" ")).not.toContain("toward your light");
  });
  it("warns again before an attack, and correct retreat is deterministic", () => {
    for (const light of [true, false]) {
      const g = setup(light); notice(g); g.dispatch({ type: "search" });
      expect(g.run.l1!.encounter?.phase).toBe("approaching"); expect(g.run.stats.health).toBe(100);
      const dest = { ...g.run.l1!.encounter!.retreat }; g.dispatch({ type: "avoidEntity" });
      expect(g.run.l1!.encounter).toBeNull(); expect(g.run.stats.health).toBe(100);
      expect(g.run.pos.i).toBe(dest.i); expect(g.run.pos.j).toBe(dest.j); expect(g.run.flashlightOn).toBe(false);
      expect(g.run.l1!.hazards.avoided).toBe(1); expect(g.run.l1!.hazards.hits).toBe(0);
    }
  });
  it("only hits after both warnings were ignored, without granting the blocked action", () => {
    const g = setup(); notice(g); g.dispatch({ type: "search" }); g.dispatch({ type: "search" });
    expect(g.run.stats.health).toBe(80); expect(g.run.status.bleeding).toBeGreaterThan(g.run.time);
    expect(g.run.l1!.hazards.hits).toBe(1); expect(g.run.l1!.encounter).toBeNull(); expect(g.cellHere().searched).toBe(false);
  });
  it("can turn off the light and read free information without advancing the threat", () => {
    const g = setup(); notice(g); g.dispatch({ type: "toggleFlashlight" });
    const t = g.run.time; g.dispatch({ type: "readGuide" }); g.dispatch({ type: "readSign" });
    expect(g.run.time).toBe(t); expect(g.run.l1!.encounter?.phase).toBe("noticed");
  });
  it("persists warnings, encounters and RNG without re-rolling on reload", () => {
    const g = setup(); notice(g); const s = importSave(exportSave(g.meta, g.save()));
    const restored = new Game(g.c, s.meta, s.run!);
    expect(restored.run.l1).toEqual(g.run.l1); expect(restored.run.rng).toEqual(g.run.rng);
    expect(restored.dispatch({ type: "avoidEntity" })).toEqual(g.dispatch({ type: "avoidEntity" }));
  });
  it("lets Base Alpha sleep across outages without spawning an entity", () => {
    const g = setup(); g.devJump("alpha"); g.run.l1!.power.nextAt = g.run.time + 1;
    const out = g.dispatch({ type: "rest", hours: 8 });
    expect(out.minutes).toBe(480); expect(g.run.l1!.hazards.outages).toBeGreaterThan(0);
    expect(g.run.l1!.encounter).toBeNull(); expect(g.run.l1!.hazards.hits).toBe(0);
  });
  it("migrates a stage-four warehouse save without changing its supplies or drawing RNG", () => {
    const g = setup(), old = JSON.parse(JSON.stringify(g.save())); delete old.l1.hazards;
    const s = importSave(exportSave(g.meta, old));
    expect(s.run!.l1!.hazards).toEqual({ outages: 0, noticed: 0, avoided: 0, hits: 0 });
    expect(s.run!.rng).toEqual(old.rng); expect(s.run!.world).toEqual(old.world);
  });
  it("records the Smiler death and leaves a body in the correct layer", () => {
    const g = setup(); notice(g); g.dispatch({ type: "search" }); g.run.stats.health = 10;
    g.dispatch({ type: "search" }); expect(g.run.ended?.ending).toBe("death_smiler");
    expect(g.meta.corpses["level-1"]?.cause).toBe("death_smiler");
  });
  it("can attract a Smiler by switching on midway through a blackout, only once per outage", () => {
    const g = setup(); g.c.hazards[0].encounter.chance = 0; g.run.flashlightOn = false;
    notice(g); expect(g.run.l1!.encounter).toBeNull();
    g.dispatch({ type: "toggleFlashlight" }); expect(g.run.l1!.encounter?.phase).toBe("noticed");
    g.dispatch({ type: "avoidEntity" }); g.dispatch({ type: "toggleFlashlight" });
    expect(g.run.l1!.encounter).toBeNull(); expect(g.run.l1!.hazards.noticed).toBe(1);
  });
  it("uses Level 1 power for notebook visibility and keeps the base readable", () => {
    const g = setup(false); g.run.inv.push({ key: "book", id: "notebook" });
    g.run.outageLeft = 5; g.run.map = {}; recordNotebook(g.run, g.world, true);
    expect(g.run.map["0,0"].zone).toBe("arrival");
    g.run.l1!.power.phase = "blackout"; g.run.map = {}; recordNotebook(g.run, g.world, true);
    expect(g.run.map["0,0"].zone).toBe("unknown");
    g.devJump("alpha"); expect(g.run.map[`${g.run.pos.i},${g.run.pos.j}`].zone).toBe("alpha");
  });
});
