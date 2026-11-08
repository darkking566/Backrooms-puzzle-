import { describe, expect, it } from "vitest";
import { Game } from "../src/core/game";
import { newMeta } from "../src/state/types";
import { exportSave, importSave } from "../src/state/save";
import { edgeKey } from "../src/world/types";
import { warehouseSurvival } from "../src/systems/rewards";
import { loadContent } from "../tools/content-plugin";
const c = loadContent();
function arrive(bought: string[] = []) { const g = Game.newRun(c, newMeta(), 122, bought); g.devJump("level1"); return g; }
describe("same-run warehouse exploration", () => {
  it("crosses the real wall without settlement, time, healing or a new awakening", () => {
    const g = Game.newRun(c, newMeta(), 131, ["notebook", "flashlight"]);
    g.run.stats.water = 4; g.run.stats.sanity = 25; g.run.status.infection = -1; g.run.time = 3120;
    g.run.mapMarks["0,0"] = { kind: "custom", text: "記得這裡" }; g.run.lastNotebookRead = 3110;
    const old = structuredClone(g.run), key = edgeKey(0, 0, 2);
    g.world.edges.set(key, "flicker"); const o = g.dispatch({ type: "flicker", edge: key });
    expect(o.levelChanged).toBe(true); expect(o.ended).toBeUndefined(); expect(o.minutes).toBe(0);
    expect(g.run.ended).toBeNull(); expect(g.meta.points).toBe(0); expect(g.meta.runs).toBe(1);
    expect(g.run.time).toBe(old.time); expect(g.run.stats).toEqual(old.stats); expect(g.run.inv).toEqual(old.inv);
    expect(g.run.status).toEqual(old.status); expect(g.run.rng).toEqual(old.rng);
    expect(g.run.mapPages).toEqual([{ level: "level-0", map: old.map, mapMarks: old.mapMarks }]);
    expect(g.run.lastNotebookRead).toBe(3110); expect(g.run.l1?.enteredAt).toBe(3120);
    expect(g.meta.history).toEqual([]); expect(g.meta.endings).not.toContain("exit_level1");
    expect(g.run.pendingRewards.map(x => x.points)).toEqual([300, 250]);
  });
  it("persists the warehouse and exactly-once arrival and base supplies", () => {
    const g = arrive(); g.devJump("alpha"); g.dispatch({ type: "baseSupplies" });
    const s = importSave(exportSave(g.meta, g.save())), loaded = new Game(c, s.meta, s.run!);
    expect(loaded.world.level).toBe("level-1"); expect(loaded.run.pos).toEqual(g.run.pos);
    const state = JSON.stringify(loaded.save()); loaded.dispatch({ type: "baseSupplies" });
    expect(JSON.stringify(loaded.save())).not.toBe(state); // a feedback line is recorded, no new resources
    if (loaded.world.level !== "level-1") throw new Error("warehouse expected");
    expect(loaded.world.crates.get("base")!.items).toHaveLength(5);
    expect(loaded.run.pendingRewards).toHaveLength(2); expect(loaded.run.l1!.baseClaimed).toBe(true);
  });
  it("opens crates without a crowbar only after examining the side latch", () => {
    const g = arrive(); if (g.world.level !== "level-1") throw new Error("warehouse expected");
    const box = [...g.world.crates.values()].find(x => x.kind === "supply")!;
    g.run.pos = { i: box.i, j: box.j, d: 0 }; g.world.ensureAround(box.i, box.j);
    g.dispatch({ type: "crateOpen", id: box.id }); expect(box.opened).toBe(false);
    g.dispatch({ type: "crateExamine", id: box.id }); g.dispatch({ type: "crateOpen", id: box.id }); expect(box.opened).toBe(true);
    const it = box.items[0]; if (it) {
      g.dispatch({ type: "crateTake", id: box.id, key: it.key }); g.dispatch({ type: "crateTake", id: box.id, key: it.key });
      expect(g.run.inv.filter(x => x.key === it.key)).toHaveLength(1);
    }
  });
  it("provides water immediately and forbids Level 0-only commands", () => {
    const g = arrive(); const initial = g.run.time;
    g.dispatch({ type: "crateTake", id: "arrival", key: "l1:arrival:almond_water:0" });
    expect(g.run.inv[0].id).toBe("almond_water");
    for (const cmd of [{ type: "wring" }, { type: "ceiling" }, { type: "roomPersonTalk" }] as const) g.dispatch(cmd);
    expect(g.run.time).toBe(initial + 1); expect(g.canWring()).toBe(false); expect(g.canReachPack()).toBe(false);
    g.dispatch({ type: "drink", key: g.run.inv[0].key }); expect(g.run.stats.water).toBeGreaterThan(90);
  });
  it("keeps paths stable after turns and rests, and restores sanity in Base Alpha", () => {
    const g = arrive(); g.devJump("alpha"); const edges = [...g.world.edges]; g.run.stats.sanity = 20;
    g.dispatch({ type: "turn", dir: 2 }); g.dispatch({ type: "rest", hours: 8 });
    expect([...g.world.edges]).toEqual(edges); expect(g.run.shifted).toBe(0); expect(g.run.stats.sanity).toBeGreaterThan(43);
  });
  it("settles layer time once and only replaces the body in the current layer", () => {
    const g = arrive(), oldBody = { run: 0, items: [], cause: "death_injury", note: { zh: "紙。", en: "Paper." } };
    g.meta.corpses["level-0"] = oldBody; g.run.l1!.enteredAt = 2880; g.run.time = 2880 + 1440 * 100;
    const score = warehouseSurvival(g.run, c);
    expect(score.at(-1)?.pts).toBe(40); expect(score[0].pts).toBe(20); expect(score[1].pts).toBe(16);
    g.run.inv.push({ key: "pain", id: "bottle", bottle: { liquid: "liquid_pain", color: "reddish", full: true, sealed: true, spoiled: false } });
    g.dispatch({ type: "drink", key: "pain" }); const points = g.meta.points;
    expect(g.run.ended?.level).toBe("level-1"); expect(g.meta.corpses["level-0"]).toEqual(oldBody);
    expect(g.meta.corpses["level-1"]?.cause).toBe("death_liquid_pain");
    g.dispatch({ type: "drink", key: "pain" }); expect(g.meta.points).toBe(points);
  });
  it("does not re-award first discovery to old exit saves", () => {
    const m = newMeta(); m.endings.push("exit_level1"); const g = Game.newRun(c, m, 10, []); g.devJump("level1");
    expect(g.run.pendingRewards.map(x => x.points)).toEqual([300]);
    expect(importSave(exportSave(m, g.save())).meta.discoveries).toContain("level1");
  });
  it("remembers the crate method and can reread archived pages without resetting the cooldown", () => {
    const g = arrive(["notebook"]); g.run.stats.sanity = 20;
    expect(Object.keys(g.run.mapPages[0].map).length).toBeGreaterThan(0);
    g.run.map = {}; g.run.lastNotebookRead = null; const sanity = g.run.stats.sanity;
    g.dispatch({ type: "rereadNotebook" }); expect(g.run.stats.sanity).toBeGreaterThan(sanity);
    const readAt = g.run.lastNotebookRead; g.dispatch({ type: "rereadNotebook" }); expect(g.run.lastNotebookRead).toBe(readAt);
    if (g.world.level !== "level-1") throw new Error("warehouse expected");
    const box = [...g.world.crates.values()].find(x => x.kind === "supply")!;
    g.run.pos = { i: box.i, j: box.j, d: 0 }; g.world.ensureAround(box.i, box.j);
    g.meta.clues.push("warehouse_latch"); g.dispatch({ type: "crateOpen", id: box.id }); expect(box.opened).toBe(true);
  });
  it("reports only the minutes actually survived during a fatal warehouse rest", () => {
    const g = arrive(); g.run.stats.water = 0; g.run.stats.health = .1;
    const before = g.run.time, out = g.dispatch({ type: "rest", hours: 8 });
    expect(g.run.ended).not.toBeNull(); expect(out.minutes).toBe(g.run.time - before); expect(out.minutes).toBeLessThan(8 * 60);
  });
});
